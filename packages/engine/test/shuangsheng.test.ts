import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../src';
import { Rng, SYSTEM_SEAT, sh, shuangsheng, simulate } from '../src';

const {
  decompose,
  followError,
  throwFailure,
  trickWinnerIndex,
  canOverride,
  bottomMultiplier,
  upgradeFor,
  parseDeclaration,
  sortSs,
} = sh;

let nextId = 1000;
/** 形如 "H5"、"S10"、"SJ"(小王)、"BJ"(大王) */
const c = (spec: string): Card => {
  if (spec === 'SJ') return { id: nextId++, suit: 'J', rank: 16 };
  if (spec === 'BJ') return { id: nextId++, suit: 'J', rank: 17 };
  const suit = spec[0] as Suit;
  const r = spec.slice(1);
  const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[r] ?? Number(r);
  return { id: nextId++, suit, rank };
};
const cards = (s: string) => s.split(' ').map(c);
const shape = (s: string, ctx: sh.SsCtx) =>
  decompose(cards(s), ctx).map((x) => (x.kind === 'tractor' ? `T${x.pairs}` : x.kind));

const S2: sh.SsCtx = { level: 2, trump: 'S' };
const NT2: sh.SsCtx = { level: 2, trump: null };

describe('双升牌型', () => {
  it('对子必须是完全相同的两张', () => {
    expect(shape('H5 H5', S2)).toEqual(['pair']);
    expect(shape('H5 C5', S2)).toEqual(['single', 'single']);
    // 不同花色的副级牌一样大，但不是对子
    expect(shape('H2 C2', S2)).toEqual(['single', 'single']);
  });

  it('拖拉机：同门相邻对子，跳过级牌', () => {
    expect(shape('H5 H5 H6 H6', S2)).toEqual(['T2']);
    expect(shape('H5 H5 H7 H7', S2)).toEqual(['pair', 'pair']);
    expect(shape('H6 H6 H8 H8', { level: 7, trump: 'S' })).toEqual(['T2']);
    expect(shape('H5 H5 H6 H6 H7 H7 H9', S2)).toEqual(['T3', 'single']);
  });

  it('主牌拖拉机跨层：对大王-对小王-对主级牌-对副级牌-对主 A', () => {
    expect(shape('SA SA H2 H2 S2 S2 SJ SJ BJ BJ', S2)).toEqual(['T5']);
    expect(shape('S2 S2 H2 H2', S2)).toEqual(['T2']);
    // 两个副级牌对子一样大，不能相连
    expect(shape('H2 H2 C2 C2', S2)).toEqual(['pair', 'pair']);
    expect(shape('SK SK SA SA', S2)).toEqual(['T2']);
    // A 与副级牌相连，K 与副级牌不相连
    expect(shape('SK SK H2 H2', S2)).toEqual(['pair', 'pair']);
  });

  it('无主：对大王-对小王-对级牌；A 是副牌', () => {
    expect(shape('H2 H2 SJ SJ BJ BJ', NT2)).toEqual(['T3']);
    expect(shape('HA HA H2 H2', NT2)[0]).toBe('pair');
    expect(sh.isTrump(c('HA'), NT2)).toBe(false);
    expect(sh.isTrump(c('C2'), NT2)).toBe(true);
  });

  it('手牌排序：主牌在前', () => {
    const hand = cards('H5 S3 BJ C2 SA H2 S2');
    const sorted = sortSs(hand, S2).map((x) => `${x.suit}${x.rank}`);
    expect(sorted.slice(0, 5)).toEqual(['J17', 'S2', 'H2', 'C2', 'S14']);
  });
});

describe('双升跟牌与比大小', () => {
  it('有对子必须跟对子', () => {
    const lead = cards('H5 H5');
    const hand = cards('H9 H9 H3 H4 S6');
    expect(followError(hand, lead, [hand[2], hand[3]], S2)).toContain('对子');
    expect(followError(hand, lead, [hand[0], hand[1]], S2)).toBeNull();
  });

  it('有拖拉机必须跟拖拉机，没有则尽量跟对子', () => {
    const lead = cards('H5 H5 H6 H6');
    const hand = cards('H8 H8 H9 H9 HJ HJ H3');
    expect(followError(hand, lead, [hand[0], hand[1], hand[4], hand[5]], S2)).toContain('拖拉机');
    expect(followError(hand, lead, hand.slice(0, 4), S2)).toBeNull();
    const pairsOnly = cards('H8 H8 HJ HJ H3 H4');
    expect(
      followError(pairsOnly, lead, [pairsOnly[0], pairsOnly[1], pairsOnly[4], pairsOnly[5]], S2),
    ).toContain('对子');
    expect(followError(pairsOnly, lead, pairsOnly.slice(0, 4), S2)).toBeNull();
  });

  it('必须跟同门，同门不够先出完再垫', () => {
    const lead = cards('H5 H5');
    const hand = cards('H3 S6 C7 D8');
    expect(followError(hand, lead, [hand[1], hand[2]], S2)).toContain('全部跟出');
    expect(followError(hand, lead, [hand[0], hand[2]], S2)).toBeNull();
    const single = cards('H3 S6');
    expect(followError(single, [lead[0]], [single[1]], S2)).toContain('必须跟');
    const void_ = cards('S6 C7');
    expect(followError(void_, lead, void_, S2)).toBeNull();
  });

  it('毙牌必须牌型一致才算大', () => {
    const lead = { seat: 0, cards: cards('H5 H5') };
    const notPair = { seat: 1, cards: cards('S3 S4') };
    const pair = { seat: 2, cards: cards('S3 S3') };
    expect(trickWinnerIndex([lead, notPair], S2)).toBe(0);
    expect(trickWinnerIndex([lead, notPair, pair], S2)).toBe(2);
    // 垫的牌不能赢
    expect(trickWinnerIndex([lead, { seat: 1, cards: cards('C9 C9') }], S2)).toBe(0);
    // 更大的毙
    expect(trickWinnerIndex([lead, pair, { seat: 3, cards: cards('BJ BJ') }], S2)).toBe(2);
  });

  it('一样大的牌先出者大；不同副花色不比大小', () => {
    const plays = [
      { seat: 0, cards: cards('H2') },
      { seat: 1, cards: cards('C2') },
      { seat: 2, cards: cards('D2') },
    ];
    expect(trickWinnerIndex(plays, S2)).toBe(0);
    const off = [
      { seat: 0, cards: cards('H5') },
      { seat: 1, cards: cards('CA') },
      { seat: 2, cards: cards('H6') },
    ];
    expect(trickWinnerIndex(off, S2)).toBe(2);
    // 主花色级牌大于副级牌
    expect(trickWinnerIndex([plays[1], { seat: 3, cards: cards('S2') }], S2)).toBe(1);
  });
});

describe('双升甩牌', () => {
  it('每组都是最大才成功', () => {
    const thrown = cards('HA HK HK');
    expect(throwFailure(thrown, [cards('H3 H4'), cards('HQ HQ'), cards('S5')], S2)).toBeNull();
  });

  it('失败时强制出最小的那一组', () => {
    const thrown = cards('HA HK HK');
    const fail = throwFailure(thrown, [cards('HA HA'), cards('H3'), cards('S5')], S2);
    expect(fail?.kind).toBe('pair');
    expect(fail?.cards.map((x) => x.rank)).toEqual([13, 13]);
    const singles = cards('HA HQ HJ');
    const f2 = throwFailure(singles, [cards('HK'), [], []], S2);
    expect(f2?.cards.map((x) => x.rank)).toEqual([11]);
  });

  it('拖拉机组件只怕更大的同长拖拉机', () => {
    const thrown = cards('H9 H9 H10 H10 HA');
    expect(throwFailure(thrown, [cards('HJ HJ HK HK'), [], []], S2)).toBeNull();
    const f = throwFailure(thrown, [cards('HJ HJ HQ HQ'), [], []], S2);
    expect(f?.kind).toBe('tractor');
  });

  it('毙甩牌：牌型一致才算大，比最大的一组', () => {
    const lead = { seat: 0, cards: cards('HA HK HK') };
    const ok = { seat: 1, cards: cards('S3 S4 S4') };
    const bad = { seat: 2, cards: cards('S6 S7 S8') };
    const bigger = { seat: 3, cards: cards('S3 S9 S9') };
    expect(trickWinnerIndex([lead, ok], S2)).toBe(1);
    expect(trickWinnerIndex([lead, bad], S2)).toBe(0);
    expect(trickWinnerIndex([lead, ok, bad, bigger], S2)).toBe(3);
  });

  it('甩牌在牌局中失败时只出最小组', () => {
    let st = dealtState(5);
    st = { ...st };
    // 庄家 0 甩 ♥A ♥K（两张单张），对手手里有 ♥A 之上的牌不可能，但有 ♥K 之上的 ♥A
    st.phase = 'play';
    st.dealer = 0;
    st.decl = { seat: 0, suit: 'S', strength: 1, cards: [] };
    st.level = 2;
    st.turn = 0;
    st.trick = { leader: 0, plays: [], winner: null, points: 0 };
    const a = c('HA');
    const k = c('HQ');
    st.hands = [
      [a, k, c('C3')],
      [c('HK'), c('C4'), c('C5')],
      [c('C6'), c('C7'), c('C8')],
      [c('C9'), c('C10'), c('CJ')],
    ];
    expect(shuangsheng.validate(st, 0, { type: 'play', cards: [a.id, k.id] })).toBeNull();
    const next = shuangsheng.apply(st, 0, { type: 'play', cards: [a.id, k.id] });
    expect(next.trick!.plays[0].cards.map((x) => x.id)).toEqual([k.id]);
    expect(next.throwFail?.tried).toHaveLength(2);
    expect(next.hands[0].map((x) => x.id)).toContain(a.id);
  });
});

describe('双升亮主与反主', () => {
  it('亮主须同色王：♠♣ 配小王，♥♦ 配大王', () => {
    expect(parseDeclaration(cards('SJ S2'), 2)?.strength).toBe(1);
    expect(parseDeclaration(cards('SJ C2 C2'), 2)?.strength).toBe(2);
    expect(parseDeclaration(cards('BJ H2'), 2)?.suit).toBe('H');
    expect(parseDeclaration(cards('BJ S2'), 2)).toBeNull();
    expect(parseDeclaration(cards('SJ H2'), 2)).toBeNull();
    expect(parseDeclaration(cards('SJ S2 C2'), 2)).toBeNull();
    expect(parseDeclaration(cards('BJ BJ'), 2)?.strength).toBe(4);
    expect(parseDeclaration(cards('SJ BJ'), 2)).toBeNull();
  });

  it('反主层级', () => {
    const weak: sh.Declaration = { seat: 0, suit: 'S', strength: 1, cards: [] };
    const strong: sh.Declaration = { seat: 0, suit: 'S', strength: 2, cards: [] };
    const smallNt: sh.Declaration = { seat: 0, suit: null, strength: 3, cards: [] };
    const bigNt: sh.Declaration = { seat: 0, suit: null, strength: 4, cards: [] };
    const opt = (suit: Suit | null, strength: sh.Strength) => ({ suit, strength, cards: [] });
    // 弱主：可被换花色的强主、双王反
    expect(canOverride(weak, opt('H', 2), 1)).toBe(true);
    expect(canOverride(weak, opt('S', 2), 1)).toBe(false);
    expect(canOverride(weak, opt('H', 1), 1)).toBe(false);
    expect(canOverride(weak, opt(null, 3), 1)).toBe(true);
    expect(canOverride(weak, opt(null, 4), 1)).toBe(true);
    // 强主只能被双王反
    expect(canOverride(strong, opt('H', 2), 1)).toBe(false);
    expect(canOverride(strong, opt(null, 3), 1)).toBe(true);
    // 小无主只能被双大王反；大无主不能反
    expect(canOverride(smallNt, opt(null, 3), 1)).toBe(false);
    expect(canOverride(smallNt, opt(null, 4), 1)).toBe(true);
    expect(canOverride(bigNt, opt(null, 4), 1)).toBe(false);
    // 不能反自己
    expect(canOverride(weak, opt(null, 4), 0)).toBe(false);
  });

  it('第一局发牌中先亮者坐庄并拿底', () => {
    let st = shuangsheng.setup({ players: [], options: { startLevel: 2 }, seed: 11 });
    let declared = false;
    while (st.phase === 'deal') {
      for (const s of shuangsheng.activeSeats(st)) {
        const v = shuangsheng.view(st, s);
        if (!declared && v.declOptions.length) {
          st = shuangsheng.apply(st, s, {
            type: 'declare',
            cards: v.declOptions[0].cards.map((x) => x.id),
          });
          declared = true;
        } else st = shuangsheng.apply(st, s, { type: 'pass' });
      }
      const auto = shuangsheng.autoAdvance!(st);
      if (st.phase === 'deal' && auto) st = shuangsheng.apply(st, SYSTEM_SEAT, auto.action);
    }
    if (!declared) return; // 这个种子没人能亮（会去翻底），不影响断言
    expect(st.phase).toBe('bury');
    expect(st.dealer).toBe(st.decl!.seat);
    expect(st.hands[st.dealer!]).toHaveLength(33);
  });

  it('翻底：另一张在谁手里谁坐庄，另一张也在底里则继续翻', () => {
    let st = dealtState(3);
    expect(st.phase).toBe('flip');
    // 底牌第一张和第二张设为同一张牌，第三张的另一张在 2 号手里
    const twin = st.hands[2].find((x) => !(x.suit === 'D' && x.rank === 7))!;
    const expected = [0, 1, 2, 3].find((s) =>
      st.hands[s].some((x) => x.suit === twin.suit && x.rank === twin.rank),
    );
    const bottom = [...st.bottom];
    const a = c('D7');
    const b = c('D7');
    // 把手里的 ♦7 都挪走，保证 ♦7 两张都在底
    for (const h of st.hands) {
      for (let i = 0; i < h.length; i++)
        if (h[i].suit === 'D' && h[i].rank === 7) h[i] = { ...h[i], rank: 3 };
    }
    bottom[0] = a;
    bottom[1] = b;
    bottom[2] = { id: 5000, suit: twin.suit, rank: twin.rank };
    st.bottom = bottom;
    st = shuangsheng.apply(st, SYSTEM_SEAT, { type: 'flip' });
    expect(st.phase).toBe('flip');
    st = shuangsheng.apply(st, SYSTEM_SEAT, { type: 'flip' });
    expect(st.phase).toBe('flip');
    st = shuangsheng.apply(st, SYSTEM_SEAT, { type: 'flip' });
    expect(st.phase).toBe('bury');
    expect(st.dealer).toBe(expected);
    expect(st.decl!.suit).toBe(twin.suit === 'J' ? null : twin.suit);
    expect(st.flipped).toHaveLength(3);
  });
});

describe('双升计分', () => {
  it('抠底倍数', () => {
    expect(bottomMultiplier(decompose(cards('H5'), S2))).toBe(2);
    expect(bottomMultiplier(decompose(cards('H5 H5'), S2))).toBe(4);
    expect(bottomMultiplier(decompose(cards('H5 H5 H6 H6'), S2))).toBe(8);
    expect(bottomMultiplier(decompose(cards('H5 H5 H6 H6 H7 H7'), S2))).toBe(16);
    // 甩牌按最大的牌型
    expect(bottomMultiplier(decompose(cards('HA HK HK'), S2))).toBe(4);
  });

  it('升级表', () => {
    expect(upgradeFor(0)).toEqual({ side: 'dealer', up: 3 });
    expect(upgradeFor(5)).toEqual({ side: 'dealer', up: 2 });
    expect(upgradeFor(35)).toEqual({ side: 'dealer', up: 2 });
    expect(upgradeFor(40)).toEqual({ side: 'dealer', up: 1 });
    expect(upgradeFor(75)).toEqual({ side: 'dealer', up: 1 });
    expect(upgradeFor(80)).toEqual({ side: 'defender', up: 0 });
    expect(upgradeFor(115)).toEqual({ side: 'defender', up: 0 });
    expect(upgradeFor(120)).toEqual({ side: 'defender', up: 1 });
    expect(upgradeFor(155)).toEqual({ side: 'defender', up: 1 });
    expect(upgradeFor(160)).toEqual({ side: 'defender', up: 2 });
    expect(upgradeFor(200)).toEqual({ side: 'defender', up: 3 });
    expect(upgradeFor(280)).toEqual({ side: 'defender', up: 5 });
  });

  it('分牌共 200 分', () => {
    const st = shuangsheng.setup({ players: [], options: { startLevel: 2 }, seed: 1 });
    expect(sh.sumPoints([...st.deck, ...st.bottom])).toBe(200);
    expect(st.deck.length + st.bottom.length).toBe(108);
  });
});

/** 发完牌、没人亮主（第一局进入翻底） */
function dealtState(seed: number): sh.SsState {
  let st = shuangsheng.setup({ players: [], options: { startLevel: 2 }, seed });
  while (st.deck.length) st = shuangsheng.apply(st, SYSTEM_SEAT, { type: 'deal' });
  st = shuangsheng.apply(st, SYSTEM_SEAT, { type: 'dealt' });
  return st;
}

describe('双升对局流程', () => {
  it('发牌：每人 25 张，底 8 张，view 不泄露他人手牌与底牌', () => {
    const st = dealtState(7);
    expect(st.hands.map((h) => h.length)).toEqual([25, 25, 25, 25]);
    expect(st.bottom).toHaveLength(8);
    const v = shuangsheng.view(st, 1);
    expect(v.hand).toHaveLength(25);
    expect(v.bottom).toBeNull();
    expect(JSON.stringify(v)).not.toContain('"deck"');
    expect(shuangsheng.view(st, null).hand).toHaveLength(0);
  });

  it('电脑对战 50 个种子都能打完整场', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { state } = simulate(shuangsheng, 4, { startLevel: 2 }, seed, 400000);
      expect(state.phase).toBe('matchOver');
      expect(state.winnerTeam).not.toBeNull();
      const last = state.history[state.history.length - 1];
      expect(last.matchWon).toBe(true);
      expect(last.level).toBe(14);
      expect(last.defenderPoints).toBeLessThan(80);
      for (const r of state.history) {
        // 每局分数是 5 的倍数，升级不超过 A
        expect(r.defenderPoints % 5).toBe(0);
        expect(Math.max(...r.levelsAfter)).toBeLessThanOrEqual(14);
      }
    }
  });

  it('apply 不修改入参', () => {
    let st = shuangsheng.setup({ players: [], options: { startLevel: 2 }, seed: 8 });
    const rng = new Rng(8);
    for (let i = 0; i < 1500 && !shuangsheng.isOver(st); i++) {
      const active = shuangsheng.activeSeats(st);
      const seat = active.length ? active[rng.int(active.length)] : SYSTEM_SEAT;
      const action = active.length
        ? shuangsheng.bot(shuangsheng.view(st, seat), seat, rng)
        : shuangsheng.autoAdvance!(st)!.action;
      const before = JSON.stringify(st);
      const next = shuangsheng.apply(st, seat, action);
      expect(JSON.stringify(st)).toBe(before);
      st = next;
    }
  });

  it('一局中牌数守恒', () => {
    let st = shuangsheng.setup({ players: [], options: { startLevel: 2 }, seed: 21 });
    const rng = new Rng(21);
    for (let i = 0; i < 400 && st.phase !== 'roundOver'; i++) {
      const active = shuangsheng.activeSeats(st);
      if (!active.length) {
        st = shuangsheng.apply(st, SYSTEM_SEAT, shuangsheng.autoAdvance!(st)!.action);
      } else {
        const s = active[0];
        st = shuangsheng.apply(st, s, shuangsheng.bot(shuangsheng.view(st, s), s, rng));
      }
      if (st.phase === 'play' || st.phase === 'trickEnd') {
        const inTrick = st.trick ? st.trick.plays.flatMap((p) => p.cards).length : 0;
        expect(st.hands.flat().length + st.bottom.length + st.played.length).toBe(108);
        expect(inTrick).toBeLessThanOrEqual(st.played.length);
      }
    }
    expect(st.phase).toBe('roundOver');
  });
  it('闲家上台后，新一局按上台方自己的级数打（80–115 分不升级）', { timeout: 60000 }, () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let st = shuangsheng.setup({ players: [], options: { startLevel: 2 }, seed });
      const rng = new Rng(seed);
      let round = 1;
      for (let i = 0; i < 400000 && !shuangsheng.isOver(st); i++) {
        if (st.round !== round) {
          round = st.round;
          const prev = st.history[st.history.length - 1];
          const team = prev.side === 'dealer' ? prev.dealerTeam : 1 - prev.dealerTeam;
          expect(st.phase).toBe('deal');
          expect(st.dealerTeam).toBe(team);
          expect(st.level).toBe(prev.levelsAfter[team]);
          if (prev.side === 'defender' && prev.defenderPoints < 120) {
            expect(prev.levelsAfter[team]).toBe(prev.levelsBefore[team]);
            checked++;
          }
        }
        const active = shuangsheng.activeSeats(st);
        if (!active.length) {
          st = shuangsheng.apply(st, SYSTEM_SEAT, shuangsheng.autoAdvance!(st)!.action);
        } else {
          const s = active[0];
          st = shuangsheng.apply(st, s, shuangsheng.bot(shuangsheng.view(st, s), s, rng));
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
