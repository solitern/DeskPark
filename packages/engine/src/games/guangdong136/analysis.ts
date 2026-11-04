import { Z_DRAGON_START, Z_KINDS, Z_SUIT_KINDS, Z_WIND_START, canStartChow } from './tiles';

/**
 * 136 张字牌版的手牌分析（34 种牌）。
 *
 * 共用模块 `mahjong/analysis` 以「27 种牌、每 9 种一门」为前提（顺子判断写成 `i % 9 <= 6`），
 * 直接复用会把字牌当成第 4、5 门序数牌。这里单独实现一套 34 种版本：
 * - 面子拆解、和牌判定、七对、十三幺；
 * - 向听数（三门序数牌各自搜索 + 字牌只能凑刻子/对子）；
 * - 听牌列表。
 */

export type ZSet = { type: 'pung' | 'chow'; kind: number };

export interface ZDecomp {
  pair: number;
  sets: ZSet[];
}

const total = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);

/** 枚举暗手组成 setsNeeded 个面子 + 1 将的全部拆法 */
export function standardDecomps(counts: readonly number[], setsNeeded: number): ZDecomp[] {
  if (total(counts) !== setsNeeded * 3 + 2) return [];
  const c = [...counts];
  const out: ZDecomp[] = [];
  const sets: ZSet[] = [];
  const rec = (i: number, pair: number) => {
    while (i < Z_KINDS && c[i] === 0) i++;
    if (i === Z_KINDS) {
      if (pair >= 0 && sets.length === setsNeeded) out.push({ pair, sets: [...sets] });
      return;
    }
    if (sets.length > setsNeeded) return;
    if (pair < 0 && c[i] >= 2) {
      c[i] -= 2;
      rec(i, i);
      c[i] += 2;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      sets.push({ type: 'pung', kind: i });
      rec(i, pair);
      sets.pop();
      c[i] += 3;
    }
    if (canStartChow(i) && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      sets.push({ type: 'chow', kind: i });
      rec(i, pair);
      sets.pop();
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
  };
  rec(0, -1);
  return out;
}

export function isStandardWin(counts: readonly number[], setsNeeded: number): boolean {
  if (total(counts) !== setsNeeded * 3 + 2) return false;
  const c = [...counts];
  const rec = (i: number, sets: number, hasPair: boolean): boolean => {
    while (i < Z_KINDS && c[i] === 0) i++;
    if (i === Z_KINDS) return hasPair && sets === setsNeeded;
    let ok = false;
    if (!hasPair && c[i] >= 2) {
      c[i] -= 2;
      ok = rec(i, sets, true);
      c[i] += 2;
      if (ok) return true;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      ok = rec(i, sets + 1, hasPair);
      c[i] += 3;
      if (ok) return true;
    }
    if (canStartChow(i) && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      ok = rec(i, sets + 1, hasPair);
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
    return ok;
  };
  return rec(0, 0, false);
}

/** 七对：暗手 14 张、无副露、每种牌张数为偶数（四张相同算两对） */
export function isSevenPairs(counts: readonly number[], melds: number): boolean {
  return melds === 0 && total(counts) === 14 && counts.every((n) => n % 2 === 0);
}

/** 十三幺需要的那 13 种牌：三门 1 与 9 + 四风 + 三箭 */
export const THIRTEEN_KINDS: readonly number[] = [
  0,
  8,
  9,
  17,
  18,
  26,
  Z_WIND_START,
  Z_WIND_START + 1,
  Z_WIND_START + 2,
  Z_WIND_START + 3,
  Z_DRAGON_START,
  Z_DRAGON_START + 1,
  Z_DRAGON_START + 2,
];

/** 十三幺：14 张暗手、无副露、13 种幺九字牌各至少一张 + 其中一张成对 */
export function isThirteenOrphans(counts: readonly number[], melds: number): boolean {
  if (melds !== 0 || total(counts) !== 14) return false;
  let pair = 0;
  for (let k = 0; k < Z_KINDS; k++) {
    const n = counts[k];
    if (n === 0) {
      if (THIRTEEN_KINDS.includes(k)) return false;
      continue;
    }
    if (!THIRTEEN_KINDS.includes(k) || n > 2) return false;
    if (n === 2) pair++;
  }
  return pair === 1;
}

export function isWinningShape(counts: readonly number[], melds: number): boolean {
  return (
    isStandardWin(counts, 4 - melds) ||
    isSevenPairs(counts, melds) ||
    isThirteenOrphans(counts, melds)
  );
}

// ---------------------------------------------------------------------------
// 向听数（电脑出牌与「差几向听」提示用）

type Partial = [mentsu: number, taatsu: number, pair: number];

const suitCache = new Map<string, Partial[]>();
const honorCache = new Map<string, Partial[]>();

/** 一门序数牌（9 种）拆分：刻子 / 顺子 / 对子 / 搭子 */
function suitPartials(cs: readonly number[]): Partial[] {
  const key = cs.join('');
  const hit = suitCache.get(key);
  if (hit) return hit;
  return finishPartials(key, suitCache, searchSuit(cs));
}

function searchSuit(cs: readonly number[]): Partial[] {
  const c = [...cs];
  const found = new Map<string, Partial>();
  const rec = (i: number, m: number, t: number, p: number) => {
    while (i < 9 && c[i] === 0) i++;
    if (i === 9) {
      found.set(`${m},${t},${p}`, [m, t, p]);
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      rec(i, m + 1, t, p);
      c[i] += 3;
    }
    if (i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      rec(i, m + 1, t, p);
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (p === 0) rec(i, m, t, 1);
      rec(i, m, t + 1, p);
      c[i] += 2;
    }
    if (i <= 7 && c[i + 1] > 0) {
      c[i]--;
      c[i + 1]--;
      rec(i, m, t + 1, p);
      c[i]++;
      c[i + 1]++;
    }
    if (i <= 6 && c[i + 2] > 0) {
      c[i]--;
      c[i + 2]--;
      rec(i, m, t + 1, p);
      c[i]++;
      c[i + 2]++;
    }
    c[i]--;
    rec(i, m, t, p);
    c[i]++;
  };
  rec(0, 0, 0, 0);
  return [...found.values()];
}

/** 字牌（7 种）：只能刻子 / 对子，没有顺子与搭子 */
function searchHonors(cs: readonly number[]): Partial[] {
  const c = [...cs];
  const found = new Map<string, Partial>();
  const rec = (i: number, m: number, p: number) => {
    while (i < 7 && c[i] === 0) i++;
    if (i === 7) {
      found.set(`${m},0,${p}`, [m, 0, p]);
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      rec(i, m + 1, p);
      c[i] += 3;
    }
    if (p === 0 && c[i] >= 2) {
      c[i] -= 2;
      rec(i, m, 1);
      c[i] += 2;
    }
    c[i]--;
    rec(i, m, p);
    c[i]++;
  };
  rec(0, 0, 0);
  return [...found.values()];
}

/** 只保留帕累托最优的组合，避免组合爆炸 */
function finishPartials(key: string, cache: Map<string, Partial[]>, all: Partial[]): Partial[] {
  const front = all.filter(
    (a) =>
      !all.some(
        (b) =>
          b !== a &&
          b[0] >= a[0] &&
          b[1] >= a[1] &&
          b[2] >= a[2] &&
          (b[0] > a[0] || b[1] > a[1] || b[2] > a[2]),
      ),
  );
  cache.set(key, front);
  return front;
}

function honorPartials(hs: readonly number[]): Partial[] {
  const key = hs.join('');
  const hit = honorCache.get(key);
  if (hit) return hit;
  return finishPartials(key, honorCache, searchHonors(hs));
}

/** 标准型向听数（-1 表示已和牌） */
export function shantenStandard(counts: readonly number[], melds: number): number {
  const parts = [0, 1, 2].map((s) => suitPartials(counts.slice(s * 9, s * 9 + 9)));
  const honor = honorPartials(counts.slice(Z_SUIT_KINDS));
  let best = 8;
  for (const a of parts[0])
    for (const b of parts[1])
      for (const d of parts[2])
        for (const h of honor) {
          const m = melds + a[0] + b[0] + d[0] + h[0];
          const t = Math.min(a[1] + b[1] + d[1] + h[1], Math.max(0, 4 - m));
          const p = a[2] + b[2] + d[2] + h[2] > 0 ? 1 : 0;
          const s = 8 - 2 * m - t - p;
          if (s < best) best = s;
        }
  return best;
}

export function shantenSevenPairs(counts: readonly number[]): number {
  let pairs = 0;
  for (const n of counts) pairs += Math.floor(n / 2);
  return 6 - Math.min(7, pairs);
}

export function shanten(counts: readonly number[], melds: number): number {
  const std = shantenStandard(counts, melds);
  return melds === 0 ? Math.min(std, shantenSevenPairs(counts)) : std;
}

/** 听牌：13 张（或等价张数）的暗手加入哪些牌种可以和牌 */
export function waitingKinds(
  counts: readonly number[],
  melds: number,
  allowed?: (kind: number) => boolean,
): number[] {
  const out: number[] = [];
  const c = [...counts];
  for (let k = 0; k < Z_KINDS; k++) {
    if (c[k] >= 4 || (allowed && !allowed(k))) continue;
    c[k]++;
    if (isWinningShape(c, melds)) out.push(k);
    c[k]--;
  }
  return out;
}
