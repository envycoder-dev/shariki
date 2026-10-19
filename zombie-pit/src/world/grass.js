// Трава: густой участок вокруг камеры (бесшовная «плитка» в шейдере) + высокий бурьян по всему полю.
import * as THREE from 'three';
import { RNG, clamp } from '../core/noise.js';
import { SPLAT_SIZE } from './terrain.js';

export const GRASS_TILE = 38; // сторона плитки, следующей за камерой
export const grassUniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } };

// Травинка: 4 сегмента, высота 1, ширина у корня 1 (масштаб в шейдере)
function bladeGeometry() {
  const P = [], U = [], N = [], I = [];
  const rows = 4;
  for (let k = 0; k < rows; k++) {
    const t = k / rows, w = 0.5 * (1 - t * 0.85);
    P.push(-w, t, 0, w, t, 0); U.push(0, t, 1, t); N.push(0, 0.6, 1, 0, 0.6, 1);
  }
  P.push(0, 1, 0); U.push(0.5, 1); N.push(0, 0.6, 1);
  for (let k = 0; k < rows - 1; k++) { const a = k * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  I.push((rows - 1) * 2, (rows - 1) * 2 + 1, rows * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(I);
  return g;
}

export function buildGrass(ctx) {
  const { tex, maxCount } = ctx;
  const rng = new RNG(5150);
  const base = bladeGeometry();
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k of ['position', 'uv', 'normal']) g.setAttribute(k, base.attributes[k]);
  const off = new Float32Array(maxCount * 2), rnd = new Float32Array(maxCount * 4);
  // кучками: центры пучков + разброс вокруг
  let i = 0;
  while (i < maxCount) {
    const cx = rng.float(0, GRASS_TILE), cz = rng.float(0, GRASS_TILE), n = rng.int(4, 14), sp = rng.range(0.08, 0.35);
    for (let k = 0; k < n && i < maxCount; k++, i++) {
      off[i * 2] = (cx + rng.gauss() * sp + GRASS_TILE) % GRASS_TILE;
      off[i * 2 + 1] = (cz + rng.gauss() * sp + GRASS_TILE) % GRASS_TILE;
      rnd[i * 4] = rng.float(); rnd[i * 4 + 1] = rng.range(0, Math.PI * 2); rnd[i * 4 + 2] = rng.range(-1, 1); rnd[i * 4 + 3] = rng.float();
    }
  }
  // перемешиваем, чтобы урезание instanceCount равномерно снижало плотность
  for (let a = maxCount - 1; a > 0; a--) {
    const b = rng.int(0, a);
    for (let c = 0; c < 2; c++) { const t = off[a * 2 + c]; off[a * 2 + c] = off[b * 2 + c]; off[b * 2 + c] = t; }
    for (let c = 0; c < 4; c++) { const t = rnd[a * 4 + c]; rnd[a * 4 + c] = rnd[b * 4 + c]; rnd[b * 4 + c] = t; }
  }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
  g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  g.instanceCount = maxCount;

  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const u = {
    tHeight: { value: tex.height }, tSplat: { value: tex.splat }, tMacro: { value: tex.macro },
    uSplatSize: { value: SPLAT_SIZE }, uHRes: { value: tex.height.image.width }, uTile: { value: GRASS_TILE },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, grassUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aOff; attribute vec4 aRnd;
uniform sampler2D tHeight, tSplat, tMacro;
uniform float uSplatSize, uHRes, uTile, uTime; uniform vec3 uCam;
varying vec3 vGrassCol;`)
      .replace('#include <beginnormal_vertex>', `
float gy_c = cos(aRnd.y), gy_s = sin(aRnd.y);
vec3 objectNormal = normalize(vec3(gy_s * 0.55, 1.0, gy_c * 0.55));`)
      .replace('#include <begin_vertex>', `
vec2 rel = mod(aOff - uCam.xz + uTile * 0.5, uTile) - uTile * 0.5;
vec2 wxz = uCam.xz + rel;
float dist = length(rel);
vec2 huv = (wxz / uSplatSize + 0.5) * ((uHRes - 1.0) / uHRes) + 0.5 / uHRes;
float gy = texture2D(tHeight, huv).r;
vec4 spl = texture2D(tSplat, wxz / uSplatSize + 0.5);
float dens = (1.0 - smoothstep(0.22, 0.5, spl.r)) * (1.0 - smoothstep(0.3, 0.6, spl.g)) * (1.0 - smoothstep(0.15, 0.45, spl.b));
vec4 mac = texture2D(tMacro, wxz * 0.021);
float keep = step(aRnd.w, dens * (0.45 + 0.75 * mac.b));
float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.48, dist);
float hgt = (0.16 + 0.36 * aRnd.x * aRnd.x + 0.14 * mac.r) * keep * fade;
float t = uv.y;
vec3 p = vec3(position.x * (0.026 + 0.02 * aRnd.x) * (0.4 + 0.6 * fade), t * hgt, aRnd.z * t * t * hgt * 0.4);
p = vec3(p.x * gy_c + p.z * gy_s, p.y, -p.x * gy_s + p.z * gy_c);
vec2 wdir = vec2(0.94, 0.34);
float gust = texture2D(tMacro, wxz * 0.016 - wdir * uTime * 0.05).r;
float sway = sin(uTime * 2.1 + wxz.x * 0.45 + wxz.y * 0.3 + aRnd.w * 3.0) * 0.18 + (gust - 0.42) * 1.5;
p.xz += wdir * sway * t * t * hgt * 0.55;
p.y -= abs(sway) * t * t * hgt * 0.12;
vec3 transformed = p + vec3(wxz.x, gy - 0.025, wxz.y);
vec3 cDark = vec3(0.028, 0.04, 0.014), cOlive = vec3(0.055, 0.06, 0.022), cStraw = vec3(0.11, 0.092, 0.045);
vec3 cc = mix(cDark, cOlive, smoothstep(0.2, 0.8, aRnd.x));
cc = mix(cc, cStraw, smoothstep(0.55, 0.85, mac.g) * 0.85 + smoothstep(0.85, 1.0, aRnd.w) * 0.4);
vGrassCol = cc * mix(0.3, 1.15, t);`)
      .replace('#include <project_vertex>', `
vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', `
#if defined( USE_SHADOWMAP ) || NUM_SPOT_LIGHT_COORDS > 0
vec4 worldPosition = vec4(transformed, 1.0);
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrassCol;')
      .replace('#include <normal_fragment_begin>', '#undef DOUBLE_SIDED\n#include <normal_fragment_begin>');
  };
  mat.customProgramCacheKey = () => 'yama-grass';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.name = 'grass';
  return { mesh, geometry: g, maxCount };
}

// Высокий бурьян: статичный InstancedMesh по полю
export function buildWeeds(ctx) {
  const { tex, heightAt, splat, blocked, maxCount } = ctx;
  const rng = new RNG(6160);
  // пучок: стебли-ленты + метёлки
  const P = [], U = [], N = [], I = [];
  const quad = (x0, z0, x1, z1, y0, y1, w, lean) => {
    const b = P.length / 3, dx = z1 - z0, dz = x0 - x1, l = Math.hypot(dx, dz) || 1;
    const nx = dx / l, nz = dz / l;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3, y = y0 + (y1 - y0) * t, ww = w * (1 - t * 0.7), lx = lean[0] * t * t, lz = lean[1] * t * t;
      const cx = x0 + (x1 - x0) * t * 0 + lx, cz = z0 + lz;
      P.push(cx - nz * ww, y, cz + nx * ww, cx + nz * ww, y, cz - nx * ww);
      U.push(0, t, 1, t); N.push(nx * 0.4, 0.8, nz * 0.4, nx * 0.4, 0.8, nz * 0.4);
    }
    for (let k = 0; k < 3; k++) { const a = b + k * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };
  for (let s = 0; s < 7; s++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 0.12), h = rng.range(0.55, 1.25);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, ang = rng.range(0, Math.PI);
    quad(x, z, x + Math.cos(ang) * 0.01, z + Math.sin(ang) * 0.01, 0, h, 0.009, [Math.cos(a) * rng.range(0.05, 0.25), Math.sin(a) * rng.range(0.05, 0.25)]);
    if (rng.chance(0.6)) { // метёлка
      const lx = Math.cos(a) * 0.15, lz = Math.sin(a) * 0.15;
      quad(x + lx, z + lz, x + lx + 0.01, z + lz, h * 0.82, h * 1.02, 0.035, [0.02, 0.02]);
    }
  }
  for (let s = 0; s < 5; s++) { // листья у земли
    const a = rng.range(0, Math.PI * 2), h = rng.range(0.15, 0.35);
    quad(0, 0, 0.01, 0, 0, h, 0.03, [Math.cos(a) * 0.25, Math.sin(a) * 0.25]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setIndex(I);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassUniforms.uTime; sh.uniforms.tMacro = { value: tex.macro };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform sampler2D tMacro;')
      .replace('#include <project_vertex>', `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
#endif
float hh = max(position.y, 0.0);
vec2 wd = vec2(0.94, 0.34);
float gust = texture2D(tMacro, mvPosition.xz * 0.016 - wd * uTime * 0.05).r;
float sway = sin(uTime * 1.5 + mvPosition.x * 0.4 + mvPosition.z * 0.3) * 0.1 + (gust - 0.42) * 0.55;
mvPosition.xz += wd * sway * hh * hh * 0.6;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#undef DOUBLE_SIDED\n#include <normal_fragment_begin>');
  };
  mat.customProgramCacheKey = () => 'yama-weeds';
  const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const o = [0, 0, 0];
  let n = 0;
  for (let tries = 0; tries < maxCount * 20 && n < maxCount; tries++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.range(13 * 13, 85 * 85));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    splat(x, z, o);
    if (o[0] > 0.35 || o[1] > 0.4 || o[2] > 0.25 || blocked(x, z, 0.6)) continue;
    const k = rng.range(0.7, 1.3);
    mesh.setMatrixAt(n, m.compose(p.set(x, heightAt(x, z) - 0.02, z), q.setFromAxisAngle(up, rng.range(0, 6.28)), s.set(k, k * rng.range(0.8, 1.2), k)));
    const dry = rng.float();
    c.setRGB(0.05 + 0.08 * dry, 0.05 + 0.04 * dry, 0.02 + 0.02 * dry);
    mesh.setColorAt(n, c);
    n++;
  }
  mesh.count = n;
  mesh.userData.maxCount = n;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  return mesh;
}
