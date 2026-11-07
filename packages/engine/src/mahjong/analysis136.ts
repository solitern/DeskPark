import { HONOR_START, KINDS } from './tiles136';

/**
 * 136 张麻将（34 种牌 + 财神当万能牌）的手牌分析，杭州麻将与遂昌麻将共用。
 *
 * - 标准型（4 面子 + 1 将）与七对判定；财神可以代替任意牌参与和牌；
 * - 碰碰胡判定（所有面子都是刻子）；
 * - 向听数与听牌（电脑与界面提示用）。
 *
 * 财神的和牌判定用「锚定搜索」：按最小的真实牌依次确定它所在的面子，
 * 缺的位置用财神补，剩下的财神必须能自己凑成完整的刻子 / 将。
 */

export type MjSet = { type: 'pung' | 'chow'; kind: number };

export interface StdDecomp {
  pair: number;
  sets: MjSet[];
}

export const total = (c: readonly number[]): number => c.reduce((a, b) => a + b, 0);

const isNumber = (kind: number) => kind < HONOR_START;

/** 枚举暗手组成 setsNeeded 个面子 + 1 将的所有拆法（字牌不能吃） */
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
    if (isNumber(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
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
    if (isNumber(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
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

// ---------------------------------------------------------------------------
// 财神（万能牌）

/** 财神：单个种类、多个种类（如遂昌麻将的翻牌 + 白板）或没有 */
export type JokerSpec = number | readonly number[] | null;

export function jokerList(spec: JokerSpec): number[] {
  if (spec === null) return [];
  return typeof spec === 'number' ? [spec] : [...spec];
}

export function hasJokers(spec: JokerSpec): boolean {
  return jokerList(spec).length > 0;
}

/** 去掉财神后的真实牌计数；同时返回财神张数 */
export function splitJokers(
  counts: readonly number[],
  spec: JokerSpec,
): { real: number[]; jokers: number } {
  const real = [...counts];
  let jokers = 0;
  for (const k of jokerList(spec)) {
    jokers += real[k];
    real[k] = 0;
  }
  return { real, jokers };
}

/** 标准型（4 面子 + 1 将）和牌：real 为真实牌计数，jokers 为万能牌张数 */
export function standardWinRaw(
  real: readonly number[],
  jokers: number,
  setsNeeded: number,
): boolean {
  const c = [...real];
  if (total(c) + jokers !== setsNeeded * 3 + 2) return false;
  const memo = new Map<string, boolean>();
  const rec = (from: number, sets: number, pair: boolean, left: number): boolean => {
    let i = from;
    while (i < KINDS && c[i] === 0) i++;
    if (i === KINDS) return left === (setsNeeded - sets) * 3 + (pair ? 0 : 2);
    if (sets > setsNeeded) return false;
    const key = `${i},${sets},${pair ? 1 : 0},${left}|${c.slice(i).join('')}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;

    // 将：这一种牌出 1~2 张，不够的用财神补
    if (!pair) {
      for (let use = Math.min(2, c[i]); use >= 1 && !ok; use--) {
        const need = 2 - use;
        if (need > left) continue;
        c[i] -= use;
        ok = rec(i, sets, true, left - need);
        c[i] += use;
      }
    }
    // 刻子：这一种牌出 1~3 张，不够的用财神补
    for (let use = Math.min(3, c[i]); use >= 1 && !ok; use--) {
      const need = 3 - use;
      if (need > left) continue;
      c[i] -= use;
      ok = rec(i, sets + 1, pair, left - need);
      c[i] += use;
    }
    // 顺子：最小真实牌可能在顺子的任意位置，前面的位置用财神补
    if (!ok && isNumber(i)) {
      for (let shift = 0; shift <= 2 && !ok; shift++) {
        const start = i - shift;
        if (start < 0 || start % 9 > 6) continue;
        const others = [start, start + 1, start + 2].filter((k) => k !== i);
        for (let mask = 0; mask < 4 && !ok; mask++) {
          let need = 0;
          const used: number[] = [];
          for (let idx = 0; idx < others.length; idx++) {
            const k = others[idx];
            if (mask & (1 << idx) && c[k] > 0) used.push(k);
            else need++;
          }
          if (need > left) continue;
          c[i]--;
          for (const k of used) c[k]--;
          ok = rec(i, sets + 1, pair, left - need);
          for (const k of used) c[k]++;
          c[i]++;
        }
      }
    }
    memo.set(key, ok);
    return ok;
  };
  return rec(0, 0, false, jokers);
}

/** 财神当万能牌时的标准型和牌判定 */
export function standardWinWithJokers(
  counts: readonly number[],
  jokerKind: JokerSpec,
  setsNeeded: number,
): boolean {
  const { real, jokers } = splitJokers(counts, jokerKind);
  return standardWinRaw(real, jokers, setsNeeded);
}

/** 七对：real 为真实牌计数，jokers 为万能牌张数 */
export function sevenPairsRaw(real: readonly number[], jokers: number): boolean {
  if (total(real) + jokers !== 14) return false;
  let singles = 0;
  for (const n of real) if (n % 2 === 1) singles++;
  return jokers >= singles && (jokers - singles) % 2 === 0;
}

/** 财神当万能牌时的七对判定 */
export function sevenPairsWithJokers(counts: readonly number[], jokerKind: JokerSpec): boolean {
  const { real, jokers } = splitJokers(counts, jokerKind);
  return sevenPairsRaw(real, jokers);
}

/** 碰碰胡：每一组都是刻子（财神可补）；real 为真实牌计数，jokers 为万能牌张数 */
export function pungWinRaw(
  real: readonly number[],
  jokers: number,
  setsNeeded: number,
): boolean {
  if (total(real) + jokers !== setsNeeded * 3 + 2) return false;
  const memo = new Map<string, boolean>();
  /** 每个种类：自然能凑几个刻子，余下的 1~2 张用财神补成刻子或做将 */
  const rec = (k: number, sets: number, pair: boolean, left: number): boolean => {
    if (k === KINDS) return left === 0 && pair && sets === setsNeeded;
    if (sets > setsNeeded) return false;
    const key = `${k},${sets},${pair ? 1 : 0},${left}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const n = real[k];
    const p = Math.floor(n / 3);
    const r = n % 3;
    let ok: boolean;
    if (r === 0) {
      ok = rec(k + 1, sets + p, pair, left) || (!pair && left >= 2 && rec(k + 1, sets + p, true, left - 2));
    } else if (r === 1) {
      ok =
        (left >= 2 && rec(k + 1, sets + p + 1, pair, left - 2)) ||
        (!pair && left >= 1 && rec(k + 1, sets + p, true, left - 1));
    } else {
      ok =
        (!pair && rec(k + 1, sets + p, true, left)) ||
        (left >= 1 && rec(k + 1, sets + p + 1, pair, left - 1));
    }
    memo.set(key, ok);
    return ok;
  };
  return rec(0, 0, false, jokers);
}

/** 碰碰胡：每一组都是刻子（财神可补） */
export function pungWinWithJokers(
  counts: readonly number[],
  jokerKind: JokerSpec,
  setsNeeded: number,
): boolean {
  const { real, jokers } = splitJokers(counts, jokerKind);
  return pungWinRaw(real, jokers, setsNeeded);
}

/** 是否和牌（财神当万能牌） */
export function winWithJokers(
  counts: readonly number[],
  jokerKind: JokerSpec,
  setsNeeded: number,
): boolean {
  if (!hasJokers(jokerKind)) {
    return isStandardWin(counts, setsNeeded) || (setsNeeded === 4 && isSevenPairs(counts, 0));
  }
  return (
    standardWinWithJokers(counts, jokerKind, setsNeeded) ||
    (setsNeeded === 4 && sevenPairsWithJokers(counts, jokerKind))
  );
}

/** 听牌：再进哪些牌种可以和牌 */
export function waitingKinds(
  counts: readonly number[],
  jokerKind: JokerSpec,
  melds: number,
): number[] {
  const out: number[] = [];
  const setsNeeded = 4 - melds;
  for (let k = 0; k < KINDS; k++) {
    if (counts[k] >= 4) continue;
    const c = [...counts];
    c[k]++;
    if (winWithJokers(c, jokerKind, setsNeeded)) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 向听数（34 种牌）

type Partial = [mentsu: number, taatsu: number, pair: number];
const suitCache = new Map<string, Partial[]>();

function partialsOf(cs: number[], allowChow: boolean): Partial[] {
  const key = `${allowChow ? 1 : 0}:${cs.join('')}`;
  const hit = suitCache.get(key);
  if (hit) return hit;
  const c = [...cs];
  const n = cs.length;
  const found = new Map<string, Partial>();
  const rec = (i: number, m: number, t: number, p: number) => {
    while (i < n && c[i] === 0) i++;
    if (i === n) {
      found.set(`${m},${t},${p}`, [m, t, p]);
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      rec(i, m + 1, t, p);
      c[i] += 3;
    }
    if (allowChow && i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
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
    if (allowChow && i <= 7 && c[i + 1] > 0) {
      c[i]--;
      c[i + 1]--;
      rec(i, m, t + 1, p);
      c[i]++;
      c[i + 1]++;
    }
    if (allowChow && i <= 6 && c[i + 2] > 0) {
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

const shantenCache = new Map<string, number>();

/** 标准型向听数（-1 表示已和牌） */
export function shantenStandard(counts: readonly number[], melds: number): number {
  const key = `${melds}:${counts.join('')}`;
  const hit = shantenCache.get(key);
  if (hit !== undefined) return hit;
  const groups = [
    partialsOf(counts.slice(0, 9) as number[], true),
    partialsOf(counts.slice(9, 18) as number[], true),
    partialsOf(counts.slice(18, 27) as number[], true),
    partialsOf(counts.slice(27, 34) as number[], false),
  ];
  let best = 8;
  for (const a of groups[0])
    for (const b of groups[1])
      for (const d of groups[2])
        for (const e of groups[3]) {
          const m = melds + a[0] + b[0] + d[0] + e[0];
          if (m > 4) continue;
          const t = Math.min(a[1] + b[1] + d[1] + e[1], Math.max(0, 4 - m));
          const p = a[2] + b[2] + d[2] + e[2] > 0 ? 1 : 0;
          const s = 8 - 2 * m - t - p;
          if (s < best) best = s;
        }
  if (shantenCache.size > 200000) shantenCache.clear();
  shantenCache.set(key, best);
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

/** 把财神换成最合适的牌，得到一个「虚拟」的普通手牌（电脑与提示的快速估算用） */
export function assignJokers(
  counts: readonly number[],
  jokerKind: JokerSpec,
  melds: number,
): number[] {
  const { real, jokers } = splitJokers(counts, jokerKind);
  return assignJokersRaw(real, jokers, melds);
}

/** real 为真实牌计数，jokers 为万能牌张数 */
export function assignJokersRaw(
  real: readonly number[],
  jokers: number,
  melds: number,
): number[] {
  const c = [...real];
  if (jokers === 0) return c;
  const candidates: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if (c[k] === 0) continue;
    candidates.push(k);
    if (isNumber(k)) {
      const rank = k % 9;
      if (rank >= 1) candidates.push(k - 1);
      if (rank >= 2) candidates.push(k - 2);
      if (rank <= 7) candidates.push(k + 1);
      if (rank <= 6) candidates.push(k + 2);
    }
  }
  if (!candidates.length) for (let k = 0; k < KINDS; k++) candidates.push(k);
  const uniq = [...new Set(candidates)].filter((k) => c[k] < 4);
  let best = c;
  let bestS = shanten(c, melds);
  for (let step = 0; step < jokers; step++) {
    let pick = best;
    for (const k of uniq) {
      const trial = [...best];
      trial[k]++;
      const s = shanten(trial, melds);
      if (s < bestS || (s === bestS && trial[k] > pick[k])) {
        bestS = s;
        pick = trial;
      }
    }
    best = pick;
  }
  return best;
}

/** 考虑财神的向听数（估算：先把财神安排到最合适的位置，再算普通向听） */
export function shantenWithJokers(
  counts: readonly number[],
  jokerKind: JokerSpec,
  melds: number,
): number {
  const kinds = jokerList(jokerKind);
  if (!kinds.length) return shanten(counts, melds);
  if (kinds.every((k) => counts[k] === 0)) return shanten(counts, melds);
  return shanten(assignJokers(counts, jokerKind, melds), melds);
}
