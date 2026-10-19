// Яма: стенка (радиальная сетка), пласты, корни, камни, свечение со дна, угли и дым.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, makeNoise2D, makeNoise3D, clamp, smoothstep, lerp } from '../core/noise.js';
import { SEG, TAU, PIT_DEPTH, wallOffset } from './shape.js';
import { fixSeamNormals } from './terrain.js';

export const pitUniforms = { uPitGlow: { value: 1 }, uTime: { value: 0 } };

// Патч материала: луна/небо гаснут с глубиной, туман в яме — красная дымка, свечение у дна
export function patchPit(mat, key, emissiveGlow = true) {
  const lfb = THREE.ShaderChunk.lights_fragment_begin
    .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= pitAtt;')
    .replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * pitAtt;');
  if (!lfb.includes('pitAtt;')) console.warn('[world] lights chunk patch failed');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPitGlow = pitUniforms.uPitGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPitDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPitDepth = -(modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uPitGlow;\nvarying float vPitDepth;')
      .replace('#include <lights_fragment_begin>', 'float pitAtt = exp(-max(vPitDepth - 0.8, 0.0) * 0.17);\n' + lfb)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (emissiveGlow
        ? '{ float gD = smoothstep(10.0, 36.0, vPitDepth); totalEmissiveRadiance += vec3(1.0, 0.2, 0.04) * gD * gD * 1.6 * uPitGlow * diffuseColor.rgb; }' : ''))
      .replace('#include <fog_fragment>', `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float hz = smoothstep(2.5, 33.0, vPitDepth);
  vec3 hazeCol = mix(fogColor, vec3(0.2, 0.034, 0.007) * uPitGlow, smoothstep(1.5, 26.0, vPitDepth));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, max(fogFactor, hz * 0.93));
#endif`);
  };
  mat.customProgramCacheKey = () => 'yama-pit-' + key;
  return mat;
}

// Цвет пластов по глубине (линейный множитель к текстуре породы)
const LAYERS = [
  [0.0, [0.13, 0.095, 0.07]],   // дёрн, гумус
  [0.3, [0.27, 0.18, 0.12]],    // суглинок
  [1.45, [0.5, 0.43, 0.33]],    // светлая песчаная прослойка
  [1.62, [0.44, 0.27, 0.15]],   // рыжая глина
  [3.0, [0.33, 0.3, 0.26]],     // гравий
  [4.5, [0.42, 0.4, 0.36]],     // известняк
  [8.5, [0.25, 0.23, 0.21]],    // тёмная порода
];
const sN = makeNoise2D(55), sN2 = makeNoise2D(56);
function strata(a, depth, R, out) {
  const c = Math.cos(a) * R, s = Math.sin(a) * R;
  const w = depth + 0.3 * sN(c * 0.13, s * 0.13) + 0.1 * sN(c * 0.5, s * 0.5);
  let i = 0;
  while (i < LAYERS.length - 1 && w >= LAYERS[i + 1][0]) i++;
  let col = LAYERS[i][1];
  // мягкий переход к следующему пласту
  if (i < LAYERS.length - 1) {
    const nb = LAYERS[i + 1][0], t = smoothstep(nb - 0.07, nb, w), nc = LAYERS[i + 1][1];
    out[0] = lerp(col[0], nc[0], t); out[1] = lerp(col[1], nc[1], t); out[2] = lerp(col[2], nc[2], t);
  } else { out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; }
  if (w > 8.5) { // чередование слоёв в глубине
    const b = 0.75 + 0.25 * Math.sin(w * 2.3 + sN2(c * 0.1, s * 0.1) * 2);
    out[0] *= b; out[1] *= b; out[2] *= b;
  }
  const k = (0.82 + 0.3 * sN2(c * 0.4 + depth * 0.2, s * 0.4)) * 1.25;
  out[0] *= k; out[1] *= k; out[2] *= k;
}

export function buildPit(ctx) {
  const { grid, tex, quality, root } = ctx;
  const rng = new RNG(3030);
  const W = SEG + 1;
  const parts = {};

  // ---------- стенка ----------
  const depths = [0, 0.04, 0.1, 0.18, 0.27, 0.38, 0.52, 0.68, 0.86];
  for (let d = 1.04; d < 3.95; d += 0.17) depths.push(d);
  depths.push(4.0);
  for (let d = 4; d < PIT_DEPTH;) { d = Math.min(PIT_DEPTH, d + 0.3 + 0.075 * (d - 4)); depths.push(d); }
  const NK = depths.length, N = NK * W;
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), col = new Float32Array(N * 3);
  const c3 = [0, 0, 0];
  const wallR = new Float32Array(N); // для размещения камней/корней
  for (let k = 0; k < NK; k++) for (let j = 0; j < W; j++) {
    const a = (j % SEG) / SEG * TAU, R = grid.rim[j], dep = depths[k], i = k * W + j;
    const r = R + wallOffset(a, dep, R);
    wallR[i] = r;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = grid.py[j] - dep; pos[i * 3 + 2] = Math.sin(a) * r;
    uv[i * 2] = j / SEG * 26; uv[i * 2 + 1] = dep / 2.6;
    strata(a, dep, R, c3);
    col[i * 3] = c3[0]; col[i * 3 + 1] = c3[1]; col[i * 3 + 2] = c3[2];
  }
  const idx = [];
  for (let k = 0; k < NK - 1; k++) for (let j = 0; j < SEG; j++) {
    const a = k * W + j, b = a + 1, d = a + W, c = d + 1;
    idx.push(a, d, b, b, d, c); // нормали внутрь ямы
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  wg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  wg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  wg.setIndex(idx);
  wg.computeVertexNormals();
  fixSeamNormals(wg, NK, W);
  const wallMat = patchPit(new THREE.MeshStandardMaterial({
    map: tex.rock.map, normalMap: tex.rock.normalMap, normalScale: new THREE.Vector2(1.3, 1.3),
    vertexColors: true, roughness: 0.93, metalness: 0,
  }), 'wall');
  const wall = new THREE.Mesh(wg, wallMat);
  wall.receiveShadow = true; wall.castShadow = true; wall.name = 'pitWall';
  root.add(wall);
  parts.wall = wall;
  const wallPoint = (a, dep) => { // радиус стенки в произвольной точке
    const j = Math.round(((a / TAU) % 1 + 1) % 1 * SEG);
    const R = grid.rim[j];
    return { r: R + wallOffset(a, dep, R), y: grid.py[j] - dep, R };
  };

  // ---------- корни, свисающие из-под дёрна ----------
  const rootGeos = [];
  const tube = (pts, r0, r1, sides = 5) => {
    const n = pts.length, P = [], I = [], U = [];
    const tmp = new THREE.Vector3(), t = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      nrm.crossVectors(t, Math.abs(t.y) > 0.9 ? tmp.set(1, 0, 0) : up).normalize();
      bin.crossVectors(t, nrm);
      const rr = lerp(r0, r1, i / (n - 1));
      for (let s = 0; s <= sides; s++) {
        const an = s / sides * TAU;
        P.push(pts[i].x + (nrm.x * Math.cos(an) + bin.x * Math.sin(an)) * rr, pts[i].y + (nrm.y * Math.cos(an) + bin.y * Math.sin(an)) * rr, pts[i].z + (nrm.z * Math.cos(an) + bin.z * Math.sin(an)) * rr);
        U.push(s / sides, i / (n - 1) * 3);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
      const a = i * (sides + 1) + s, b = a + sides + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeVertexNormals();
    return g;
  };
  const addRoot = (a, dep, len, r0, branchDepth) => {
    const w = wallPoint(a, dep), ca = Math.cos(a), sa = Math.sin(a);
    const pts = [];
    let x = ca * (w.r + 0.05), y = w.y, z = sa * (w.r + 0.05);
    let vx = -ca * rng.range(0.25, 0.6), vz = -sa * rng.range(0.25, 0.6), vy = rng.range(-0.2, 0.15);
    const steps = 7;
    for (let s = 0; s <= steps; s++) {
      pts.push(new THREE.Vector3(x, y, z));
      const st = len / steps;
      x += vx * st; y += vy * st; z += vz * st;
      vy -= 0.55 * st * 2; // провисание
      vx *= 0.75; vz *= 0.75;
      vx += rng.range(-0.15, 0.15); vz += rng.range(-0.15, 0.15);
    }
    rootGeos.push(tube(pts, r0, r0 * 0.12, r0 > 0.02 ? 5 : 4));
    if (branchDepth < 1 && len > 0.6) {
      const p = pts[rng.int(2, 4)];
      const sub = [p.clone()];
      let bx = rng.range(-0.3, 0.3), bz = rng.range(-0.3, 0.3), by = -0.2;
      for (let s = 0; s < 4; s++) { const q = sub[sub.length - 1]; sub.push(new THREE.Vector3(q.x + bx * 0.15, q.y + by * 0.18 - 0.05, q.z + bz * 0.15)); by -= 0.4; }
      rootGeos.push(tube(sub, r0 * 0.5, r0 * 0.08, 3));
    }
  };
  const nRoots = quality === 'low' ? 110 : 190;
  for (let i = 0; i < nRoots; i++) addRoot(rng.range(0, TAU), rng.range(0.1, 0.55), rng.range(0.25, 1.5), rng.range(0.007, 0.03), 0);
  for (let i = 0; i < 30; i++) addRoot(rng.range(0, TAU), rng.range(0.6, 2.2), rng.range(0.2, 0.8), rng.range(0.006, 0.016), 1);
  const rootMat = patchPit(new THREE.MeshStandardMaterial({ map: tex.bark.map, color: 0x6b5442, roughness: 0.9 }), 'roots', false);
  const roots = new THREE.Mesh(mergeGeometries(rootGeos), rootMat);
  roots.castShadow = true; roots.receiveShadow = true;
  root.add(roots);

  // ---------- камни в стенках ----------
  const rockN = makeNoise3D(77);
  const rockGeo = (rad, seed) => {
    const g = new THREE.IcosahedronGeometry(1, rad > 0.5 ? 2 : 1);
    const p = g.attributes.position, sx = rng.range(0.7, 1.3), sy = rng.range(0.5, 0.9), sz = rng.range(0.7, 1.3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.28 * rockN(x * 1.3 + seed, y * 1.3, z * 1.3) + 0.1 * rockN(x * 3 + seed, y * 3, z * 3);
      p.setXYZ(i, x * rad * sx * n, y * rad * sy * n, z * rad * sz * n);
    }
    g.deleteAttribute('uv');
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    // UV — проекция по нормали
    const P = ng.attributes.position, Nn = ng.attributes.normal, U = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      const ax = Math.abs(Nn.getX(i)), ay = Math.abs(Nn.getY(i));
      U[i * 2] = (ax > ay ? P.getZ(i) : P.getX(i)) * 0.5; U[i * 2 + 1] = (ay > ax ? P.getZ(i) : P.getY(i)) * 0.5;
    }
    ng.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    return ng;
  };
  const rockGeos = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const colorize = (g, r, gg, b) => {
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { const k = 0.85 + 0.3 * Math.random(); c[i] = r * k; c[i + 1] = gg * k; c[i + 2] = b * k; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  for (let i = 0; i < 70; i++) {
    const dep = i < 14 ? rng.range(1.4, 3.8) : rng.range(4.5, 33);
    const rad = i < 14 ? rng.range(0.12, 0.3) : rng.range(0.35, 1.5);
    const a = rng.range(0, TAU), w = wallPoint(a, dep);
    const g = rockGeo(rad, i * 3.1);
    const out = i < 14 ? 0.55 : 0.35;
    v.set(Math.cos(a) * (w.r - rad * out), w.y, Math.sin(a) * (w.r - rad * out));
    e.set(rng.range(-0.4, 0.4), rng.range(0, TAU), rng.range(-0.4, 0.4)); q.setFromEuler(e);
    m4.compose(v, q, sc); g.applyMatrix4(m4);
    const gr = rng.range(0.32, 0.5);
    rockGeos.push(colorize(g, gr * 1.05, gr, gr * 0.92));
  }
  const rockMat = patchPit(new THREE.MeshStandardMaterial({ map: tex.rock.map, normalMap: tex.rock.normalMap, vertexColors: true, roughness: 0.88 }), 'rocks');
  const rocks = new THREE.Mesh(mergeGeometries(rockGeos), rockMat);
  rocks.castShadow = true; rocks.receiveShadow = true;
  root.add(rocks);

  // ---------- комья земли и камни на краю ----------
  const clumpGeos = [];
  const nClumps = quality === 'low' ? 160 : 300;
  for (let i = 0; i < nClumps; i++) {
    const a = rng.range(0, TAU), R = grid.rim[Math.round(a / TAU * SEG) % SEG];
    const dd = Math.pow(rng.float(), 1.8) * 4.2 + 0.25;
    const big = dd > 2.3 && rng.chance(0.25);
    const rad = big ? rng.range(0.25, 0.5) : rng.range(0.04, 0.2) * (1.2 - dd / 6);
    const x = Math.cos(a) * (R + dd), z = Math.sin(a) * (R + dd);
    const g = rockGeo(rad, i * 1.7);
    v.set(x, ctx.heightAt(x, z) - rad * 0.25, z);
    e.set(rng.range(-0.5, 0.5), rng.range(0, TAU), rng.range(-0.5, 0.5)); q.setFromEuler(e);
    m4.compose(v, q, sc); g.applyMatrix4(m4);
    const stone = rng.chance(0.3);
    clumpGeos.push(stone ? colorize(g, 0.42, 0.4, 0.37) : colorize(g, 0.36, 0.27, 0.19));
  }
  const clumpMat = new THREE.MeshStandardMaterial({ map: tex.dirt.map, normalMap: tex.dirt.normalMap, vertexColors: true, roughness: 0.95 });
  const clumps = new THREE.Mesh(mergeGeometries(clumpGeos), clumpMat);
  clumps.castShadow = true; clumps.receiveShadow = true;
  root.add(clumps);

  // ---------- дно: тлеющая магма ----------
  const bottom = wallPoint(0, PIT_DEPTH);
  const floorGeo = new THREE.CircleGeometry(bottom.R + 2, 64).rotateX(-Math.PI / 2);
  floorGeo.translate(0, -PIT_DEPTH + 0.2, 0);
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uTime: pitUniforms.uTime, uPitGlow: pitUniforms.uPitGlow, tNoise: { value: tex.cloud } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uPitGlow; uniform sampler2D tNoise; varying vec3 vW;
      void main(){
        vec2 p = vW.xz;
        float n1 = texture2D(tNoise, p * 0.045 + vec2(uTime * 0.006, 0.0)).r;
        float n2 = texture2D(tNoise, p * 0.12 - vec2(0.0, uTime * 0.011)).g;
        float veins = smoothstep(0.5, 0.72, n1 * 0.6 + n2 * 0.5);
        vec3 col = vec3(0.5, 0.06, 0.012) + vec3(3.2, 0.95, 0.18) * veins;
        gl_FragColor = vec4(col * uPitGlow * 0.6, 1.0);
      }`,
  });
  root.add(new THREE.Mesh(floorGeo, floorMat));

  // ---------- слои «объёмного» свечения ----------
  const layerGeos = [];
  const LAYER_D = quality === 'low' ? [9, 17, 25, 32] : [6, 10, 14, 18, 22, 26, 30, 34];
  for (const dep of LAYER_D) {
    const n = 96, P = [0, -dep, 0], A = [0, 0], I = [];
    for (let s = 0; s <= n; s++) {
      const a = s / n * TAU, w = wallPoint(a, dep), rr = w.r - 0.4;
      P.push(Math.cos(a) * rr, w.y, Math.sin(a) * rr); A.push(1, dep / PIT_DEPTH);
      if (s < n) I.push(0, s + 2, s + 1);
    }
    A[1] = dep / PIT_DEPTH;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aL', new THREE.Float32BufferAttribute(A, 2));
    g.setIndex(I);
    layerGeos.push(g);
  }
  const layerMat = new THREE.ShaderMaterial({
    uniforms: { uTime: pitUniforms.uTime, uPitGlow: pitUniforms.uPitGlow, tNoise: { value: tex.cloud } },
    vertexShader: `attribute vec2 aL; varying vec2 vL; varying vec3 vW;
      void main(){ vL = aL; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uPitGlow; uniform sampler2D tNoise; varying vec2 vL; varying vec3 vW;
      void main(){
        float r = vL.x, d = vL.y;
        float n = texture2D(tNoise, vW.xz * 0.05 + vec2(uTime * 0.012 * (1.0 + d), uTime * 0.008 + d * 3.0)).r;
        float a = (1.0 - r * r) * (0.35 + 0.9 * n);
        vec3 V = normalize(vW - cameraPosition);
        a *= smoothstep(0.08, 0.7, abs(V.y));
        vec3 col = mix(vec3(0.8, 0.14, 0.03), vec3(1.6, 0.5, 0.1), d) * (0.03 + 0.2 * d * d) * uPitGlow;
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const layers = new THREE.Mesh(mergeGeometries(layerGeos), layerMat);
  layers.renderOrder = 2;
  root.add(layers);

  // ---------- столб красной дымки над ямой ----------
  {
    const n = 128, rows = 8, P = [], A = [], I = [];
    for (let k = 0; k <= rows; k++) {
      const h = k / rows, y = -4 + h * 14;
      for (let s = 0; s <= n; s++) {
        const a = s / n * TAU, R = grid.rim[Math.round(s / n * SEG) % SEG] - 0.25 + h * 1.5;
        P.push(Math.cos(a) * R, y, Math.sin(a) * R); A.push(s / n, h);
      }
    }
    for (let k = 0; k < rows; k++) for (let s = 0; s < n; s++) { const a = k * (n + 1) + s, b = a + n + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(A, 2));
    g.setIndex(I); g.computeVertexNormals();
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: pitUniforms.uTime, uPitGlow: pitUniforms.uPitGlow, tNoise: { value: tex.cloud } },
      vertexShader: `attribute vec2 aH; varying vec2 vH; varying vec3 vW; varying vec3 vN;
        void main(){ vH = aH; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime, uPitGlow; uniform sampler2D tNoise; varying vec2 vH; varying vec3 vW; varying vec3 vN;
        void main(){
          float h = vH.y;
          vec3 V = normalize(cameraPosition - vW);
          float fr = 1.0 - abs(dot(V, normalize(vN)));
          float n = texture2D(tNoise, vec2(vH.x * 4.0 + uTime * 0.004, h * 0.9 - uTime * 0.035)).r;
          float n2 = texture2D(tNoise, vec2(vH.x * 9.0 - uTime * 0.006, h * 1.7 - uTime * 0.06)).g;
          float a = pow(1.0 - h, 2.4) * smoothstep(0.0, 0.08, h) * (0.25 + 0.9 * n * n2) * (0.35 + 0.65 * fr);
          vec3 col = vec3(1.0, 0.24, 0.06) * a * 0.11 * uPitGlow;
          gl_FragColor = vec4(col, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const col = new THREE.Mesh(g, m); col.renderOrder = 3;
    root.add(col);
  }

  // ---------- угли, поднимающиеся из ямы ----------
  const emberMax = 700;
  const eg = new THREE.BufferGeometry();
  const seeds = new Float32Array(emberMax * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.float();
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(emberMax * 3), 3));
  eg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const emberMat = new THREE.ShaderMaterial({
    uniforms: { uTime: pitUniforms.uTime, uScale: ctx.pointScale, uPitGlow: pitUniforms.uPitGlow },
    vertexShader: `attribute vec4 aSeed; uniform float uTime, uScale; varying float vA; varying float vHeat;
      void main(){
        float life = mix(8.0, 16.0, aSeed.x);
        float t = fract(uTime / life + aSeed.y);
        float y = -33.0 + t * 45.0;
        float ang = aSeed.z * 6.2832 + uTime * (0.12 + aSeed.w * 0.3) + t * 3.5;
        float rad = (0.12 + 0.88 * sqrt(aSeed.w)) * mix(4.0, 9.5, smoothstep(-33.0, -3.0, y));
        vec3 p = vec3(cos(ang) * rad, y, sin(ang) * rad);
        float up = max(y, 0.0);
        p.xz += vec2(0.55, 0.22) * up * up * 0.12;
        p.x += sin(uTime * 1.3 + aSeed.x * 40.0) * 0.3;
        p.z += cos(uTime * 1.1 + aSeed.w * 30.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float fl = 0.55 + 0.45 * sin(uTime * (5.0 + aSeed.y * 9.0) + aSeed.z * 30.0);
        vA = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.62, 0.95, t)) * fl;
        vHeat = 1.0 - t;
        gl_PointSize = max(1.5, uScale * mix(0.05, 0.12, aSeed.x) / -mv.z);
      }`,
    fragmentShader: `uniform float uPitGlow; varying float vA; varying float vHeat;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        vec3 col = mix(vec3(2.2, 0.38, 0.06), vec3(5.0, 1.9, 0.5), vHeat * vHeat);
        gl_FragColor = vec4(col * a * vA * (0.6 + 0.4 * uPitGlow), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const embers = new THREE.Points(eg, emberMat);
  embers.frustumCulled = false; embers.renderOrder = 4;
  root.add(embers);
  parts.embers = embers; parts.emberMax = emberMax;

  // ---------- дым из ямы ----------
  const smokeMax = 22;
  const sg = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1);
  sg.index = plane.index; sg.setAttribute('position', plane.attributes.position); sg.setAttribute('uv', plane.attributes.uv);
  const ss = new Float32Array(smokeMax * 4);
  for (let i = 0; i < ss.length; i++) ss[i] = rng.float();
  sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ss, 4));
  sg.instanceCount = smokeMax;
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: pitUniforms.uTime, uPitGlow: pitUniforms.uPitGlow, tSmoke: { value: tex.smoke } },
    vertexShader: `attribute vec4 aSeed; uniform float uTime; varying vec2 vUv; varying float vA; varying float vD;
      void main(){
        float life = mix(28.0, 44.0, aSeed.x);
        float t = fract(uTime / life + aSeed.y);
        float y = mix(-28.0, 9.0, t);
        float ang = aSeed.z * 6.2832 + t * 1.5;
        vec3 c = vec3(cos(ang), 0.0, sin(ang)) * aSeed.w * 4.5 + vec3(0.0, y, 0.0);
        c.xz += vec2(0.5, 0.2) * max(y, 0.0) * 0.5;
        float size = mix(6.0, 15.0, t);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float rot = aSeed.x * 6.28 + uTime * 0.04 * (aSeed.w - 0.5);
        vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
        vec3 wp = c + (right * q.x + up * q.y) * size;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        vUv = uv; vA = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.7, 1.0, t)); vD = -y;
      }`,
    fragmentShader: `uniform float uPitGlow; uniform sampler2D tSmoke; varying vec2 vUv; varying float vA; varying float vD;
      void main(){
        float a = texture2D(tSmoke, vUv).a * vA * 0.2;
        vec3 col = mix(vec3(0.018, 0.02, 0.025), vec3(0.24, 0.05, 0.014) * uPitGlow, smoothstep(-1.0, 16.0, vD));
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false,
  });
  const smoke = new THREE.Mesh(sg, smokeMat);
  smoke.frustumCulled = false; smoke.renderOrder = 5;
  root.add(smoke);
  parts.smoke = smoke; parts.smokeMax = smokeMax;

  // ---------- свет со дна ----------
  const glowLight = new THREE.PointLight(0xff4a1c, 900, 0, 1.75);
  glowLight.position.set(0, -14, 0);
  glowLight.castShadow = false;
  root.add(glowLight);
  parts.glowLight = glowLight;

  return parts;
}
