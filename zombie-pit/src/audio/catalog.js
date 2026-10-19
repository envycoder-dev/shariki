// Каталог предрасчитанных звуков: имя → { make(sr, R, vi, vars), vars, pri, half?, stereo? }
// pri 0 — синхронно в init(); 1 — сразу в фоне; 2 — позже в фоне. half — рендер на половинной частоте (голоса).
import * as S from './sfx.js';
import { zombieVox, zombieSpit, playerHurt, playerDeath, crow, howl } from './vox.js';

export const ZOMBIE_TYPES = ['walker', 'runner', 'crawler', 'brute', 'spitter', 'bloater', 'boss'];
export const ZOMBIE_ACTIONS = ['groan', 'attack', 'scream', 'pain', 'death'];
export const SURFACES = ['dirt', 'wood', 'metal', 'rock', 'concrete', 'sandbag'];
export const STEP_SURFACES = ['grass', 'dirt', 'concrete', 'wood'];
export const RELOAD = ['pistol_magOut', 'pistol_magIn', 'pistol_slide', 'rifle_magOut', 'rifle_magIn', 'rifle_bolt', 'shotgun_shellIn', 'shotgun_pump', 'grab'];

export const CATALOG = {};
const add = (name, make, vars, pri, extra) => { CATALOG[name] = { make, vars, pri, ...extra }; };

// pri 0: выстрелы, механика, шаги, интерфейс — нужны сразу
add('gun_pistol', (sr, R) => S.gunshot(sr, R, 'pistol'), 5, 0);
add('gun_shotgun', (sr, R) => S.gunshot(sr, R, 'shotgun'), 4, 0);
add('gun_rifle', (sr, R) => S.gunshot(sr, R, 'rifle'), 6, 0);
add('dry', (sr, R) => S.mech(sr, R, 'dry'), 3, 0);
for (const n of RELOAD) add(n, (sr, R) => S.mech(sr, R, n), n === 'shotgun_shellIn' || n === 'shotgun_pump' ? 3 : 2, 0);
for (const n of ['switch', 'knifeSwing', 'knifeHit', 'grenadePin', 'grenadeThrow']) add(n, (sr, R) => S.mech(sr, R, n), n === 'knifeSwing' ? 4 : 3, 0);
for (const k of ['hit', 'kill', 'headshot']) add('hm_' + k, (sr, R) => S.ui(sr, R, k), 2, 0);
add('ui_hover', (sr, R) => S.ui(sr, R, 'hover'), 2, 0);
add('ui_click', (sr, R) => S.ui(sr, R, 'click'), 2, 0);
for (const s of STEP_SURFACES) add('step_' + s, (sr, R) => S.footstep(sr, R, s), 5, 0);

// pri 1: попадания, плоть, гильзы, зомби-шумы, игрок, музыка, голоса обычных зомби
for (const s of SURFACES) add('imp_' + s, (sr, R) => S.impact(sr, R, s), s === 'dirt' || s === 'metal' ? 4 : 3, 1);
add('ricochet', S.ricochet, 3, 1);
add('flesh', (sr, R) => S.flesh(sr, R, false), 4, 1);
add('flesh_head', (sr, R) => S.flesh(sr, R, true), 3, 1);
add('gore', S.gore, 3, 1);
add('body', (sr, R) => S.bodyFall(sr, R, false), 3, 1);
add('body_heavy', (sr, R) => S.bodyFall(sr, R, true), 2, 1);
for (const k of ['pistol', 'rifle', 'shotgun']) add('casing_' + k, (sr, R) => S.casing(sr, R, k), k === 'shotgun' ? 3 : 4, 1);
add('grenadeBounce', S.grenadeBounce, 3, 1);
add('explosion', S.explosion, 3, 1);
add('zstep', (sr, R) => S.zombieStep(sr, R, false), 5, 1);
add('zstep_heavy', (sr, R) => S.zombieStep(sr, R, true), 3, 1);
add('rimScrape', S.rimScrape, 3, 1);
add('acidSpit', S.acidSpit, 2, 1);
add('acidSplash', S.acidSplash, 2, 1);
add('gear', S.gear, 3, 1);
add('jump', S.jump, 3, 1);
add('land', S.land, 3, 1);
add('hb_lub', (sr, R) => S.heartbeat(sr, R, false), 1, 1);
add('hb_dub', (sr, R) => S.heartbeat(sr, R, true), 1, 1);
add('ui_buy', (sr, R) => S.ui(sr, R, 'buy'), 1, 1);
add('ui_denied', (sr, R) => S.ui(sr, R, 'denied'), 1, 1);
for (const k of ['ammo', 'health', 'money']) add('pick_' + k, (sr, R) => S.ui(sr, R, k), k === 'health' ? 1 : 2, 1);
add('player_hurt', (sr, R, vi, nv) => playerHurt(sr, R, vi, nv), 6, 1, { half: true });
add('player_death', playerDeath, 2, 1, { half: true });
add('wave_start', S.waveHorn, 1, 1);
add('mus_tom', S.musTom, 3, 1);
add('mus_pulse', S.musPulse, 2, 1);
add('mus_tick', S.musTick, 3, 1);
add('amb_crickets', S.crickets, 1, 1, { stereo: true, half: true });

const VARS = { groan: 4, attack: 3, scream: 3, pain: 3, death: 2 };
const voxEntry = (t, a) => add(`vox_${t}_${a}`, (sr, R) => zombieVox(sr, R, t, a), t === 'boss' ? 2 : VARS[a], t === 'walker' || t === 'runner' ? 1 : 2, { half: true });
for (const a of ZOMBIE_ACTIONS) { voxEntry('walker', a); voxEntry('runner', a); }

// pri 2: остальные голоса, стингеры, далёкие события
for (const t of ZOMBIE_TYPES) if (t !== 'walker' && t !== 'runner') for (const a of ZOMBIE_ACTIONS) voxEntry(t, a);
add('vox_spit', (sr, R) => zombieSpit(sr, R, 'spitter'), 3, 2, { half: true });
add('mus_riser', S.musRiser, 1, 2);
add('wave_clear', S.relief, 1, 2);
add('boss_brass', S.bossBrass, 1, 2);
add('amb_crow', crow, 3, 2, { half: true });
add('amb_howl', howl, 2, 2, { half: true });
add('amb_creak', S.creak, 3, 2, { half: true });
add('amb_thunder', S.thunder, 2, 2, { half: true });
