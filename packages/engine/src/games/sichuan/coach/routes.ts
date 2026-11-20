import { shanten, shantenSevenPairs } from '../../../mahjong/analysis';
import type { MjSuit } from '../../../mahjong/tiles';
import { KINDS, MJ_SUITS, MJ_SUIT_LABEL, kindSuit } from '../../../mahjong/tiles';
import type { MeldShape } from '../scoring';

/**
 * 牌型路线（算法说明第 4.1 节）：同一手牌可以朝平胡、对对胡、七对、清一色等方向做，
 * 每条路线有自己的向听数、有效进张和保底番。导师对每条路线分别估期望，取最高的。
 *
 * 「不属于这条路线的牌」（缺门、做清一色时的另一门）都要打掉，记为废牌 junk：
 * 路线向听至少是废牌张数，摸到路线内的牌时会顶替掉一张废牌。
 */

export type RouteId = 'normal' | 'duidui' | 'qidui' | 'flush' | 'flushDuidui' | 'flushQidui';

export interface Route {
  id: RouteId;
  /** 清一色路线的花色 */
  suit: MjSuit | null;
  /** 给人看的名字：平胡、对对胡、七对、清一色·万、清对·万、清七对·万 */
  name: string;
  /** 查哪张胡牌概率表 */
  table: 'std' | 'qidui';
  shanten: number;
  /** 有效进张：张数与种类 */
  ukeire: number;
  ukeireKinds: number[];
  /** 保底番：牌型番 + 已有的根 */
  fan: number;
  /** 这条路线必须打掉的牌（按种类，一张一项） */
  junk: number[];
  /** 还有机会凑成根的牌种：手里 3 张、或已碰而手里没有 */
  rootChances: number[];
  /** 路线内的计数（废牌已去掉） */
  counts: number[];
}

/** 对对胡向听：K 组刻子（含碰杠），对子补成刻子要 1 张，单张要 2 张；种子不够时每缺一个多要 1 张 */
export function duiduiShanten(c: readonly number[], melds: number): number {
  let k3 = melds;
  let pairs = 0;
  let singles = 0;
  for (const n of c) {
    if (n >= 3) k3++;
    else if (n === 2) pairs++;
    else if (n === 1) singles++;
  }
  k3 = Math.min(5, k3);
  const groups = 5 - k3;
  const p = Math.min(pairs, groups);
  return 8 - 2 * k3 - p + Math.max(0, groups - p - singles);
}

const SHAPE: Record<RouteId, (c: readonly number[], m: number) => number> = {
  normal: (c, m) => shanten(c, m),
  duidui: (c, m) => duiduiShanten(c, m),
  qidui: (c) => shantenSevenPairs(c),
  flush: (c, m) => shanten(c, m),
  flushDuidui: (c, m) => duiduiShanten(c, m),
  flushQidui: (c) => shantenSevenPairs(c),
};

/** 保底牌型番（不含根） */
const BASE_FAN: Record<RouteId, number> = {
  normal: 1,
  duidui: 2,
  qidui: 3,
  flush: 3,
  flushDuidui: 4,
  flushQidui: 4,
};

const NAME: Record<RouteId, string> = {
  normal: '平胡',
  duidui: '对对胡',
  qidui: '七对',
  flush: '清一色',
  flushDuidui: '清对',
  flushQidui: '清七对',
};

export interface RouteInput {
  /** 暗手计数（含缺门） */
  concealed: readonly number[];
  melds: readonly MeldShape[];
  que: MjSuit | null;
  /** 每种牌还能摸到的张数 */
  left: readonly number[];
}

/** 计算一条路线；不适用时返回 null */
export function routeOf(input: RouteInput, id: RouteId, suit: MjSuit | null = null): Route | null {
  const { concealed, melds, que, left } = input;
  const m = melds.length;
  const flush = id === 'flush' || id === 'flushDuidui' || id === 'flushQidui';
  const qidui = id === 'qidui' || id === 'flushQidui';
  if (qidui && m > 0) return null;
  if (flush) {
    if (!suit || suit === que) return null;
    if (melds.some((x) => kindSuit(x.kind) !== suit)) return null;
  }
  const allowed = (k: number) => (flush ? kindSuit(k) === suit : kindSuit(k) !== que);
  const c = new Array<number>(KINDS).fill(0);
  const junk: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if (allowed(k)) c[k] = concealed[k];
    else for (let i = 0; i < concealed[k]; i++) junk.push(k);
  }
  const shape = SHAPE[id];
  const J = junk.length;
  const s = Math.max(shape(c, m), J);
  // 有效进张：摸到这张以后路线向听下降（有废牌时，这张顶替一张废牌）
  let u = 0;
  const kinds: number[] = [];
  const floor = J > 0 ? J - 1 : -Infinity;
  for (let k = 0; k < KINDS; k++) {
    if (!allowed(k) || left[k] <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (Math.max(shape(c, m), floor) < s) {
      u += left[k];
      kinds.push(k);
    }
    c[k]--;
  }
  // 根：和牌时（暗手 + 副露）四张相同的牌种
  const combined = [...c];
  for (const x of melds) combined[x.kind] += x.type === 'kong' ? 4 : 3;
  let roots = 0;
  for (let k = 0; k < KINDS; k++) if (combined[k] === 4) roots++;
  const rootChances: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if (!allowed(k)) continue;
    const pung = melds.some((x) => x.type === 'pung' && x.kind === k);
    if ((c[k] === 3 && !pung) || (pung && c[k] === 0)) rootChances.push(k);
  }
  return {
    id,
    suit: flush ? suit : null,
    name: flush ? `${NAME[id]}·${MJ_SUIT_LABEL[suit!]}` : NAME[id],
    table: qidui ? 'qidui' : 'std',
    shanten: s,
    ukeire: u,
    ukeireKinds: kinds,
    fan: BASE_FAN[id] + roots,
    junk,
    rootChances,
    counts: c,
  };
}

/** 一手牌（13 张或碰杠后的等价张数）所有适用的路线 */
export function routesOf(input: RouteInput): Route[] {
  const out: Route[] = [];
  for (const id of ['normal', 'duidui', 'qidui'] as const) {
    const r = routeOf(input, id);
    if (r) out.push(r);
  }
  for (const suit of MJ_SUITS) {
    if (suit === input.que) continue;
    for (const id of ['flush', 'flushDuidui', 'flushQidui'] as const) {
      const r = routeOf(input, id, suit);
      if (r) out.push(r);
    }
  }
  return out;
}
