// Песочница оружия: ночная сцена-заглушка + WeaponSystem + та же пост-обработка, что в ядре.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WeaponSystem } from '../src/weapons/WeaponSystem.js';
import { makeNoise2D, fbm2 } from '../src/core/noise.js';

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- основная сцена: тёмная земля, туман, луна, бочка с огнём, красное свечение ямы ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);
scene.fog = new THREE.FogExp2(0x0b0f16, 0.02);
const camera = new THREE.PerspectiveCamera(75, W / H, 0.05, 400);
camera.position.set(0, 1.65, 22);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0x3b4a66, 0x17110c, 0.9));
const moon = new THREE.DirectionalLight(0xaabfff, 1.4);
moon.position.set(-0.4, 0.8, -0.45).multiplyScalar(40); moon.castShadow = true; scene.add(moon);
const flash = new THREE.SpotLight(0xfff1d6, 18, 40, 0.45, 0.6, 2); flash.position.set(0.1, -0.1, 0); flash.target.position.set(0, -0.6, -5);
camera.add(flash, flash.target);
{
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S), n = makeNoise2D(5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 0.5 + 0.5 * fbm2(n, x / 40, y / 40, 5), i = (y * S + x) * 4;
    img.data[i] = 40 + 50 * v; img.data[i + 1] = 38 + 42 * v; img.data[i + 2] = 30 + 30 * v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); t.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const crateM = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9 });
  for (const [x, z, s] of [[3.5, 18, 1], [-4, 15, 1.2], [6, 10, 0.9]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateM); c.position.set(x, s / 2, z); c.castShadow = c.receiveShadow = true; scene.add(c);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.7, metalness: 0.4 }));
  barrel.position.set(2.2, 0.45, 16); scene.add(barrel);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.2, 0.6) }));
  fire.position.set(2.2, 1.0, 16); scene.add(fire);
  const fl = new THREE.PointLight(0xff8a3a, 6, 12, 2); fl.position.set(2.2, 1.3, 16); scene.add(fl);
  const pit = new THREE.PointLight(0xff3010, 30, 40, 2); pit.position.set(0, -2, 0); scene.add(pit);
  const rim = new THREE.Mesh(new THREE.RingGeometry(10, 11.5, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.08, 0.02), side: THREE.DoubleSide }));
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.02; scene.add(rim);
}

// --- заглушки систем ---
const noop = () => {};
const log = [];
const audio = new Proxy({}, { get: (_, k) => (...a) => { log.push('audio.' + String(k) + (a.length ? ':' + a.join(',') : '')); } });
const fx = new Proxy({}, { get: (_, k) => (...a) => { log.push('fx.' + String(k)); } });
const combat = {
  fireBullet: () => { log.push('combat.fireBullet'); return { point: null, kind: 'none' }; },
  melee: () => { log.push('combat.melee'); return { hit: false, killed: false }; },
  explode: (o) => { log.push('combat.explode@' + o.position.toArray().map((v) => v.toFixed(1)).join(',')); },
};

const weapons = new WeaponSystem({ renderer, camera, scene, audio, fx, combat, world: undefined, quality: 'high' });

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const vp = new RenderPass(weapons.viewScene, weapons.viewCamera); vp.clear = false; vp.clearDepth = true;
composer.addPass(vp);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.4, 0.9));
composer.addPass(new OutputPass());

// --- ввод и шаг симуляции ---
const inp = { fireDown: false, firePressed: false, aimDown: false, reloadPressed: false, meleePressed: false, grenadePressed: false, switchTo: null, wheel: 0,
  lookDX: 0, lookDY: 0, speed01: 0, sprinting: false, grounded: true, crouching: false, landed: 0, canFire: true };
let yaw = 0, pitch = 0;
function step(dt) {
  weapons.update(dt, inp);
  const r = weapons.consumeRecoil(); pitch += r.pitch; yaw += r.yaw;
  const p = weapons.viewPunch;
  camera.rotation.set(pitch + p.pitch, yaw + p.yaw, p.roll, 'YXZ');
  camera.fov = 75 * weapons.aimFovScale; camera.updateProjectionMatrix();
  inp.firePressed = inp.reloadPressed = inp.meleePressed = inp.grenadePressed = false; inp.switchTo = null; inp.wheel = 0; inp.landed = 0; inp.lookDX = inp.lookDY = 0;
}
function run(sec, each) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (each) each(i); step(1 / 60); } }

// --- отладочный вид: 4 ракурса вьюмодели без пост-обработки ---
let mode = 'game', viewsTarget = new THREE.Vector3(0.08, -0.1, -0.35), viewsDist = 0.45;
const dbgCam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
function renderViews() {
  const angles = [[0, 0], [Math.PI / 2, 0.15], [-Math.PI / 2, 0.15], [0, 1.2], [Math.PI, 0.25], [0.6, 0.35]];
  const cols = 3, rows = 2, w = Math.floor(W / cols), h = Math.floor(H / rows);
  renderer.setScissorTest(true);
  dbgCam.aspect = w / h; dbgCam.updateProjectionMatrix();
  const bg = weapons.viewScene.background;
  weapons.viewScene.background = new THREE.Color(0x3a4250);
  angles.forEach(([az, el], i) => {
    const x = (i % cols) * w, y = H - (Math.floor(i / cols) + 1) * h;
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    dbgCam.position.set(viewsTarget.x + Math.sin(az) * Math.cos(el) * viewsDist, viewsTarget.y + Math.sin(el) * viewsDist, viewsTarget.z + Math.cos(az) * Math.cos(el) * viewsDist);
    dbgCam.lookAt(viewsTarget);
    renderer.render(weapons.viewScene, dbgCam);
  });
  weapons.viewScene.background = bg;
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
}

let frozen = false, frames = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (!frozen) step(Math.min(dt, 0.05));
  if (mode === 'views') renderViews(); else composer.render();
  if (++frames === 4) window.__ready = true;
});

window.__weap = {
  ws: weapons, inp, log,
  freeze(v = true) { frozen = v; return frozen; },
  run, step,
  select(id) { if (id !== 'pistol') weapons.give(id); weapons.setActive(id, true); weapons.refillAmmo(); run(0.4); return weapons.hud(); },
  aim(on, t = 0.4) { inp.aimDown = on; run(t); return weapons.isAiming; },
  fireOnce(after = 1 / 60) { inp.firePressed = true; inp.fireDown = true; step(1 / 60); inp.fireDown = false; if (after > 1 / 60) run(after - 1 / 60); },
  burst(sec) { inp.fireDown = true; run(sec, () => {}); inp.fireDown = false; },
  reloadAt(t, empty = false) { const id = weapons.cur; const w = weapons.inv[id]; w.mag = empty ? 0 : Math.max(0, w.mag - 3); weapons.slideLocked = empty && id === 'pistol'; inp.reloadPressed = true; step(1 / 60); run(Math.max(0, t - 1 / 60)); return weapons.hud(); },
  knifeAt(t) { inp.meleePressed = true; step(1 / 60); run(Math.max(0, t - 1 / 60)); },
  nadeAt(t) { inp.grenadePressed = true; step(1 / 60); run(Math.max(0, t - 1 / 60)); },
  views(on = true, target, dist) { mode = on ? 'views' : 'game'; if (target) viewsTarget.fromArray(target); if (dist) viewsDist = dist; },
  look(y, p) { yaw = y; pitch = p; },
  drawCalls() {
    renderer.info.autoReset = false; renderer.info.reset();
    renderer.render(weapons.viewScene, weapons.viewCamera);
    const c = renderer.info.render.calls; renderer.info.autoReset = true; return c;
  },
};
