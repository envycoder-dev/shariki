# ЯМА — архитектура и контракты модулей

3D-шутер от первого лица: ночь, поле, огромная провальная яма, из которой лезут зомби волнами.
Игрок отстреливается (пистолет, дробовик, автомат, нож, гранаты), между волнами покупает снаряжение.

## Стек и правила

- three@0.186 (**WebGLRenderer**, не WebGPU). Импорт: `import * as THREE from 'three'`, аддоны: `'three/addons/...'`.
- ES-модули в `src/`, сборка `node build.mjs` → один самодостаточный `dist/index.html` (esbuild IIFE, инлайн).
- **Никаких внешних файлов и сетевых запросов в рантайме.** Все модели, текстуры и звуки генерируются кодом:
  BufferGeometry/ExtrudeGeometry/LatheGeometry/merge, текстуры через `<canvas>` (CanvasTexture / DataTexture),
  звук — синтез WebAudio.
- Единицы: метры, секунды, радианы. Y — вверх. Поле вокруг ямы на высоте y≈0.
- Комментарии в коде — по-русски, кратко, только там, где неочевидно.
- `src/core/noise.js` — общий (только чтение для всех): `RNG`, `makeNoise2D/3D`, `fbm2/fbm3`, `clamp/lerp/smoothstep/damp`.
- Горячие пути (update каждый кадр) — без аллокаций: переиспользуйте временные Vector3/Matrix4, пулы объектов.

```
src/
  main.js, core/, zombies/, ui/   — ведущий (ядро, игрок, бой, волны, зомби, HUD, меню, пост-обработка)
  world/     — окружение (World)
  weapons/   — оружие и руки (WeaponSystem)
  fx/        — эффекты: кровь, частицы, декали, взрывы, гильзы (FX)
  audio/     — весь звук (AudioSystem)
sandbox/     — тестовые сцены модулей: sandbox/<module>.js
tools/       — build/shot
```

## Тестирование (для всех)

```
cd zombie-pit
node build.mjs --entry sandbox/world.js --out sandbox/out/world.html --dev
node tools/shot.mjs --url sandbox/out/world.html --out ../.hoplite/artifacts/world-1.png --size 1280x720 --wait 1500
```
`shot.mjs` ждёт `window.__ready === true` (выставьте после нескольких отрисованных кадров), печатает консоль страницы
и ошибки. `--eval "js"` выполняется перед снимком; `--plan plan.json` — несколько кадров за один запуск
(`[{ "eval": "...", "after": 800, "out": "a.png" }]`). Рендер программный (SwiftShader): медленно, но
картинка честная. Смотрите PNG через Read и доводите вид до высокого качества.

## Рендер и сцена (делает ядро)

- Одна основная `THREE.Scene` (мир + зомби + эффекты). Камера: PerspectiveCamera, fov 75 (настраивается), near 0.05, far 400.
- Вьюмодель (оружие + руки) — в **отдельной** сцене `weapons.viewScene` с камерой `weapons.viewCamera`; рисуется
  поверх основной сцены с очищенной глубиной (оружие никогда не пересекает зомби). Обе сцены проходят одну пост-обработку.
- Рендерер: `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, exposure 1.0,
  `shadowMap.enabled = true`, `PCFSoftShadowMap`. Пост: EffectComposer → UnrealBloomPass (порог ≈ 0.9 в линейном HDR:
  светятся только эмиссивные/яркие вещи — вспышки выстрелов, огонь, глаза зомби, свечение ямы) → виньетка/зерно → OutputPass.
  Значит, «светящиеся» материалы должны иметь emissive с интенсивностью > 1 (например `emissiveIntensity: 3`).
- Качество: `'low' | 'medium' | 'high'` передаётся в конструкторы; модули масштабируют стоимость (тени, плотность травы,
  количество частиц и т.п.). Цель — 60 fps на обычном игровом ПК/ноутбуке на 'high' при ~30 зомби на экране.

## Настроение и стиль (единый для всех модулей)

- Ночь, пасмурно, холодный лунный свет. Тёмное сине-серое окружение; тёплые оранжевые акценты (бочки с огнём, сигнальные огни);
  болезненное красно-оранжевое свечение из глубины ямы; глаза зомби светятся бледно-жёлтым.
- Реалистичные пропорции, PBR (MeshStandardMaterial/MeshPhysicalMaterial), грязь, износ, ржавчина. Никакого «мультяшного» вида,
  никаких голых примитивов без деталей: фаски, слои, процедурные текстуры (шум, зерно, царапины, ржавчина, волокна дерева), карты нормалей/bump.
- Туман: `FogExp2(0x0b0f16, ~0.02)` (ставит World). Сцена должна читаться: силуэты зомби видны на 30 м
  (контраст с небом/туманом, контровой лунный свет, прожекторы).
- Общий свет (World создаёт в основной сцене, Weapons повторяет во вьюмодели):
  HemisphereLight небо `0x3b4a66` / земля `0x17110c`, ~0.9; DirectionalLight «луна» `0xaabfff`, ~1.4, направление из
  (-0.4, 0.8, -0.45) (высоко, со стороны за ямой), отбрасывает тени. Фонарик игрока (ядро): SpotLight `0xfff1d6` на камере.

## Ключевые координаты

- Центр ямы (0,0,0). Радиус кромки ≈ 11 м, неровный: `world.pit.radiusAt(angle)` ∈ [10, 12.5], `angle = Math.atan2(z, x)`.
- Старт игрока (0, 0, 22), взгляд на яму (−Z). Игровая зона — круг радиуса 46 (`world.bounds.radius`).
- Позиция обороны вокруг старта: мешки с песком, ящик снабжения (магазин) около (3.5, 0, 25) → `world.supplyCrate`.

---

## World — `src/world/World.js` (агент окружения)

```js
export class World {
  constructor({ renderer, scene, quality })
  async build(onProgress?)        // (p: 0..1, label) — строит всё и добавляет в scene
  update(dt, time, camera)        // ветер травы, огонь, облака, пульсация свечения ямы, частицы в воздухе
  heightAt(x, z) → number         // высота поверхности земли (вне ямы)
  surfaceAt(x, z) → 'grass'|'dirt'|'concrete'|'wood'   // для звука шагов
  pit: { center: Vector3, radiusAt(angle) → number, depth: number, glowLight: THREE.PointLight }
  bounds: { radius: 46 }
  colliders: Array<{ x, z, r }>   // окружности, блокирующие игрока и зомби (бочки, ящики, мешки цепочкой окружностей, деревья, столбы)
  raycastMeshes: Object3D[]       // меши для попаданий пуль (можно невидимые low-poly прокси), userData.surface:
                                  // 'dirt'|'rock'|'wood'|'metal'|'sandbag'|'concrete'. Землю (heightAt) ядро пересекает само.
  supplyCrate: Vector3
  moon: DirectionalLight
  setQuality(q)                   // минимум: тени и плотность травы
}
```
Яма (по стенке лезут зомби!): верхние 4 м стенки почти вертикальны (радиус на глубине 0..4 м = radiusAt(angle) ± 0.25),
кромка — чёткий обломанный край; дальше провал уходит глубоко и тонет во тьме с красноватым свечением снизу.
Руки зомби хватаются за кромку на радиусе `radiusAt(angle) − 0.05`, поэтому кольцо R…R+2 должно быть свободно от крупных
объектов (мелкий мусор/трава можно).

## WeaponSystem — `src/weapons/WeaponSystem.js` (агент оружия)

```js
export class WeaponSystem {
  constructor({ renderer, camera, scene, audio, fx, combat, world, quality })
  viewScene: THREE.Scene; viewCamera: THREE.PerspectiveCamera
  update(dt, s)   // s: { fireDown, firePressed, aimDown, reloadPressed, meleePressed, grenadePressed,
                  //      switchTo: number|null (слот 0..), wheel: -1|0|1, lookDX, lookDY (px мыши за кадр),
                  //      speed01 (0..1 от скорости спринта), sprinting, grounded, crouching, landed (0..1), canFire }
  get aimFovScale()     // множитель FOV основной камеры (1 — обычно, ~0.75 при прицеливании)
  consumeRecoil()       // → { pitch, yaw } (рад) отдача для камеры за кадр; после чтения обнуляется
  get viewPunch()       // → { pitch, yaw, roll } кратковременная тряска камеры (рад)
  get spread()          // текущий разброс в градусах (для прицела)
  get isAiming()
  hud()                 // → { weaponId, name, mag, magSize, reserve (Infinity у пистолета), grenades, reloading, slots:[{id,name,owned}] }
  give(id), owns(id), addAmmo(id, rounds), refillAmmo(), addGrenades(n), setActive(id), reset(), onResize(aspect)
}
```
Оружие: `'pistol'` (Пистолет), `'shotgun'` (Дробовик, помповый), `'rifle'` (Автомат, AK-подобный), нож на V, гранаты на G.
Стрельба — через `combat.fireBullet(...)` (см. ниже); попадания/кровь/звуки попаданий делает ядро.

## FX — `src/fx/FX.js` (агент эффектов)

```js
export class FX {
  constructor({ scene, camera, world, audio, quality })
  update(dt)
  bulletImpact(point, normal, surface)   // пыль/щепки/искры + декаль пробоины
  bloodHit(point, dir, intensity = 1)    // брызги по направлению пули + облачко; капли на земле → мелкие декали
  bloodBurst(point, intensity = 1)       // крупный выброс (голова/конечность/толстяк): ошмётки, брызги, туман
  bloodPool(point, size = 1)             // растущая лужа под трупом
  addGib(object3D, velocity, angularVelocity, opts?)  // { bleed, lifetime, radius, disposeGeometry } — физика кувыркания, отскоки, след крови, исчезновение
  tracer(from, to, color?)
  flash(position, color, intensity, duration)  // короткий динамический свет (пул ≤ 4 PointLight без теней)
  explosion(position, radius)            // огненный шар, дым, обломки, ударная волна, подпалина, вспышка
  shellCasing(position, velocity, kind)  // 'pistol'|'rifle'|'shotgun' — физическая гильза; звук через audio.shellCasing на первом отскоке
  muzzleSmoke(position, dir)
  dirtBurst(position, intensity = 1)     // комья и пыль (зомби вылезает, тяжёлый удар)
  acidSplash(position)
  acidPuddle(position, radius, duration) → { position, radius, alive }
  gasCloud(position, radius)
  clear()
}
```

## AudioSystem — `src/audio/AudioSystem.js` (агент звука)

```js
export class AudioSystem {
  constructor()
  init()                      // на первом жесте пользователя; повторный вызов безопасен
  resume(); suspend()
  setVolumes({ master, sfx, music })   // 0..1
  update(dt, camera)          // позиция/ориентация слушателя
  // 2D
  weaponFire(id), weaponDry(), weaponSwitch(), weaponReload(id, step)  // step: 'magOut'|'magIn'|'slide'|'bolt'|'shellIn'|'pump'|'grab'
  knifeSwing(), knifeHit(), grenadePin(), grenadeThrow()
  footstep(surface, speed01), jump(), land(intensity), playerHurt(intensity), playerDeath(), heartbeat(intensity)
  hitMarker(kind)             // 'hit'|'kill'|'headshot'
  uiHover(), uiClick(), buy(), denied(), pickup(kind), waveStart(n), waveClear(), bossIntro(), setIntensity(x)
  // 3D (THREE.Vector3)
  explosion(pos), bulletImpact(pos, surface), fleshHit(pos, headshot), gore(pos), bodyFall(pos, heavy),
  shellCasing(pos, kind), grenadeBounce(pos), zombieStep(pos, heavy), rimScrape(pos), acidSpit(pos), acidSplash(pos)
  createVoice(type, seed) → { setPosition(v3), groan(), attack(), scream(), pain(), death(), spit(), stop(), dispose() }
  //   type: 'walker'|'runner'|'crawler'|'brute'|'spitter'|'bloater'|'boss'
}
```

## Combat — `src/core/Combat.js` (ядро; вызывают Weapons)

```js
combat.fireBullet({ origin, dir, damage, range, force, weaponId, pellet })
  → { point: Vector3|null, kind: 'zombie'|'world'|'none', killed, headshot, distance }
combat.melee({ origin, dir, range, damage, force }) → { hit, killed }
combat.explode({ position, radius, damage, force })
```
Combat сам вызывает FX/звук попаданий и хит-маркеры HUD. Weapons рисуют только своё: вспышку, гильзы, трассеры, дым.
