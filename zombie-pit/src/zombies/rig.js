// Скелет зомби: список костей, иерархия, поза (плоский Float32Array) и применение позы к костям.
// Анимации задаются в «канонических» осях модели (X — влево, Y — вверх, Z — вперёд) для позы «руки опущены».
// rotX+: корпус/голова наклоняются вперёд; конечность (смотрит вниз) уходит назад → для шага вперёд rotX−.
// rotZ+: левая рука/нога отводится наружу (для правой — rotZ−). rotY+: поворот влево.
import * as THREE from 'three';

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'headTop',
  'clavL', 'armL', 'foreL', 'handL', 'handEndL',
  'clavR', 'armR', 'foreR', 'handR', 'handEndR',
  'thighL', 'shinL', 'footL', 'toeL',
  'thighR', 'shinR', 'footR', 'toeR',
];
export const PARENT = [-1, 0, 1, 2, 3, 4, 5, 5, 3, 8, 9, 10, 11, 3, 13, 14, 15, 16, 1, 18, 19, 20, 1, 22, 23, 24];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
export const NB = BONES.length;

// слоты позы: [кости × 3 угла] [смещение таза ×3] [смещение корня ×3] [поворот корня ×3]
export const HIPS_P = NB * 3;
export const ROOT_P = HIPS_P + 3;
export const ROOT_R = ROOT_P + 3;
export const POSE_SIZE = ROOT_R + 3;

export const newPose = () => new Float32Array(POSE_SIZE);

export function lerpPose(out, a, b, t) {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** позиции суставов (bind-поза, A-поза рук под 45°) из параметров тела */
export function computeJoints(s) {
  const H = s.H, L = s.legLen, T = s.torsoLen;
  const J = {};
  const ankleY = 0.085 * H;
  const kneeY = ankleY + 0.42 * H * L;
  const hipY = kneeY + 0.43 * H * L;
  const hipsY = hipY + 0.035 * H;
  const spineY = hipsY + 0.12 * H * T;
  const chestY = spineY + 0.19 * H * T;
  const neckY = chestY + 0.19 * H * T;
  const headY = neckY + 0.1 * H * s.neckLen;
  const hs = H * s.headSize;
  const legX = 0.108 * H * s.hipW;
  J.root = [0, 0, 0];
  J.hips = [0, hipsY, 0];
  J.spine = [0, spineY, 0.005 * H];
  J.chest = [0, chestY, 0];
  J.neck = [0, neckY, -0.015 * H];
  J.head = [0, headY, 0];
  J.jaw = [0, headY + 0.062 * hs, 0.012 * hs];
  J.headTop = [0, headY + 0.205 * hs, 0];
  const shY = neckY - 0.035 * H, shX = 0.18 * H * s.shoulderW;
  const ua = 0.29 * H * s.armLen, fa = 0.255 * H * s.armLen, ha = 0.17 * H * s.armLen;
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const d = [sx * Math.SQRT1_2, -Math.SQRT1_2, 0];
    const S = [sx * shX, shY, -0.012 * H];
    const E = [S[0] + d[0] * ua, S[1] + d[1] * ua, S[2]];
    const W = [E[0] + d[0] * fa, E[1] + d[1] * fa, E[2]];
    J['clav' + side] = [sx * 0.025 * H, neckY - 0.04 * H, 0.01 * H];
    J['arm' + side] = S; J['fore' + side] = E; J['hand' + side] = W;
    J['handEnd' + side] = [W[0] + d[0] * ha, W[1] + d[1] * ha, W[2]];
    J['thigh' + side] = [sx * legX, hipY, 0];
    J['shin' + side] = [sx * legX, kneeY, 0.012 * H];
    J['foot' + side] = [sx * legX, ankleY, -0.012 * H];
    J['toe' + side] = [sx * legX, 0.02 * H, 0.16 * H];
  }
  return { J, ankleY, kneeY, hipY, hipsY, spineY, chestY, neckY, headY, hs, shX, shY, legX, ua, fa, ha };
}

/** кости для экземпляра: Bone-объекты с локальными смещениями bind-позы */
export function createBones(J) {
  const bones = BONES.map((name) => { const b = new THREE.Bone(); b.name = name; return b; });
  for (let i = 0; i < NB; i++) {
    const p = J[BONES[i]], pp = PARENT[i] >= 0 ? J[BONES[PARENT[i]]] : [0, 0, 0];
    bones[i].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (PARENT[i] >= 0) bones[PARENT[i]].add(bones[i]);
  }
  return bones;
}

/** обратные bind-матрицы (кости в пространстве модели, без поворотов) */
export function boneInverses(J) {
  return BONES.map((n) => new THREE.Matrix4().makeTranslation(-J[n][0], -J[n][1], -J[n][2]));
}

// A-поза → «руки вниз»: поворот плеча вокруг Z; для предплечья/кисти — сопряжение
const qOffL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 4);
const qOffR = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
const qOffLi = qOffL.clone().invert(), qOffRi = qOffR.clone().invert();
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
const ARM_UP = new Set([B.armL, B.armR]);
const ARM_LOW = new Set([B.foreL, B.handL, B.foreR, B.handR]);
const LEFT = new Set([B.armL, B.foreL, B.handL]);

export function applyPose(bones, pose, rest) {
  for (let i = 1; i < NB; i++) {
    const bone = bones[i];
    _e.set(pose[i * 3], pose[i * 3 + 1], pose[i * 3 + 2], 'XYZ');
    _q.setFromEuler(_e);
    if (ARM_UP.has(i)) {
      bone.quaternion.multiplyQuaternions(_q, LEFT.has(i) ? qOffL : qOffR);
    } else if (ARM_LOW.has(i)) {
      const l = LEFT.has(i);
      bone.quaternion.multiplyQuaternions(l ? qOffLi : qOffRi, _q).multiply(l ? qOffL : qOffR);
    } else {
      bone.quaternion.copy(_q);
    }
  }
  const root = bones[0];
  root.position.set(pose[ROOT_P], pose[ROOT_P + 1], pose[ROOT_P + 2]);
  _e.set(pose[ROOT_R], pose[ROOT_R + 1], pose[ROOT_R + 2], 'YXZ');
  root.quaternion.setFromEuler(_e);
  const hp = rest.hips;
  bones[B.hips].position.set(hp[0] + pose[HIPS_P], hp[1] + pose[HIPS_P + 1], hp[2] + pose[HIPS_P + 2]);
}
