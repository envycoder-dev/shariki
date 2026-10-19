// Типы зомби: характеристики, варианты телосложения и палитры одежды.
import { computeJoints } from './rig.js';
import { RNG } from '../core/noise.js';

export const TYPES = {
  walker: { name: 'Ходок', hp: 100, speed: [0.8, 1.25], turn: 2.6, reach: 1.35, dmg: 13, score: 100, radius: 0.36, eye: 0xffe2a0, variants: ['walker_a', 'walker_b', 'walker_c', 'walker_d'] },
  runner: { name: 'Бегун', hp: 70, speed: [4.2, 5.2], turn: 5.5, reach: 1.45, dmg: 9, score: 130, radius: 0.34, eye: 0xff5a36, variants: ['runner_a', 'runner_b'] },
  crawler: { name: 'Ползун', hp: 60, speed: [0.95, 1.3], turn: 2.2, reach: 1.2, dmg: 8, score: 90, radius: 0.42, eye: 0xffd27a, variants: ['walker_a', 'walker_c', 'walker_d', 'runner_b'], legless: true },
  brute: { name: 'Громила', hp: 700, speed: [1.15, 1.35], turn: 1.6, reach: 2.25, dmg: 32, score: 500, radius: 0.62, eye: 0xffa030, variants: ['brute'] },
  spitter: { name: 'Плевун', hp: 90, speed: [1.4, 1.7], turn: 3.0, reach: 1.3, dmg: 10, score: 160, radius: 0.34, eye: 0x9dff4f, variants: ['spitter'] },
  bloater: { name: 'Толстяк', hp: 170, speed: [0.95, 1.15], turn: 1.8, reach: 1.75, dmg: 40, score: 150, radius: 0.55, eye: 0xd8ff6a, variants: ['bloater'] },
  boss: { name: 'Мясник', hp: 4000, speed: [1.45, 1.6], turn: 1.8, reach: 2.9, dmg: 42, score: 3000, radius: 0.85, eye: 0xff2a14, variants: ['boss'] },
};

const BASE = {
  H: 1, legLen: 1, torsoLen: 1, armLen: 1, neckLen: 1, headSize: 1, shoulderW: 1, hipW: 1,
  thick: 1, limb: 1, muscle: 1, belly: 0, bust: 0, neckW: 1, jawW: 1, mouthW: 1, handSize: 1, fingerW: 1,
  curl: 0.55, noseMissing: false, jawMissing: false, earMissing: null, eyeMissing: null,
  hair: 'short', shirt: 'short', pants: 'long', shoes: 'shoes', tear: 0.5,
  wounds: [], craters: [], ribs: null, pustules: null, thin: false, gloves: false,
};

// раны/выемки ставим относительно суставов конкретного телосложения
function place(spec, fn) {
  const R = computeJoints(spec);
  fn(R, spec);
  return spec;
}

export const VARIANTS = {
  walker_a: () => place({ ...BASE, seed: 11, shirt: 'long', tear: 0.55, curl: 0.6 }, (R, s) => {
    s.wounds = [{ c: [0.05, R.neckY + 0.03, 0.04], r: 0.05 }, { c: [0.12, R.chestY - 0.05, 0.1], r: 0.06 }, { c: [-0.2, R.shY - 0.1, 0.0], r: 0.045 }];
  }),
  walker_b: () => place({ ...BASE, seed: 23, H: 0.95, bust: 0.75, shoulderW: 0.9, hipW: 1.06, thick: 0.9, limb: 0.86, muscle: 0.85, headSize: 0.96, neckW: 0.85, jawW: 0.9, hair: 'long', shirt: 'tank', tear: 0.45, handSize: 0.9, fingerW: 0.85, curl: 0.7 }, (R, s) => {
    s.wounds = [{ c: [0.38, R.shY - 0.24, 0.0], r: 0.05 }, { c: [-0.06, R.spineY, 0.11], r: 0.07 }, { c: [0.0, R.headY + 0.04, 0.09], r: 0.035 }];
  }),
  walker_c: () => place({ ...BASE, seed: 37, H: 0.98, belly: 0.7, thick: 1.15, limb: 1.05, muscle: 0.95, shoulderW: 1.05, neckW: 1.2, hair: 'patchy', shirt: 'tank', shoes: 'boots', tear: 0.6, earMissing: 'R', handSize: 1.05, fingerW: 1.1 }, (R, s) => {
    s.wounds = [{ c: [-0.1, R.chestY + 0.02, 0.12], r: 0.07 }, { c: [0.13, R.kneeY + 0.2, 0.06], r: 0.06 }];
    s.craters = [{ c: [0.08, R.spineY + 0.04, 0.2], r: 0.025 }];
  }),
  walker_d: () => place({ ...BASE, seed: 41, H: 1.03, thin: true, thick: 0.82, limb: 0.8, muscle: 0.75, neckW: 0.85, hair: 'patchy', shirt: 'gown', pants: 'none', shoes: 'none', tear: 0.65, noseMissing: true, curl: 0.85, fingerW: 0.85 }, (R, s) => {
    s.ribs = { c: [0.12, R.chestY - 0.02, 0.07] };
    s.wounds = [{ c: [-0.1, R.kneeY - 0.15, 0.05], r: 0.05 }, { c: [-0.32, R.shY - 0.2, 0.0], r: 0.05 }];
  }),
  runner_a: () => place({ ...BASE, seed: 53, thick: 0.92, limb: 0.92, muscle: 1.05, shirt: 'hoodie', hair: 'short', tear: 0.4, curl: 0.5 }, (R, s) => {
    s.wounds = [{ c: [0.07, R.headY + 0.1, 0.06], r: 0.035 }, { c: [-0.1, R.spineY + 0.05, 0.12], r: 0.06 }];
  }),
  runner_b: () => place({ ...BASE, seed: 67, H: 0.94, thick: 0.86, limb: 0.84, muscle: 0.9, headSize: 1.02, shirt: 'short', pants: 'shorts', hair: 'short', tear: 0.5, eyeMissing: 'L', curl: 0.65 }, (R, s) => {
    s.wounds = [{ c: [0.1, R.kneeY - 0.1, 0.06], r: 0.06 }, { c: [0.03, R.neckY + 0.02, -0.05], r: 0.05 }];
  }),
  brute: () => place({ ...BASE, seed: 79, H: 1.22, shoulderW: 1.45, hipW: 1.15, thick: 1.42, limb: 1.45, muscle: 1.55, belly: 0.55, neckW: 1.65, headSize: 0.86, neckLen: 0.7, armLen: 1.12, legLen: 0.95, handSize: 1.35, fingerW: 1.25, hair: 'none', shirt: 'none', pants: 'overalls', shoes: 'boots', tear: 0.55, jawW: 1.15, curl: 0.45 }, (R, s) => {
    s.wounds = [{ c: [0.2, R.chestY + 0.08, 0.1], r: 0.08 }, { c: [-0.15, R.spineY, 0.2], r: 0.07 }, { c: [-0.45, R.shY - 0.15, 0.02], r: 0.07 }];
    s.craters = [{ c: [0.12, R.chestY - 0.05, 0.16], r: 0.03 }, { c: [-0.18, R.chestY + 0.1, 0.12], r: 0.025 }];
  }),
  spitter: () => place({ ...BASE, seed: 83, H: 1.02, thin: true, thick: 0.78, limb: 0.74, muscle: 0.7, neckLen: 1.9, neckW: 0.78, headSize: 1.03, jawW: 1.15, mouthW: 1.4, armLen: 1.12, shirt: 'none', pants: 'long', shoes: 'none', hair: 'patchy', tear: 0.75, curl: 0.85, fingerW: 0.8 }, (R, s) => {
    s.ribs = { c: [-0.11, R.chestY, 0.08] };
    s.wounds = [{ c: [0.0, R.neckY + 0.06, 0.05], r: 0.05 }, { c: [0.09, R.spineY, 0.1], r: 0.05 }];
  }),
  bloater: () => place({ ...BASE, seed: 97, belly: 2.3, thick: 1.25, limb: 1.15, muscle: 0.9, neckW: 1.35, headSize: 0.94, shoulderW: 1.1, hipW: 1.15, hair: 'none', shirt: 'short', tear: 0.85, eyeMissing: 'R', handSize: 1.1, fingerW: 1.2 }, (R, s) => {
    const rng = new RNG(5);
    s.pustules = [];
    for (let i = 0; i < 13; i++) {
      const a = rng.range(-1.2, 1.2), y = R.spineY + rng.range(-0.12, 0.2);
      const rad = 0.3 * Math.cos((y - R.spineY - 0.05) * 3);
      s.pustules.push({ c: [Math.sin(a) * rad * 0.95, y, 0.17 + Math.cos(a) * rad * 1.05], r: rng.range(0.022, 0.045) });
    }
    s.wounds = [{ c: [0.0, R.chestY + 0.05, 0.14], r: 0.06 }];
  }),
  boss: () => place({ ...BASE, seed: 101, H: 1.36, shoulderW: 1.5, hipW: 1.2, thick: 1.5, limb: 1.5, muscle: 1.6, belly: 0.8, neckW: 1.7, headSize: 0.84, neckLen: 0.6, armLen: 1.1, legLen: 0.95, handSize: 1.4, fingerW: 1.3, hair: 'none', shirt: 'apron', pants: 'long', shoes: 'boots', tear: 0.35, jawW: 1.2, curl: 0.4 }, (R, s) => {
    s.wounds = [{ c: [-0.22, R.chestY + 0.12, 0.12], r: 0.09 }, { c: [0.5, R.shY - 0.2, 0.0], r: 0.08 }];
    s.craters = [{ c: [0.1, R.spineY + 0.08, 0.26], r: 0.03 }];
  }),
};

// палитры (мёртвая серо-зелёная кожа, грязная одежда)
const SKINS = [[0x8a9479, 0x5f6a55], [0x99a08f, 0x6f7564], [0x7a8873, 0x55634d], [0xa09886, 0x776c5c], [0x84907a, 0x5a6553], [0x726c5f, 0x4c463c], [0x8e8a7c, 0x6a5a50]];
const SHIRTS = [
  { shirt: 0x6e1c17, shirt2: 0x24170f, pattern: 1 }, { shirt: 0x2f4059, pattern: 0 }, { shirt: 0x9c968a, pattern: 0 },
  { shirt: 0x545658, pattern: 0 }, { shirt: 0x394530, pattern: 0 }, { shirt: 0x1d2737, pattern: 0 },
  { shirt: 0x2d4a63, shirt2: 0x8a8a80, pattern: 2 }, { shirt: 0x7a6a2e, pattern: 0 }, { shirt: 0x4a2a52, pattern: 0 },
];
const GOWNS = [{ shirt: 0x7a948f, pattern: 0 }, { shirt: 0x8d9aa5, shirt2: 0x6d7a85, pattern: 2 }];
const HOODIES = [{ shirt: 0x2b3038, pattern: 0 }, { shirt: 0x5a2420, pattern: 0 }, { shirt: 0x384030, pattern: 0 }, { shirt: 0x24344a, pattern: 0 }];
const PANTS = [0x2a3850, 0x22252a, 0x5f5440, 0x463626, 0x434548, 0x1f2c40];
const SHOES = [0x1b1916, 0x3a2b1f, 0x55504a, 0x2a2420];
const HAIR = [0x17130f, 0x35271a, 0x5e4f38, 0x494846, 0x2a1c12];

export function rollColors(variantId, type, rng) {
  const sk = rng.pick(SKINS);
  let top = rng.pick(SHIRTS);
  if (variantId === 'walker_d') top = rng.pick(GOWNS);
  if (variantId === 'runner_a') top = rng.pick(HOODIES);
  if (variantId === 'boss') top = { shirt: 0x3b2618, pattern: 0 };
  const c = {
    skin: sk[0], skin2: sk[1], ...top,
    pants: variantId === 'brute' ? rng.pick([0x30425a, 0x3d4a2e, 0x5a4a30]) : rng.pick(PANTS),
    shoes: rng.pick(SHOES), hair: rng.pick(HAIR),
    rot: rng.range(0.35, 0.9), blood: rng.range(0.35, 0.85), seed: rng.range(0, 50),
  };
  if (type === 'bloater') c.glow = 0x6cff2a;
  if (type === 'spitter') { c.skin = 0x8c9a6a; c.skin2 = 0x5d6b40; c.rot = 0.9; }
  if (type === 'boss') { c.blood = 1.0; c.skin = 0x8d8270; c.skin2 = 0x6a5a4a; }
  return c;
}
