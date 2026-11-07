import { KINDS, isHonor } from '../../mahjong/tiles136';
import { sevenPairsRaw, standardWinRaw, total } from '../../mahjong/analysis136';

export * from '../../mahjong/analysis136';

/**
 * 遂昌麻将特有牌型：不搭（十三烂类）、七风、敲头。
 *
 * 这里的 real 是「真实牌」的计数，jokers 是财神（万能牌）张数。
 * 注意：白板在这一轮会被当成翻出的那张牌（普通牌，例如一万），
 * 它已经算进 real 里；真正能当万能牌的只有翻出的那 3 张。
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
export function ordinaryBuDa(real: readonly number[], jokers: number): boolean {
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
export function specialBuDa(real: readonly number[], jokers: number): BuDaClass | null {
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
export function nonMeldWin(real: readonly number[], jokers: number): BuDaClass | null {
  const special = specialBuDa(real, jokers);
  if (special) return special;
  return ordinaryBuDa(real, jokers) ? 'ordinary' : null;
}

/** 7 张数牌是否是不搭形（无重复、同门差 >= 3），财神可以补位 */
function numbersBuDa(real: readonly number[], jokers: number, need: number): boolean {
  if (total(real) + jokers !== need) return false;
  for (let k = 27; k < KINDS; k++) if (real[k] > 0) return false;
  for (let k = 0; k < 27; k++) if (real[k] > 1) return false;
  for (let s = 0; s < 3; s++) {
    const ranks: number[] = [];
    for (let r = 1; r <= 9; r++) if (real[s * 9 + r - 1] > 0) ranks.push(r);
    for (let a = 0; a < ranks.length; a++)
      for (let b = a + 1; b < ranks.length; b++)
        if (Math.abs(ranks[a] - ranks[b]) < 3) return false;
  }
  const allowed: number[] = [];
  for (let k = 0; k < 27; k++) {
    if (real[k] > 0) continue;
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
  const dfs = (start: number, left: number): boolean => {
    if (left === 0) return true;
    for (let idx = start; idx <= allowed.length - left; idx++) {
      const k = allowed[idx];
      let ok = true;
      for (const ck of chosen) {
        if (
          ck === k ||
          (Math.floor(k / 9) === Math.floor(ck / 9) && Math.abs((k % 9) - (ck % 9)) < 3)
        ) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      chosen.push(k);
      if (dfs(idx + 1, left - 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return dfs(0, jokers);
}

/**
 * 七风：不搭手里东南西北中发白各有一张（七张字牌齐全）。
 * 不能用财神替代缺的字牌；除非这个财神本身就是缺的那一种
 * （例如翻到东风，东风财神可以当东风用）。
 */
export function isSevenWinds(
  real: readonly number[],
  jokers: number,
  jokerKind: number | null,
): boolean {
  if (total(real) + jokers !== 14) return false;
  const c = [...real];
  let left = jokers;
  for (let h = 27; h < KINDS; h++) {
    if (c[h] > 0) {
      c[h]--;
    } else if (jokerKind === h && left > 0) {
      left--;
    } else {
      return false;
    }
  }
  return numbersBuDa(c, left, 7);
}

/** 只看面子（不含将）：财神可以补位 */
export function allSets(real: readonly number[], jokers: number, setsNeeded: number): boolean {
  if (total(real) + jokers !== setsNeeded * 3) return false;
  const c = [...real];
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

/** 13 张手牌是不是「敲头」的听牌形：去掉一张财神后正好是 4 组面子 */
export function explosiveWait(real: readonly number[], jokers: number, melds: number): boolean {
  if (jokers === 0) return false;
  return allSets(real, jokers - 1, 4 - melds);
}

/** 13 张手牌是不是七对敲头：6 个对子 + 1 张财神，听任意牌 */
export function sevenPairsQiaotouWait(real: readonly number[], jokers: number): boolean {
  return jokers === 1 && total(real) === 12 && real.every((n) => n % 2 === 0);
}

/** 14 张（或加副露）是否和牌：标准型 / 七对 / 不搭 */
export function isWin14(real: readonly number[], jokers: number, melds: number): boolean {
  const setsNeeded = 4 - melds;
  if (standardWinRaw(real, jokers, setsNeeded)) return true;
  if (melds === 0 && sevenPairsRaw(real, jokers)) return true;
  return melds === 0 && !!nonMeldWin(real, jokers);
}

/** 不搭专用听牌：白板替身按白板字牌算 */
export function buDaWaits(
  real: readonly number[],
  jokers: number,
  jokerKind: number | null,
): number[] {
  const out: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if (real[k] >= 4) continue;
    const c = [...real];
    c[k]++;
    if (nonMeldWin(c, jokers)) out.push(k);
  }
  // 摸到财神（万能牌）也可能补成不搭
  if (jokerKind !== null && nonMeldWin(real, jokers + 1)) out.push(jokerKind);
  return out;
}

/**
 * 听牌：再进哪些牌可以和牌（含不搭与敲头）。
 * 一万既是财神（万能）又有白板替身（普通一万），所以两边的进张都要算。
 */
export function waits(
  real: readonly number[],
  jokers: number,
  jokerKind: number | null,
  melds: number,
): number[] {
  const cap = (k: number) => (jokerKind === k ? (jokerKind === 33 ? 3 : 7) : 4);
  if (explosiveWait(real, jokers, melds)) {
    const out: number[] = [];
    for (let k = 0; k < KINDS; k++)
      if (real[k] + (jokerKind === k ? jokers : 0) < cap(k)) out.push(k);
    return out;
  }
  const out: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if (real[k] < 4 && isWin14(inc(real, k, 1), jokers, melds)) {
      out.push(k);
      continue;
    }
    if (jokerKind === k && jokers > 0 && isWin14(real, jokers + 1, melds)) out.push(k);
  }
  return out;
}

function inc(real: readonly number[], k: number, n: number): number[] {
  const c = [...real];
  c[k] += n;
  return c;
}
