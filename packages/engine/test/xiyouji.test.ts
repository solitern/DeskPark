import { describe, expect, it } from 'vitest';
import type { Card } from '../src';
import { simulate, xiyouji, xyj } from '../src';

const card = (id: number, rank: number, suit: Card['suit'] = 'S'): Card => ({ id, suit, rank });
const joker = (id: number, rank = 16): Card => ({ id, suit: 'J', rank });

function fresh(seed = 1) {
  return xiyouji.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    options: xiyouji.defaultOptions,
    seed,
  });
}

describe('西游记', () => {
  it('牌库为 60 张：七种点数各 8 张 + 4 张王，每人 15 张', () => {
    const deck = xyj.createXyjDeck();
    expect(deck).toHaveLength(60);
    expect(new Set(deck.map((c) => c.id)).size).toBe(60);
    for (const r of xyj.XYJ_RANKS)
      expect(deck.filter((c) => c.rank === r && c.suit !== 'J')).toHaveLength(8);
    expect(deck.filter((c) => c.suit === 'J')).toHaveLength(4);
    const s = fresh();
    expect(s.hands.map((h) => h.length)).toEqual([15, 15, 15, 15]);
  });

  it('循环克制：师傅压徒弟，徒弟压妖怪，妖怪压师傅', () => {
    const { beats } = xyj;
    expect(beats(10, 5)).toBe(true);
    expect(beats(10, 3)).toBe(true);
    expect(beats(5, 8)).toBe(true);
    expect(beats(8, 3)).toBe(true);
    expect(beats(3, 13)).toBe(true);
    expect(beats(13, 12)).toBe(true);
    expect(beats(12, 11)).toBe(true);
    expect(beats(11, 10)).toBe(true);
    // 反过来不行
    expect(beats(5, 10)).toBe(false);
    expect(beats(13, 3)).toBe(false);
    expect(beats(10, 11)).toBe(false);
    expect(beats(3, 8)).toBe(false);
    expect(beats(11, 13)).toBe(false);
    // 同点不能压
    for (const r of xyj.XYJ_RANKS) expect(beats(r, r)).toBe(false);
  });

  it('牌型：同点数，王可补，全王需指定点数', () => {
    expect(xyj.resolvePlay([card(1, 5), card(2, 5)])).toBe(5);
    expect(xyj.resolvePlay([card(1, 5), joker(2)])).toBe(5);
    expect(xyj.resolvePlay([card(1, 5), card(2, 8)])).toBeNull();
    expect(xyj.resolvePlay([joker(1)])).toBeNull();
    expect(xyj.resolvePlay([joker(1), joker(2, 17)], 13)).toBe(13);
    expect(xyj.resolvePlay(Array.from({ length: 9 }, (_, i) => card(i, 3)))).toBeNull();
  });

  it('报牌文字', () => {
    expect(xyj.callOut(10, 1)).toBe('师傅');
    expect(xyj.callOut(10, 2)).toBe('对师傅');
    expect(xyj.callOut(13, 3)).toBe('三个大妖');
    expect(xyj.callOut(5, 8)).toBe('八个悟空');
  });

  it('跟牌张数须一致且能压过；已不要的人可再出；三家不要后重新领出', () => {
    const s = fresh(3);
    s.dealer = 0;
    s.turn = 0;
    s.top = null;
    s.count = null;
    s.hands = [
      [card(1, 11), card(2, 11), card(3, 10), card(4, 10), card(5, 3)],
      [card(11, 12), card(12, 12), card(13, 3)],
      [card(21, 5), card(22, 5), card(23, 8)],
      [card(31, 13), card(32, 13), card(33, 3)],
    ];
    let t = xiyouji.apply(s, 0, { type: 'play', cards: [1, 2] });
    expect(t.count).toBe(2);
    expect(xiyouji.validate(t, 1, { type: 'play', cards: [13] })).toContain('2 张');
    expect(xiyouji.validate(t, 1, { type: 'play', cards: [11, 12] })).toBeNull();
    t = xiyouji.apply(t, 1, { type: 'pass' });
    t = xiyouji.apply(t, 2, { type: 'play', cards: [21, 22] });
    // 对悟空：妖怪压不过徒弟
    expect(xiyouji.validate(t, 3, { type: 'play', cards: [31, 32] })).not.toBeNull();
    t = xiyouji.apply(t, 3, { type: 'pass' });
    // 师傅压徒弟
    t = xiyouji.apply(t, 0, { type: 'play', cards: [3, 4] });
    // 刚才不要的 1 号还能再出：对中妖压师傅
    expect(xiyouji.validate(t, 1, { type: 'play', cards: [11, 12] })).toBeNull();
    t = xiyouji.apply(t, 1, { type: 'play', cards: [11, 12] });
    t = xiyouji.apply(t, 2, { type: 'pass' });
    t = xiyouji.apply(t, 3, { type: 'pass' });
    expect(t.turn).toBe(0);
    t = xiyouji.apply(t, 0, { type: 'pass' });
    // 三家都不要，1 号重新领出，张数任意
    expect(t.turn).toBe(1);
    expect(t.top).toBeNull();
    expect(xiyouji.validate(t, 1, { type: 'pass' })).not.toBeNull();
    expect(xiyouji.validate(t, 1, { type: 'play', cards: [13] })).toBeNull();
  });

  it('全王出牌按指定点数；结算：手牌最多的（并列都）扣分，赢家得分，赢家坐庄', () => {
    const s = fresh(5);
    s.turn = 2;
    s.top = { seat: 1, cards: [card(90, 10)], rank: 10 };
    s.count = 1;
    s.hands = [
      Array.from({ length: 5 }, (_, i) => card(100 + i, 3)),
      Array.from({ length: 5 }, (_, i) => card(110 + i, 8)),
      [joker(120)],
      Array.from({ length: 2 }, (_, i) => card(130 + i, 12)),
    ];
    expect(xiyouji.validate(s, 2, { type: 'play', cards: [120] })).toContain('指定');
    // 指定为徒弟压不过师傅
    expect(xiyouji.validate(s, 2, { type: 'play', cards: [120], as: 5 })).not.toBeNull();
    const t = xiyouji.apply(s, 2, { type: 'play', cards: [120], as: 13 });
    expect(t.event).toMatchObject({ kind: 'play', rank: 13, count: 1 });
    expect(t.phase).toBe('roundOver');
    expect(t.result!.losers).toEqual([0, 1]);
    expect(t.result!.deltas).toEqual([-5, -5, 10, 0]);
    expect(t.scores).toEqual([-5, -5, 10, 0]);
    expect(t.dealer).toBe(2);
    let u = t;
    for (const seat of [0, 1, 2, 3]) u = xiyouji.apply(u, seat, { type: 'ready' });
    expect(u.round).toBe(2);
    expect(u.turn).toBe(2);
    expect(u.flip).toBeNull();
  });

  it('第一盘翻牌定庄：摸到翻开那张牌的人坐庄并先出', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = fresh(seed);
      expect(s.flip).not.toBeNull();
      expect(s.hands[s.flip!.seat].some((c) => c.id === s.flip!.card.id)).toBe(true);
      expect(s.dealer).toBe(s.flip!.seat);
      expect(s.turn).toBe(s.dealer);
    }
  });

  it('电脑可以完整打完，分数零和', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = simulate(xiyouji, 4, { rounds: 4 }, seed);
      expect(state.phase).toBe('matchOver');
      expect(state.scores.reduce((a: number, b: number) => a + b, 0)).toBe(0);
    }
  });
});
