// Мир «ЯМА»: рельеф, яма, небо, реквизит, трава, атмосфера, свет. Контракт — ARCHITECTURE.md.
import * as THREE from 'three';
import { damp } from '../core/noise.js';
import { PolarGrid, radiusAt, PIT_DEPTH } from './shape.js';
import * as TX from './textures.js';
import { paintSplat, heightTexture, terrainGeometry, terrainMaterial } from './terrain.js';
import { buildPit, pitUniforms } from './pit.js';
import { buildSky, buildHorizon } from './sky.js';
import { buildProps, buildFires } from './props.js';
import { buildGrass, buildWeeds, grassUniforms } from './grass.js';
import { buildDust, buildGroundFog, rimTexture, atmoUniforms } from './particles.js';

const QUALITY = {
  low: { shadow: 0, grass: 0.3, weeds: 0.35, particles: 0.4, fogLayers: 1 },
  medium: { shadow: 1024, grass: 0.6, weeds: 0.7, particles: 0.7, fogLayers: 2 },
  high: { shadow: 2048, grass: 1, weeds: 1, particles: 1, fogLayers: 3 },
};
const GRASS_MAX = 90000, WEED_MAX = 1500, DUST_MAX = 1400;
const FOG_COLOR = 0x0b0f16;

export class World {
  constructor({ renderer, scene, quality = 'high' }) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = QUALITY[quality] ? quality : 'high';
    this.grid = new PolarGrid();
    this.root = new THREE.Group();
    this.root.name = 'world';
    this.pit = { center: new THREE.Vector3(0, 0, 0), radiusAt, depth: PIT_DEPTH, glowLight: null };
    this.bounds = { radius: 46 };
    this.colliders = [];
    this.raycastMeshes = [];
    this.supplyCrate = new THREE.Vector3(3.5, 0, 25);
    this.moon = null;
    this.hemi = null;
    this.heightAt = this.heightAt.bind(this);
    this._time = { value: 0 };
    this._pointScale = { value: 400 };
    this._v2 = new THREE.Vector2();
    this._splatOut = [0, 0, 0];
    this._built = false;
  }

  /** Высота поверхности земли (точно по треугольникам меша); внутри ямы — высота кромки */
  heightAt(x, z) { return this.grid.heightAt(x, z); }

  /** Тип поверхности для шагов: 'grass' | 'dirt' | 'concrete' | 'wood' */
  surfaceAt(x, z) {
    const inRect = (r) => {
      const dx = x - r.x, dz = z - r.z, c = Math.cos(r.yaw), s = Math.sin(r.yaw);
      const u = dx * c - dz * s, v = dx * s + dz * c; // поворот в систему прямоугольника
      return Math.abs(u) <= r.hw && Math.abs(v) <= r.hl;
    };
    if (this._surf) {
      for (const r of this._surf.wood) if (inRect(r)) return 'wood';
      for (const r of this._surf.concrete) if (inRect(r)) return 'concrete';
    }
    if (this.grid.rimDistance(x, z) < 3.2) return 'dirt';
    if (this._splat) {
      const o = this._splat.sample(x, z, this._splatOut);
      if (o[0] > 0.5 || o[1] > 0.5) return 'dirt';
    }
    return 'grass';
  }

  async build(onProgress = () => {}) {
    const t0 = performance.now();
    const times = (this.buildStats = {});
    let tPrev = performance.now(), lastLabel = 'start';
    const step = async (p, label) => {
      const now = performance.now(); times[lastLabel] = Math.round(now - tPrev); tPrev = now; lastLabel = label;
      onProgress(p, label); await new Promise((r) => setTimeout(r, 0));
    };
    const { scene, renderer, root } = this;
    scene.add(root);

    await step(0.02, 'Текстуры');
    TX.setAnisotropy(renderer.capabilities.getMaxAnisotropy());
    const grass = TX.grassGroundTex(512), dirt = TX.dirtTex(512);
    const tx = {
      grass, dirt, groundNormals: TX.packNormals(grass.buf, 3, dirt.buf, 3.5),
      rock: TX.rockWallTex(512), bark: TX.barkTex(256), wood: TX.woodTex(512), paint: TX.paintTex(512), rust: TX.rustTex(512),
      concrete: TX.concreteTex(512), burlap: TX.burlapTex(256), straw: TX.strawTex(256), tread: TX.treadTex(256),
      macro: TX.macroTex(256), cloud: TX.cloudTex(256), glow: TX.glowTex(), smoke: TX.smokeTex(), crack: TX.crackTex(), tape: TX.tapeTex(),
    };
    const atlas = TX.atlasTex();
    this._tx = tx;

    await step(0.3, 'Небо и свет');
    const fogColor = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.02);
    scene.background = fogColor.clone();
    const hemi = new THREE.HemisphereLight(0x3b4a66, 0x17110c, 0.9);
    const moon = new THREE.DirectionalLight(0xaabfff, 1.4);
    moon.position.set(-0.4, 0.8, -0.45).normalize().multiplyScalar(90);
    moon.target.position.set(0, 0, 0);
    const sc = moon.shadow.camera;
    sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 20; sc.far = 190;
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.045;
    root.add(hemi, moon, moon.target);
    this.hemi = hemi; this.moon = moon;
    const sky = buildSky({ tex: tx, fogColor, pitUniforms });
    root.add(sky.dome);
    this.sky = sky;
    // карта окружения из неба — для металла и стекла
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.dome.material));
      this.envMap = pmrem.fromScene(envScene, 0.04, 0.1, 100).texture;
      pmrem.dispose();
    }

    await step(0.4, 'Реквизит');
    const env = this.envMap;
    const std = (p) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
    const basic = (c, extra = {}) => new THREE.MeshBasicMaterial({ color: c, ...extra });
    const mats = {
      paint: std({ map: tx.paint.map, normalMap: tx.paint.normalMap, roughness: 0.72, metalness: 0.2, envMap: env, envMapIntensity: 0.5 }),
      metal: std({ map: tx.paint.map, roughness: 0.5, metalness: 0.65, envMap: env, envMapIntensity: 0.9 }),
      rust: std({ map: tx.rust.map, normalMap: tx.rust.normalMap, roughness: 0.82, metalness: 0.3, envMap: env, envMapIntensity: 0.5 }),
      wood: std({ map: tx.wood.map, normalMap: tx.wood.normalMap, roughness: 0.88 }),
      concrete: std({ map: tx.concrete.map, normalMap: tx.concrete.normalMap, roughness: 0.93 }),
      fabric: std({ map: tx.burlap.map, normalMap: tx.burlap.normalMap, roughness: 0.96 }),
      rubber: std({ map: tx.tread.map, normalMap: tx.tread.normalMap, roughness: 0.86 }),
      straw: std({ map: tx.straw.map, normalMap: tx.straw.normalMap, roughness: 0.95 }),
      bark: std({ map: tx.bark.map, normalMap: tx.bark.normalMap, roughness: 0.92 }),
      dark: std({ roughness: 0.75 }),
      glass: std({ color: 0x0a0d10, roughness: 0.06, metalness: 0.1, envMap: env, envMapIntensity: 2.2 }),
      decal: std({ map: atlas.tex, alphaTest: 0.5, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      bag: new THREE.MeshStandardMaterial({ map: tx.burlap.map, normalMap: tx.burlap.normalMap, roughness: 0.96 }),
      leaf: new THREE.MeshStandardMaterial({ map: tx.grass.map, normalMap: tx.grass.normalMap, color: 0x67784a, roughness: 0.9 }),
      lamp: basic(new THREE.Color(14, 13.5, 12)),
      lampF: basic(new THREE.Color(14, 13.5, 12)),
      fireglow: basic(new THREE.Color(5, 1.5, 0.3)),
      amber: basic(new THREE.Color(5, 2.4, 0.3)),
      chem: basic(new THREE.Color(0.3, 6, 1.2)),
      window: basic(new THREE.Color(2.6, 2.1, 1.6), { map: atlas.tex, fog: false }),
    };
    this._mats = mats;
    const props = buildProps({ heightAt: this.heightAt, tex: tx, atlas, envMap: env, root, mats, timeU: this._time, pointScale: this._pointScale });
    this.colliders = props.colliders;
    this.raycastMeshes = props.raycast;
    this.supplyCrate.copy(props.crate);
    this._surf = props.surf;
    this._floods = props.dyn.floods;
    const fires = buildFires({ tex: tx, root, timeU: this._time, pointScale: this._pointScale }, props.dyn.fires);
    this._fireLights = fires.lights;

    await step(0.55, 'Земля');
    const splat = paintSplat(props.marks);
    this._splat = splat;
    tx.splat = splat.tex;
    const terrain = new THREE.Mesh(terrainGeometry(this.grid), terrainMaterial(tx));
    terrain.receiveShadow = true; terrain.name = 'terrain';
    root.add(terrain);
    this.terrain = terrain;
    tx.height = heightTexture(this.heightAt, 256);

    await step(0.65, 'Яма');
    const pit = buildPit({ grid: this.grid, tex: tx, quality: this.quality, root, heightAt: this.heightAt, pointScale: this._pointScale });
    this._pitParts = pit;
    this.pit.glowLight = pit.glowLight;
    this._glowBase = pit.glowLight.intensity;

    await step(0.78, 'Трава');
    const g = buildGrass({ tex: tx, maxCount: GRASS_MAX });
    root.add(g.mesh);
    this._grass = g;
    this._weeds = buildWeeds({ tex: tx, heightAt: this.heightAt, splat: splat.sample, blocked: props.blocked, maxCount: WEED_MAX });
    root.add(this._weeds);

    await step(0.88, 'Атмосфера');
    this._dust = buildDust({ maxCount: DUST_MAX, pointScale: this._pointScale });
    root.add(this._dust);
    this._fogLayers = buildGroundFog({ tex: tx, rimTex: rimTexture(radiusAt), layers: 3, pitGlow: pitUniforms.uPitGlow });
    for (const m of this._fogLayers) root.add(m);
    this._horizon = buildHorizon({ heightAt: this.heightAt, root, tex: tx });

    this.setQuality(this.quality);
    this._built = true;
    this.buildTime = performance.now() - t0;
    await step(1, 'Готово');
    return this;
  }

  update(dt, time, camera) {
    if (!this._built) return;
    const cam = camera.position;
    this._time.value = time;
    this.sky.dome.position.copy(cam);
    this.sky.uniforms.uTime.value = time;
    this.sky.uniforms.uCam.value.copy(cam);
    // пульсация свечения ямы
    const pulse = 1 + 0.16 * Math.sin(time * 1.25) + 0.07 * Math.sin(time * 3.1 + 1.3) + 0.05 * Math.sin(time * 0.41 + 0.5);
    pitUniforms.uPitGlow.value = pulse;
    pitUniforms.uTime.value = time;
    this.pit.glowLight.intensity = this._glowBase * pulse;
    grassUniforms.uTime.value = time;
    grassUniforms.uCam.value.copy(cam);
    atmoUniforms.uTime.value = time;
    atmoUniforms.uCam.value.copy(cam);
    camera.getWorldDirection(atmoUniforms.uCamDir.value);
    // огонь
    for (let i = 0; i < this._fireLights.length; i++) {
      const f = this._fireLights[i], s = f.seed;
      const n = Math.sin(time * 9.1 + s) * 0.5 + Math.sin(time * 23.7 + s * 2) * 0.3 + Math.sin(time * 4.3 + s * 3) * 0.4;
      f.light.intensity = f.base * (0.82 + 0.13 * n);
    }
    const fl = 0.85 + 0.1 * Math.sin(time * 11.3) + 0.06 * Math.sin(time * 27.1);
    this._mats.fireglow.color.setRGB(5 * fl, 1.5 * fl, 0.3 * fl);
    const amb = Math.sin(time * 4.2) > 0.3 ? 1 : 0.06;
    this._mats.amber.color.setRGB(5 * amb, 2.4 * amb, 0.3 * amb);
    // мигающий прожектор
    for (let i = 0; i < this._floods.length; i++) {
      const F = this._floods[i];
      if (!F.flick) continue;
      F.timer -= dt;
      if (F.timer <= 0) { F.state = F.state ? 0 : 1; F.timer = F.state ? 0.5 + Math.random() * 1.4 : 2.5 + Math.random() * 6; }
      const target = F.state ? (Math.sin(time * 47) > 0.1 ? 1 : 0.05) * (Math.sin(time * 13.3) > -0.6 ? 1 : 0.25) : 0.96 + 0.04 * Math.sin(time * 60);
      F.f = damp(F.f, target, 35, dt);
      F.spot.intensity = F.base * F.f;
      F.cone.material.uniforms.uI.value = F.f;
      for (let k = 0; k < F.sprites.length; k++) F.sprites[k].material.color.setRGB(2.2 * F.f, 2.3 * F.f, 2.6 * F.f);
      this._mats.lampF.color.setRGB(14 * F.f, 13.5 * F.f, 12 * F.f);
    }
    // огни радиовышки
    const bl = this._horizon.blinkers;
    for (let i = 0; i < bl.length; i++) bl[i].visible = ((time * 0.8 + i * 0.33) % 1) < 0.45;
    // масштаб точечных частиц
    this.renderer.getDrawingBufferSize(this._v2);
    this._pointScale.value = this._v2.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 75) / 2));
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'high';
    const Q = QUALITY[this.quality];
    const moon = this.moon;
    if (moon) {
      moon.castShadow = Q.shadow > 0;
      if (Q.shadow > 0 && moon.shadow.mapSize.x !== Q.shadow) {
        moon.shadow.mapSize.set(Q.shadow, Q.shadow);
        if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
      }
    }
    if (this._grass) this._grass.geometry.instanceCount = Math.floor(GRASS_MAX * Q.grass);
    if (this._weeds) this._weeds.count = Math.floor(this._weeds.userData.maxCount * Q.weeds);
    if (this._dust) this._dust.geometry.setDrawRange(0, Math.floor(DUST_MAX * Q.particles));
    if (this._pitParts) {
      this._pitParts.embers.geometry.setDrawRange(0, Math.floor(this._pitParts.emberMax * Q.particles));
      this._pitParts.smoke.geometry.instanceCount = Math.max(6, Math.floor(this._pitParts.smokeMax * Q.particles));
    }
    if (this._fogLayers) this._fogLayers.forEach((m, i) => { m.visible = i < Q.fogLayers; });
  }
}
