import * as THREE from 'three';
import { ZombieManager } from '../src/zombies/ZombieManager.js';
import { PARTS } from '../src/zombies/Zombie.js';
import { CLIPS } from '../src/zombies/anim.js';
window.__clips = CLIPS;
(async () => {

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d22);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
scene.add(new THREE.HemisphereLight(0x8899bb, 0x302820, 1.4));
const key = new THREE.DirectionalLight(0xfff0e0, 2.4); key.position.set(10, 14, 18); key.castShadow = true;
Object.assign(key.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 80 }); key.shadow.mapSize.set(2048, 2048);
scene.add(key);
// макет поля с ямой радиуса 11
const R = 11;
const ground = new THREE.Mesh(new THREE.RingGeometry(R, 60, 96, 1), new THREE.MeshStandardMaterial({ color: 0x3a3a30 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 8, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x4a3a2a, side: THREE.BackSide }));
wall.position.y = -4; wall.receiveShadow = true; scene.add(wall);
const world = { heightAt: () => 0, pit: { radiusAt: () => R }, colliders: [], bounds: { radius: 46 } };
const fx = { addGib: (m, v, av) => { scene.add(m); gibs.push({ m, v, av }); } };
const gibs = [];
const mgr = new ZombieManager({ scene, world, fx, quality: 'high' });
window.__mgr = mgr; window.__PARTS = PARTS;
await mgr.build((p, id) => console.log('build', id, Math.round(p * 100) + '%'));
const stepFixed = (sec) => {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) {
    mgr.update(1 / 60);
    for (const g of gibs) { g.v.y -= 9.8 / 60; g.m.position.addScaledVector(g.v, 1 / 60); if (g.m.position.y < 0.05) { g.m.position.y = 0.05; g.v.set(0, 0, 0); } }
  }
};
window.__step = stepFixed;
const clearAll = () => { mgr.clear(); };
const scenes = {
  gaits() {
    clearAll();
    mgr.target.set(0, 0, 60);
    const types = ['walker', 'walker', 'runner', 'crawler', 'brute', 'spitter', 'bloater', 'boss'];
    types.forEach((t, i) => {
      const z = mgr.spawn(t, { position: new THREE.Vector3((i - 3.5) * 2.2, 0, 16), yaw: 0 });
      if (t === 'runner') z.speed = 0.0001;
    });
    stepFixed(1.3);
    cam.position.set(13, 2.2, 27); cam.lookAt(0, 0.9, 17); cam.fov = 40; cam.updateProjectionMatrix();
  },
  climb() {
    clearAll();
    mgr.target.set(0, 0, 30);
    const angs = [1.25, 1.45, 1.65, 1.85];
    const zs = angs.map((a) => { const z = mgr.spawn('walker', { angle: a }); return z; });
    // разная стадия: пошагово
    zs.forEach((z, i) => { z.st = [0.3, 1.0, 1.6, 2.3][i]; });
    stepFixed(0.02);
    cam.position.set(0, 3.5, 20); cam.lookAt(0, -0.3, 11); cam.fov = 45; cam.updateProjectionMatrix();
  },
  attack() {
    clearAll();
    mgr.target.set(0, 0, 21);
    const a = mgr.spawn('walker', { position: new THREE.Vector3(-1.6, 0, 19.9), yaw: 0.35 });
    const b = mgr.spawn('brute', { position: new THREE.Vector3(1.8, 0, 19.0), yaw: -0.3 });
    const c = mgr.spawn('boss', { position: new THREE.Vector3(5, 0, 18.5), yaw: -0.6 });
    stepFixed(0.3);
    a.startAttack(window.__clips.swipe.R, 'swipe'); b.startAttack(window.__clips.smash.R, 'smash'); c.startAttack(window.__clips.chop.R, 'boss');
    stepFixed(0.42);
    cam.position.set(1, 1.7, 25.5); cam.lookAt(1.5, 1.2, 19); cam.fov = 50; cam.updateProjectionMatrix();
  },
  deaths() {
    clearAll();
    mgr.target.set(0, 0, 60);
    const dirs = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [0, 0, -1], [0, 0, -1]];
    dirs.forEach((d, i) => {
      const z = mgr.spawn(i === 4 ? 'brute' : 'walker', { position: new THREE.Vector3((i - 2) * 2.4, 0, 18), yaw: 0 });
      stepFixed(0.1);
      const part = i === 3 ? PARTS[0] : PARTS[2];
      z.bone(part.a, new THREE.Vector3());
      z.hit(part, z.center.clone(), new THREE.Vector3(...d), 2000, { weaponId: i === 3 ? 'shotgun' : 'rifle', force: 2 });
    });
    stepFixed(2.6);
    cam.position.set(0, 4.5, 26); cam.lookAt(0, 0.2, 18); cam.fov = 45; cam.updateProjectionMatrix();
  },
  gore() {
    clearAll();
    mgr.target.set(0, 0, 25);
    const z = mgr.spawn('walker', { position: new THREE.Vector3(0, 0, 19), yaw: 0 });
    stepFixed(0.5);
    z.hit(PARTS[6], z.center.clone(), new THREE.Vector3(0, 0, -1), 500, { weaponId: 'shotgun', force: 4 });
    z.hit(PARTS[11], z.center.clone(), new THREE.Vector3(0, 0, -1), 500, { weaponId: 'shotgun', force: 4 });
    stepFixed(0.35);
    cam.position.set(1.6, 1.4, 22.5); cam.lookAt(0, 0.8, 19); cam.fov = 45; cam.updateProjectionMatrix();
  },
};
window.__scene = (n) => scenes[n]();
let f = 0;
renderer.setAnimationLoop(() => { renderer.render(scene, cam); if (++f === 3) window.__ready = true; });
})();
