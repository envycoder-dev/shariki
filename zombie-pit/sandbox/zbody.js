import * as THREE from 'three';
import { buildBody } from '../src/zombies/body.js';
import { VARIANTS, rollColors } from '../src/zombies/types.js';
import { createBones, boneInverses, applyPose, newPose, B } from '../src/zombies/rig.js';
import { makeZombieMaterial, eyeMaterial } from '../src/zombies/material.js';
import { RNG } from '../src/core/noise.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d22);
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
scene.add(new THREE.HemisphereLight(0x8899bb, 0x302820, 1.3));
const key = new THREE.DirectionalLight(0xfff0e0, 2.4); key.position.set(3, 5, 6); key.castShadow = true;
key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 4; key.shadow.camera.bottom = -2; key.shadow.mapSize.set(2048, 2048);
scene.add(key);
const rim = new THREE.DirectionalLight(0x99aaff, 1.5); rim.position.set(-4, 3, -5); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0x2a2a28 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const rng = new RNG(7);
const ids = Object.keys(VARIANTS);
const stats = [];
const meshes = [];
ids.forEach((id, i) => {
  const spec = VARIANTS[id]();
  const body = buildBody(spec);
  stats.push(`${id}: ${body.stats.verts}v ${body.stats.tris}t ${body.stats.ms}ms`);
  const bones = createBones(body.joints);
  const skel = new THREE.Skeleton(bones, boneInverses(body.joints));
  const type = id.split('_')[0];
  const mat = makeZombieMaterial(rollColors(id, type, rng));
  const mesh = new THREE.SkinnedMesh(body.geometry, mat);
  mesh.add(bones[0]); mesh.bind(skel, new THREE.Matrix4());
  mesh.castShadow = true; mesh.frustumCulled = false;
  for (const so of body.sockets) {
    if (so.missing) continue;
    const e = new THREE.Mesh(new THREE.SphereGeometry(so.r * 0.62, 12, 8), eyeMaterial(0xffe2a0));
    e.position.set(so.c[0] - body.joints.head[0], so.c[1] - body.joints.head[1], so.c[2] - body.joints.head[2] + so.r * 0.15);
    bones[B.head].add(e);
  }
  const pose = newPose();
  const down = window.location.search.includes('apose') ? 0 : 1;
  if (down) {
    pose[B.armL * 3 + 2] = 0.12; pose[B.armR * 3 + 2] = -0.12;
    pose[B.foreL * 3] = -0.25; pose[B.foreR * 3] = -0.25;
    pose[B.jaw * 3] = 0.25;
  }
  applyPose(bones, pose, body.joints);
  mesh.position.x = (i - (ids.length - 1) / 2) * 1.15;
  scene.add(mesh); meshes.push({ id, mesh, bones, body, pose });
});
console.log(stats.join('\n'));
window.__meshes = meshes;
const views = {
  row: () => { cam.fov = 35; cam.position.set(0, 1.4, 14); cam.lookAt(0, 1.0, 0); },
  heads: () => { cam.fov = 30; cam.position.set(-3.45, 1.75, 2.2); cam.lookAt(-3.45, 1.62, 0); },
  heads2: () => { cam.fov = 30; cam.position.set(2.3, 1.75, 2.4); cam.lookAt(2.3, 1.62, 0); },
  hand: () => { cam.fov = 25; const m = meshes[0]; cam.position.set(m.mesh.position.x + 0.5, 1.15, 0.7); cam.lookAt(m.mesh.position.x + 0.45, 1.0, 0); },
  side: () => { cam.fov = 35; cam.position.set(14, 1.4, 0.0); cam.lookAt(0, 1.0, 0); },
};
window.__view = (n) => { views[n](); cam.updateProjectionMatrix(); };
window.__view('row');
let f = 0;
renderer.setAnimationLoop(() => { renderer.render(scene, cam); if (++f === 3) window.__ready = true; });
