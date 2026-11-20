import { KINDS } from './tiles';

/**
 * 麻将手牌分析（基于 27 种序数牌的计数数组）：
 * - 标准型（4 面子 + 1 将）全部拆法枚举，用于选番；
 * - 七对判定；
 * - 向听数（按花色分别搜索并缓存），用于电脑出牌；
 * - 听牌（等待的牌种）。
 */

export type MjSet = { type: 'pung' | 'chow'; kind: number };

export interface StdDecomp {
  pair: number;
  sets: MjSet[];
}

const total = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);

/** 枚举暗手组成 setsNeeded 个面子 + 1 将的所有拆法 */
export function standardDecomps(counts: readonly number[], setsNeeded: number): StdDecomp[] {
  if (total(counts) !== setsNeeded * 3 + 2) return [];
  const c = [...counts];
  const out: StdDecomp[] = [];
  const sets: MjSet[] = [];
  const rec = (i: number, pair: number) => {
    while (i < KINDS && c[i] === 0) i++;
    if (i === KINDS) {
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
    if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
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
    while (i < KINDS && c[i] === 0) i++;
    if (i === KINDS) return hasPair && sets === setsNeeded;
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
    if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
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

/** 七对：暗手 14 张、无副露、每种牌张数为偶数（四张相同计为两对） */
export function isSevenPairs(counts: readonly number[], melds: number): boolean {
  return melds === 0 && total(counts) === 14 && counts.every((n) => n % 2 === 0);
}

export function isWinningShape(counts: readonly number[], melds: number): boolean {
  return isStandardWin(counts, 4 - melds) || isSevenPairs(counts, melds);
}

// ---------------------------------------------------------------------------
// 向听数

type Partial = [mentsu: number, taatsu: number, pair: number];
// 按一门牌（9 种、每种 0–4 张）的计数缓存拆法；键用五进制数，比拼字符串快
const suitCache = new Map<number, Partial[]>();

function suitPartials(counts: readonly number[], off: number): Partial[] {
  let key = 0;
  for (let i = off + 8; i >= off; i--) key = key * 5 + counts[i];
  const hit = suitCache.get(key);
  if (hit) return hit;
  const c = counts.slice(off, off + 9);
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
  // 只保留帕累托最优的组合
  const all = [...found.values()];
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
  suitCache.set(key, front);
  return front;
}

/**
 * 标准型向听数（-1 表示已和牌）。
 *
 * 张数可以不足 13 − 3m（例如只保留一门的清一色计数、或去掉缺门后的手牌）：
 * 缺的面子、将要从「没用上的牌」长出来（单张变面子要 2 张、变将要 1 张）；
 * 没用上的牌不够时，每缺一个种子多要 1 张。满 13 / 14 张时这一项恒为 0，结果与常规公式相同。
 */
export function shantenStandard(counts: readonly number[], melds: number): number {
  const parts = [suitPartials(counts, 0), suitPartials(counts, 9), suitPartials(counts, 18)];
  const n = total(counts);
  let best = Infinity;
  for (const a of parts[0])
    for (const b of parts[1])
      for (const d of parts[2]) {
        const sets = a[0] + b[0] + d[0];
        const m = melds + sets;
        const t = Math.min(a[1] + b[1] + d[1], Math.max(0, 4 - m));
        const p = a[2] + b[2] + d[2] > 0 ? 1 : 0;
        const free = n - 3 * sets - 2 * t - 2 * p;
        const seeds = Math.max(0, 4 - m - t) + (1 - p);
        const s = 8 - 2 * m - t - p + Math.max(0, seeds - free);
        if (s < best) best = s;
      }
  return best;
}

/** 七对向听：缺的对子要从单张长出来，单张不够时每缺一张多要 1 张（四张相同算两对） */
export function shantenSevenPairs(counts: readonly number[]): number {
  let pairs = 0;
  let singles = 0;
  for (const n of counts) {
    pairs += n >> 1;
    singles += n & 1;
  }
  pairs = Math.min(7, pairs);
  return 6 - pairs + Math.max(0, 7 - pairs - singles);
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
  for (let k = 0; k < KINDS; k++) {
    if (c[k] >= 4 || (allowed && !allowed(k))) continue;
    c[k]++;
    if (isWinningShape(c, melds)) out.push(k);
    c[k]--;
  }
  return out;
}
