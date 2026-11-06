import { KINDS, isHonor } from '../../mahjong/tiles136';
import { splitJokers, total, winWithJokers } from '../../mahjong/analysis136';

export * from '../../mahjong/analysis136';

/**
 * 遂昌麻将特有牌型：不搭（十三烂类）与爆头。
 *
 * - 不搭：14 张、无副露，所有牌种类互不相同，同一门任意两张点数差 >= 3，字牌互不相同；
 *   普通不搭 = 平胡；特殊不搭 = 5 张字牌 + 三门各 3 张且每门恰为 147 / 258 / 369。
 * - 爆头：手上是 4 组面子 + 1 张财神（财神做将），听所有牌；只能自摸。
 */

export type BuDaClass = 'ordinary' | 'regular' | 'luxury' | 'ultra';

export const BUDA_FAN: Record<BuDaClass, number> = {
  ordinary: 0,
  regular: 1,
  luxury: 2,
  ultra: 3,
};

export const BUDA_NAME: Record<BuDaClass, string> = {
  ordinary: '不搭',
  regular: '正规不搭',
  luxury: '豪华不搭',
  ultra: '超豪华不搭',
};

const PATTERNS = [
  [1, 4, 7],
  [2, 5, 8],
  [3, 6, 9],
];
const patternKey = (p: number[]) => p.join('');

export const isNumberKind = (kind: number) => kind < 27;

/** 普通不搭：无重复、同门点数差 >= 3，财神补缺 */
export function ordinaryBuDa(
  counts: readonly number[],
  jokerKind: number | null,
): boolean {
  const { real, jokers } = splitJokers(counts, jokerKind);
  if (total(real) + jokers !== 14) return false;
  for (let k = 0; k < KINDS; k++) if (real[k] > 1) return false;
  // 已有的牌本身不能是搭子
  for (let s = 0; s < 3; s++) {
    const ranks: number[] = [];
    for (let r = 1; r <= 9; r++) if (real[s * 9 + r - 1] > 0) ranks.push(r);
    for (let a = 0; a < ranks.length; a++)
      for (let b = a + 1; b < ranks.length; b++)
        if (Math.abs(ranks[a] - ranks[b]) < 3) return false;
  }
  // 财神可以补的位置
  const allowed: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if (real[k] > 0) continue;
    if (isHonor(k)) {
      allowed.push(k);
      continue;
    }
    const suit = Math.floor(k / 9);
    const rank = (k % 9) + 1;
    let ok = true;
    for (let r = 1; r <= 9; r++) {
      if (real[suit * 9 + r - 1] > 0 && Math.abs(r - rank) < 3) {
        ok = false;
        break;
      }
    }
    if (ok) allowed.push(k);
  }
  if (allowed.length < jokers) return false;
  const chosen: number[] = [];
  const dfs = (start: number, need: number): boolean => {
    if (need === 0) return true;
    for (let idx = start; idx <= allowed.length - need; idx++) {
      const k = allowed[idx];
      let ok = true;
      for (const ck of chosen) {
        if (ck === k) {
          ok = false;
          break;
        }
        if (!isHonor(k) && !isHonor(ck)) {
          if (Math.floor(k / 9) === Math.floor(ck / 9) && Math.abs((k % 9) - (ck % 9)) < 3) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      chosen.push(k);
      if (dfs(idx + 1, need - 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return dfs(0, jokers);
}

/** 特殊不搭：5 张字牌 + 三门各 3 张，每门恰为 147/258/369；返回最高档 */
export function specialBuDa(
  counts: readonly number[],
  jokerKind: number | null,
): BuDaClass | null {
  const { real, jokers } = splitJokers(counts, jokerKind);
  if (total(real) + jokers !== 14) return null;
  for (let k = 0; k < KINDS; k++) if (real[k] > 1) return null;
  let honorCount = 0;
  for (let k = 27; k < KINDS; k++) if (real[k] > 0) honorCount++;
  if (honorCount > 5) return null;
  const needHonors = 5 - honorCount;
  let best: BuDaClass | null = null;
  for (const p0 of PATTERNS)
    for (const p1 of PATTERNS)
      for (const p2 of PATTERNS) {
        const pats = [p0, p1, p2];
        let missing = needHonors;
        let possible = true;
        for (let s = 0; s < 3; s++) {
          const pat = pats[s];
          let cnt = 0;
          for (let r = 1; r <= 9; r++) {
            if (real[s * 9 + r - 1] === 0) continue;
            if (!pat.includes(r)) {
              possible = false;
              break;
            }
            cnt++;
          }
          if (!possible) break;
          missing += 3 - cnt;
        }
        if (!possible || missing !== jokers) continue;
        const ids = [patternKey(p0), patternKey(p1), patternKey(p2)];
        const same = ids.filter((x) => x === ids[0]).length;
        const cls: BuDaClass = same === 3 ? 'ultra' : same === 2 ? 'regular' : 'luxury';
        if (!best || BUDA_FAN[cls] > BUDA_FAN[best]) best = cls;
      }
  return best;
}

/** 无副露时的不搭判定（普通或特殊，取最高档） */
export function nonMeldWin(
  counts: readonly number[],
  jokerKind: number | null,
): BuDaClass | null {
  const special = specialBuDa(counts, jokerKind);
  if (special) return special;
  return ordinaryBuDa(counts, jokerKind) ? 'ordinary' : null;
}

/** 只看面子（不含将）：财神可以补位 */
export function allSets(
  counts: readonly number[],
  jokerKind: number | null,
  setsNeeded: number,
): boolean {
  const { real, jokers } = splitJokers(counts, jokerKind);
  if (total(real) + jokers !== setsNeeded * 3) return false;
  const c = real;
  const memo = new Map<string, boolean>();
  const rec = (from: number, left: number): boolean => {
    let i = from;
    while (i < KINDS && c[i] === 0) i++;
    if (i === KINDS) return left % 3 === 0;
    const key = `${i},${left}|${c.slice(i).join('')}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    // 刻子
    for (let use = Math.min(3, c[i]); use >= 1 && !ok; use--) {
      const need = 3 - use;
      if (need > left) continue;
      c[i] -= use;
      ok = rec(i, left - need);
      c[i] += use;
    }
    // 顺子：最小真实牌可能落在顺子的任意位置
    if (!ok && isNumberKind(i)) {
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
          ok = rec(i, left - need);
          for (const k of used) c[k]++;
          c[i]++;
        }
      }
    }
    memo.set(key, ok);
    return ok;
  };
  return rec(0, jokers);
}

/** 13 张手牌是不是「爆头」的听牌形：去掉一张财神后正好是 4 组面子 */
export function explosiveWait(
  counts: readonly number[],
  jokerKind: number | null,
  melds: number,
): boolean {
  if (jokerKind === null) return false;
  const c = [...counts];
  if (c[jokerKind] === 0) return false;
  c[jokerKind]--;
  return allSets(c, jokerKind, 4 - melds);
}

/** 14 张（或加副露）是否和牌：标准型 / 七对 / 不搭 */
export function isWin14(
  counts: readonly number[],
  jokerKind: number | null,
  melds: number,
): boolean {
  if (winWithJokers(counts, jokerKind, 4 - melds)) return true;
  return melds === 0 && !!nonMeldWin(counts, jokerKind);
}

/** 听牌：再进哪些牌可以和牌（含不搭与爆头） */
export function waits(
  counts: readonly number[],
  jokerKind: number | null,
  melds: number,
): number[] {
  const out: number[] = [];
  if (explosiveWait(counts, jokerKind, melds)) {
    for (let k = 0; k < KINDS; k++) if (counts[k] < 4) out.push(k);
    return out;
  }
  for (let k = 0; k < KINDS; k++) {
    if (counts[k] >= 4) continue;
    const c = [...counts];
    c[k]++;
    if (isWin14(c, jokerKind, melds)) out.push(k);
  }
  return out;
}
