// Материал зомби: MeshStandardMaterial + процедурная кожа/одежда/кровь по маскам вершин.
// Текстурные координаты не нужны: шум берётся из bind-позиции вершины, поэтому «прилипает» к телу.
import * as THREE from 'three';

export const sharedTime = { value: 0 };

const NOISE_GLSL = /* glsl */`
varying vec4 vMask; varying vec4 vMask2; varying vec3 vRest;
uniform vec3 uSkin, uSkin2, uShirt, uShirt2, uPants, uShoes, uHair, uBlood, uGlow;
uniform float uPattern, uRot, uBloodAmt, uSeed, uDamage, uHeight, uBump, uTime;
float zhash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float znoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(zhash(i), zhash(i + vec3(1,0,0)), f.x), mix(zhash(i + vec3(0,1,0)), zhash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(zhash(i + vec3(0,0,1)), zhash(i + vec3(1,0,1)), f.x), mix(zhash(i + vec3(0,1,1)), zhash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float zfbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * znoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s / 0.9375; }
`;

export function makeZombieMaterial(colors) {
  const u = {
    uSkin: { value: new THREE.Color() }, uSkin2: { value: new THREE.Color() },
    uShirt: { value: new THREE.Color() }, uShirt2: { value: new THREE.Color() },
    uPants: { value: new THREE.Color() }, uShoes: { value: new THREE.Color() },
    uHair: { value: new THREE.Color() }, uBlood: { value: new THREE.Color(0x3a0503) },
    uGlow: { value: new THREE.Color(0x000000) },
    uPattern: { value: 0 }, uRot: { value: 0.5 }, uBloodAmt: { value: 0.5 }, uSeed: { value: 0 },
    uDamage: { value: 0 }, uHeight: { value: 1.8 }, uBump: { value: 1 }, uTime: sharedTime,
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMask; attribute vec4 aMask2; attribute vec3 aRest;\nvarying vec4 vMask; varying vec4 vMask2; varying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = aMask; vMask2 = aMask2; vRest = aRest;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', /* glsl */`
        vec3 P = vRest * 6.0 + vec3(uSeed);
        float nA = zfbm(P);
        float nB = znoise(P * 3.0);
        float nC = znoise(P * 2.3 + 11.0);
        float clothM = clamp(vMask.x + vMask.y + vMask.z, 0.0, 1.0);
        vec3 skin = mix(uSkin, uSkin2, smoothstep(0.3, 0.75, nA));
        float vn = abs(znoise(P * 3.1 + 5.0) * 2.0 - 1.0);
        skin = mix(skin, skin * vec3(0.5, 0.56, 0.72), (1.0 - smoothstep(0.0, 0.035, vn)) * 0.45 * smoothstep(0.4, 0.7, nC));
        skin = mix(skin, vec3(0.11, 0.1, 0.05), smoothstep(0.6, 0.86, nC) * uRot);
        skin *= 0.82 + 0.32 * nB;
        vec3 shirt = uShirt;
        if (uPattern > 0.5 && uPattern < 1.5) {
          float a = step(0.5, fract(vRest.x * 13.0)), b = step(0.5, fract(vRest.y * 13.0));
          float thin = step(0.85, fract(vRest.x * 26.0 + 0.3)) + step(0.85, fract(vRest.y * 26.0 + 0.3));
          shirt = mix(uShirt, uShirt2, (a + b) * 0.5) * (1.0 - 0.25 * clamp(thin, 0.0, 1.0));
        } else if (uPattern > 1.5) {
          shirt = mix(uShirt, uShirt2, step(0.55, fract(vRest.y * 24.0)));
        }
        shirt *= (0.72 + 0.42 * nA) * (0.9 + 0.2 * nB);
        vec3 pants = uPants * (0.72 + 0.42 * nA) * (0.88 + 0.24 * nB);
        vec3 col = skin;
        col = mix(col, shirt, vMask.x);
        col = mix(col, pants, vMask.y);
        col = mix(col, uShoes * (0.75 + 0.35 * nB), vMask.z);
        col = mix(col, uHair * (0.55 + 0.7 * znoise(P * 22.0)), vMask2.x);
        float hN = vRest.y / uHeight;
        col *= mix(0.5, 1.0, smoothstep(0.0, 0.32, hN));
        float splat = smoothstep(0.6, 0.74, zfbm(P * 1.7 + 3.0)) * uBloodAmt;
        float drip = smoothstep(0.72, 0.9, hN) * smoothstep(0.55, 0.7, znoise(vec3(vRest.x * 30.0, vRest.y * 3.0, vRest.z * 30.0) + uSeed)) * uBloodAmt;
        float blood = clamp(max(max(vMask.w, splat), drip) + uDamage * smoothstep(0.45, 0.62, nC), 0.0, 1.0);
        col = mix(col, uBlood * (0.5 + 0.7 * nB), blood);
        col = mix(col, vec3(0.16, 0.012, 0.01), smoothstep(0.65, 1.0, vMask.w) * 0.8);
        float stripes = smoothstep(0.3, 0.55, abs(fract(vRest.y * 38.0) - 0.5) * 2.0);
        col = mix(col, mix(vec3(0.2, 0.02, 0.015), vec3(0.62, 0.56, 0.45), stripes), vMask2.z);
        col = mix(col, uGlow * 0.4 + vec3(0.25, 0.28, 0.08), vMask2.w * 0.8);
        col *= 1.0 - 0.92 * vMask2.y;
        diffuseColor.rgb = col;
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = mix(0.6, 0.93, clothM);
        roughnessFactor = mix(roughnessFactor, 0.26, blood);
        roughnessFactor = mix(roughnessFactor, 0.3, vMask2.w);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        {
          float bh = (znoise(P * 2.2) * 0.65 + znoise(P * 6.0) * 0.35) * (1.0 - clothM)
                   + clothM * znoise(P * 9.0) * 0.35 + vMask2.z * stripes * 0.6 + vMask.w * nB * 0.4;
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          float dhx = dFdx(bh), dhy = dFdy(bh);
          vec3 R1 = cross(dpdy, normal), R2 = cross(normal, dpdx);
          float det = dot(dpdx, R1);
          // гасим рельеф, когда он меняется быстрее пикселя (иначе — шум)
          float aa = 1.0 / (1.0 + 60.0 * (abs(dhx) + abs(dhy)));
          vec3 grad = sign(det) * (dhx * R1 + dhy * R2) * aa;
          normal = normalize(abs(det) * normal - grad * 0.02 * uBump);
        }
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * vMask2.w * (0.75 + 0.25 * sin(uTime * 3.0 + vRest.x * 40.0 + vRest.y * 23.0));
      `);
  };
  mat.customProgramCacheKey = () => 'zombie-v1';
  if (colors) setZombieColors(mat, colors);
  return mat;
}

export function setZombieColors(mat, c) {
  const u = mat.userData.u;
  u.uSkin.value.set(c.skin); u.uSkin2.value.set(c.skin2);
  u.uShirt.value.set(c.shirt); u.uShirt2.value.set(c.shirt2 ?? c.shirt);
  u.uPants.value.set(c.pants); u.uShoes.value.set(c.shoes); u.uHair.value.set(c.hair);
  u.uGlow.value.set(c.glow ?? 0x000000);
  u.uPattern.value = c.pattern ?? 0; u.uRot.value = c.rot ?? 0.5; u.uBloodAmt.value = c.blood ?? 0.5;
  u.uSeed.value = c.seed ?? 0; u.uHeight.value = c.height ?? 1.8; u.uDamage.value = 0;
}

// глаза: эмиссия > 1, чтобы светились через bloom
const eyeMats = new Map();
export function eyeMaterial(color) {
  if (!eyeMats.has(color)) {
    eyeMats.set(color, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 4.5, roughness: 0.2 }));
  }
  return eyeMats.get(color);
}
export const teethMaterial = new THREE.MeshStandardMaterial({ color: 0x8d8165, roughness: 0.45 });
export const stumpMaterial = new THREE.MeshStandardMaterial({ color: 0x4a0806, roughness: 0.3, metalness: 0.0 });
export const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xb8ab90, roughness: 0.5 });
export const woundMaterial = new THREE.MeshStandardMaterial({
  color: 0x2a0302, roughness: 0.22, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
