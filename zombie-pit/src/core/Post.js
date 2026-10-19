// Пост-обработка: мир → вьюмодель (поверх, с очисткой глубины) → bloom → грейдинг/виньетка/зерно → тонмаппинг.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uLow: { value: 0 },
    uFlash: { value: 0 }, uAcid: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uGrain: { value: 0.04 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uDamage, uLow, uFlash, uAcid, uGrain; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float r2 = dot(c, c);
      float ca = 0.0012 + 0.005 * uDamage;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca * 2.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca * 2.0).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col * vec3(0.93, 0.98, 1.07), col * vec3(1.05, 1.0, 0.93), smoothstep(0.04, 0.5, l));
      col = mix(col, vec3(l) * vec3(1.15, 0.72, 0.68), uLow * 0.6);
      col = mix(col, col * vec3(0.75, 1.12, 0.62), uAcid * 0.55);
      col *= 1.0 - smoothstep(0.16, 0.72, r2) * 0.5;
      col += vec3(1.0, 0.85, 0.7) * uFlash;
      float g = hash(uv * uRes + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * uGrain * (0.25 + l * 0.8);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, viewScene, viewCamera, quality) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.main = new RenderPass(scene, camera);
    this.composer.addPass(this.main);
    if (viewScene) {
      this.view = new RenderPass(viewScene, viewCamera);
      this.view.clear = false; this.view.clearDepth = true;
      this.composer.addPass(this.view);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.u = this.grade.uniforms;
    this.setQuality(quality);
  }

  setQuality(q) { this.bloom.enabled = q !== 'low'; }
  setSize(w, h) {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.u.uRes.value.set(w * pr, h * pr);
  }
  render(dt) { this.u.uTime.value += dt; this.composer.render(dt); }
}
