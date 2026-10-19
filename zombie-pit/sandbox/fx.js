// Тестовая сцена FX: тёмная земля, реквизит (ящик, бочка, мешки, бетон), ночной свет, bloom.
// window.__fx.setup(name) — сценарий; window.__step(sec) — детерминированный шаг симуляции (dt = 1/60) + рендер.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RNG } from '../src/core/noise.js';
import { FX } from '../src/fx/FX.js';

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);
scene.fog = new THREE.FogExp2(0x0b0f16, 0.02);
const camera = new THREE.PerspectiveCamera(75, W / H, 0.05, 400);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x3b4a66, 0x17110c, 0.9));
const moon = new THREE.DirectionalLight(0xaabfff, 1.4);
moon.position.set(-0.4, 0.8, -0.45).multiplyScalar(30);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 80 });
scene.add(moon, moon.target);
const flashlight = new THREE.SpotLight(0xfff1d6, 35, 40, 0.5, 0.55, 2);
flashlight.position.set(0.15, -0.12, 0);
flashlight.target.position.set(0, -0.12, -1);
camera.add(flashlight, flashlight.target);

// ---------- процедурные текстуры реквизита
const rng = new RNG(5);
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
function speckle(ctx, s, n, cols, r0, r1, a0 = 0.2, a1 = 0.6) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.float(a0, a1);
    ctx.fillStyle = rng.pick(cols);
    ctx.beginPath();
    ctx.arc(rng.float(0, s), rng.float(0, s), rng.float(r0, r1), 0, 6.283);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
const groundTex = canvasTex(512, (ctx, s) => {
  ctx.fillStyle = '#2a261e';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 900, ['#3a3324', '#1d1a14', '#2f3322', '#262a1c', '#40382a'], 2, 14, 0.15, 0.5);
  speckle(ctx, s, 2500, ['#4a4234', '#15130f', '#353b26'], 0.5, 2, 0.3, 0.8);
}, 40);
const woodTex = canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#5a4128';
  ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) {
    ctx.fillStyle = `rgba(${rng.int(30, 60)},${rng.int(20, 40)},${rng.int(10, 25)},${rng.float(0.1, 0.35)})`;
    ctx.fillRect(0, y, s, 1);
  }
  ctx.fillStyle = 'rgba(20,12,6,0.9)';
  for (let k = 0; k < 4; k++) ctx.fillRect(0, (k * s) / 4, s, 3);
  ctx.fillRect(0, 0, 10, s); ctx.fillRect(s - 10, 0, 10, s);
});
const barrelTex = canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#28453f';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 300, ['#5a3018', '#7a4520', '#3a2412'], 1, 10, 0.3, 0.8);
  ctx.fillStyle = 'rgba(20,20,20,0.8)';
  ctx.fillRect(0, s * 0.3, s, 5); ctx.fillRect(0, s * 0.7, s, 5);
});
const sandTex = canvasTex(128, (ctx, s) => {
  ctx.fillStyle = '#6b5d45';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < s; i += 3) {
    ctx.fillStyle = 'rgba(40,30,20,0.25)';
    ctx.fillRect(i, 0, 1, s); ctx.fillRect(0, i, s, 1);
  }
  speckle(ctx, s, 120, ['#4a3f2e', '#7d6e52'], 1, 6, 0.2, 0.5);
}, 2);
const concreteTex = canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#6a6a66';
  ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 1500, ['#555551', '#7a7a74', '#4a4a46'], 0.5, 3, 0.3, 0.7);
});

const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160),
  new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96, metalness: 0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const props = [];
function prop(mesh, surface, x, y, z) {
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.surface = surface;
  scene.add(mesh);
  props.push(mesh);
  return mesh;
}
prop(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 })),
  'wood', -1.5, 0.45, -2.4).rotation.y = 0.25;
prop(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 32), new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.55, metalness: 0.6 })),
  'metal', -0.25, 0.45, -2.9);
const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95 });
for (let row = 0; row < 3; row++) {
  for (let k = 0; k < 3 - row; k++) {
    const bag = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), sandMat);
    bag.scale.set(0.3, 0.11, 0.19);
    prop(bag, 'sandbag', 0.85 + k * 0.58 + row * 0.29, 0.1 + row * 0.2, -2.5).rotation.y = rng.float(-0.1, 0.1);
  }
}
prop(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.5), new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 })),
  'concrete', 2.9, 0.275, -3.1).rotation.y = -0.3;

const world = { heightAt: () => 0, raycastMeshes: props };
const audioLog = [];
const audio = { shellCasing: (pos, kind) => audioLog.push(kind + '@' + pos.y.toFixed(3)) };

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.4, 0.9));
composer.addPass(new OutputPass());

const t0 = performance.now();
const fx = new FX({ scene, camera, world, audio, quality: 'high' });
const initMs = performance.now() - t0;

// ---------- утилиты сценариев
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function view(px, py, pz, tx, ty, tz) {
  camera.position.set(px, py, pz);
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld();
}
function step(sec) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) fx.update(1 / 60);
}
const ray = new THREE.Raycaster();
// выстрел из камеры в точку: попадание в реквизит или в землю
function shoot(tx, ty, tz) {
  const o = camera.position.clone(), d = V(tx, ty, tz).sub(o).normalize();
  ray.set(o, d);
  const hit = ray.intersectObjects(props, false)[0];
  if (hit) {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    fx.bulletImpact(hit.point, n, hit.object.userData.surface);
    return hit.object.userData.surface;
  }
  if (d.y < 0) {
    const t = -o.y / d.y;
    fx.bulletImpact(o.addScaledVector(d, t), V(0, 1, 0), 'dirt');
    return 'dirt';
  }
  return 'none';
}
function makeArm() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x6d7360, roughness: 0.75 });
  const meat = new THREE.MeshPhysicalMaterial({ color: 0x4a0806, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 6, 12), skin);
  arm.rotation.z = Math.PI / 2;
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.03, 12), meat);
  stump.rotation.z = Math.PI / 2;
  stump.position.x = 0.19;
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.08), skin);
  hand.position.x = -0.24;
  g.add(arm, stump, hand);
  g.traverse((c) => { c.castShadow = true; });
  return g;
}

const S = {
  // все ячейки атласа сеткой на земле под фонарём
  decals() {
    view(0, 2.2, 0.2, 0, 0, -2.2);
    const cols = [[0.085, 0.0075, 0.005], [1, 1, 1], [0.18, 0.62, 0.03]];
    for (let i = 0; i < 16; i++) {
      const x = ((i % 4) - 1.5) * 0.85, z = -1.2 - Math.floor(i / 4) * 0.75;
      const c = i <= 7 || i === 15 ? cols[0] : i === 14 ? cols[2] : cols[1];
      fx.decals.add(x, 0.02, z, 0, 1, 0, 0.7, 0.7, 0, i, false, c[0], c[1], c[2], 0.95, i <= 7 || i === 15 ? 0.15 : 0.9, i === 11 ? 0.5 : 0, i === 14 ? 1.4 : 0);
    }
  },
  holes() {
    view(-0.3, 0.9, -0.9, -1.0, 0.45, -2.6);
    for (const t of [[-1.65, 0.55, -2.0], [-1.35, 0.3, -2.0], [-1.45, 0.72, -2.0]]) shoot(...t);
    for (const t of [[-0.35, 0.5, -2.6], [-0.15, 0.25, -2.6], [-0.3, 0.75, -2.6]]) shoot(...t);
    for (const t of [[0.95, 0.15, -2.4], [1.3, 0.35, -2.4]]) shoot(...t);
  },
  impacts() {
    view(0.6, 1.45, 0.9, 0.55, 0.45, -2.6);
    const targets = [[-1.55, 0.6, -2.0], [-1.3, 0.35, -2.0], [-1.7, 0.75, -2.0], [-0.25, 0.55, -2.6], [-0.15, 0.3, -2.6],
      [0.95, 0.15, -2.4], [1.4, 0.35, -2.4], [1.75, 0.12, -2.4], [2.75, 0.35, -2.8], [3.0, 0.2, -2.8],
      [0.3, 0, -1.4], [-0.6, 0, -1.0], [1.8, 0, -1.2]];
    for (const t of targets) { shoot(...t); step(0.012); }
  },
  blood() {
    view(1.6, 1.4, 0.6, -0.2, 0.8, -2.0);
    fx.bloodHit(V(-0.6, 1.35, -1.6), V(1, 0.05, 0.25), 1.6);
  },
  burst() {
    view(1.4, 1.5, 0.8, -0.2, 0.7, -2.0);
    fx.bloodBurst(V(-0.3, 1.25, -2.0), 1.5);
  },
  gib() {
    view(1.2, 1.4, 1.2, -0.2, 0.7, -1.8);
    fx.bloodBurst(V(-1.2, 1.4, -1.8), 0.6);
    fx.addGib(makeArm(), V(2.8, 3.8, 0.4), V(4, 9, 3), { radius: 0.06, lifetime: 15, disposeGeometry: true });
    fx.addGib(makeArm(), V(1.2, 4.5, -1.2), V(-6, 3, 8), { radius: 0.06, lifetime: 15, disposeGeometry: true });
  },
  explosion() {
    view(0, 1.7, 5, 0, 1.6, -6);
    fx.explosion(V(0, 0, -6), 5);
  },
  pools() {
    view(0.4, 1.9, 0.6, -0.2, 0, -1.6);
    fx.bloodPool(V(-0.6, 0, -1.6), 1.1);
    fx.bloodPool(V(0.9, 0, -2.0), 0.8);
    fx.bloodHit(V(-0.2, 0.9, -1.0), V(0.4, -0.6, -0.5), 1.4);
    fx.bloodBurst(V(0.2, 0.6, -1.4), 0.8);
    step(0.5);
    fx.bloodHit(V(0.6, 1.0, -0.8), V(-0.5, -0.5, -0.4), 1.2);
  },
  acid() {
    view(0.3, 1.6, 1.4, 0, 0.3, -1.6);
    fx.acidPuddle(V(-0.6, 0, -1.8), 0.7, 8);
    fx.acidSplash(V(0.7, 0.05, -1.4));
    fx.gasCloud(V(1.8, 0.2, -3.6), 2.5);
  },
  casings() {
    view(0.75, 1.1, 0.1, 0.1, 0.0, -1.0);
    const kinds = ['pistol', 'rifle', 'shotgun'];
    for (let i = 0; i < 15; i++) {
      fx.shellCasing(V(0.1, 1.3, -0.5), V(1.6 + (i % 3) * 0.3, 2.2, -0.4 + (i % 5) * 0.12), kinds[i % 3]);
      step(0.1);
    }
  },
  tracers() {
    view(0, 1.6, 2.5, 0, 1.2, -10);
    const from = V(0.25, 1.35, 1.9);
    for (let i = 0; i < 6; i++) {
      fx.tracer(from, V(-6 + i * 2.5, 0.5 + (i % 3), -25), i % 2 ? 0xffd27a : 0xff8a50);
      step(0.008);
    }
    fx.flash(from, 0xffb060, 4, 0.08);
    fx.muzzleSmoke(from, V(0, 0.05, -1));
    fx.muzzleSmoke(V(-0.4, 1.3, 1.0), V(0.1, 0.05, -1));
  },
  dirt() {
    view(0.5, 1.6, 2.2, 0, 0.4, -1.5);
    fx.dirtBurst(V(-0.6, 0, -1.6), 1.5);
    fx.dirtBurst(V(0.9, 0, -1.9), 0.8);
  },
};

window.__fx = {
  fx, scene, camera, view, shoot, step, audioLog, initMs,
  setup(name) { fx.clear(); S[name](); return { name, ...fx.stats() }; },
  stats: () => fx.stats(),
};
window.__step = (sec) => {
  step(sec);
  composer.render();
  return { ...fx.stats(), info: { calls: renderer.info.render.calls, tris: renderer.info.render.triangles } };
};

composer.render();
requestAnimationFrame(() => { composer.render(); window.__ready = true; });
