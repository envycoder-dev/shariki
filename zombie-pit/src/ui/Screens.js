// Экраны: меню, пауза, управление, настройки, магазин, итог. Кнопки работают через data-act.
import { settings, saveSettings } from '../core/settings.js';
import { SHOP } from '../core/Game.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'menu', 'pause', 'controls', 'settings', 'shop', 'over', 'click'];

export class Screens {
  constructor({ onAction, onSettings, audio }) {
    this.onAction = onAction; this.onSettings = onSettings; this.audio = audio;
    this.current = 'loading';
    this.stack = [];
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) { this.audio?.uiClick?.(); this.act(b.dataset.act); }
      const item = e.target.closest('.item');
      if (item && !item.classList.contains('off')) this.onAction('buy', item.dataset.id);
    });
    document.addEventListener('mouseover', (e) => { if (e.target.closest('.btn,.item:not(.off),.seg button')) this.audio?.uiHover?.(); });
    $('screen-click').addEventListener('click', () => this.onAction('resume'));
    this.bindSettings();
  }

  show(name) {
    for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
    this.current = name;
  }

  /** вложенные экраны (управление/настройки) возвращаются туда, откуда открыты */
  push(name) { this.stack.push(this.current); this.show(name); }
  back() { this.show(this.stack.pop() || 'menu'); }

  act(a) {
    if (a === 'controls' || a === 'settings') { this.syncSettings(); this.push(a); return; }
    if (a === 'back') { this.back(); return; }
    this.onAction(a);
  }

  progress(p, text) {
    $('loadBar').firstElementChild.style.width = Math.round(p * 100) + '%';
    if (text) $('loadText').textContent = text;
  }

  best(b) {
    $('menuBest').innerHTML = b.score > 0
      ? `Рекорд: <b>${b.score}</b> очков · волна <b>${b.wave}</b> · убито <b>${b.kills}</b><br>Совет: играйте в наушниках`
      : 'Совет: играйте в наушниках — зомби слышно раньше, чем видно';
  }

  over(sum, best) {
    const m = Math.floor(sum.time / 60), s = Math.floor(sum.time % 60);
    $('overStats').innerHTML = `
      <span>Волна</span><b>${sum.wave}</b>
      <span>Убито зомби</span><b>${sum.kills}</b>
      <span>В голову</span><b>${sum.headshots}</b>
      <span>Точность</span><b>${sum.accuracy}%</b>
      <span>Время</span><b>${m}:${String(s).padStart(2, '0')}</b>
      <span>Очки</span><b>${sum.score}</b>
      <span class="best">${best.record ? 'Новый рекорд!' : 'Рекорд'}</span><b class="best">${best.score}</b>`;
  }

  shop(game) {
    $('shopCash').textContent = '$ ' + game.money;
    $('shopGrid').innerHTML = SHOP.map((it, i) => {
      const owned = (it.id === 'shotgun' || it.id === 'rifle') && game.ctx.weapons.owns(it.id);
      const ok = game.canBuy(it);
      return `<div class="item ${ok ? '' : 'off'}" data-id="${it.id}"><span class="key">${i + 1}</span>
        <div class="nm">${it.name}</div><div class="ds">${it.desc}</div>
        <div class="pr">${owned ? 'Есть' : '$ ' + it.price}</div></div>`;
    }).join('');
  }

  bindSettings() {
    const range = (id, key, fmt) => {
      const el = $(id), val = $('val' + id.slice(3));
      el.addEventListener('input', () => { settings[key] = parseFloat(el.value); val.textContent = fmt(settings[key]); saveSettings(); this.onSettings(key); });
    };
    range('setSens', 'sens', (v) => v.toFixed(2));
    range('setBright', 'bright', (v) => Math.round(v * 100) + '%');
    range('setFov', 'fov', (v) => v + '°');
    range('setVol', 'vol', (v) => Math.round(v * 100) + '%');
    range('setMusic', 'music', (v) => Math.round(v * 100) + '%');
    const seg = (id, key, attr, parse = (x) => x) => {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        settings[key] = parse(b.dataset[attr]); saveSettings(); this.syncSettings(); this.onSettings(key);
      });
    };
    seg('setQuality', 'quality', 'q');
    seg('setDiff', 'diff', 'd');
    seg('setInvert', 'invert', 'v', Number);
    seg('setFps', 'fps', 'v', Number);
  }

  syncSettings() {
    const put = (id, v, txt) => { $(id).value = v; $('val' + id.slice(3)).textContent = txt; };
    put('setSens', settings.sens, settings.sens.toFixed(2));
    put('setBright', settings.bright, Math.round(settings.bright * 100) + '%');
    put('setFov', settings.fov, settings.fov + '°');
    put('setVol', settings.vol, Math.round(settings.vol * 100) + '%');
    put('setMusic', settings.music, Math.round(settings.music * 100) + '%');
    const mark = (id, attr, v) => { for (const b of $(id).children) b.classList.toggle('on', b.dataset[attr] === String(v)); };
    mark('setQuality', 'q', settings.quality); mark('setDiff', 'd', settings.diff);
    mark('setInvert', 'v', settings.invert); mark('setFps', 'v', settings.fps);
  }
}
