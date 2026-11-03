import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';

// ================== Configuración ==================
const ISLAND_R = 105;
const PLAYER = { walk: 5.5, run: 9.5, jump: 7.5, hp: 100, mag: 12, reserve: 48, dmg: 34 };
const ENEMY = { count: 9, hp: 100, dmg: 9, range: 48, fireMin: 1.0, fireMax: 1.8, speed: 3.4 };
const MAX_WALLS = 10;
const GRAVITY = 22;
const rnd = (a, b) => a + Math.random() * (b - a);

// ================== Render ==================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbfd8e8, 0.0042);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 4000);

// Cielo físico + sol
const sun = new THREE.Vector3();
const sky = new Sky();
sky.scale.setScalar(10000);
Object.assign(sky.material.uniforms, {});
sky.material.uniforms.turbidity.value = 6;
sky.material.uniforms.rayleigh.value = 1.6;
sky.material.uniforms.mieCoefficient.value = 0.005;
sky.material.uniforms.mieDirectionalG.value = 0.8;
sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 32), THREE.MathUtils.degToRad(200));
sky.material.uniforms.sunPosition.value.copy(sun);

// Iluminación ambiental a partir del cielo (PBR)
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene(); envScene.add(sky);
scene.environment = pmrem.fromScene(envScene).texture;
scene.add(sky);

const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.bias = -0.0004;
Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
scene.add(sunLight, sunLight.target);
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5a4a30, 0.35));

// Agua realista
const water = new Water(new THREE.PlaneGeometry(4000, 4000), {
  textureWidth: 512, textureHeight: 512,
  waterNormals: new THREE.TextureLoader().load('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/textures/waternormals.jpg',
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }),
  sunDirection: sun.clone().normalize(), sunColor: 0xffffff, waterColor: 0x0b4a5e, distortionScale: 3.2, fog: true,
});
water.rotation.x = -Math.PI / 2;
water.position.y = 0;
scene.add(water);

// ================== Terreno ==================
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z) => vnoise(x, z) * 0.55 + vnoise(x * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, z * 4.3) * 0.15;
function heightAt(x, z) {
  const r = Math.hypot(x, z) / ISLAND_R;
  const f = 1 - r * r;
  if (f <= 0) return f * 12 - 0.5;
  const hill = Math.exp(-((x - 20) ** 2 + (z + 30) ** 2) / 900) * 14; // colina con el tesoro
  return f * 5 + fbm(x * 0.035, z * 0.035) * 6 * f + hill * f - 0.6;
}

const TSIZE = 300, TSEG = 220;
const tGeo = new THREE.PlaneGeometry(TSIZE, TSIZE, TSEG, TSEG);
tGeo.rotateX(-Math.PI / 2);
const tp = tGeo.attributes.position, colors = [];
const cSand = new THREE.Color(0xd8c08a), cWet = new THREE.Color(0x9c8a62), cGrass = new THREE.Color(0x5f7f35),
  cGrass2 = new THREE.Color(0x3f6526), cRock = new THREE.Color(0x77716a), tmp = new THREE.Color();
for (let i = 0; i < tp.count; i++) {
  const x = tp.getX(i), z = tp.getZ(i), h = heightAt(x, z);
  tp.setY(i, h);
  const n = fbm(x * 0.2, z * 0.2);
  if (h < 0.2) tmp.copy(cWet);
  else if (h < 1.4) tmp.copy(cSand).lerp(cGrass, THREE.MathUtils.smoothstep(h, 1.0, 1.4));
  else if (h < 9) tmp.copy(cGrass).lerp(cGrass2, n);
  else tmp.copy(cGrass2).lerp(cRock, THREE.MathUtils.smoothstep(h, 9, 12));
  tmp.offsetHSL(0, 0, (n - 0.5) * 0.06);
  colors.push(tmp.r, tmp.g, tmp.b);
}
tGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
tGeo.computeVertexNormals();
const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
terrain.receiveShadow = true;
scene.add(terrain);

// ================== Objetos del mundo ==================
const solids = [];       // mallas que bloquean balas
const circles = [];      // colisionadores {x, z, r, wall?}
const stdMat = (c, r = 0.85, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const M = {
  bark: stdMat(0x6b4f35), leaf: stdMat(0x3c7a2a, 0.7), rock: stdMat(0x8a8580, 0.95), wood: stdMat(0x8a5a32),
  darkWood: stdMat(0x4a2f1c), sail: stdMat(0xe8dfc8, 0.9), metal: stdMat(0x333333, 0.4, 0.8), gold: stdMat(0xffc94a, 0.3, 1),
  straw: stdMat(0xc9a55c), cloth: stdMat(0x8b1e1e),
};
function addMesh(geo, mat, x, y, z, solid = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true; scene.add(m);
  if (solid) solids.push(m);
  return m;
}
function freeSpot(minH, maxH, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * ISLAND_R * 0.9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
    if (h > minH && h < maxH && !circles.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 3)) return { x, z, h };
  }
  return null;
}

// Palmeras
const leafGeo = new THREE.ConeGeometry(0.5, 4.2, 4, 1); leafGeo.translate(0, 2.1, 0); leafGeo.scale(1, 1, 0.15);
function palm(x, z) {
  const h = heightAt(x, z), g = new THREE.Group(); g.position.set(x, h, z);
  const H = rnd(6, 9), lean = rnd(-0.25, 0.25), segs = 6;
  let top = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - i * 0.015, 0.26 - i * 0.015, H / segs, 7), M.bark);
    const y = (i + 0.5) * (H / segs);
    s.position.set(lean * y * y * 0.05, y, 0); s.castShadow = true; g.add(s); solids.push(s);
    top.set(lean * H * H * 0.05, H, 0);
  }
  for (let i = 0; i < 8; i++) {
    const l = new THREE.Mesh(leafGeo, M.leaf);
    l.position.copy(top); l.rotation.set(0, (i / 8) * Math.PI * 2, 0);
    l.rotateX(rnd(1.1, 1.6)); l.castShadow = true; g.add(l);
  }
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M.darkWood); c.position.copy(top).add(new THREE.Vector3(rnd(-.3, .3), -0.3, rnd(-.3, .3))); g.add(c); }
  g.rotation.y = Math.random() * 6.28;
  scene.add(g);
  circles.push({ x, z, r: 0.45 });
}
// Rocas
function rock(x, z, s) {
  const geo = new THREE.IcosahedronGeometry(s, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rnd(0.8, 1.2), p.getY(i) * rnd(0.6, 1), p.getZ(i) * rnd(0.8, 1.2));
  geo.computeVertexNormals();
  const m = addMesh(geo, M.rock, x, heightAt(x, z) + s * 0.3, z);
  m.rotation.set(rnd(0, 3), rnd(0, 3), 0);
  circles.push({ x, z, r: s * 0.9 });
}
// Cabaña
function hut(x, z, rot) {
  const h = heightAt(x, z), g = new THREE.Group(); g.position.set(x, h, z); g.rotation.y = rot;
  const box = (w, hh, d, mat, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m); solids.push(m); return m; };
  box(6, 3, 0.25, M.wood, 0, 1.5, -2.5); box(0.25, 3, 5, M.wood, -3, 1.5, 0); box(0.25, 3, 5, M.wood, 3, 1.5, 0);
  box(2, 3, 0.25, M.wood, -2, 1.5, 2.5); box(2, 3, 0.25, M.wood, 2, 1.5, 2.5);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5, 2.5, 4), M.straw); roof.position.y = 4.2; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  scene.add(g);
  // colisionadores de las paredes (huecos en la puerta)
  const pts = [[-3, -2.5], [-1.5, -2.5], [0, -2.5], [1.5, -2.5], [3, -2.5], [-3, -1], [-3, 0.5], [-3, 2], [3, -1], [3, 0.5], [3, 2], [-2.5, 2.5], [-1.5, 2.5], [1.5, 2.5], [2.5, 2.5]];
  for (const [px, pz] of pts) { const c = Math.cos(rot), s = Math.sin(rot); circles.push({ x: x + px * c + pz * s, z: z - px * s + pz * c, r: 0.6 }); }
}
// Barco naufragado
function wreck(x, z) {
  const g = new THREE.Group(); g.position.set(x, heightAt(x, z) - 0.6, z); g.rotation.set(0.12, 0.6, 0.2);
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(3, 2, 16, 10, 1, true, 0, Math.PI), M.darkWood);
  hull.rotation.set(0, 0, Math.PI / 2); hull.rotation.x = Math.PI / 2; hull.material.side = THREE.DoubleSide; hull.castShadow = true; g.add(hull); solids.push(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 12, 8), M.darkWood); mast.position.y = 5; mast.rotation.z = 0.3; mast.castShadow = true; g.add(mast); solids.push(mast);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(6, 4, 8, 4), M.sail); sail.position.set(-1.2, 7, 0.3); sail.rotation.z = 0.3; sail.material.side = THREE.DoubleSide; sail.castShadow = true; g.add(sail);
  scene.add(g);
  for (let i = -6; i <= 6; i += 2) { const c = Math.cos(0.6), s = Math.sin(0.6); circles.push({ x: x + i * c, z: z - i * s, r: 2 }); }
}
// Cajas (cobertura)
function crate(x, z, s = 1.2) { const m = addMesh(new THREE.BoxGeometry(s, s, s), M.wood, x, heightAt(x, z) + s / 2, z); m.rotation.y = rnd(0, 3); circles.push({ x, z, r: s * 0.7 }); }

hut(-30, 25, 0.4); hut(-42, 5, 1.6); hut(35, 30, -0.8);
wreck(72, 52);
for (let i = 0; i < 90; i++) { const p = freeSpot(0.8, 9); if (p) palm(p.x, p.z); }
for (let i = 0; i < 40; i++) { const p = freeSpot(0.3, 20); if (p) rock(p.x, p.z, rnd(0.8, 2.6)); }
for (let i = 0; i < 25; i++) { const p = freeSpot(0.5, 12); if (p) { crate(p.x, p.z); if (Math.random() < 0.5) crate(p.x + 1.3, p.z + 0.3); } }

// Hierba
const grassGeo = new THREE.ConeGeometry(0.06, 0.6, 3); grassGeo.translate(0, 0.3, 0);
const grass = new THREE.InstancedMesh(grassGeo, stdMat(0x5b8a2f, 0.9), 6000);
const dummy = new THREE.Object3D(); let gi = 0;
for (let i = 0; i < 20000 && gi < 6000; i++) {
  const x = rnd(-ISLAND_R, ISLAND_R), z = rnd(-ISLAND_R, ISLAND_R), h = heightAt(x, z);
  if (h < 1.5 || h > 10) continue;
  dummy.position.set(x, h, z); dummy.rotation.set(rnd(-0.3, 0.3), rnd(0, 6), rnd(-0.3, 0.3)); dummy.scale.setScalar(rnd(0.6, 1.4));
  dummy.updateMatrix(); grass.setMatrixAt(gi++, dummy.matrix);
}
grass.count = gi; scene.add(grass);

// ================== Humanoides ==================
function humanoid(o) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = stdMat(o.skin, 0.6), shirt = stdMat(o.shirt, 0.85), pants = stdMat(o.pants, 0.9), boots = stdMat(0x2a1d14, 0.7);
  const mesh = (geo, m, x, y, z, parent = body) => { const r = new THREE.Mesh(geo, m); r.position.set(x, y, z); r.castShadow = true; parent.add(r); return r; };
  const torso = mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 10), shirt, 0, 1.25, 0); torso.scale.set(1.15, 1, 0.75);
  mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 12), stdMat(0x3b2616, 0.6), 0, 0.98, 0); // cinturón
  const head = mesh(new THREE.SphereGeometry(0.2, 16, 12), skin, 0, 1.83, 0);
  head.scale.set(1, 1.12, 1);
  mesh(new THREE.BoxGeometry(0.2, 0.04, 0.02), stdMat(0x111111), 0, 1.86, 0.19); // ojos (línea)
  if (o.beard) mesh(new THREE.SphereGeometry(0.16, 10, 8), stdMat(o.beard, 0.9), 0, 1.72, 0.08).scale.set(1, 0.8, 0.8);
  // sombrero
  if (o.hat === 'tricorn') {
    mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.05, 3), stdMat(0x1d1410, 0.8), 0, 2.02, 0).rotation.y = Math.PI;
    mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.18, 12), stdMat(0x1d1410, 0.8), 0, 2.1, 0);
  } else if (o.hat === 'straw') {
    const straw = stdMat(0xe8b85c, 0.95), band = stdMat(0xc0201c, 0.8), hair = stdMat(0x111111, 0.9);
    // pelo despeinado negro
    mesh(new THREE.SphereGeometry(0.215, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, 0, 1.86, -0.01);
    for (let i = 0; i < 7; i++) { const a = -1.2 + i * 0.4; const t = mesh(new THREE.ConeGeometry(0.05, 0.14, 5), hair, Math.sin(a) * 0.17, 1.92, Math.cos(a) * 0.15); t.rotation.set(Math.PI * 0.75, a, 0); }
    // sombrero de paja con cinta roja
    mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.03, 24), straw, 0, 2.02, 0);
    mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.16, 20), straw, 0, 2.11, 0);
    mesh(new THREE.CylinderGeometry(0.222, 0.222, 0.05, 20), band, 0, 2.06, 0);
    // cicatriz bajo el ojo izquierdo y sonrisa grande
    mesh(new THREE.BoxGeometry(0.07, 0.012, 0.01), stdMat(0x5a1a10), -0.08, 1.8, 0.195).rotation.z = 0.2;
    mesh(new THREE.BoxGeometry(0.16, 0.05, 0.02), stdMat(0xffffff, 0.4), 0, 1.74, 0.18);
  } else {
    mesh(new THREE.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), stdMat(o.hat, 0.9), 0, 1.86, 0);
  }
  const limb = (r, len, m, x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); mesh(new THREE.CapsuleGeometry(r, len, 4, 8), m, 0, -len / 2 - r, 0, p); body.add(p); return p; };
  if (o.vest) { // chaleco abierto: pecho descubierto en V
    const v = mesh(new THREE.BoxGeometry(0.14, 0.42, 0.02), skin, 0, 1.36, 0.215); v.scale.set(1, 1, 1);
    mesh(new THREE.ConeGeometry(0.1, 0.22, 3), skin, 0, 1.12, 0.205).rotation.z = Math.PI;
    for (const y of [1.18, 1.05]) { mesh(new THREE.SphereGeometry(0.02, 6, 4), stdMat(0xf2c230, 0.4), -0.09, y, 0.21); }
  }
  const sleeve = o.vest ? skin : shirt;
  const armL = limb(0.075, 0.55, sleeve, -0.38, 1.58), armR = limb(0.075, 0.55, sleeve, 0.38, 1.58);
  mesh(new THREE.SphereGeometry(0.075, 8, 6), skin, 0, -0.75, 0, armL); mesh(new THREE.SphereGeometry(0.075, 8, 6), skin, 0, -0.75, 0, armR);
  const legL = limb(0.1, 0.7, pants, -0.14, 0.95), legR = limb(0.1, 0.7, pants, 0.14, 0.95);
  if (o.shorts) { // pantalón corto doblado: espinillas descubiertas y sandalias
    for (const leg of [legL, legR]) {
      leg.children[0].material = skin;
      mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.45, 10), pants, 0, -0.2, 0, leg);
      mesh(new THREE.TorusGeometry(0.125, 0.03, 6, 12), pants, 0, -0.43, 0, leg).rotation.x = Math.PI / 2;
      mesh(new THREE.BoxGeometry(0.15, 0.04, 0.28), stdMat(0x6b4a2a, 0.8), 0, -0.99, 0.05, leg);
    }
  } else {
    mesh(new THREE.BoxGeometry(0.17, 0.12, 0.3), boots, 0, -0.95, 0.05, legL); mesh(new THREE.BoxGeometry(0.17, 0.12, 0.3), boots, 0, -0.95, 0.05, legR);
  }
  // pistola de chispa en la mano derecha
  const gun = new THREE.Group(); gun.position.set(0, -0.78, 0.05); armR.add(gun);
  mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.42, 8), M.metal, 0, -0.05, 0.2, gun).rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.07, 0.16, 0.12), M.darkWood, 0, -0.08, 0, gun);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.05, 0.42); gun.add(muzzle);
  gun.rotation.x = Math.PI / 2;
  scene.add(root);
  root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return { root, body, head, armL, armR, legL, legR, muzzle };
}

// ================== Audio sintetizado ==================
let actx = null;
function shotSound(vol = 1, pitch = 1) {
  if (!actx) return;
  const len = 0.25, buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = actx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2500 * pitch;
  const g = actx.createGain(); g.gain.value = 0.5 * vol;
  src.connect(f).connect(g).connect(actx.destination); src.start();
}
function beep(freq, dur = 0.12, vol = 0.15, type = 'square') {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
}

// ================== Efectos ==================
const fx = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true });
function tracer(a, b) {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), tracerMat.clone());
  scene.add(l); fx.push({ o: l, life: 0.08, age: 0, kind: 'line' });
}
const flashMat = new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
function muzzleFlash(p) {
  const s = new THREE.Sprite(flashMat.clone()); s.position.copy(p); s.scale.setScalar(0.6);
  scene.add(s); fx.push({ o: s, life: 0.06, age: 0, kind: 'sprite' });
}
const dustMat = new THREE.SpriteMaterial({ color: 0xc8b490, transparent: true, depthWrite: false });
const bloodMat = new THREE.SpriteMaterial({ color: 0x8a0000, transparent: true, depthWrite: false });
function puff(p, blood = false) {
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite((blood ? bloodMat : dustMat).clone()); s.position.copy(p); s.scale.setScalar(rnd(0.15, 0.35));
    scene.add(s); fx.push({ o: s, life: 0.5, age: 0, kind: 'sprite', v: new THREE.Vector3(rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1)) });
  }
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.age += dt;
    if (f.v) { f.o.position.addScaledVector(f.v, dt); f.v.y -= 4 * dt; }
    f.o.material.opacity = 1 - f.age / f.life;
    if (f.age >= f.life) { scene.remove(f.o); f.o.material.dispose(); f.o.geometry?.dispose?.(); fx.splice(i, 1); }
  }
}

// ================== Estado del juego ==================
const $ = (id) => document.getElementById(id);
const P = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, hp: 100, mag: 12, reserve: 48,
  reloading: 0, fireCd: 0, onGround: true, walk: 0, aiming: false, walls: MAX_WALLS, hurt: 0,
};
const player = humanoid({ skin: 0xe9b98f, shirt: 0xc0201c, pants: 0x2f5fa8, hat: 'straw', vest: true, shorts: true, beard: null });
let enemies = [], pickups = [], walls = [], state = 'menu', treasure, treasureBeam, msgT = 0;
const keys = {};
let mouseDown = false;

function showMsg(t, d = 2.5) { $('msg').textContent = t; $('msg').style.opacity = 1; msgT = d; }

function spawnEnemies() {
  enemies.forEach((e) => scene.remove(e.m.root));
  enemies = [];
  const shirts = [0x7a1d1d, 0x4d2e1a, 0x2f4f2f, 0x5a1a4a, 0x6b5a1e];
  for (let i = 0; i < ENEMY.count; i++) {
    let p;
    do { p = freeSpot(1.2, 18); } while (!p || Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 40);
    const m = humanoid({ skin: [0xb07850, 0x8d5a3a, 0xd7a07a][i % 3], shirt: shirts[i % 5], pants: 0x2a2a2a, hat: 0x9e1b1b, beard: [0x222222, 0x5a3a1a, null][i % 3] });
    m.root.position.set(p.x, p.h, p.z);
    m.root.traverse((c) => { if (c.isMesh) c.userData.enemy = i; });
    enemies.push({ m, pos: new THREE.Vector3(p.x, p.h, p.z), home: new THREE.Vector3(p.x, p.h, p.z), hp: ENEMY.hp, alive: true,
      cd: rnd(1, 2), los: false, losT: 0, alert: 0, last: new THREE.Vector3(), wander: null, walk: 0, dead: 0, id: i });
  }
}
function spawnPickups() {
  pickups.forEach((p) => scene.remove(p.m)); pickups = [];
  for (let i = 0; i < 12; i++) {
    const p = freeSpot(0.6, 15); if (!p) continue;
    const ammo = i % 2 === 0;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.45), ammo ? stdMat(0x5a6b2a) : stdMat(0xf2f2f2));
    box.castShadow = true; g.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(ammo ? 0.72 : 0.3, ammo ? 0.08 : 0.3, ammo ? 0.47 : 0.47), ammo ? M.gold : stdMat(0xd32f2f));
    g.add(band);
    if (!ammo) { const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.47), stdMat(0xd32f2f)); g.add(b2); band.scale.set(1, 0.33, 1); }
    g.position.set(p.x, p.h + 0.6, p.z); scene.add(g);
    pickups.push({ m: g, type: ammo ? 'ammo' : 'hp', taken: false, base: p.h + 0.6 });
  }
}
function buildTreasure() {
  if (treasure) scene.remove(treasure, treasureBeam);
  const x = 20, z = -30, h = heightAt(x, z);
  treasure = new THREE.Group(); treasure.position.set(x, h, z);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), M.darkWood); base.position.y = 0.4; base.castShadow = true; treasure.add(base);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 12, 1, false, 0, Math.PI), M.darkWood);
  lid.rotation.z = Math.PI / 2; lid.position.y = 0.8; lid.castShadow = true; treasure.add(lid); treasure.userData.lid = lid;
  for (const x2 of [-0.5, 0.5]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.95), M.gold); s.position.set(x2, 0.42, 0); treasure.add(s); }
  scene.add(treasure);
  treasureBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 80, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
  treasureBeam.position.set(x, h + 40, z); treasureBeam.visible = false; scene.add(treasureBeam);
}

function reset() {
  walls.forEach((w) => { scene.remove(w.m); solids.splice(solids.indexOf(w.m), 1); });
  walls = [];
  for (let i = circles.length - 1; i >= 0; i--) if (circles[i].wall) circles.splice(i, 1);
  Object.assign(P, { hp: PLAYER.hp, mag: PLAYER.mag, reserve: PLAYER.reserve, reloading: 0, fireCd: 0, walls: MAX_WALLS, hurt: 0, yaw: Math.PI * 0.75, pitch: -0.05 });
  P.pos.set(-60, 0, 60); P.pos.y = heightAt(P.pos.x, P.pos.z); P.vel.set(0, 0, 0);
  spawnEnemies(); spawnPickups(); buildTreasure();
  $('obj').textContent = `🏴‍☠️ Elimina a los piratas rivales (${ENEMY.count})`;
}

// ================== Entrada ==================
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (state !== 'play') return;
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyQ') buildWall();
  if (e.code === 'KeyE') openTreasure();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => (keys[e.code] = false));
addEventListener('mousemove', (e) => {
  if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
  const s = P.aiming ? 0.0012 : 0.0022;
  P.yaw -= e.movementX * s;
  P.pitch = THREE.MathUtils.clamp(P.pitch - e.movementY * s, -1.1, 0.9);
});
addEventListener('mousedown', (e) => {
  if (state !== 'play') return;
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) { mouseDown = true; shoot(); }
  if (e.button === 2) P.aiming = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; if (e.button === 2) P.aiming = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'play') { state = 'pause'; $('menu').classList.remove('hidden'); $('play').textContent = 'Continuar'; }
});
function start() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  $('menu').classList.add('hidden'); $('end').classList.add('hidden');
  state = 'play';
  renderer.domElement.requestPointerLock();
}
$('play').addEventListener('click', start);
$('again').addEventListener('click', () => { reset(); start(); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ================== Acciones ==================
const ray = new THREE.Raycaster();
const camDir = new THREE.Vector3();

function terrainHit(origin, dir, maxD) {
  for (let d = 0.5; d < maxD; d += 0.5) {
    const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
    if (y < heightAt(x, z)) return d;
  }
  return Infinity;
}
function reload() {
  if (P.reloading > 0 || P.mag === PLAYER.mag || P.reserve <= 0) return;
  P.reloading = 1.4; $('reload').classList.remove('hidden'); beep(300, 0.08, 0.08); setTimeout(() => beep(500, 0.08, 0.08), 900);
}
function shoot() {
  if (P.fireCd > 0 || P.reloading > 0) return;
  if (P.mag <= 0) { beep(160, 0.06, 0.08); reload(); return; }
  P.mag--; P.fireCd = 0.22;
  shotSound(1, rnd(0.95, 1.05));
  camera.getWorldDirection(camDir);
  // dispersión
  const spread = (P.aiming ? 0.004 : 0.018) + (P.onGround ? 0 : 0.03) + (keys.ShiftLeft ? 0.02 : 0);
  camDir.x += rnd(-spread, spread); camDir.y += rnd(-spread, spread); camDir.z += rnd(-spread, spread); camDir.normalize();
  ray.set(camera.position, camDir); ray.far = 200;
  const targets = [...solids];
  enemies.forEach((e) => e.alive && e.m.root.traverse((c) => c.isMesh && targets.push(c)));
  const hits = ray.intersectObjects(targets, false).filter((h) => h.distance > 3);
  const tD = terrainHit(camera.position, camDir, 200);
  let end = camera.position.clone().addScaledVector(camDir, Math.min(200, tD));
  const h = hits[0];
  if (h && h.distance < tD) {
    end = h.point;
    if (h.object.userData.enemy !== undefined) {
      const e = enemies[h.object.userData.enemy];
      const head = h.object === e.m.head;
      hitEnemy(e, head ? PLAYER.dmg * 2.5 : PLAYER.dmg, head);
      puff(h.point, true);
    } else puff(h.point);
  } else if (tD < 200) puff(end);
  const m = new THREE.Vector3(); player.muzzle.getWorldPosition(m);
  tracer(m, end); muzzleFlash(m);
  P.pitch += 0.012; // retroceso
  if (P.mag === 0) reload();
}
function hitEnemy(e, dmg, head) {
  e.hp -= dmg; e.alert = 8; e.last.copy(P.pos);
  $('hitmark').style.opacity = 1; setTimeout(() => ($('hitmark').style.opacity = 0), 120);
  beep(head ? 1400 : 900, 0.05, 0.06, 'triangle');
  if (e.hp <= 0 && e.alive) {
    e.alive = false; e.dead = 0;
    const left = enemies.filter((x) => x.alive).length;
    if (left > 0) { $('obj').textContent = `🏴‍☠️ Elimina a los piratas rivales (${left})`; showMsg(head ? '¡Tiro a la cabeza!' : 'Pirata eliminado', 1.5); }
    else {
      $('obj').textContent = '💰 Encuentra el tesoro en la colina (sigue la luz dorada)';
      showMsg('¡Todos eliminados! El tesoro está libre', 3.5); treasureBeam.visible = true; beep(660, 0.3, 0.12, 'triangle');
    }
  }
}
function buildWall() {
  if (P.walls <= 0) { showMsg('No te quedan muros', 1.2); return; }
  const f = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw)).negate();
  const c = P.pos.clone().addScaledVector(f, 2.6);
  const y = heightAt(c.x, c.z);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.8, 0.25), M.wood);
  wall.position.set(c.x, y + 1.3, c.z); wall.rotation.y = P.yaw;
  wall.castShadow = wall.receiveShadow = true; scene.add(wall); solids.push(wall);
  // tablas para que se vea de madera
  for (let i = -1; i <= 1; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.12, 0.3), M.darkWood); b.position.y = i * 0.9; wall.add(b); }
  const r = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  for (let i = -1.2; i <= 1.21; i += 0.8) circles.push({ x: c.x + r.x * i, z: c.z + r.z * i, r: 0.45, wall: wall });
  walls.push({ m: wall, hp: 120 });
  P.walls--; $('wallN').textContent = P.walls;
  beep(220, 0.1, 0.12, 'sawtooth');
}
function damageWall(mesh, dmg) {
  const w = walls.find((x) => x.m === mesh); if (!w) return;
  w.hp -= dmg;
  if (w.hp <= 0) {
    scene.remove(w.m); solids.splice(solids.indexOf(w.m), 1); walls.splice(walls.indexOf(w), 1);
    for (let i = circles.length - 1; i >= 0; i--) if (circles[i].wall === mesh) circles.splice(i, 1);
    puff(mesh.position);
  }
}
function openTreasure() {
  if (!treasureBeam.visible) { if (P.pos.distanceTo(treasure.position) < 3) showMsg('Está bloqueado: elimina a todos los piratas', 2); return; }
  if (P.pos.distanceTo(treasure.position) > 3) return;
  treasure.userData.lid.rotation.x = -1.2; treasure.userData.lid.position.z = -0.4;
  for (let i = 0; i < 40; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), M.gold);
    s.position.copy(treasure.position).add(new THREE.Vector3(0, 1, 0)); scene.add(s);
    fx.push({ o: s, life: 2, age: 0, kind: 'mesh', v: new THREE.Vector3(rnd(-2, 2), rnd(4, 8), rnd(-2, 2)) });
  }
  [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.25, 0.12, 'triangle'), i * 150));
  setTimeout(() => endGame(true), 1500);
}
function endGame(won) {
  state = 'end'; document.exitPointerLock();
  $('endTitle').textContent = won ? '¡TESORO ENCONTRADO!' : 'HAS CAÍDO';
  $('endText').textContent = won ? 'Derrotaste a todos los piratas rivales y la isla es tuya. 🏴‍☠️💰' : 'Los piratas rivales te superaron. ¡Usa los muros como cobertura!';
  $('end').classList.remove('hidden');
}
function hurtPlayer(dmg) {
  P.hp = Math.max(0, P.hp - dmg); P.hurt = 0.4;
  if (P.hp <= 0 && state === 'play') endGame(false);
}

// ================== Movimiento con colisiones ==================
function collide(p, r) {
  for (const c of circles) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
    if (d < m && d > 0.0001) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
  }
  const rr = Math.hypot(p.x, p.z), lim = ISLAND_R + 5;
  if (rr > lim) { p.x *= lim / rr; p.z *= lim / rr; }
}
function lineOfSight(a, b) {
  const dir = b.clone().sub(a), dist = dir.length(); dir.normalize();
  if (terrainHit(a, dir, dist) < dist) return null;
  ray.set(a, dir); ray.far = dist;
  const h = ray.intersectObjects(solids, false)[0];
  return h ? h : true;
}

function updatePlayer(dt, t) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const mv = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, s);
  const running = keys.ShiftLeft && f > 0 && !P.aiming;
  const speed = P.aiming ? PLAYER.walk * 0.55 : running ? PLAYER.run : PLAYER.walk;
  const moving = mv.lengthSq() > 0;
  if (moving) {
    mv.normalize().multiplyScalar(speed * dt);
    if (heightAt(P.pos.x, P.pos.z) < 0) mv.multiplyScalar(0.5); // en el agua
    P.pos.add(mv);
  }
  collide(P.pos, 0.4);
  if (keys.Space && P.onGround) { P.vel.y = PLAYER.jump; P.onGround = false; }
  P.vel.y -= GRAVITY * dt; P.pos.y += P.vel.y * dt;
  const gh = Math.max(heightAt(P.pos.x, P.pos.z), -1.2);
  if (P.pos.y <= gh) { P.pos.y = gh; P.vel.y = 0; P.onGround = true; }

  if (P.fireCd > 0) P.fireCd -= dt;
  if (P.reloading > 0) {
    P.reloading -= dt;
    if (P.reloading <= 0) { const n = Math.min(PLAYER.mag - P.mag, P.reserve); P.mag += n; P.reserve -= n; $('reload').classList.add('hidden'); }
  }
  // Animación
  P.walk += moving && P.onGround ? dt * speed * 1.6 : 0;
  const sw = moving && P.onGround ? Math.sin(P.walk) * 0.7 : 0;
  const m = player;
  m.root.position.copy(P.pos); m.root.rotation.y = P.yaw + Math.PI;
  m.legL.rotation.x = sw; m.legR.rotation.x = -sw; m.armL.rotation.x = -sw * 0.6;
  m.armR.rotation.set(-Math.PI / 2 - P.pitch, 0, 0); // brazo apuntando
  if (P.reloading > 0) m.armR.rotation.x = -0.6;
  m.body.rotation.x = running ? 0.15 : 0;
  // Recogidas
  for (const p of pickups) {
    if (p.taken) continue;
    p.m.rotation.y += dt * 1.5; p.m.position.y = p.base + Math.sin(t * 2) * 0.15;
    if (p.m.position.distanceTo(P.pos.clone().setY(P.pos.y + 0.6)) < 1.5) {
      if (p.type === 'hp' && P.hp >= 100) continue;
      p.taken = true; scene.remove(p.m);
      if (p.type === 'ammo') { P.reserve += 24; showMsg('+24 balas', 1.2); } else { P.hp = Math.min(100, P.hp + 40); showMsg('+40 de vida', 1.2); }
      beep(880, 0.12, 0.1, 'triangle');
    }
  }
}

function updateEnemies(dt) {
  const chest = P.pos.clone().setY(P.pos.y + 1.4);
  for (const e of enemies) {
    const m = e.m;
    if (!e.alive) {
      e.dead += dt;
      m.root.rotation.x = Math.max(-Math.PI / 2, m.root.rotation.x - dt * 4) ;
      if (e.dead > 6) m.root.visible = false;
      continue;
    }
    const eye = e.pos.clone().setY(e.pos.y + 1.6);
    const dist = eye.distanceTo(chest);
    e.losT -= dt;
    if (e.losT <= 0) { e.losT = 0.25; e.los = dist < ENEMY.range && lineOfSight(eye, chest) === true; }
    if (e.los) { e.alert = 6; e.last.copy(P.pos); }
    e.alert -= dt;
    let target = null, run = false;
    if (e.los) { if (dist > 14) target = P.pos; }
    else if (e.alert > 0) { target = e.last; run = true; }
    else {
      if (!e.wander || e.pos.distanceTo(e.wander) < 1.5) {
        const a = Math.random() * 6.28, r = rnd(3, 14);
        const wx = e.home.x + Math.cos(a) * r, wz = e.home.z + Math.sin(a) * r;
        e.wander = heightAt(wx, wz) > 0.8 ? new THREE.Vector3(wx, 0, wz) : e.home.clone();
      }
      target = e.wander;
    }
    let moving = false;
    if (target) {
      const d = target.clone().sub(e.pos).setY(0);
      if (d.length() > 0.8) {
        d.normalize().multiplyScalar(ENEMY.speed * (run ? 1.4 : e.los ? 1 : 0.5) * dt);
        const nx = e.pos.x + d.x, nz = e.pos.z + d.z;
        if (heightAt(nx, nz) > 0.4) { e.pos.x = nx; e.pos.z = nz; moving = true; }
        if (!e.los) m.root.rotation.y = Math.atan2(d.x, d.z);
      }
    }
    collide(e.pos, 0.4);
    for (const o of enemies) if (o !== e && o.alive) { const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, dd = Math.hypot(dx, dz); if (dd < 1 && dd > 0) { e.pos.x += dx / dd * (1 - dd) * 0.5; e.pos.z += dz / dd * (1 - dd) * 0.5; } }
    e.pos.y = heightAt(e.pos.x, e.pos.z);
    if (e.los) m.root.rotation.y = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z);

    // Disparo
    e.cd -= dt;
    const aimPitch = Math.atan2(chest.y - eye.y, Math.hypot(chest.x - eye.x, chest.z - eye.z));
    m.armR.rotation.set(e.los || e.alert > 0 ? -Math.PI / 2 - aimPitch : 0, 0, 0);
    if (e.los && e.cd <= 0 && state === 'play') {
      e.cd = rnd(ENEMY.fireMin, ENEMY.fireMax);
      const mz = new THREE.Vector3(); m.muzzle.getWorldPosition(mz);
      const pMoving = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD;
      let chance = 0.55 - dist / 120 - (pMoving ? 0.15 : 0) - (keys.ShiftLeft ? 0.1 : 0);
      const blk = lineOfSight(mz, chest);
      let end = chest.clone().add(new THREE.Vector3(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-1.5, 1.5)));
      if (blk !== true && blk) { end = blk.point; damageWall(blk.object, ENEMY.dmg); chance = 0; }
      if (Math.random() < chance) { end = chest; hurtPlayer(ENEMY.dmg); }
      tracer(mz, end); muzzleFlash(mz);
      shotSound(Math.max(0.15, 1 - dist / 60), 0.8);
    }
    e.walk += moving ? dt * 7 : 0;
    const sw = moving ? Math.sin(e.walk) * 0.6 : 0;
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw; m.armL.rotation.x = -sw * 0.5;
    m.root.position.copy(e.pos);
  }
}

// ================== Cámara (hombro) ==================
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const dist = P.aiming ? 2.2 : 4.2, shoulder = P.aiming ? 0.75 : 0.9;
  camera.fov += ((P.aiming ? 50 : 70) - camera.fov) * Math.min(1, dt * 10); camera.updateProjectionMatrix();
  const dir = new THREE.Vector3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
  const right = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  const pivot = P.pos.clone().add(new THREE.Vector3(0, 1.7, 0)).addScaledVector(right, shoulder);
  camTarget.copy(pivot).addScaledVector(dir, -dist);
  const gh = heightAt(camTarget.x, camTarget.z) + 0.4;
  if (camTarget.y < gh) camTarget.y = gh;
  camera.position.lerp(camTarget, Math.min(1, dt * 18));
  camera.lookAt(pivot.clone().addScaledVector(dir, 20));
  // sombras siguen al jugador
  sunLight.position.copy(P.pos).addScaledVector(sun, 100); sunLight.target.position.copy(P.pos);
}

// ================== HUD ==================
function updateHud(dt) {
  $('hp').style.width = P.hp + '%';
  $('hp').style.background = P.hp > 50 ? '' : P.hp > 25 ? 'linear-gradient(#ffe066,#f59f00)' : 'linear-gradient(#ff8787,#e03131)';
  $('mag').textContent = P.mag; $('res').textContent = P.reserve;
  P.hurt = Math.max(0, P.hurt - dt); $('dmg').style.opacity = P.hurt > 0 ? 1 : 0;
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').style.opacity = 0; }
  if (treasureBeam.visible && P.pos.distanceTo(treasure.position) < 3 && treasure.userData.lid.rotation.x === 0 && msgT <= 0) showMsg('Presiona E para abrir el tesoro', 0.3);
}

// ================== Bucle ==================
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  water.material.uniforms.time.value += dt * 0.6;
  if (state === 'play') {
    updatePlayer(dt, t);
    updateEnemies(dt);
    if (mouseDown && P.mag > 0) {/* pistola semiautomática: un disparo por click */}
  }
  updateFx(dt);
  updateCamera(dt);
  updateHud(dt);
  if (treasureBeam.visible) treasureBeam.material.opacity = 0.18 + Math.sin(t * 3) * 0.07;
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

reset();
camera.position.set(P.pos.x, P.pos.y + 3, P.pos.z + 5);
$('loading').remove();
loop();
