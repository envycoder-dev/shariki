// ЯМА — точка входа: загрузка, меню с живой сценой, игровой цикл.
import * as THREE from 'three';
import { World } from './world/World.js';
import { FX } from './fx/FX.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { WeaponSystem } from './weapons/WeaponSystem.js';
import { ZombieManager } from './zombies/ZombieManager.js';
import { Player } from './core/Player.js';
import { Combat } from './core/Combat.js';
import { Game } from './core/Game.js';
import { Post } from './core/Post.js';
import { Input } from './core/Input.js';
import { HUD } from './ui/HUD.js';
import { Screens } from './ui/Screens.js';
import { settings } from './core/settings.js';
import { PARTS } from './zombies/Zombie.js';

// заглушка на случай, если необязательный модуль (звук/эффекты) не поднялся: игра продолжает работать
const noop = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => undefined });
function safe(label, fn) { try { return fn(); } catch (e) { console.error(`[${label}]`, e); return noop; } }
const pixelRatioFor = (q) => (q === 'low' ? 0.75 : q === 'medium' ? 1 : Math.min(devicePixelRatio || 1, 1.5));

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(pixelRatioFor(settings.quality));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = settings.bright;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);

const input = new Input(canvas);
const quality = settings.quality;
const ctx = { scene, camera, renderer, input, shopOpen: false };
let world, fx, audio, zombies, player, hud, game, combat, weapons, post, screens;
let state = 'loading';
let t = 0, deadT = 0, menuT = 0, attractT = 0, fpsAcc = 0, fpsN = 0, fpsVal = '';
const radarPts = [];
const PARTS_CHEST = PARTS.find((p) => p.name === 'chest');
const clock = new THREE.Clock();

async function boot() {
  audio = safe('audio', () => new AudioSystem());
  screens = new Screens({ onAction, onSettings, audio });
  screens.show('loading');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  screens.progress(0.02, 'Строим поле');
  await tick();
  world = new World({ renderer, scene, quality });
  await world.build((p, label) => screens.progress(0.02 + p * 0.4, label || 'Строим поле'));
  fx = safe('fx', () => new FX({ scene, camera, world, audio, quality }));
  zombies = new ZombieManager({ scene, world, audio, fx, quality });
  await zombies.build((p) => screens.progress(0.42 + p * 0.48, `Поднимаем мертвецов · ${Math.round(p * 100)}%`));
  player = new Player({ camera, scene, world, audio, quality });
  hud = new HUD();
  Object.assign(ctx, { world, fx, audio, zombies, player, hud, hurtPlayer, closeShop });
  game = new Game(ctx);
  ctx.game = game;
  combat = new Combat({ world, zombies, fx, audio, hud, player, stats: game.stats });
  weapons = safe('weapons', () => new WeaponSystem({ renderer, camera, scene, audio, fx, combat, world, quality }));
  ctx.weapons = weapons;
  post = new Post(renderer, scene, camera, weapons.viewScene, weapons.viewCamera, quality);
  wire();
  screens.progress(0.95, 'Прогрев шейдеров');
  await tick();
  warmup();
  screens.progress(1, 'Готово');
  onResize();
  enterMenu();
  window.__ready = true;
  requestAnimationFrame(loop);
}

function wire() {
  zombies.onKill = (z, info) => { if (state === 'playing') game.onKill(z, info); };
  zombies.onPlayerHit = (dmg, from, type) => hurtPlayer(dmg, from, type);
  zombies.onAcid = (dmg, from) => { hurtPlayer(dmg, from, 'acid'); hud.acid(); };
  zombies.onPuddle = (h) => game.addPuddle(h);
  zombies.onShake = (a, pos) => {
    if (state !== 'playing') return;
    const d = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
    player.shake(a * Math.max(0, 1 - d / 22));
  };
  zombies.onSummon = (boss) => {
    hud.message('Мясник зовёт подмогу!', 2.2);
    for (let i = 0; i < 4; i++) zombies.spawn('runner');
  };
  combat.onShake = (a) => player.shake(a);
  combat.onPlayerHurt = (dmg, from, type) => hurtPlayer(dmg, from, type);
  input.onLockChange = (locked) => {
    if (!locked && state === 'playing' && !ctx.shopOpen && player.alive) pause();
    if (locked && screens.current === 'click') screens.show('none');
  };
  // браузер разрешает звук только после жеста пользователя
  const unlockAudio = () => { audio.init?.(); audio.setVolumes?.({ master: settings.vol, sfx: 1, music: settings.music }); };
  addEventListener('pointerdown', unlockAudio);
  addEventListener('keydown', unlockAudio);
  addEventListener('resize', onResize);
}

/** компиляция шейдеров заранее, чтобы первый зомби/выстрел не дёргал кадр */
function warmup() {
  const tmp = [];
  for (const type of ['walker', 'runner', 'brute', 'spitter', 'bloater', 'boss']) {
    tmp.push(zombies.spawn(type, { position: new THREE.Vector3(0, -30, 0) }));
  }
  try {
    renderer.compile(scene, camera);
    if (weapons.viewScene) renderer.compile(weapons.viewScene, weapons.viewCamera);
    post.render(0.016);
  } catch (e) { console.warn('warmup', e); }
  zombies.clear();
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post?.setSize(w, h);
  weapons?.onResize?.(w / h);
}

function onSettings(key) {
  if (key === 'bright') renderer.toneMappingExposure = settings.bright;
  if (key === 'vol' || key === 'music') audio.setVolumes?.({ master: settings.vol, sfx: 1, music: settings.music });
  if (key === 'quality') {
    renderer.setPixelRatio(pixelRatioFor(settings.quality));
    post.setQuality(settings.quality);
    player.flash.castShadow = settings.quality === 'high';
    world.setQuality?.(settings.quality);
    onResize();
  }
  if (key === 'fps') document.getElementById('fps').classList.toggle('hidden', !settings.fps);
}

function onAction(a, arg) {
  switch (a) {
    case 'play': case 'restart': startGame(); break;
    case 'resume': resume(); break;
    case 'quit': case 'menu': enterMenu(); break;
    case 'closeShop': closeShop(); break;
    case 'nextWave': game.skipBreak(); closeShop(); break;
    case 'buy': if (game.buy(arg)) screens.shop(game); break;
  }
}

function enterMenu() {
  state = 'menu';
  input.unlock();
  ctx.shopOpen = false;
  screens.stack.length = 0;
  screens.show('menu');
  screens.best(game.best);
  hud.show(false);
  zombies.clear();
  fx.clear?.();
  game.reset();
  player.flash.visible = false;
  zombies.targetAlive = false;
  zombies.hpMul = 1; zombies.speedMul = 1;
  attractT = 0.5;
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  audio.setIntensity?.(0.08);
  audio.heartbeat?.(0);
}

function startGame() {
  audio.init?.(); audio.resume?.();
  audio.setVolumes?.({ master: settings.vol, sfx: 1, music: settings.music });
  zombies.clear(); fx.clear?.();
  game.reset(); combat.stats = game.stats;
  player.reset(); weapons.reset?.(); hud.reset();
  hud.show(true);
  document.getElementById('fps').classList.toggle('hidden', !settings.fps);
  zombies.targetAlive = true;
  deadT = 0;
  state = 'playing';
  screens.show('none');
  input.lock();
  hud.banner('ЯМА', 'Продержитесь как можно дольше', 3);
  audio.setIntensity?.(0.25);
}

function pause() {
  state = 'paused';
  screens.show('pause');
  audio.suspend?.();
}

function resume() {
  if (state !== 'paused' && state !== 'playing') return;
  state = 'playing';
  screens.show('none');
  audio.resume?.();
  input.lock();
  // если захват не дали (например, без жеста) — просим кликнуть
  setTimeout(() => { if (state === 'playing' && !input.locked && !ctx.shopOpen && !debug.lockless) screens.show('click'); }, 400);
}

function openShop() {
  ctx.shopOpen = true;
  screens.shop(game);
  screens.show('shop');
  input.unlock();
}

function closeShop() {
  if (!ctx.shopOpen) return;
  ctx.shopOpen = false;
  screens.show('none');
  if (state === 'playing') input.lock();
}

function hurtPlayer(dmg, from, type) {
  if (state !== 'playing' || !player.alive) return;
  const dealt = player.damage(dmg, from, type, settings.diff);
  if (dealt > 0 && from) {
    const dx = from.x - player.pos.x, dz = from.z - player.pos.z;
    const fx_ = -Math.sin(player.yaw), fz_ = -Math.cos(player.yaw);
    hud.damage(Math.atan2(fx_ * dz - fz_ * dx, fx_ * dx + fz_ * dz), dealt);
  }
}

const debug = { lockless: false, input: null };

function weaponInput(control, pst) {
  const m = input.m, d = debug.input;
  const s = weaponInput.s || (weaponInput.s = {});
  s.fireDown = control && (m.left || !!d?.fire);
  s.firePressed = control && (m.leftHit || !!d?.firePressed);
  s.aimDown = control && (m.right || !!d?.aim);
  s.reloadPressed = control && input.hit('KeyR');
  s.meleePressed = control && input.hit('KeyV');
  s.grenadePressed = control && input.hit('KeyG');
  s.switchTo = !control ? null : input.hit('Digit1') ? 0 : input.hit('Digit2') ? 1 : input.hit('Digit3') ? 2 : null;
  s.wheel = control ? Math.sign(m.wheel) : 0;
  s.lookDX = m.dx; s.lookDY = m.dy;
  s.speed01 = pst.speed01 || 0; s.sprinting = !!pst.sprinting; s.grounded = pst.grounded !== false;
  s.crouching = !!pst.crouching; s.landed = pst.landed || 0;
  s.canFire = control && player.alive && !ctx.shopOpen;
  if (d) d.firePressed = false;
  return s;
}

function updatePlaying(dt) {
  const control = (input.locked || debug.lockless) && !ctx.shopOpen;
  const pst = player.update(dt, input, { control, aiming: !!weapons.isAiming });
  weapons.update?.(dt, weaponInput(control, pst));
  const recoil = weapons.consumeRecoil?.();
  player.updateCamera(dt, recoil, weapons.viewPunch, weapons.aimFovScale ?? 1, t);
  zombies.target.copy(player.pos);
  zombies.targetVel = player.vel;
  zombies.targetAlive = player.alive;
  zombies.update(dt);
  game.update(dt);
  combat.frame++;
  if (ctx.shopOpen) {
    for (let i = 0; i < 6; i++) if (input.hit('Digit' + (i + 1))) onAction('buy', ['shotgun', 'rifle', 'ammo', 'grenade', 'medkit', 'armor'][i]);
    if (input.hit('KeyB') || input.hit('Escape')) closeShop();
    if (input.hit('KeyN')) onAction('nextWave');
  } else if (control) {
    if (input.hit('KeyB') && game.phase === 'break' && game.wave > 0) openShop();
    if (input.hit('KeyN')) game.skipBreak();
  }
  const hpK = player.hp / player.maxHp;
  audio.heartbeat?.(player.alive && hpK < 0.3 ? (0.3 - hpK) / 0.3 : 0);
  if (!player.alive) {
    deadT += dt;
    if (deadT > 2.8) gameOver();
  }
}

function gameOver() {
  state = 'over';
  input.unlock();
  const sum = game.summary();
  const best = game.finish();
  screens.over(sum, best);
  screens.show('over');
  hud.show(false);
  audio.setIntensity?.(0);
  audio.heartbeat?.(0);
}

/** меню: камера облетает яму, зомби вылезают и бредут к камере */
function updateAttract(dt) {
  menuT += dt;
  const a = menuT * 0.035 + 2.0;
  camera.position.set(Math.cos(a) * 24, 3.6 + Math.sin(menuT * 0.13) * 0.5, Math.sin(a) * 24);
  camera.lookAt(Math.cos(a + 0.45) * 5, -0.8, Math.sin(a + 0.45) * 5);
  zombies.target.set(Math.cos(a) * 26, 0, Math.sin(a) * 26);
  attractT -= dt;
  if (attractT <= 0 && zombies.aliveCount < 7) {
    attractT = 1.6 + Math.random() * 2.2;
    const r = Math.random();
    const type = r < 0.55 ? 'walker' : r < 0.7 ? 'runner' : r < 0.8 ? 'crawler' : r < 0.88 ? 'spitter' : r < 0.95 ? 'bloater' : 'brute';
    zombies.spawn(type, { angle: a + (Math.random() - 0.5) * 1.3 });
  }
  for (const z of zombies.active) {
    if (z.alive && z.state === 'move' && z.group.position.distanceTo(zombies.target) < 9) {
      z.hit(PARTS_CHEST, z.center.clone(), new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), 9999, { weaponId: 'rifle' });
    }
  }
  zombies.update(dt);
}

function loop() {
  requestAnimationFrame(loop);
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  t += dt;
  if (state === 'playing') updatePlaying(dt);
  else if (state === 'menu') updateAttract(dt);
  if (state !== 'paused') {
    world.update(dt, t, camera);
    fx.update?.(dt);
  }
  audio.update?.(dt, camera);
  if (state === 'playing' || state === 'paused') {
    const w = weapons.hud?.();
    hud.update(dt, {
      hp: player.hp, maxHp: player.maxHp, armor: player.armor, stamina: player.stamina, weapon: w,
      score: game.score, money: game.money, spread: weapons.spread, aiming: weapons.isAiming, alive: player.alive,
      yaw: player.yaw, px: player.pos.x, pz: player.pos.z, radar: zombies.radar(radarPts),
      fps: settings.fps ? fpsVal : undefined,
    });
    hud.waveNum(Math.max(1, game.wave));
    const hpK = player.hp / player.maxHp;
    post.u.uLow.value = player.alive ? Math.max(0, (0.35 - hpK) / 0.35) : 1;
    post.u.uDamage.value = Math.min(1, hud.vig);
    post.u.uAcid.value = hud.acidV;
  } else {
    post.u.uLow.value = 0; post.u.uDamage.value = 0; post.u.uAcid.value = 0;
  }
  post.render(dt);
  input.endFrame();
  fpsAcc += raw; fpsN++;
  if (fpsAcc > 0.5) { fpsVal = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = 0; fpsN = 0; }
}

// отладочный API для автотестов и скриншотов
window.__game = {
  get state() { return state; }, debug,
  get ctx() { return { world, fx, audio, zombies, player, hud, game, combat, weapons, post, camera, renderer, scene }; },
  start() { debug.lockless = true; startGame(); },
  step(sec, dt = 1 / 30) { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) { t += dt; if (state === 'playing') updatePlaying(dt); else if (state === 'menu') updateAttract(dt); world.update(dt, t, camera); fx.update?.(dt); input.endFrame(); } },
  look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; },
  menu: enterMenu,
};

boot().catch((e) => {
  console.error(e);
  screens?.progress(1, 'Ошибка загрузки: ' + (e?.message || e));
});
