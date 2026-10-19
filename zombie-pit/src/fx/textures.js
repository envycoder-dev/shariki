// Процедурные текстуры эффектов: тайлящийся шум (дым/огонь), атлас декалей + карта нормалей, текстура мяса.
import * as THREE from 'three';
import { RNG } from '../core/noise.js';

// Ячейки атласа декалей 4×4
export const CELL = {
  SPLAT: 0, // 0..5 — брызги крови
  POOL: 6, // 6..7 — лужи
  SCORCH: 8, HOLE_DIRT: 9, HOLE_WOOD: 10, HOLE_METAL: 11, HOLE_ROCK: 12, HOLE_SAND: 13, ACID: 14, DROP: 15,
};
export const ATLAS_GRID = 4;

const TAU = Math.PI * 2;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Периодический value-noise: решётка period×period, бесшовно тайлится
function periodic(rng, period) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    const ab = a + (b - a) * u, cd = c + (d - c) * u;
    return ab + (cd - ab) * v;
  };
}

// RGBA: R — клубы (fbm), G — мелкая деталь, B — «гребни» для огня, A — средняя частота
export function makeNoiseTexture(size = 128, seed = 77) {
  const rng = new RNG(seed);
  const channel = (base, oct, ridged) => {
    const layers = [];
    for (let o = 0; o < oct; o++) layers.push(periodic(rng, base << o));
    const out = new Float32Array(size * size);
    let mn = 1e9, mx = -1e9;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0, amp = 1, tot = 0;
        for (let o = 0; o < oct; o++) {
          const f = (base << o) / size;
          let n = layers[o](x * f, y * f);
          if (ridged) n = 1 - Math.abs(n * 2 - 1);
          s += n * amp; tot += amp; amp *= 0.55;
        }
        const v = s / tot;
        out[y * size + x] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
    return out;
  };
  const r = channel(4, 5, false), g = channel(8, 4, false), b = channel(4, 5, true), a = channel(16, 3, false);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r[i] * 255; data[i * 4 + 1] = g[i] * 255; data[i * 4 + 2] = b[i] * 255; data[i * 4 + 3] = a[i] * 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------- рисование декалей (координаты ячейки −128..128) ----------

function blob(ctx, cx, cy, R, rng, rough = 0.12, lobes = 5, sx = 1, sy = 1) {
  const n = 72, ph = rng.float(0, TAU), ph2 = rng.float(0, TAU), ph3 = rng.float(0, TAU);
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const r = R * (1 + rough * Math.sin(a * lobes + ph) + rough * 0.55 * Math.sin(a * (lobes * 2 + 1) + ph2) +
      rough * 0.3 * Math.sin(a * 13 + ph3));
    const x = cx + Math.cos(a) * r * sx, y = cy + Math.sin(a) * r * sy;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function streak(ctx, x0, y0, x1, y1, w0, w1) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
  ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.lineTo(x0 - nx * w0, y0 - ny * w0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x1, y1, w1 * 1.25, 0, TAU);
  ctx.fill();
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

// Неоднородная толщина: темнее в центре и пятнами (source-atop — только по уже нарисованному)
function shade(ctx, R, rng, dark = 0.35, spots = 26) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, `rgba(0,0,0,${dark})`);
  g.addColorStop(0.7, `rgba(0,0,0,${dark * 0.4})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-128, -128, 256, 256);
  for (let i = 0; i < spots; i++) {
    const x = rng.float(-R, R), y = rng.float(-R, R), r = rng.float(4, R * 0.35);
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(0,0,0,${rng.float(0.05, 0.22)})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

function drawSplat(ctx, v, rng) {
  ctx.fillStyle = '#fff';
  if (v === 0) { // капля с высоты: блоб + лучи с каплями
    const R = rng.float(36, 44);
    blob(ctx, 0, 0, R, rng, 0.1, 6);
    const n = rng.int(10, 16);
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, TAU), d1 = R * rng.float(1.2, 2.3), w = rng.float(2.5, 6);
      streak(ctx, Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7, Math.cos(a) * d1, Math.sin(a) * d1, w * 1.6, w * 0.5);
    }
    for (let i = 0; i < 40; i++) {
      const a = rng.float(0, TAU), d = R * rng.float(1.2, 2.6);
      dot(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(0.8, 3.2));
    }
    shade(ctx, R * 1.2, rng);
  } else if (v === 1) { // косой удар: вытянутое пятно и «восклицательные знаки» по направлению
    blob(ctx, -30, 0, 30, rng, 0.12, 4, 1.5, 0.8);
    for (let i = 0; i < 14; i++) {
      const y = rng.float(-26, 26), x0 = rng.float(-10, 20), x1 = x0 + rng.float(20, 75);
      streak(ctx, x0, y * 0.6, x1, y, rng.float(3, 6), rng.float(1.5, 4));
    }
    for (let i = 0; i < 40; i++) dot(ctx, rng.float(10, 118), rng.float(-40, 40), rng.float(0.8, 3));
    shade(ctx, 70, rng, 0.3);
  } else if (v === 2) { // россыпь капель
    for (let i = 0; i < 9; i++) {
      const x = rng.float(-70, 70), y = rng.float(-70, 70), r = rng.float(7, 22);
      blob(ctx, x, y, r, rng, 0.15, rng.int(3, 6));
      for (let k = 0; k < 6; k++) {
        const a = rng.float(0, TAU), d = r * rng.float(1.2, 1.9);
        dot(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, rng.float(0.8, 2.5));
      }
    }
    shade(ctx, 90, rng, 0.25, 30);
  } else if (v === 3) { // распылённая струя: конус мелких точек
    for (let i = 0; i < 220; i++) {
      const a = rng.gauss() * 0.35, d = Math.pow(rng.next(), 0.7) * 120 - 10;
      const r = rng.float(0.8, 3.5) * (1.2 - d / 140);
      if (rng.chance(0.15)) {
        streak(ctx, Math.cos(a) * d - 6, Math.sin(a) * d, Math.cos(a) * d + 6, Math.sin(a) * d, r * 0.6, r);
      } else dot(ctx, Math.cos(a) * d - 0, Math.sin(a) * d, r);
    }
    blob(ctx, -40, 0, 14, rng, 0.2, 4);
    shade(ctx, 80, rng, 0.2, 10);
  } else if (v === 4) { // большое пятно с лопастями
    blob(ctx, 0, 0, 48, rng, 0.16, 5);
    for (let i = 0; i < 4; i++) {
      const a = rng.float(0, TAU), d = rng.float(30, 50);
      blob(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(14, 24), rng, 0.2, 4);
    }
    for (let i = 0; i < 9; i++) {
      const a = rng.float(0, TAU);
      streak(ctx, Math.cos(a) * 45, Math.sin(a) * 45, Math.cos(a) * rng.float(75, 112), Math.sin(a) * rng.float(75, 112), 6, 2.2);
    }
    for (let i = 0; i < 30; i++) {
      const a = rng.float(0, TAU), d = rng.float(70, 120);
      dot(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(0.8, 3));
    }
    shade(ctx, 70, rng, 0.4, 34);
  } else { // мазок/след волочения
    for (let i = 0; i < 18; i++) {
      const y = rng.float(-28, 28), w = rng.float(2, 7);
      ctx.globalAlpha = rng.float(0.55, 1);
      streak(ctx, rng.float(-110, -70), y + rng.float(-6, 6), rng.float(40, 112), y, w, w * 0.4);
    }
    ctx.globalAlpha = 1;
    blob(ctx, -80, 0, 26, rng, 0.15, 3, 1, 1.2);
    shade(ctx, 90, rng, 0.3, 30);
  }
}

function drawPool(ctx, v, rng) {
  ctx.fillStyle = '#fff';
  blob(ctx, 0, 0, 74, rng, 0.08, v ? 3 : 4);
  for (let i = 0; i < 5; i++) {
    const a = rng.float(0, TAU), d = rng.float(40, 62);
    blob(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(22, 38), rng, 0.12, 3);
  }
  for (let i = 0; i < 10; i++) {
    const a = rng.float(0, TAU), d = rng.float(96, 116);
    dot(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(1.5, 5));
  }
  shade(ctx, 100, rng, 0.45, 40);
}

function drawScorch(ctx, rng) {
  // радиальный выжженный след с лучами
  for (let i = 0; i < 160; i++) {
    const a = rng.float(0, TAU), len = rng.float(60, 124), w = rng.float(0.02, 0.09);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    const c = rng.float(8, 22);
    g.addColorStop(0, `rgba(${c},${c * 0.8},${c * 0.6},0.5)`);
    g.addColorStop(1, `rgba(${c},${c * 0.8},${c * 0.6},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, len, a - w, a + w);
    ctx.closePath();
    ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 92);
  g.addColorStop(0, 'rgba(6,5,4,0.97)');
  g.addColorStop(0.45, 'rgba(12,9,7,0.9)');
  g.addColorStop(1, 'rgba(25,18,12,0)');
  ctx.fillStyle = g;
  blob(ctx, 0, 0, 90, rng, 0.12, 7);
  for (let i = 0; i < 60; i++) { // пятна копоти и пепла
    const x = rng.float(-90, 90), y = rng.float(-90, 90), r = rng.float(3, 16);
    const c = rng.chance(0.3) ? 60 : 4;
    ctx.fillStyle = `rgba(${c},${c * 0.9},${c * 0.8},${rng.float(0.1, 0.35)})`;
    dot(ctx, x, y, r);
  }
}

function drawHole(ctx, kind, rng) {
  if (kind === 'dirt') {
    ctx.fillStyle = 'rgba(30,22,15,0.85)';
    blob(ctx, 0, 0, 44, rng, 0.2, 5);
    for (let i = 0; i < 40; i++) {
      const a = rng.float(0, TAU), d = rng.float(30, 100);
      ctx.fillStyle = `rgba(${rng.int(25, 60)},${rng.int(18, 42)},${rng.int(10, 28)},${rng.float(0.6, 1)})`;
      blob(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(2, 7), rng, 0.3, 3);
    }
    ctx.fillStyle = 'rgba(12,8,5,1)';
    blob(ctx, 0, 0, 22, rng, 0.2, 4);
    ctx.fillStyle = 'rgba(2,1,1,1)';
    dot(ctx, 0, 0, 11);
  } else if (kind === 'wood') {
    ctx.fillStyle = 'rgba(205,165,110,1)'; // светлая щепа вокруг пробоины
    ctx.beginPath();
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, r = (i % 2 ? rng.float(16, 26) : rng.float(30, 60));
      const x = Math.cos(a) * r * 1.2, y = Math.sin(a) * r * 0.8;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,25,12,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) { // трещины вдоль волокон
      const y = rng.float(-10, 10);
      ctx.beginPath();
      ctx.moveTo(rng.float(-30, -10), y);
      ctx.lineTo(rng.float(-110, -50), y + rng.float(-6, 6));
      ctx.moveTo(rng.float(10, 30), y);
      ctx.lineTo(rng.float(50, 110), y + rng.float(-6, 6));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60,38,20,1)';
    dot(ctx, 0, 0, 22);
    ctx.fillStyle = 'rgba(4,3,2,1)';
    dot(ctx, 0, 0, 15);
  } else if (kind === 'metal') {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    g.addColorStop(0, 'rgba(20,14,10,0.8)');
    g.addColorStop(1, 'rgba(20,14,10,0)');
    ctx.fillStyle = g;
    dot(ctx, 0, 0, 70);
    ctx.fillStyle = 'rgba(225,222,215,1)'; // ободок содранной краски/блестящего металла
    blob(ctx, 0, 0, 30, rng, 0.08, 7);
    ctx.fillStyle = 'rgba(70,66,60,1)';
    dot(ctx, 0, 0, 22);
    ctx.fillStyle = 'rgba(2,2,2,1)';
    dot(ctx, 0, 0, 16);
  } else if (kind === 'rock') {
    ctx.fillStyle = 'rgba(150,148,140,0.95)'; // свежий скол светлее
    blob(ctx, 0, 0, 52, rng, 0.25, 6);
    ctx.fillStyle = 'rgba(95,92,88,1)';
    blob(ctx, 0, 0, 32, rng, 0.25, 5);
    ctx.strokeStyle = 'rgba(30,30,30,0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      let a = rng.float(0, TAU), x = Math.cos(a) * 25, y = Math.sin(a) * 25;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        a += rng.float(-0.4, 0.4);
        x += Math.cos(a) * rng.float(12, 24); y += Math.sin(a) * rng.float(12, 24);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15,15,15,1)';
    blob(ctx, 0, 0, 13, rng, 0.2, 4);
  } else { // мешок с песком: рваная ткань и просыпанный песок
    ctx.fillStyle = 'rgba(190,165,115,0.55)';
    blob(ctx, 0, 20, 60, rng, 0.2, 5, 0.9, 1.2);
    ctx.strokeStyle = 'rgba(200,180,130,1)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 18; i++) {
      const a = rng.float(0, TAU), r0 = 14, r1 = rng.float(24, 44);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(8,6,4,1)';
    blob(ctx, 0, 0, 17, rng, 0.25, 5);
  }
}

function drawAcid(ctx, rng) {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  blob(ctx, 0, 0, 70, rng, 0.12, 5);
  for (let i = 0; i < 6; i++) {
    const a = rng.float(0, TAU), d = rng.float(55, 80);
    blob(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(14, 26), rng, 0.2, 3);
  }
  shade(ctx, 100, rng, 0.5, 30);
  ctx.strokeStyle = 'rgba(255,255,255,1)'; // пузыри
  for (let i = 0; i < 26; i++) {
    const a = rng.float(0, TAU), d = rng.float(0, 70), r = rng.float(2, 8);
    ctx.lineWidth = rng.float(1, 2.5);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, TAU);
    ctx.stroke();
  }
}

function drawDrop(ctx, rng) {
  ctx.fillStyle = '#fff';
  blob(ctx, 0, 0, 34, rng, 0.08, 7);
  const n = rng.int(14, 20);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.float(-0.1, 0.1), d = rng.float(44, 62);
    streak(ctx, Math.cos(a) * 30, Math.sin(a) * 30, Math.cos(a) * d, Math.sin(a) * d, 4, 2.4);
  }
  for (let i = 0; i < 18; i++) {
    const a = rng.float(0, TAU), d = rng.float(66, 110);
    dot(ctx, Math.cos(a) * d, Math.sin(a) * d, rng.float(1, 3.5));
  }
  shade(ctx, 40, rng, 0.3, 10);
}

// Атлас декалей (sRGB) + карта нормалей из «высоты». Пиксели с нулевой альфой заполняются средним цветом ячейки,
// чтобы мип-уровни не давали тёмной каймы.
export function makeDecalAtlas(size = 1024) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const cs = size / ATLAS_GRID, rng = new RNG(4242);
  // режим высоты для нормалей: 0 — по альфе (жидкость), 1 — по яркости (пробоины), 2 — почти плоско
  const mode = new Uint8Array(16);
  const strength = new Float32Array(16);
  for (let i = 0; i < 16; i++) {
    const cx = (i % ATLAS_GRID + 0.5) * cs, cy = (Math.floor(i / ATLAS_GRID) + 0.5) * cs;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - cs / 2 + 3, cy - cs / 2 + 3, cs - 6, cs - 6);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.scale(cs / 256, cs / 256);
    if (i <= 5) { drawSplat(ctx, i, rng); mode[i] = 0; strength[i] = 5; }
    else if (i <= 7) { drawPool(ctx, i - 6, rng); mode[i] = 0; strength[i] = 4; }
    else if (i === CELL.SCORCH) { drawScorch(ctx, rng); mode[i] = 2; strength[i] = 1; }
    else if (i === CELL.HOLE_DIRT) { drawHole(ctx, 'dirt', rng); mode[i] = 1; strength[i] = 5; }
    else if (i === CELL.HOLE_WOOD) { drawHole(ctx, 'wood', rng); mode[i] = 1; strength[i] = 5; }
    else if (i === CELL.HOLE_METAL) { drawHole(ctx, 'metal', rng); mode[i] = 1; strength[i] = 5; }
    else if (i === CELL.HOLE_ROCK) { drawHole(ctx, 'rock', rng); mode[i] = 1; strength[i] = 5; }
    else if (i === CELL.HOLE_SAND) { drawHole(ctx, 'sand', rng); mode[i] = 1; strength[i] = 4; }
    else if (i === CELL.ACID) { drawAcid(ctx, rng); mode[i] = 0; strength[i] = 4; }
    else { drawDrop(ctx, rng); mode[i] = 0; strength[i] = 5; }
    ctx.restore();
  }
  const src = ctx.getImageData(0, 0, size, size).data;
  const N = size * size;
  const h = new Float32Array(N);
  // средний цвет непрозрачных пикселей по ячейкам
  const avg = new Float32Array(16 * 4);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / cs) * ATLAS_GRID;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, cell = row + Math.floor(x / cs), a = src[i * 4 + 3] / 255;
      if (a > 0.5) { avg[cell * 4] += src[i * 4]; avg[cell * 4 + 1] += src[i * 4 + 1]; avg[cell * 4 + 2] += src[i * 4 + 2]; avg[cell * 4 + 3]++; }
      const m = mode[cell];
      if (m === 0) h[i] = a;
      else if (m === 1) h[i] = a * (0.25 + 0.75 * (src[i * 4] + src[i * 4 + 1] + src[i * 4 + 2]) / 765);
      else h[i] = a * 0.3;
    }
  }
  // размытие высоты (2 прохода box-фильтра) — мягкий мениск у краёв жидкости
  const tmp = new Float32Array(N);
  const blur = (from, to, dx, dy, r) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0, cnt = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k * dx, yy = y + k * dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          s += from[yy * size + xx]; cnt++;
        }
        to[y * size + x] = s / cnt;
      }
    }
  };
  const br = Math.max(1, Math.round(size / 400));
  blur(h, tmp, 1, 0, br); blur(tmp, h, 0, 1, br);
  blur(h, tmp, 1, 0, br); blur(tmp, h, 0, 1, br);

  const color = new Uint8Array(N * 4), normal = new Uint8Array(N * 4);
  for (let y = 0; y < size; y++) {
    const ty = size - 1 - y; // DataTexture: строка 0 — низ (v=0)
    const row = Math.floor(y / cs) * ATLAS_GRID;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = (ty * size + x) * 4, cell = row + Math.floor(x / cs);
      const a = src[i * 4 + 3];
      if (a === 0 && avg[cell * 4 + 3] > 0) {
        const n = avg[cell * 4 + 3];
        color[o] = avg[cell * 4] / n; color[o + 1] = avg[cell * 4 + 1] / n; color[o + 2] = avg[cell * 4 + 2] / n; color[o + 3] = 0;
      } else {
        color[o] = src[i * 4]; color[o + 1] = src[i * 4 + 1]; color[o + 2] = src[i * 4 + 2]; color[o + 3] = a;
      }
      const xl = x > 0 ? x - 1 : x, xr = x < size - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < size - 1 ? y + 1 : y;
      const s = strength[cell] * (size / 256) * 0.5;
      const dhx = (h[y * size + xr] - h[y * size + xl]) * s;
      const dhy = (h[yd * size + x] - h[yu * size + x]) * s; // +y канваса = −v
      let nx = -dhx, ny = dhy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      normal[o] = (nx * 0.5 + 0.5) * 255; normal[o + 1] = (ny * 0.5 + 0.5) * 255; normal[o + 2] = (nz * 0.5 + 0.5) * 255; normal[o + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(color, true), normalMap: mk(normal, false), grid: ATLAS_GRID };
}

// Текстура мяса для ошмётков: тёмно-красная основа, сгустки, светлые прожилки (не розовые)
export function makeMeatTexture(size = 256) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), rng = new RNG(99);
  ctx.fillStyle = '#3a0705';
  ctx.fillRect(0, 0, size, size);
  const pal = ['#5c0d08', '#270302', '#6e150e', '#460906', '#1a0201'];
  for (let i = 0; i < 420; i++) {
    const x = rng.float(0, size), y = rng.float(0, size), r = rng.float(3, 22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rng.pick(pal);
    g.addColorStop(0, col);
    g.addColorStop(1, col + '00');
    ctx.globalAlpha = rng.float(0.3, 0.7);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.globalAlpha = 0.35;
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) { // жир/сухожилия
    ctx.strokeStyle = rng.chance(0.5) ? '#8c6b4a' : '#6b3a26';
    ctx.lineWidth = rng.float(1, 3.5);
    ctx.beginPath();
    let x = rng.float(0, size), y = rng.float(0, size);
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += rng.float(-30, 30); y += rng.float(-30, 30);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
