// Пулы частиц. Физика на CPU в типизированных массивах, рисование — один инстанс-вызов на систему.
//  GlowSystem   — аддитивные квады (искры, угольки, огонь, вспышки, трассеры, пузыри), HDR > 1 → bloom
//  SoftSystem   — мягкие альфа-спрайты с повершинным освещением от источников сцены (дым, пыль, туман, газ)
//  DebrisSystem — освещённые инстанс-меши (капли крови/кислоты, комья, сколы, щепки, песчинки)
import * as THREE from 'three';

export const GRAVITY = 13.7;
// флаги частиц
export const F = { COLLIDE: 1, DIE: 2, SPLAT: 4, REST: 8, CLAMP: 16 };

class Pool {
  constructor(cap, names, rng, ground) {
    this.cap = cap; this.n = 0; this.rr = 0; this.frame = 0;
    this.rng = rng; this.ground = ground;
    this.f = [];
    for (const nm of names) { const a = new Float32Array(cap); this[nm] = a; this.f.push(a); }
    this.kind = new Uint8Array(cap);
    this.flag = new Uint8Array(cap);
  }
  alloc() {
    if (this.n < this.cap) return this.n++;
    this.rr = (this.rr + 7) % this.cap; // пул полон — перезаписываем «случайную» старую частицу
    return this.rr;
  }
  kill(i) {
    const l = --this.n;
    if (i !== l) {
      const f = this.f;
      for (let k = 0; k < f.length; k++) f[k][i] = f[k][l];
      this.kind[i] = this.kind[l];
      this.flag[i] = this.flag[l];
    }
  }
  clear() { this.n = 0; }
}

function quadGeometry(cap, layout) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const attrs = {};
  for (const [name, size] of layout) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    attrs[name] = a;
  }
  geo.instanceCount = 0;
  return { geo, attrs };
}

// Загрузка на GPU только диапазона [start, start+n) элементов. Объект диапазона переиспользуется
// (addUpdateRange создавал бы новый каждый кадр); WebGLAttributes сам очищает список после загрузки.
export function flushAttr(attr, n, start = 0) {
  if (n <= 0) return;
  const r = attr._fxRange || (attr._fxRange = { start: 0, count: 0 });
  r.start = start * attr.itemSize;
  r.count = n * attr.itemSize;
  attr.updateRanges[0] = r;
  attr.updateRanges.length = 1;
  attr.needsUpdate = true;
}

const _bufSize = new THREE.Vector2();
// мировой размер пикселя на расстоянии 1 — чтобы тонкие штрихи не мерцали субпиксельно
function pixelHook(u) {
  return (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(_bufSize);
    const fov = camera.isPerspectiveCamera ? camera.fov : 60;
    u.value = (2 * Math.tan((fov * Math.PI) / 360)) / (camera.zoom || 1) / Math.max(1, _bufSize.y);
  };
}

// ---------------------------------------------------------------- аддитивные
const GLOW_VS = /* glsl */ `
#include <common>
attribute vec3 iPos;
attribute vec3 iAxis;
attribute vec2 iSize;
attribute vec4 iColor;
attribute vec4 iParam;
uniform float uPixel;
#ifdef USE_FOG
uniform float fogDensity;
uniform float fogNear;
uniform float fogFar;
#endif
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vDim;
varying vec4 vColor;
varying vec4 vParam;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float depth = max(-mv.z, 0.001);
  float w = iSize.x;
  float minW = uPixel * depth * 0.8;
  float k = 1.0;
  if (w < minW) { k = w / minW; w = minW; }
  vec3 ax = (viewMatrix * vec4(iAxis, 0.0)).xyz;
  float sl = length(ax.xy);
  vec2 c = position.xy;
  vec2 off;
  if (sl > 1e-5) {
    // вытянутый вдоль скорости/направления квад
    vec2 d = ax.xy / sl;
    vec2 p = vec2(-d.y, d.x);
    off = d * c.y * (sl + w) + p * c.x * w;
    vLocal = vec2(c.x * w, c.y * (sl + w));
    vUv = c;
  } else {
    float cs = cos(iSize.y), sn = sin(iSize.y);
    off = c * w;
    vUv = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y);
    vLocal = c * w;
  }
  vDim = vec2(w, sl);
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float fog = 1.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      fog = exp(-fogDensity * fogDensity * depth * depth);
    #else
      fog = 1.0 - smoothstep(fogNear, fogFar, depth);
    #endif
  #endif
  vColor = vec4(iColor.rgb * fog * k * smoothstep(0.04, 0.25, depth), iColor.a);
  vParam = iParam;
}`;

const GLOW_FS = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
varying vec2 vUv;
varying vec2 vLocal;
varying vec2 vDim;
varying vec4 vColor;
varying vec4 vParam;
vec3 fireRamp(float t) {
  vec3 c = vec3(0.8, 0.09, 0.012) * smoothstep(0.02, 0.3, t);
  c = mix(c, vec3(3.0, 0.95, 0.2), smoothstep(0.25, 0.62, t));
  c = mix(c, vec3(6.5, 4.0, 1.8), smoothstep(0.6, 1.05, t));
  return c;
}
void main() {
  float shape = vParam.x;
  vec3 col;
  if (shape < 0.5) {
    // точка/капсула: искры, угольки, вспышки
    float dy = max(abs(vLocal.y) - vDim.y, 0.0);
    float d = length(vec2(vLocal.x, dy)) / vDim.x;
    if (d >= 1.0) discard;
    float core = 1.0 - d;
    core = core * core * (0.5 + 0.5 * core);
    float head = vDim.y > 0.0 ? clamp(vLocal.y / (vDim.y + vDim.x) * 0.5 + 0.5, 0.0, 1.0) : 1.0;
    col = vColor.rgb * core * (0.25 + 0.75 * head);
  } else if (shape < 1.5) {
    // огонь: шум «выедает» края, цвет по температуре
    float r2 = dot(vUv, vUv);
    if (r2 >= 1.0) discard;
    vec2 q = vUv * 0.42 + vParam.zw;
    float n = texture2D(uNoise, q + vec2(0.0, -uTime * 0.3)).b * 0.55
            + texture2D(uNoise, q * 2.3 + vec2(uTime * 0.1, -uTime * 0.5)).r * 0.45;
    float dens = clamp((1.0 - r2) * 1.9 - (1.0 - n) * 1.25, 0.0, 1.0);
    float t = vParam.y * (0.3 + 0.9 * dens);
    col = fireRamp(t) * dens * vColor.rgb;
  } else if (shape < 2.5) {
    // трассер: тонкая полоса с яркой головой
    float dy = max(abs(vLocal.y) - vDim.y, 0.0);
    float d = length(vec2(vLocal.x, dy)) / vDim.x;
    if (d >= 1.0) discard;
    float head = clamp(vLocal.y / (vDim.y + vDim.x) * 0.5 + 0.5, 0.0, 1.0);
    col = vColor.rgb * (1.0 - d) * (1.0 - d) * (0.08 + 0.92 * head * head * head);
  } else {
    // пузырь-кольцо
    float r = length(vUv);
    if (r >= 1.0) discard;
    float ring = smoothstep(0.55, 0.8, r) * (1.0 - smoothstep(0.86, 1.0, r));
    col = vColor.rgb * (ring + 0.1 * (1.0 - r));
  }
  gl_FragColor = vec4(col * vColor.a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const GK = { SPARK: 0, EMBER: 1, FIRE: 2, FLASH: 3, TRACER: 4, BUBBLE: 5, MOTE: 6 };
const GLOW_FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'drag', 'grav', 's0', 's1', 'rot', 'spin', 'heat',
  'cr', 'cg', 'cb', 'ca', 'sdx', 'sdy', 'gy', 'ox', 'oy', 'oz', 'dx', 'dy', 'dz', 'dist', 'len'];

export class GlowSystem extends Pool {
  constructor(cap, rng, ground, noise) {
    super(cap, GLOW_FIELDS, rng, ground);
    const { geo, attrs } = quadGeometry(cap, [['iPos', 3], ['iAxis', 3], ['iSize', 2], ['iColor', 4], ['iParam', 4]]);
    this.geo = geo; this.attrs = attrs;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uPixel: { value: 0.002 } }]);
    uniforms.uNoise = { value: noise };
    this.uniforms = uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'fx-glow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = pixelHook(uniforms.uPixel);
  }

  // базовая частица; специфичные поля (heat, spin, трассер) выставляет вызывающий по индексу
  spawn(kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag, grav, flags) {
    const i = this.alloc(), rng = this.rng;
    this.kind[i] = kind; this.flag[i] = flags;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.ca[i] = a;
    this.drag[i] = drag; this.grav[i] = grav;
    this.rot[i] = rng.next() * 6.283; this.spin[i] = 0; this.heat[i] = 1;
    this.sdx[i] = rng.next(); this.sdy[i] = rng.next();
    this.gy[i] = flags & F.COLLIDE ? this.ground.heightAt(x, z) : -1e9;
    return i;
  }

  tracer(x, y, z, tx, ty, tz, r, g, b, width) {
    let dx = tx - x, dy = ty - y, dz = tz - z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.3) return -1;
    dx /= dist; dy /= dist; dz /= dist;
    const tHead = Math.min(0.08, Math.max(0.05, dist / 700));
    const speed = dist / tHead, len = Math.min(6, Math.max(0.8, dist * 0.3));
    const i = this.spawn(GK.TRACER, x, y, z, 0, 0, 0, (dist + len) / speed, width, width, r, g, b, 1, 0, 0, 0);
    this.ox[i] = x; this.oy[i] = y; this.oz[i] = z;
    this.dx[i] = dx; this.dy[i] = dy; this.dz[i] = dz;
    this.dist[i] = dist; this.len[i] = len; this.heat[i] = speed;
    return i;
  }

  update(dt) {
    const { px, py, pz, vx, vy, vz, age, life, drag, grav, rot, spin, gy, kind, flag } = this;
    const frame = this.frame++;
    for (let i = this.n - 1; i >= 0; i--) {
      const a = age[i] + dt;
      if (a >= life[i]) { this.kill(i); continue; }
      age[i] = a;
      const k = kind[i];
      if (k === GK.TRACER || k === GK.FLASH) continue;
      const dk = 1 / (1 + drag[i] * dt);
      vx[i] *= dk; vz[i] *= dk;
      vy[i] = vy[i] * dk - GRAVITY * grav[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      rot[i] += spin[i] * dt;
      const fl = flag[i];
      if (fl & F.COLLIDE) {
        if (((i + frame) & 7) === 0) gy[i] = this.ground.heightAt(px[i], pz[i]);
        if (py[i] < gy[i]) {
          if (fl & F.DIE) { this.kill(i); continue; }
          py[i] = gy[i] + 0.003;
          if (vy[i] < 0) vy[i] *= -0.32;
          vx[i] *= 0.55; vz[i] *= 0.55;
        }
      }
    }
  }

  write(time) {
    const n = this.n, A = this.attrs;
    const P = A.iPos.array, X = A.iAxis.array, S = A.iSize.array, C = A.iColor.array, Q = A.iParam.array;
    const { px, py, pz, vx, vy, vz, age, life, s0, s1, rot, heat, cr, cg, cb, ca, sdx, sdy, kind } = this;
    for (let i = 0; i < n; i++) {
      const t = age[i] / life[i];
      let x = px[i], y = py[i], z = pz[i], ax = 0, ay = 0, az = 0, size = s0[i];
      let r = cr[i], g = cg[i], b = cb[i], al = ca[i], shape = 0, ht = 0;
      switch (kind[i]) {
        case GK.SPARK: {
          const h = 1 - t, st = 0.016;
          ax = vx[i] * st; ay = vy[i] * st; az = vz[i] * st;
          r *= 0.55 + 0.45 * h; g *= 0.18 + 0.82 * h * h; b *= h * h * h;
          al *= Math.sqrt(h);
          break;
        }
        case GK.EMBER: {
          const h = 1 - t;
          const fl = 0.55 + 0.45 * Math.sin(age[i] * 17 + sdx[i] * 40) * Math.sin(age[i] * 6.1 + sdy[i] * 23);
          ax = vx[i] * 0.03; ay = vy[i] * 0.03; az = vz[i] * 0.03;
          r *= fl; g *= fl * (0.35 + 0.65 * h); b *= fl * h * 0.4;
          al *= Math.min(1, h * 4);
          break;
        }
        case GK.FIRE: {
          const e = 1 - (1 - t) * (1 - t);
          size = s0[i] + (s1[i] - s0[i]) * e;
          shape = 1;
          ht = heat[i] * Math.pow(1 - t, 1.25);
          al *= Math.min(1, age[i] / 0.035) * (1 - t * t);
          break;
        }
        case GK.FLASH: {
          size = s0[i] + (s1[i] - s0[i]) * Math.sqrt(t);
          al *= (1 - t) * (1 - t);
          break;
        }
        case GK.TRACER: {
          const sp = heat[i], dist = this.dist[i], len = this.len[i], a = age[i];
          const sh = Math.min(a * sp, dist), stl = Math.min(Math.max(a * sp - len, 0), dist);
          const m = (sh + stl) * 0.5, hl = (sh - stl) * 0.5;
          x = this.ox[i] + this.dx[i] * m; y = this.oy[i] + this.dy[i] * m; z = this.oz[i] + this.dz[i] * m;
          ax = this.dx[i] * hl; ay = this.dy[i] * hl; az = this.dz[i] * hl;
          shape = 2;
          break;
        }
        case GK.BUBBLE: {
          size = s0[i] + (s1[i] - s0[i]) * t;
          shape = 3;
          al *= t < 0.8 ? Math.min(1, t * 8) : (1 - t) * 5;
          break;
        }
        default: { // MOTE
          size = s0[i] + (s1[i] - s0[i]) * t;
          al *= (1 - t) * (1 - t);
        }
      }
      const i3 = i * 3, i4 = i * 4;
      P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
      X[i3] = ax; X[i3 + 1] = ay; X[i3 + 2] = az;
      S[i * 2] = size; S[i * 2 + 1] = rot[i];
      C[i4] = r; C[i4 + 1] = g; C[i4 + 2] = b; C[i4 + 3] = al;
      Q[i4] = shape; Q[i4 + 1] = ht; Q[i4 + 2] = sdx[i]; Q[i4 + 3] = sdy[i];
    }
    flushAttr(A.iPos, n); flushAttr(A.iAxis, n); flushAttr(A.iSize, n); flushAttr(A.iColor, n); flushAttr(A.iParam, n);
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    this.uniforms.uTime.value = time;
  }
}

// ---------------------------------------------------------------- мягкие (освещённые)
const SOFT_VS = /* glsl */ `
#include <common>
#include <lights_pars_begin>
#include <fog_pars_vertex>
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iColor;
attribute vec4 iParam;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vLight;
varying vec3 vEm;
varying vec2 vSeed;
varying vec2 vGround;
varying float vNear;
// рассеяние вперёд: контровой свет ярче
float phaseFn(float c) { return 0.45 + 1.4 * pow(max(c, 0.0), 6.0); }
void main() {
  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
  vec3 P = mvPosition.xyz;
  float cs = cos(iSize.y), sn = sin(iSize.y);
  vUv = vec2(cs * position.x - sn * position.y, sn * position.x + cs * position.y);
  mvPosition.xy += position.xy * iSize.x;
  gl_Position = projectionMatrix * mvPosition;
  // высота вершины над землёй — мягкое касание без резкой линии пересечения
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float wy = iPos.y + (camR.y * position.x + camU.y * position.y) * iSize.x;
  vGround = vec2(wy - iParam.w, min(0.4, iSize.x * 0.6));
  vec3 V = normalize(-P);
  vec3 N = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 irr = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
    irr += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, 0.5 + 0.3 * dot(N, hemisphereLights[i].direction));
  }
  #endif
  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3 L = directionalLights[i].direction;
    irr += directionalLights[i].color * phaseFn(dot(-L, V)) * (0.55 + 0.45 * max(dot(N, L), 0.0));
  }
  #endif
  #if NUM_POINT_LIGHTS > 0
  IncidentLight pl;
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    getPointLightInfo(pointLights[i], P, pl);
    irr += pl.color * phaseFn(dot(-pl.direction, V));
  }
  #endif
  #if NUM_SPOT_LIGHTS > 0
  IncidentLight sl;
  for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
    getSpotLightInfo(spotLights[i], P, sl);
    irr += sl.color * phaseFn(dot(-sl.direction, V));
  }
  #endif
  vLight = irr * RECIPROCAL_PI;
  // iParam.z > 0 — свечение раскалённого дыма (оранжевое), < 0 — собственное свечение цвета частицы (кислота, газ)
  float e = iParam.z;
  float mx = max(max(iColor.r, iColor.g), max(iColor.b, 1e-4));
  vEm = e > 0.0 ? e * vec3(1.0, 0.36, 0.08) : -e * iColor.rgb / mx;
  vColor = iColor;
  vSeed = iParam.xy;
  vNear = smoothstep(0.08, 0.08 + iSize.x * 1.2, -P.z);
  #include <fog_vertex>
}`;

const SOFT_FS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vLight;
varying vec3 vEm;
varying vec2 vSeed;
varying vec2 vGround;
varying float vNear;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 >= 1.0) discard;
  vec2 q = vUv * 0.36 + vSeed;
  float n1 = texture2D(uNoise, q + vec2(uTime * 0.012, uTime * 0.007)).r;
  float n2 = texture2D(uNoise, q * 2.2 - vec2(uTime * 0.018, 0.0)).g;
  float n = n1 * 0.62 + n2 * 0.38;
  float d = clamp((1.0 - r2) * (0.25 + 1.35 * n) * 1.45 - 0.2, 0.0, 1.0);
  float a = vColor.a * d * smoothstep(0.0, vGround.y, vGround.x) * vNear;
  if (a < 0.003) discard;
  // плотная середина темнее (самозатенение)
  vec3 col = vColor.rgb * vLight * (1.2 - 0.5 * d) + vEm * (0.4 + 0.6 * d);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const SK = { SMOKE: 0, DUST: 1, MIST: 2, GAS: 3, FUME: 4 };
const SOFT_FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'drag', 'grav', 's0', 's1', 'rot', 'spin',
  'cr', 'cg', 'cb', 'ca', 'em', 'sdx', 'sdy', 'gy', 'fin'];

export class SoftSystem extends Pool {
  constructor(cap, rng, ground, noise) {
    super(cap, SOFT_FIELDS, rng, ground);
    const { geo, attrs } = quadGeometry(cap, [['iPos', 3], ['iSize', 2], ['iColor', 4], ['iParam', 4]]);
    this.geo = geo; this.attrs = attrs;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, { uTime: { value: 0 } }]);
    uniforms.uNoise = { value: noise };
    this.uniforms = uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: SOFT_VS, fragmentShader: SOFT_FS,
      transparent: true, depthWrite: false, lights: true, fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'fx-soft';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }

  spawn(kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag, grav) {
    const i = this.alloc(), rng = this.rng;
    this.kind[i] = kind; this.flag[i] = 0;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.ca[i] = a;
    this.drag[i] = drag; this.grav[i] = grav;
    this.rot[i] = rng.next() * 6.283; this.spin[i] = (rng.next() - 0.5) * 0.8;
    this.em[i] = 0; this.fin[i] = 0.08;
    this.sdx[i] = rng.next(); this.sdy[i] = rng.next();
    this.gy[i] = this.ground.heightAt(x, z);
    return i;
  }

  update(dt) {
    const { px, py, pz, vx, vy, vz, age, life, drag, grav, rot, spin, gy, s0, s1 } = this;
    const frame = this.frame++;
    for (let i = this.n - 1; i >= 0; i--) {
      const a = age[i] + dt;
      if (a >= life[i]) { this.kill(i); continue; }
      age[i] = a;
      const dk = 1 / (1 + drag[i] * dt);
      vx[i] *= dk; vz[i] *= dk;
      vy[i] = vy[i] * dk - GRAVITY * grav[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      rot[i] += spin[i] * dt;
      if (((i + frame) & 15) === 0) gy[i] = this.ground.heightAt(px[i], pz[i]);
      // не уходим под землю: центр не ниже трети текущего радиуса
      const t = a / life[i], s = s0[i] + (s1[i] - s0[i]) * t;
      const minY = gy[i] + s * 0.3;
      if (py[i] < minY) { py[i] = minY; if (vy[i] < 0) vy[i] = 0; }
    }
  }

  write(time) {
    const n = this.n, A = this.attrs;
    const P = A.iPos.array, S = A.iSize.array, C = A.iColor.array, Q = A.iParam.array;
    const { px, py, pz, age, life, s0, s1, rot, cr, cg, cb, ca, em, sdx, sdy, gy, fin, kind } = this;
    for (let i = 0; i < n; i++) {
      const t = age[i] / life[i], h = 1 - t;
      let size, al = ca[i], e = em[i];
      switch (kind[i]) {
        case SK.SMOKE:
          size = s0[i] + (s1[i] - s0[i]) * (1 - Math.pow(h, 2.2));
          al *= Math.min(1, age[i] / fin[i]) * Math.pow(h, 1.3);
          if (e > 0) e *= Math.max(0, 1 - age[i] / 0.45);
          break;
        case SK.GAS:
          size = s0[i] + (s1[i] - s0[i]) * Math.sqrt(t);
          al *= Math.min(1, age[i] / fin[i]) * Math.min(1, h * 2.5);
          break;
        case SK.FUME:
          size = s0[i] + (s1[i] - s0[i]) * t;
          al *= Math.min(1, age[i] / fin[i]) * h;
          break;
        default: // DUST, MIST
          size = s0[i] + (s1[i] - s0[i]) * (1 - h * h * h);
          al *= Math.min(1, age[i] / fin[i]) * h * h;
      }
      const i3 = i * 3, i4 = i * 4;
      P[i3] = px[i]; P[i3 + 1] = py[i]; P[i3 + 2] = pz[i];
      S[i * 2] = size; S[i * 2 + 1] = rot[i];
      C[i4] = cr[i]; C[i4 + 1] = cg[i]; C[i4 + 2] = cb[i]; C[i4 + 3] = al;
      Q[i4] = sdx[i]; Q[i4 + 1] = sdy[i]; Q[i4 + 2] = e; Q[i4 + 3] = gy[i];
    }
    flushAttr(A.iPos, n); flushAttr(A.iSize, n); flushAttr(A.iColor, n); flushAttr(A.iParam, n);
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    this.uniforms.uTime.value = time;
  }
}

// ---------------------------------------------------------------- освещённые меши
export const DK = { BLOOD: 0, ACID: 1, CLOD: 2, CHIP: 3, SPLINTER: 4, GRAIN: 5 };
const DEB_FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 'drag', 'grav', 'size', 'sx', 'sy', 'sz',
  'kx', 'ky', 'kz', 'ang', 'spin', 'cr', 'cg', 'cb', 'rough', 'emis', 'gy', 'rest'];

export class DebrisSystem extends Pool {
  constructor(cap, rng, ground, onSplat) {
    super(cap, DEB_FIELDS, rng, ground);
    this.onSplat = onSplat; // (x, y, z, size, kind, vx, vz)
    const geo = new THREE.IcosahedronGeometry(1, 1);
    this.aMat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.aMat.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aMat', this.aMat);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aMat;\nvarying vec2 vMat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMat;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMat.x;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vMat.y;');
    };
    this.material = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'fx-debris';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  spawn(kind, x, y, z, vx, vy, vz, life, size, r, g, b, rough, flags) {
    const i = this.alloc(), rng = this.rng;
    this.kind[i] = kind; this.flag[i] = flags | F.COLLIDE;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.rough[i] = rough; this.emis[i] = 0;
    this.drag[i] = kind <= DK.ACID ? 0.35 : 0.25; this.grav[i] = 1;
    // форма: комья приплюснутые, щепки длинные
    if (kind === DK.SPLINTER) { this.sx[i] = 0.22 + rng.next() * 0.2; this.sy[i] = 0.12 + rng.next() * 0.1; this.sz[i] = 1.6 + rng.next() * 1.6; }
    else if (kind === DK.CLOD || kind === DK.CHIP) { this.sx[i] = 0.7 + rng.next() * 0.6; this.sy[i] = 0.5 + rng.next() * 0.4; this.sz[i] = 0.7 + rng.next() * 0.6; }
    else { this.sx[i] = 1; this.sy[i] = 1; this.sz[i] = 1; }
    let kx = rng.next() - 0.5, ky = rng.next() - 0.5, kz = rng.next() - 0.5;
    const kl = Math.hypot(kx, ky, kz) || 1;
    this.kx[i] = kx / kl; this.ky[i] = ky / kl; this.kz[i] = kz / kl;
    this.ang[i] = rng.next() * 6.283; this.spin[i] = (rng.next() - 0.5) * 40;
    this.gy[i] = this.ground.heightAt(x, z);
    this.rest[i] = 0;
    return i;
  }

  update(dt) {
    const { px, py, pz, vx, vy, vz, age, life, drag, grav, ang, spin, gy, kind, flag, size, sy } = this;
    const frame = this.frame++;
    for (let i = this.n - 1; i >= 0; i--) {
      const a = age[i] + dt;
      if (a >= life[i]) { this.kill(i); continue; }
      age[i] = a;
      const fl = flag[i];
      if (fl & F.REST) continue;
      const dk = 1 / (1 + drag[i] * dt);
      vx[i] *= dk; vz[i] *= dk;
      vy[i] = vy[i] * dk - GRAVITY * grav[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      ang[i] += spin[i] * dt;
      if (((i + frame) & 3) === 0 || py[i] < gy[i] + 0.5) gy[i] = this.ground.heightAt(px[i], pz[i]);
      const k = kind[i];
      const rad = size[i] * (k === DK.CLOD || k === DK.CHIP || k === DK.SPLINTER ? sy[i] : 1);
      if (py[i] - rad < gy[i]) {
        if (fl & F.DIE) {
          if (fl & F.SPLAT) this.onSplat(px[i], gy[i], pz[i], size[i], k, vx[i], vz[i]);
          this.kill(i);
          continue;
        }
        py[i] = gy[i] + rad;
        if (vy[i] < 0) vy[i] *= k === DK.CLOD ? -0.18 : -0.32;
        vx[i] *= 0.55; vz[i] *= 0.55; spin[i] *= 0.5;
        if (Math.abs(vy[i]) < 0.7) {
          vy[i] = 0; vx[i] = 0; vz[i] = 0; spin[i] = 0;
          flag[i] = fl | F.REST;
        }
      }
    }
  }

  write() {
    const n = this.n, M = this.mesh.instanceMatrix.array, Cc = this.mesh.instanceColor.array, Am = this.aMat.array;
    const { px, py, pz, vx, vy, vz, age, life, size, sx, sy, sz, kx, ky, kz, ang, cr, cg, cb, rough, emis, kind } = this;
    for (let i = 0; i < n; i++) {
      const o = i * 16, k = kind[i];
      const left = life[i] - age[i];
      const shrink = left < 0.35 ? left / 0.35 : 1;
      if (k === DK.BLOOD || k === DK.ACID || k === DK.GRAIN) {
        // капля вытянута вдоль скорости
        const sp = Math.hypot(vx[i], vy[i], vz[i]);
        let zx = 0, zy = 1, zz = 0;
        if (sp > 1e-3) { zx = vx[i] / sp; zy = vy[i] / sp; zz = vz[i] / sp; }
        let xx = zz, xz = -zx, xl = Math.hypot(xx, xz);
        if (xl < 1e-4) { xx = 1; xz = 0; xl = 1; }
        xx /= xl; xz /= xl;
        const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
        const s = size[i] * shrink, st = s * Math.min(3.2, 1 + sp * 0.07);
        M[o] = xx * s; M[o + 1] = 0; M[o + 2] = xz * s; M[o + 3] = 0;
        M[o + 4] = yx * s; M[o + 5] = yy * s; M[o + 6] = yz * s; M[o + 7] = 0;
        M[o + 8] = zx * st; M[o + 9] = zy * st; M[o + 10] = zz * st; M[o + 11] = 0;
      } else {
        // кувыркание: поворот вокруг оси (формула Родрига)
        const c = Math.cos(ang[i]), s = Math.sin(ang[i]), t = 1 - c, x = kx[i], y = ky[i], z = kz[i];
        const b = size[i] * shrink, ex = b * sx[i], ey = b * sy[i], ez = b * sz[i];
        M[o] = (c + x * x * t) * ex; M[o + 1] = (y * x * t + z * s) * ex; M[o + 2] = (z * x * t - y * s) * ex; M[o + 3] = 0;
        M[o + 4] = (x * y * t - z * s) * ey; M[o + 5] = (c + y * y * t) * ey; M[o + 6] = (z * y * t + x * s) * ey; M[o + 7] = 0;
        M[o + 8] = (x * z * t + y * s) * ez; M[o + 9] = (y * z * t - x * s) * ez; M[o + 10] = (c + z * z * t) * ez; M[o + 11] = 0;
      }
      M[o + 12] = px[i]; M[o + 13] = py[i]; M[o + 14] = pz[i]; M[o + 15] = 1;
      Cc[i * 3] = cr[i]; Cc[i * 3 + 1] = cg[i]; Cc[i * 3 + 2] = cb[i];
      Am[i * 2] = rough[i]; Am[i * 2 + 1] = emis[i];
    }
    flushAttr(this.mesh.instanceMatrix, n); flushAttr(this.mesh.instanceColor, n); flushAttr(this.aMat, n);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
  }
}
