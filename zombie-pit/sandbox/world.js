// Тестовая сцена окружения: World + ACES + Bloom + фонарик на камере.
//   ?q=low|medium|high  ?t=секунды (сдвиг времени)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from '../src/world/World.js';

const params = new URLSearchParams(location.search);
const quality = params.get('q') || 'high';
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
camera.position.set(0, 1.65, 22);
camera.lookAt(0, 0.4, 0);
scene.add(camera);
// фонарик игрока (как в ядре)
const flash = new THREE.SpotLight(0xfff1d6, 220, 45, 0.42, 0.55, 2);
flash.position.set(0.25, -0.2, 0);
flash.target.position.set(0.1, -0.15, -1);
camera.add(flash, flash.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const info = document.createElement('div');
info.style.cssText = 'position:fixed;left:8px;top:6px;font:12px monospace;color:#9ab;text-shadow:0 0 3px #000;pointer-events:none';
document.body.appendChild(info);

const world = new World({ renderer, scene, quality });
window.__world = world;
window.__cam = (x, y, z, tx, ty, tz) => { camera.position.set(x, y, z); camera.lookAt(tx, ty, tz); };
window.__q = (q) => world.setQuality(q);
window.__flash = (on) => { flash.visible = !!on; };
window.__stats = () => {
  // один кадр основной сцены без постобработки — честный счёт вызовов отрисовки
  const rt = new THREE.WebGLRenderTarget(256, 256);
  renderer.setRenderTarget(rt);
  renderer.info.autoReset = false; renderer.info.reset();
  renderer.render(scene, camera);
  const r = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, points: renderer.info.render.points,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length, buildMs: Math.round(world.buildTime) };
  renderer.info.autoReset = true; renderer.setRenderTarget(null); rt.dispose();
  return r;
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

const t0 = performance.now(), tOff = +(params.get('t') || 6);
world.build((p, label) => { info.textContent = `${label} ${(p * 100) | 0}%`; }).then(start).catch((e) => console.error(e.stack || e));
function start() {
console.log(`[world] build ${world.buildTime.toFixed(0)} ms ${JSON.stringify(world.buildStats)}, colliders ${world.colliders.length}, raycast ${world.raycastMeshes.length}, h(0,22)=${world.heightAt(0, 22).toFixed(3)} surface=${world.surfaceAt(0, 22)}`);
let frames = 0, last = performance.now(), simTime = tOff;
const frame = (dt) => { simTime += dt; world.update(dt, simTime, camera); composer.render(); };
// ?shot=1 — рендер по запросу (для медленного программного рендера при снимках)
window.__render = (n = 1, dt = 1 / 30) => { const gl = renderer.getContext(), t = performance.now(); for (let i = 0; i < n; i++) frame(dt); gl.finish(); return Math.round(performance.now() - t) + ' ms'; };
window.__vis = (re, v) => { const r = new RegExp(re); let n = 0; scene.traverse((o) => { if (o.name && r.test(o.name)) { o.visible = v; n++; } }); return n; };
window.__bloom = (on) => { bloom.enabled = !!on; };
const prevCam = window.__cam;
if (params.has('shot')) {
  window.__cam = (...a) => { prevCam(...a); return window.__render(2); };
  window.__render(2); window.__ready = true;
} else {
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    frame(dt);
    if (++frames === 4) window.__ready = true;
    info.textContent = `q=${world.quality}`;
  });
}
}
