import { describe, expect, it } from 'vitest';
import { Rng } from '../src';
import { isWinningShape, shanten } from '../src/mahjong/analysis';

/**
 * 向听数对拍：暴力枚举一门牌（9 种）所有能和的 14 − 3m 张组合，
 * 向听 = 和牌张数 − 与手牌最大重合张数 − 1。
 * 清一色路线会把「只保留一门」的计数交给 shanten()，张数常常不足 13 − 3m，这里专门测这种情况。
 */

function winningVectors(size: number, melds: number): number[][] {
  const out: number[][] = [];
  const c = new Array<number>(9).fill(0);
  const full = new Array<number>(27).fill(0);
  const rec = (i: number, left: number) => {
    if (i === 9) {
      if (left !== 0) return;
      for (let k = 0; k < 9; k++) full[k] = c[k];
      if (isWinningShape(full, melds)) out.push([...c]);
      return;
    }
    for (let n = 0; n <= Math.min(4, left); n++) {
      c[i] = n;
      rec(i + 1, left - n);
    }
    c[i] = 0;
  };
  rec(0, size);
  return out;
}

function bruteShanten(hand: number[], wins: number[][], size: number): number {
  let best = 0;
  for (const w of wins) {
    let o = 0;
    for (let k = 0; k < 9; k++) o += Math.min(hand[k], w[k]);
    if (o > best) best = o;
  }
  return size - best - 1;
}

describe('向听数：张数不足的手牌（与暴力法对拍）', () => {
  for (const melds of [0, 1, 2]) {
    it(`副露 ${melds} 组`, () => {
      const size = 14 - 3 * melds;
      const wins = winningVectors(size, melds);
      const rng = new Rng(17 + melds);
      for (let trial = 0; trial < 400; trial++) {
        // 随机一手同门牌，张数从 0 到 14 − 3m
        const n = rng.int(size + 1);
        const pool: number[] = [];
        for (let k = 0; k < 9; k++) for (let i = 0; i < 4; i++) pool.push(k);
        const hand = new Array<number>(9).fill(0);
        for (const k of rng.shuffle(pool).slice(0, n)) hand[k]++;
        const counts = new Array<number>(27).fill(0);
        for (let k = 0; k < 9; k++) counts[k] = hand[k];
        expect(shanten(counts, melds), `hand ${hand.join('')} melds ${melds}`).toBe(
          bruteShanten(hand, wins, size),
        );
      }
    });
  }
});
