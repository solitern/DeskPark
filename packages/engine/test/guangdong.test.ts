import { describe, expect, it } from 'vitest';
import type { mj as MJ } from '../src';
import { gdm, guangdong, mj, simulate } from '../src';

type Tile = MJ.Tile;
type State = gdm.GdState;
const { evaluateHand, scoreWin } = gdm;

// 夹具：用 "123m456p78s" 记法生成牌（m 万、s 条、p 筒），同种牌最多四张

const SUIT: Record<string, MJ.MjSuit> = { m: 'wan', s: 'tiao', p: 'tong' };

class Pool {
  used = new Map<number, number>();
  ids = new Set<number>();
  tiles(spec: string): Tile[] {
    const out: Tile[] = [];
    let digits: number[] = [];
    for (const ch of spec.replace(/\s+/g, '')) {
      if (/\d/.test(ch)) digits.push(Number(ch));
      else {
        for (const r of digits) out.push(this.one(SUIT[ch], r));
        digits = [];
      }
    }
    return out;
  }
  one(spec: string, rank: number): Tile {
    const suit = SUIT[spec] ?? (spec as MJ.MjSuit);
    const kind = mj.suitIndex(suit) * 9 + rank - 1;
    const copy = this.used.get(kind) ?? 0;
    if (copy >= 4) throw new Error(`more than 4 of ${rank}${spec}`);
    this.used.set(kind, copy + 1);
    const id = mj.suitIndex(suit) * 36 + (rank - 1) * 4 + copy;
    this.ids.add(id);
    return mj.tileOf(id);
  }
  /** 从还没用过的牌里凑 n 张（用于"不参与本测试"的座位） */
  rest(n: number): Tile[] {
    const out: Tile[] = [];
    for (const t of mj.createTiles()) {
      if (this.ids.has(t.id)) continue;
      this.ids.add(t.id);
      out.push(t);
      if (out.length === n) break;
    }
    return out;
  }
}

const counts = (spec: string) => mj.countKinds(new Pool().tiles(spec));
const NO_CTX = {
  selfDrawn: true,
  afterKong: false,
  robbing: false,
  haidi: false,
  tianhu: false,
  dihu: false,
};

function player(p: Partial<gdm.GdPlayer> = {}): gdm.GdPlayer {
  return {
    hand: [],
    melds: [],
    river: [],
    won: null,
    afterKong: false,
    lastReceipt: null,
    draws: 1,
    ...p,
  };
}

function baseState(players: gdm.GdPlayer[], patch: Partial<State> = {}): State {
  const s = guangdong.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    options: guangdong.defaultOptions,
    seed: 1,
  });
  return {
    ...s,
    phase: 'play',
    window: null,
    players,
    ledger: [],
    receipts: [],
    discards: 5,
    claimsOrKongs: 1,
    drawnThisTurn: null,
    canSelfHu: true,
    turn: 0,
    ...patch,
  };
}

const act = (s: State, seat: number, a: gdm.GdAction) => {
  const err = guangdong.validate(s, seat, a);
  if (err) throw new Error(`seat ${seat} ${JSON.stringify(a)}: ${err}`);
  return guangdong.apply(s, seat, a);
};

// ---------------------------------------------------------------------------

describe('广东推倒胡 · 牌与牌型', () => {
  it('使用 108 张牌（只有万、条、筒）', () => {
    const all = mj.createTiles();
    expect(all).toHaveLength(108);
    expect(all.every((t) => ['wan', 'tiao', 'tong'].includes(t.suit))).toBe(true);
  });

  it('平胡：四组顺子 + 将，1 番', () => {
    const v = evaluateHand(counts('123456789m123p99s'), []);
    expect(v?.patterns).toContain('pinghu');
    expect(scoreWin(v!, NO_CTX, 1).fanRaw).toBe(1);
  });

  it('碰碰胡 2 番，清对 5 番', () => {
    const duidui = evaluateHand(counts('111222333m444p55p'), []);
    expect(duidui?.patterns).toContain('duidui');
    expect(scoreWin(duidui!, NO_CTX, 1).fanRaw).toBe(2);

    const qingdui = evaluateHand(counts('111222333444m55m'), []);
    expect(qingdui?.patterns).toContain('qingdui');
    expect(scoreWin(qingdui!, NO_CTX, 1).points).toBe(16);
  });

  it('七小对 3 番、清七对 6 番、清豪华七对 7 番', () => {
    const normal = evaluateHand(counts('1122334455m6677p'), []);
    expect(normal?.patterns).toEqual(['qidui']);
    expect(scoreWin(normal!, NO_CTX, 1).fanRaw).toBe(3);

    const qing = evaluateHand(counts('11223344556677m'), []);
    expect(qing?.patterns).toEqual(['qingqidui']);
    expect(scoreWin(qing!, NO_CTX, 1).fanRaw).toBe(6);

    const haohua = evaluateHand(counts('11112233445566m'), []);
    expect(haohua?.patterns).toEqual(['qinghaohuaqidui']);
    expect(scoreWin(haohua!, NO_CTX, 1).fanRaw).toBe(7);
  });

  it('吃出的顺子计入面子：有副露的平胡', () => {
    const p = new Pool();
    const v = evaluateHand(counts('123456789m99p'), [{ type: 'chow', kind: mj.kindOf(p.one('p', 7)) }]);
    expect(v).not.toBeNull();
    expect(v!.skeleton).toBe('standard');
    expect(v!.patterns).toContain('pinghu');
  });

  it('过程番：杠上开花 +1，8 番封顶', () => {
    const base = evaluateHand(counts('111222333444m55m'), [])!;
    const s = scoreWin(base, { ...NO_CTX, afterKong: true }, 1);
    expect(s.fanRaw).toBe(6); // 清对 5 + 杠上开花 1
    expect(s.points).toBe(32);
    expect(scoreWin(base, { ...NO_CTX, tianhu: true }, 1).points).toBe(128);
  });
});

describe('广东推倒胡 · 流程', () => {
  it('能吃任意一家打出的牌，吃完轮到吃牌者出牌', () => {
    const p = new Pool();
    const t3 = p.one('m', 3);
    const t2 = p.one('m', 2);
    const t4 = p.one('m', 4);
    const st = baseState([
      player({ hand: [t3, ...p.tiles('1m2m4m5m6m7m8m9m1p2p3p1s')] }),
      player({ hand: [t2, t4, ...p.tiles('5m6m7m8m9m1p2p3p4p1s2s3s')] }),
      player({ hand: p.rest(13) }),
      player({ hand: p.rest(13) }),
    ]);
    const s1 = act(st, 0, { type: 'discard', tile: t3.id });
    expect(s1.window?.options[1]).toContain('chi');
    let s2 = act(s1, 1, { type: 'chi', tiles: [t2.id, t4.id] });
    // 其余两家如果还要表态，直接过，让窗口结算
    for (const seat of [2, 3]) {
      const L = gdm.legalActions(s2, seat);
      if (L?.pass) s2 = act(s2, seat, { type: 'pass' });
    }
    expect(s2.players[1].melds[0].type).toBe('chow');
    expect(s2.players[1].melds[0].kind).toBe(mj.kindOf(t2));
    expect(s2.turn).toBe(1);
    expect(s2.players[1].hand.some((t) => t.id === t2.id)).toBe(false);
    expect(s2.players[1].hand.some((t) => t.id === t4.id)).toBe(false);
  });

  it('没有相邻牌时不能吃', () => {
    const p = new Pool();
    const t3 = p.one('m', 3);
    const st = baseState([
      player({ hand: [t3, ...p.tiles('1m2m4m5m6m7m8m9m1p2p3p1s')] }),
      player({ hand: p.tiles('1m5m6m7m8m9m1p2p3p4p1s2s3s') }),
      player({ hand: p.rest(13) }),
      player({ hand: p.rest(13) }),
    ]);
    const s1 = act(st, 0, { type: 'discard', tile: t3.id });
    expect(gdm.legalActions(s1, 1)?.chi ?? []).toHaveLength(0);
    expect(guangdong.validate(s1, 1, { type: 'chi', tiles: [] })).not.toBeNull();
  });

  it('截胡：同时能胡时归出牌顺序最近的一家', () => {
    const p = new Pool();
    const win = p.one('m', 9);
    // 1 号位与 3 号位都听 9 万
    const st = baseState([
      player({ hand: [win, ...p.tiles('1m2m3m4m5m6m1p2p3p4p5p6p')] }),
      player({ hand: p.tiles('1m2m3m4m5m6m7m8m1p2p3p1s1s') }),
      player({ hand: p.tiles('1p2p3p4p5p6p7p8p9p1p2p3p4p') }),
      player({ hand: p.tiles('1m2m3m4m5m6m7m8m4p5p6p2s2s') }),
    ]);
    const s1 = act(st, 0, { type: 'discard', tile: win.id });
    expect(gdm.legalActions(s1, 1)?.hu).toBe(true);
    expect(gdm.legalActions(s1, 3)?.hu).toBe(true);
    const s2 = act(s1, 1, { type: 'hu' });
    const s3 = act(s2, 3, { type: 'hu' });
    expect(s3.result?.wins).toHaveLength(1);
    expect(s3.result?.wins[0].seat).toBe(1);
    expect(s3.result?.ledger.filter((e) => e.clause === 'pay.dianpao')).toHaveLength(1);
    expect(s3.result?.reason).toBe('hu');
  });

  it('暗杠三家各付 2 分，并补摸一张', () => {
    const p = new Pool();
    const four = [p.one('m', 1), p.one('m', 1), p.one('m', 1), p.one('m', 1)];
    const st = baseState([
      player({ hand: [...four, ...p.tiles('2m3m4m5m6m7m8m1p2p3p')] }),
      player({ hand: p.rest(13) }),
      player({ hand: p.rest(13) }),
      player({ hand: p.rest(13) }),
    ]);
    expect(gdm.legalActions(st, 0)?.gang.some((g) => g.type === 'an')).toBe(true);
    const s1 = act(st, 0, { type: 'gang', tile: four[0].id });
    expect(s1.players[0].melds[0]).toMatchObject({ type: 'kong', kongType: 'an' });
    expect(s1.ledger.filter((e) => e.clause === 'kong.an')).toHaveLength(3);
    expect(s1.ledger.reduce((a, e) => a + e.amount, 0)).toBe(6);
    expect(s1.players[0].hand).toHaveLength(11);
  });

  it('电脑玩家能从开局打到本盘结束', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, steps } = simulate(
        guangdong,
        4,
        { baseScore: 1, rounds: 2, chips: 0, allowChi: true },
        seed,
      );
      expect(steps).toBeGreaterThan(0);
      expect(state.phase).toBe('matchOver');
      expect(state.scores.reduce((a: number, b: number) => a + b, 0)).toBe(0);
    }
  });
});
