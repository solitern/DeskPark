import type { MjSuit } from '../../../mahjong/tiles';
import { KINDS, MJ_SUITS, kindOf, kindRank, kindSuit } from '../../../mahjong/tiles';
import type { ScView } from '../index';

/**
 * 对手模型的输入特征：只用观察者 view 里看得到的、关于某个对手 o 的公开信息。
 * 训练数据生成（scripts/gen-sc-opp-data.ts）和导师运行时用同一份代码，保证两边一致。
 *
 * 为了利用对称性，牌种按「规范顺序」排列：o 的两门非缺门在前（按万、条、筒的原顺序），缺门放最后。
 * 训练时再随机交换两门非缺门、把 1–9 镜像成 9–1 做数据增强（川麻规则对这两种变换是对称的）。
 */

export const OPP_FEATURE_VERSION = 1;
/** 每种牌的特征块数 */
export const OPP_KIND_BLOCKS = 7;
export const OPP_SCALARS = 9;
export const OPP_FEATURES = OPP_KIND_BLOCKS * KINDS + OPP_SCALARS;

/** o 的规范花色顺序：两门非缺门 + 缺门 */
export function canonicalSuits(que: MjSuit): MjSuit[] {
  return [...MJ_SUITS.filter((s) => s !== que), que];
}

/** 原牌种 → 规范顺序里的下标 */
export function toCanon(kind: number, order: readonly MjSuit[]): number {
  return order.indexOf(kindSuit(kind)) * 9 + kindRank(kind) - 1;
}

/** 观察者 view 里，对手 o 的特征；o 还没定缺（或已胡）时返回 null */
export function oppFeatures(v: ScView, o: number): Float32Array | null {
  const p = v.players[o];
  if (!p.que || p.won) return null;
  const order = canonicalSuits(p.que);
  const f = new Float32Array(OPP_FEATURES);
  const at = (block: number, kind: number) => block * KINDS + toCanon(kind, order);
  const river = p.river.map((r) => kindOf(r.tile));
  const n = river.length;
  river.forEach((k, i) => {
    f[at(0, k)] += 0.25; // 全部弃牌
    if (i < 6)
      f[at(1, k)] += 0.25; // 前 6 张
    else if (i < 12)
      f[at(2, k)] += 0.25; // 第 7–12 张
    else f[at(3, k)] += 0.25; // 之后
    if (i >= n - 4) f[at(4, k)] += 0.25; // 最近 4 张
  });
  for (const m of p.melds) f[at(5, m.kind)] = m.type === 'kong' ? 1 : 0.75;
  for (let k = 0; k < KINDS; k++) f[at(6, k)] = v.visible[k] / 4;
  // 标量
  const base = OPP_KIND_BLOCKS * KINDS;
  const queDiscards = river.filter((k) => kindSuit(k) === p.que);
  let lastQue = -1;
  river.forEach((k, i) => {
    if (kindSuit(k) === p.que) lastQue = i;
  });
  const last = p.river.at(-1)?.tile;
  f[base + 0] = n / 24;
  f[base + 1] = p.melds.length / 4;
  f[base + 2] = p.melds.filter((m) => m.type === 'kong').length / 4;
  f[base + 3] = v.wallCount / 56;
  f[base + 4] = v.players.filter((x) => !x.won).length / 4;
  f[base + 5] = last && last.suit !== p.que ? 1 : 0; // 手里确定没有缺门
  f[base + 6] = queDiscards.length / 6;
  f[base + 7] = (lastQue + 1) / 20; // 缺门在第几巡打完
  f[base + 8] = o === v.dealer ? 1 : 0;
  return f;
}
