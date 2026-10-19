// Атмосфера: пыль/пепел вокруг камеры и низкие пласты тумана.
import * as THREE from 'three';
import { RNG } from '../core/noise.js';
import { SPLAT_SIZE } from './terrain.js';

export const atmoUniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uCamDir: { value: new THREE.Vector3(0, 0, -1) } };

export function buildDust(ctx) {
  const { maxCount, pointScale } = ctx;
  const rng = new RNG(7070);
  const g = new THREE.BufferGeometry();
  const seeds = new Float32Array(maxCount * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.float();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmoUniforms, uScale: pointScale },
    vertexShader: `attribute vec4 aSeed; uniform float uTime, uScale; uniform vec3 uCam, uCamDir; varying float vA; varying float vAsh;
      void main(){
        vec3 box = vec3(26.0, 9.0, 26.0);
        vec3 p = aSeed.xyz * box + vec3(0.32, 0.03, 0.12) * uTime;
        p += vec3(sin(uTime * 0.31 + aSeed.w * 20.0), sin(uTime * 0.43 + aSeed.x * 11.0) * 0.4, cos(uTime * 0.27 + aSeed.y * 15.0)) * 0.7;
        vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
        vec3 wp = uCam + rel;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = length(rel);
        float beam = smoothstep(0.9, 0.985, dot(rel / max(dist, 1e-3), uCamDir)) * (1.0 - smoothstep(3.0, 14.0, dist));
        vA = (0.07 + 1.6 * beam) * (1.0 - smoothstep(7.0, 12.5, dist)) * smoothstep(0.25, 1.0, dist);
        vAsh = step(0.82, aSeed.w);
        gl_PointSize = max(1.0, uScale * mix(0.006, 0.016, aSeed.w) * (1.0 + vAsh) / -mv.z);
      }`,
    fragmentShader: `varying float vA; varying float vAsh;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vA;
        vec3 c = mix(vec3(0.5, 0.53, 0.6), vec3(0.32, 0.3, 0.3), vAsh);
        gl_FragColor = vec4(c * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 6;
  return pts;
}

// Пласты низкого тумана: следуют рельефу (карта высот), гуще у ямы, не закрывают провал
export function buildGroundFog(ctx) {
  const { tex, rimTex, layers } = ctx;
  const meshes = [];
  const geo = new THREE.PlaneGeometry(SPLAT_SIZE - 4, SPLAT_SIZE - 4, 96, 96).rotateX(-Math.PI / 2);
  const heights = [0.3, 0.85, 1.55];
  for (let L = 0; L < layers; L++) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x9aa6ba, transparent: true, depthWrite: false, opacity: 1 });
    const u = { tHeight: { value: tex.height }, tMacro: { value: tex.macro }, tRim: { value: rimTex }, uLayer: { value: L }, uOff: { value: heights[L] }, uSplatSize: { value: SPLAT_SIZE }, uHRes: { value: tex.height.image.width } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, { uTime: atmoUniforms.uTime, uPitGlow: ctx.pitGlow });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tHeight; uniform float uOff, uSplatSize, uHRes; varying vec3 vFW;')
        .replace('#include <begin_vertex>', `vec3 transformed = position;
vec2 huv = (position.xz / uSplatSize + 0.5) * ((uHRes - 1.0) / uHRes) + 0.5 / uHRes;
transformed.y = max(texture2D(tHeight, huv).r, -0.6) + uOff;
vFW = transformed;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tMacro, tRim; uniform float uTime, uLayer, uPitGlow; varying vec3 vFW;`)
        .replace('#include <alphamap_fragment>', `
vec2 fp = vFW.xz;
float n1 = texture2D(tMacro, fp * 0.021 + uTime * vec2(0.0045, 0.0018) + uLayer * 0.37).r;
float n2 = texture2D(tMacro, fp * 0.06 - uTime * vec2(0.003, 0.0065) + uLayer * 0.21).g;
float rr = length(fp);
float R = texture2D(tRim, vec2(atan(fp.y, fp.x) / 6.2831853 + 0.5, 0.5)).r * 16.0;
float rimD = rr - R;
float dens = smoothstep(0.42, 0.78, n1 * 0.72 + n2 * 0.45) * 0.55;
dens += (1.0 - smoothstep(0.5, 9.0, rimD)) * 0.55 * (0.4 + 0.8 * n2);
dens *= smoothstep(-0.6, 1.2, rimD);
dens *= 1.0 - smoothstep(44.0, 60.0, max(abs(fp.x), abs(fp.y)));
dens *= smoothstep(1.0, 7.0, length(vFW - cameraPosition));
dens *= (1.0 - uLayer * 0.3);
diffuseColor.a *= clamp(dens, 0.0, 1.0) * 0.17;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.5, 0.08, 0.02) * exp(-max(rimD, 0.0) / 3.5) * uPitGlow * 0.35;`);
    };
    mat.customProgramCacheKey = () => 'yama-gfog';
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 7 + L; m.frustumCulled = false; m.name = 'groundFog' + L;
    meshes.push(m);
  }
  return meshes;
}

// 1D-текстура радиуса кромки (для шейдеров): R = radius / 16
export function rimTexture(radiusAt) {
  const n = 512, d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * Math.PI * 2 - Math.PI;
    d[i * 4] = Math.round(radiusAt(a) / 16 * 255); d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
