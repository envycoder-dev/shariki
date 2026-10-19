// Небо: купол с градиентом, звёздами, облаками и луной; линия леса, радиовышка, ЛЭП.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, makeNoise2D, fbm2 } from '../core/noise.js';

// Видимая луна ниже реального направления света — чтобы попадать в кадр со старта
export const MOON_VIS_DIR = new THREE.Vector3(-0.36, 0.43, -0.83).normalize();

export function buildSky(ctx) {
  const { tex, fogColor, pitUniforms } = ctx;
  const uniforms = {
    uTime: { value: 0 }, uMoonDir: { value: MOON_VIS_DIR.clone() }, uFogColor: { value: fogColor.clone() },
    uCam: { value: new THREE.Vector3() }, tCloud: { value: tex.cloud }, uPitGlow: pitUniforms.uPitGlow,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
uniform float uTime, uPitGlow; uniform vec3 uMoonDir, uFogColor, uCam; uniform sampler2D tCloud;
varying vec3 vDir;
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y, hp = max(h, 0.0);
  vec3 zen = vec3(0.0024, 0.0034, 0.0072);
  vec3 hor = vec3(0.030, 0.036, 0.050);
  vec3 col = mix(hor, zen, pow(hp, 0.4));
  vec2 dh = normalize(d.xz + 1e-5);
  col += vec3(0.05, 0.027, 0.011) * pow(max(dot(dh, normalize(vec2(0.85, -0.5))), 0.0), 5.0) * exp(-hp * 14.0);
  float md = dot(d, uMoonDir), mk = max(md, 0.0);
  float mAng = acos(clamp(md, -1.0, 1.0));
  const float MR = 0.03;
  vec3 moonCol = vec3(0.78, 0.85, 1.0);
  // звёзды
  vec3 sp = d * 250.0, cell = floor(sp);
  float hs = hash13(cell), star = 0.0;
  if (hs > 0.982) {
    vec3 off = vec3(hash13(cell + 1.7), hash13(cell + 5.3), hash13(cell + 9.1)) * 0.6 + 0.2;
    float dist = length(fract(sp) - off);
    float tw = 0.55 + 0.45 * sin(uTime * (1.3 + hs * 25.0) + hs * 517.0);
    star = smoothstep(0.1, 0.0, dist) * (0.15 + 1.6 * pow((hs - 0.982) / 0.018, 4.0)) * tw;
  }
  star *= smoothstep(0.03, 0.3, h);
  // облака: проекция на плоскость
  vec2 cuv = d.xz / (h + 0.1);
  vec2 wind = vec2(uTime * 0.0021, uTime * 0.0008);
  float c1 = texture2D(tCloud, cuv * 0.1 + wind).r;
  float c2 = texture2D(tCloud, cuv * 0.31 + wind * 2.2 + 0.3).g;
  float cn = c1 * 0.8 + c2 * 0.42 - 0.12;
  float dens = smoothstep(0.3, 0.56, cn);
  dens *= 1.0 - 0.6 * exp(-mAng * mAng / 0.012); // разрыв в облаках у луны
  float silver = pow(mk, 80.0) * 2.4 + pow(mk, 14.0) * 0.22 + pow(mk, 3.0) * 0.03;
  vec3 cloudCol = vec3(0.011, 0.013, 0.019) * (0.6 + 0.8 * c2) + moonCol * silver * (1.0 - 0.7 * smoothstep(0.5, 1.0, dens));
  float tc = (200.0 - uCam.y) / max(h, 0.03);
  vec2 cp = uCam.xz + d.xz * tc;
  cloudCol += vec3(0.075, 0.012, 0.003) * exp(-dot(cp, cp) / (170.0 * 170.0)) * uPitGlow;
  // диск луны
  vec3 moon = vec3(0.0);
  if (mAng < MR * 1.1) {
    vec3 tx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 ty = cross(tx, uMoonDir);
    vec2 q = vec2(dot(d, tx), dot(d, ty)) / MR;
    float rr = length(q);
    float disc = smoothstep(1.0, 0.96, rr);
    float maria = texture2D(tCloud, q * 0.2 + vec2(0.31, 0.57)).b;
    float limb = sqrt(max(0.0, 1.0 - rr * rr));
    moon = moonCol * disc * (0.55 + 0.45 * limb) * mix(0.55, 1.0, maria) * 10.0;
  }
  float halo = pow(mk, 900.0) * 1.5 + pow(mk, 120.0) * 0.3 + pow(mk, 18.0) * 0.05;
  vec3 sky = col + star * vec3(0.82, 0.88, 1.0) + moonCol * halo + moon;
  float cover = dens * (1.0 - 0.75 * smoothstep(0.14, 0.0, h));
  vec3 outc = mix(sky, cloudCol + moonCol * halo * 0.4 + col * 0.35, cover);
  outc = mix(uFogColor, outc, smoothstep(-0.04, 0.025, h));
  gl_FragColor = vec4(outc, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 64, 32), mat);
  dome.renderOrder = -100; dome.frustumCulled = false; dome.name = 'sky';
  return { dome, uniforms };
}

// Силуэты леса, радиовышка и ЛЭП на горизонте
export function buildHorizon(ctx) {
  const { heightAt, root, tex } = ctx;
  const rng = new RNG(808), n = makeNoise2D(809);
  const group = new THREE.Group(); group.name = 'horizon';
  root.add(group);
  const out = { blinkers: [] };

  // ель: ствол + ярусы конусов, высота 1
  const fir = mergeGeometries([
    new THREE.CylinderGeometry(0.012, 0.02, 0.25, 5).translate(0, 0.125, 0),
    ...[0, 1, 2, 3, 4].map((i) => new THREE.ConeGeometry(0.2 - i * 0.032, 0.32, 7, 1, true).translate(0, 0.22 + i * 0.16, 0)),
  ].map((g) => g.toNonIndexed()));
  const blob = mergeGeometries([
    new THREE.CylinderGeometry(0.02, 0.035, 0.45, 5).translate(0, 0.22, 0),
    new THREE.IcosahedronGeometry(0.28, 1).translate(0, 0.62, 0),
    new THREE.IcosahedronGeometry(0.22, 1).translate(0.18, 0.5, 0.05),
    new THREE.IcosahedronGeometry(0.2, 1).translate(-0.16, 0.52, -0.06),
  ].map((g) => { g.deleteAttribute('uv'); return g.toNonIndexed(); }));
  fir.deleteAttribute('uv');
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x0d1013 });
  const firs = [], blobs = [];
  const avoid = [[-48, -58, 30], [55, -64, 30]]; // ферма
  for (let i = 0; i < 2600 && firs.length + blobs.length < 620; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(92, 265);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const forest = fbm2(n, x / 70, z / 70, 3);
    if (forest < -0.05 + (r < 130 ? 0.25 : 0)) continue;
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    const s = rng.range(0.8, 1.25) * (forest > 0.3 ? 1.2 : 1);
    (rng.chance(0.68) ? firs : blobs).push([x, heightAt(x, z) - 0.5, z, s, rng.range(0, 6.28)]);
  }
  const inst = (geo, list, h) => {
    const m = new THREE.InstancedMesh(geo, treeMat, list.length);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    list.forEach(([x, y, z, s, rot], i) => {
      const hh = h * s * rng.range(0.75, 1.25);
      m.setMatrixAt(i, mt.compose(p.set(x, y, z), q.setFromAxisAngle(up, rot), sc.set(hh * rng.range(0.8, 1.1), hh, hh * rng.range(0.8, 1.1))));
    });
    m.computeBoundingSphere();
    group.add(m);
    return m;
  };
  inst(fir, firs, 15); inst(blob, blobs, 13);

  // радиовышка с мигающими огнями
  {
    const bx = 175, bz = -285, by = heightAt(bx, bz) - 1, H = 72;
    const v = [];
    const leg = (i, t) => { const a = i / 3 * Math.PI * 2, w = 3.2 * (1 - t) + 0.4 * t; return [bx + Math.cos(a) * w, by + t * H, bz + Math.sin(a) * w]; };
    for (let s = 0; s < 18; s++) {
      const t0 = s / 18, t1 = (s + 1) / 18;
      for (let i = 0; i < 3; i++) {
        const a0 = leg(i, t0), a1 = leg(i, t1), b0 = leg((i + 1) % 3, t0), b1 = leg((i + 1) % 3, t1);
        v.push(...a0, ...a1, ...a0, ...b1, ...a1, ...b1);
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x07090c })));
    for (const t of [0.35, 0.68, 1.0]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(9, 0.6, 0.35), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp.position.set(bx, by + t * H + 0.5, bz); sp.scale.setScalar(6);
      group.add(sp); out.blinkers.push(sp);
    }
  }

  // ЛЭП за ямой: деревянные опоры и провисающие провода
  {
    const poleGeos = [], wires = [];
    const tops = [];
    for (let x = -210; x <= 210; x += 42) {
      const z = -74 + x * 0.12 + n(x * 0.01, 3) * 4, y = heightAt(x, z);
      const tilt = rng.range(-0.04, 0.04);
      const pole = new THREE.CylinderGeometry(0.11, 0.15, 9, 6).translate(0, 4.5, 0);
      const arm = new THREE.BoxGeometry(2.4, 0.12, 0.12).translate(0, 8.4, 0);
      const g = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()]);
      g.rotateZ(tilt); g.rotateY(-0.12); g.translate(x, y, z);
      poleGeos.push(g);
      const c = Math.cos(-0.12), s = Math.sin(-0.12);
      tops.push([-1.1, 0, 1.1].map((o) => [x + o * c, y + 8.55, z - o * s]));
    }
    for (let i = 0; i < tops.length - 1; i++) for (let k = 0; k < 3; k++) {
      const [ax, ay, az] = tops[i][k], [bx, by, bz] = tops[i + 1][k];
      for (let s = 0; s < 12; s++) {
        const t0 = s / 12, t1 = (s + 1) / 12;
        const sag = (t) => 4 * t * (1 - t) * 1.6;
        wires.push(ax + (bx - ax) * t0, ay + (by - ay) * t0 - sag(t0), az + (bz - az) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1 - sag(t1), az + (bz - az) * t1);
      }
    }
    const pm = new THREE.Mesh(mergeGeometries(poleGeos), new THREE.MeshStandardMaterial({ map: tex.bark.map, color: 0x5a4c40, roughness: 0.9 }));
    group.add(pm);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x050607 })));
  }
  return out;
}
