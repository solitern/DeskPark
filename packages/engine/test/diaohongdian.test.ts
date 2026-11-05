import { describe, expect, it } from 'vitest';
import type { Card } from '../src';
import { dhd, diaohongdian, simulate } from '../src';

const { pairs, cardPoints, pilePoints, redFivePairs } = dhd;
type State = dhd.DhState;

const card = (id: number, suit: Card['suit'], rank: number): Card => ({ id, suit, rank });

function make(players: number, options: Partial<dhd.DhOptions> = {}): State {
  return diaohongdian.setup({
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i + 1}`, isBot: true })),
    options: { ...diaohongdian.defaultOptions, rounds: 1, ...options },
    seed: 7,
  });
}

describe('钓红点 · 配对与分值', () => {
  it('配对表：A+9、2+8、3+7、4+6、5+5、同牌', () => {
    expect(pairs(14, 9)).toBe(true);
    expect(pairs(9, 14)).toBe(true);
    expect(pairs(2, 8)).toBe(true);
    expect(pairs(3, 7)).toBe(true);
    expect(pairs(4, 6)).toBe(true);
    expect(pairs(5, 5)).toBe(true);
    for (const r of [10, 11, 12, 13]) expect(pairs(r, r)).toBe(true);
    // 不是这些组合的都配不上
    expect(pairs(9, 9)).toBe(false);
    expect(pairs(14, 14)).toBe(false);
    expect(pairs(2, 9)).toBe(false);
    expect(pairs(3, 8)).toBe(false);
    expect(pairs(10, 9)).toBe(false);
    expect(pairs(11, 12)).toBe(false);
  });

  it('只有红牌计分：红 2–8 按牌面，红 9 以上 10 分，红 A 按房规', () => {
    expect(cardPoints(card(0, 'H', 2), 10)).toBe(2);
    expect(cardPoints(card(0, 'D', 7), 10)).toBe(7);
    expect(cardPoints(card(0, 'H', 9), 10)).toBe(10);
    expect(cardPoints(card(0, 'D', 13), 10)).toBe(10);
    expect(cardPoints(card(0, 'H', 14), 10)).toBe(10);
    expect(cardPoints(card(0, 'H', 14), 20)).toBe(20);
    expect(cardPoints(card(0, 'S', 14), 20)).toBe(0);
    expect(cardPoints(card(0, 'C', 10), 10)).toBe(0);
  });

  it('一堆牌的分与红 5 对数', () => {
    const pile = [
      card(0, 'H', 10),
      card(1, 'D', 3),
      card(2, 'H', 5),
      card(3, 'D', 5),
      card(4, 'S', 14),
    ];
    expect(pilePoints(pile, 10)).toBe(10 + 3 + 5 + 5);
    expect(pilePoints(pile, 20)).toBe(10 + 3 + 5 + 5);
    expect(redFivePairs(pile)).toBe(1);
  });
});

describe('钓红点 · 发牌', () => {
  it.each([2, 3, 4])('%i 人局按家常版发牌，52 张不重不漏', (n) => {
    const st = make(n);
    const spec = { 2: [10, 12, 20], 3: [7, 10, 21], 4: [5, 8, 24] }[n] as number[];
    expect(st.hands.map((h) => h.length)).toEqual(Array(n).fill(spec[0]));
    expect(st.table).toHaveLength(spec[1]);
    expect(st.stock).toHaveLength(spec[2]);
    const all = [...st.hands.flat(), ...st.table, ...st.stock];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
    expect(all.some((c) => c.suit === 'J')).toBe(false);
    expect(st.phase).toBe('play');
    expect(st.turn).toBe(0);
  });
});

describe('钓红点 · 出牌与钓牌', () => {
  it('手牌钓到台面上的红 5，按房规多算一对红 5', () => {
    const st = make(2, { redFiveBonus: true, rounds: 3 });
    st.hands = [[card(0, 'H', 5)], []];
    st.table = [card(1, 'D', 5)];
    st.stock = [card(3, 'C', 2)];
    const afterPlay = diaohongdian.apply(st, 0, { type: 'play', card: 0 });
    expect(afterPlay.phase).toBe('flip');
    expect(afterPlay.piles[0].map((c) => c.id)).toEqual([0, 1]);
    const afterFlip = diaohongdian.apply(afterPlay, 0, { type: 'flip' });
    expect(afterFlip.phase).toBe('roundEnd');
    expect(afterFlip.bonus[0]).toBe(1);
    // 两张红 5 基础 10 分 + 房规奖励 10 分
    expect(afterFlip.roundScores).toEqual([20, 0]);
  });

  it('配不上就把牌留在台面，翻底牌后轮到下家', () => {
    const st = make(2);
    st.hands = [[card(0, 'S', 2), card(1, 'S', 3)], [card(2, 'S', 4)]];
    st.table = [card(9, 'H', 9)];
    st.stock = [card(10, 'C', 7), card(11, 'C', 8)];
    const s1 = diaohongdian.apply(st, 0, { type: 'play', card: 0 });
    expect(s1.piles[0]).toHaveLength(0);
    expect(s1.table.some((c) => c.id === 0)).toBe(true);
    const s2 = diaohongdian.apply(s1, 0, { type: 'flip' });
    expect(s2.table.some((c) => c.id === 10)).toBe(true);
    expect(s2.turn).toBe(1);
    expect(s2.phase).toBe('play');
  });

  it('底牌翻出来能配就直接钓走', () => {
    const st = make(2);
    st.hands = [[card(0, 'S', 2)], []];
    st.table = [card(9, 'H', 9)];
    st.stock = [card(10, 'S', 14)]; // A 钓 9
    const s1 = diaohongdian.apply(st, 0, { type: 'play', card: 0 });
    const s2 = diaohongdian.apply(s1, 0, { type: 'flip' });
    expect(s2.piles[0].map((c) => c.id)).toEqual([10, 9]);
    expect(s2.roundScores[0]).toBe(10);
  });

  it('台面有多张可配时由玩家挑一张，不能乱选', () => {
    const st = make(2, { rounds: 3 });
    st.hands = [[card(0, 'S', 5), card(1, 'S', 6)], [card(2, 'S', 4)]];
    st.table = [card(20, 'S', 5), card(21, 'H', 5)];
    st.stock = [card(30, 'C', 12), card(31, 'C', 11)];
    const s1 = diaohongdian.apply(st, 0, { type: 'play', card: 0 });
    expect(s1.phase).toBe('pick');
    expect(s1.pending?.matches.map((c) => c.id).sort()).toEqual([20, 21]);
    expect(diaohongdian.validate(s1, 0, { type: 'pick', target: 999 })).not.toBeNull();
    const s2 = diaohongdian.apply(s1, 0, { type: 'pick', target: 21 });
    // 选了红 5，得分堆里是黑 5 + 红 5 = 5 分
    expect(s2.piles[0].map((c) => c.id)).toEqual([0, 21]);
    expect(s2.phase).toBe('flip');
  });

  it('手牌出完后这一轮就是单纯翻底牌', () => {
    const st = make(2);
    st.hands = [[], [card(2, 'S', 4)]];
    st.stock = [card(30, 'C', 12)];
    expect(diaohongdian.validate(st, 0, { type: 'play', card: 2 })).not.toBeNull();
    expect(diaohongdian.validate(st, 0, { type: 'flip' })).toBeNull();
    const s2 = diaohongdian.apply(st, 0, { type: 'flip' });
    expect(s2.turn).toBe(1);
    expect(s2.phase).toBe('play');
  });

  it('没轮到自己的动作一律不合法', () => {
    const st = make(2);
    expect(diaohongdian.validate(st, 1, { type: 'play', card: st.hands[0][0].id })).not.toBeNull();
    expect(diaohongdian.validate(st, 1, { type: 'flip' })).not.toBeNull();
  });
});

describe('钓红点 · 结算与残局', () => {
  it('残局作废：台面剩下的红牌不计分', () => {
    const st = make(2, { tableEnd: 'void', rounds: 1 });
    st.hands = [[card(0, 'S', 2)], []];
    st.table = [card(9, 'H', 13)]; // 红 K，10 分
    st.stock = [];
    st.lastCatcher = 0;
    const done = diaohongdian.apply(st, 0, { type: 'play', card: 0 });
    expect(done.phase).toBe('matchOver');
    expect(done.roundScores).toEqual([0, 0]);
    expect(done.lastRound?.leftover).toHaveLength(2);
  });

  it('残局归最后钓牌的人：台面的红牌算给他', () => {
    const st = make(2, { tableEnd: 'last', rounds: 1 });
    st.hands = [[card(0, 'S', 2)], []];
    st.table = [card(9, 'H', 13)];
    st.stock = [];
    st.lastCatcher = 1;
    const done = diaohongdian.apply(st, 0, { type: 'play', card: 0 });
    expect(done.roundScores).toEqual([0, 10]);
    expect(done.scores).toEqual([0, 10]);
  });

  it('打满局数后结束整场，累计分照常相加', () => {
    const st = make(2, { rounds: 2 });
    st.phase = 'roundEnd';
    st.scores = [12, 7];
    const next = diaohongdian.apply(st, -1, { type: 'next' });
    expect(next.round).toBe(2);
    expect(next.phase).toBe('play');
    expect(next.scores).toEqual([12, 7]);
    expect(next.hands.map((h) => h.length)).toEqual([10, 10]);
  });
});

describe('钓红点 · 整局模拟', () => {
  const RED_TOTAL = 190; // 一副牌里所有红牌的基础分值（红 A 按 10 分）

  it.each([2, 3, 4])('%i 人局电脑对战能打完，牌张守恒、总分不超上限', (n) => {
    for (let seed = 1; seed <= 4; seed++) {
      for (const tableEnd of ['void', 'last'] as const) {
        const { state } = simulate(
          diaohongdian,
          n,
          { ...diaohongdian.defaultOptions, rounds: 2, tableEnd },
          seed,
        );
        const st = state as State;
        expect(diaohongdian.isOver(st)).toBe(true);
        // 最后一局的一副牌：手牌 + 台面 + 底牌 + 得分堆
        const all = [...st.hands.flat(), ...st.table, ...st.stock, ...st.piles.flat()];
        expect(all).toHaveLength(52);
        expect(st.scores.every((s) => Number.isFinite(s) && s >= 0)).toBe(true);

        const gained = st.scores.reduce((a, b) => a + b, 0);
        expect(gained).toBeLessThanOrEqual(RED_TOTAL * 2);
        if (tableEnd === 'last' && st.lastRound?.lastCatcher !== null)
          expect(gained).toBe(RED_TOTAL * 2);
      }
    }
  });

  it('每局结束会给出本局得分，且累计分等于各局之和', () => {
    const { state } = simulate(diaohongdian, 3, { ...diaohongdian.defaultOptions, rounds: 3 }, 11);
    const st = state as State;
    expect(st.round).toBe(3);
    expect(st.roundScores).toHaveLength(3);
    expect(st.lastRound?.gains).toEqual(st.roundScores);
    expect(st.scores.every((s) => s >= 0)).toBe(true);
  });
});
