import { describe, expect, it } from 'vitest';
import { gd136, guangdong136, simulate } from '../src';
import type { gd136 as Z } from '../src';

type Tile = Z.Tile;
type State = Z.GdState;

// 夹具：用 "123m456t789p" 记法生成牌，m 万、t 条、p 筒；E/S/W/N 为东南西北，C/F/B 为中发白。
// 字牌不跟数字，直接写 E 就是一张東。

const SUIT: Record<string, number> = { m: 0, t: 9, p: 18 };
const HONOR: Record<string, number> = { E: 27, S: 28, W: 29, N: 30, C: 31, F: 32, B: 33 };

class Pool {
  used = new Map<number, number>();
  ids = new Set<number>();

  tiles(spec: string): Tile[] {
    const out: Tile[] = [];
    let digits: string[] = [];
    for (const ch of spec.replace(/\s+/g, '')) {
      if (/\d/.test(ch)) digits.push(ch);
      else if (ch in HONOR) {
        const times = digits.length || 1;
        for (const d of digits) void d;
        for (let i = 0; i < times; i++) out.push(this.one(ch));
        digits = [];
      } else {
        for (const d of digits) out.push(this.one(ch, Number(d)));
        digits = [];
      }
    }
    return out;
  }

  one(spec: string, rank = 0): Tile {
    const kind = spec in HONOR ? HONOR[spec] : SUIT[spec] + rank - 1;
    const copy = this.used.get(kind) ?? 0;
    if (copy >= 4) throw new Error(`more than 4 of ${spec}${rank || ''}`);
    this.used.set(kind, copy + 1);
    const id = kind * 4 + copy;
    this.ids.add(id);
    return { id, kind };
  }

  /** 从没用过的牌里凑 n 张 */
  rest(n: number): Tile[] {
    const out: Tile[] = [];
    for (let id = 0; id < 136; id++) {
      if (this.ids.has(id)) continue;
      this.ids.add(id);
      out.push({ id, kind: Math.floor(id / 4) });
      if (out.length === n) break;
    }
    return out;
  }
}

const counts = (spec: string) => gd136.countKinds(new Pool().tiles(spec));
const NO_CTX = {
  selfDrawn: false,
  afterKong: false,
  robbing: false,
  haidi: false,
  tianhu: false,
  dihu: false,
};

function player(p: Partial<Z.GdPlayer> = {}): Z.GdPlayer {
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

function baseState(players: Z.GdPlayer[], options: Partial<Z.GdOptions> = {}): State {
  const s = guangdong136.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    options: { ...guangdong136.defaultOptions, ...options },
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
  };
}

const act = (s: State, seat: number, a: Z.GdAction) => {
  const err = guangdong136.validate(s, seat, a);
  if (err) throw new Error(`seat ${seat} ${JSON.stringify(a)}: ${err}`);
  return guangdong136.apply(s, seat, a);
};

const settle = (s: State) => {
  let out = s;
  for (const seat of [1, 2, 3, 0]) {
    const l = gd136.legalActions(out, seat);
    if (l?.pass && out.window) out = act(out, seat, { type: 'pass' });
  }
  return out;
};

// ---------------------------------------------------------------------------

describe('广东字牌版 · 牌张与牌型', () => {
  it('使用 136 张牌，含 34 种（三门序数牌 + 四风 + 三箭）', () => {
    const all = gd136.createTiles();
    expect(all).toHaveLength(136);
    expect(all.filter((t) => t.kind >= 27)).toHaveLength(28);
    expect(gd136.kindLabel(27)).toBe('東');
    expect(gd136.kindLabel(33)).toBe('白');
    expect(gd136.isHonorKind(31)).toBe(true);
    expect(gd136.canStartChow(26)).toBe(false);
  });

  it('平胡 1 番（鸡平胡），老章 1 番不够起胡', () => {
    const v = gd136.evaluateHand(counts('123456789m123t99p'), [], 'jipinghu');
    expect(v?.patterns).toContain('pinghu');
    expect(v?.qualifies).toBe(true);
    expect(gd136.scoreWin(v!, NO_CTX, 1, 'jipinghu').fanRaw).toBe(1);

    const lz = gd136.evaluateHand(counts('123456789m123t99p'), [], 'laozhang');
    expect(lz?.qualifies).toBe(false);
  });

  it('碰碰胡 3 番；带字牌刻子也算碰碰胡', () => {
    const v = gd136.evaluateHand(counts('111m222t333p111E22S'), []);
    expect(v?.patterns).toContain('pengpeng');
    expect(v?.baseFan).toBe(3);
  });

  it('清一色与碰碰胡相加；鸡平胡封顶 8 番、老章封顶 10 番', () => {
    const v = gd136.evaluateHand(counts('111222333444m55m'), []);
    expect(v?.patterns).toEqual(expect.arrayContaining(['pengpeng', 'qingyise']));
    expect(v?.baseFan).toBe(9);
    expect(gd136.scoreWin(v!, NO_CTX, 1, 'jipinghu').fanCharged).toBe(8);
    expect(gd136.scoreWin(v!, NO_CTX, 1, 'jipinghu').points).toBe(128);
    // 老章番表另有 1 番门前清，单看这手清碰是 9 番
    const lz = gd136.evaluateHand(counts('111222333444m55m'), [], 'laozhang')!;
    expect(lz.baseFan).toBe(10);
    expect(gd136.scoreWin(lz, NO_CTX, 1, 'laozhang').fanCharged).toBe(10);
  });

  it('混一色、大三元、字一色、十三幺', () => {
    const hun = gd136.evaluateHand(counts('123m456m789m111E22m'), []);
    expect(hun?.patterns).toContain('hunyise');
    expect(hun?.baseFan).toBe(1 + 3);

    const dasan = gd136.evaluateHand(counts('111C222F333B111m55m'), []);
    expect(dasan?.patterns).toContain('dasanyuan');

    const zi = gd136.evaluateHand(counts('111E222S333W444N55C'), []);
    expect(zi?.patterns).toEqual(expect.arrayContaining(['ziyise', 'pengpeng']));

    const shisanyi = gd136.evaluateHand(counts('1m9m1t9t1p9pESWNCFB1m'), []);
    expect(shisanyi?.skeleton).toBe('shisanyi');
    expect(gd136.scoreWin(shisanyi!, NO_CTX, 1).points).toBe(128);
    expect(gd136.scoreWin(shisanyi!, NO_CTX, 1, 'laozhang').points).toBe(512);
  });

  it('七小对 4 番，带四张为豪华七对 6 番', () => {
    const qidui = gd136.evaluateHand(counts('1122m3344t5566pEE'), []);
    expect(qidui?.patterns).toEqual(['qidui']);
    expect(qidui?.baseFan).toBe(4);

    const haohua = gd136.evaluateHand(counts('1111m2233t4455pEE'), []);
    expect(haohua?.patterns).toEqual(['haohuaqidui']);
    expect(haohua?.baseFan).toBe(6);
  });

  it('副露的顺子计入牌型', () => {
    const v = gd136.evaluateHand(counts('123m456m789m99p'), [{ type: 'chow', kind: 18 }]);
    expect(v).not.toBeNull();
    expect(v!.patterns).toContain('pinghu');
  });
});

describe('广东字牌版 · 流程', () => {
  it('字牌不能吃，可以碰', () => {
    const p = new Pool();
    const zhong = p.one('C');
    const st = baseState([
      player({ hand: [zhong, ...p.tiles('123m456m789t12p3p')] }),
      player({ hand: new Pool().tiles('CC123t456t123p11p') }),
      player({ hand: p.rest(13) }),
      player({ hand: p.rest(13) }),
    ]);
    const s1 = act(st, 0, { type: 'discard', tile: zhong.id });
    const L = gd136.legalActions(s1, 1);
    expect(L?.peng).toBe(true);
    expect(L?.chi ?? []).toHaveLength(0);
    expect(gd136.chowOptions([p.one('C'), p.one('C')], 31)).toHaveLength(0);

    const s2 = settle(act(s1, 1, { type: 'peng' }));
    expect(s2.players[1].melds[0].type).toBe('pung');
    expect(s2.turn).toBe(1);
  });

  it('老章三番起胡：牌型成立但番数不够时不能胡，界面能看到差番提示', () => {
    const p = new Pool();
    const hand = '123m456m789t123p11E'; // 鸡胡：老章只有 门前清 + 自摸 = 2 番
    const lz = baseState(
      [
        player({ hand: p.tiles(hand) }),
        player({ hand: p.rest(13) }),
        player({ hand: p.rest(13) }),
        player({ hand: p.rest(13) }),
      ],
      { scoring: 'laozhang' },
    );
    expect(gd136.legalActions(lz, 0)?.hu).toBe(false);
    expect(guangdong136.view(lz, 0).nearWin).toMatchObject({ fan: 1, need: 3 });

    const q = new Pool();
    const jp = baseState(
      [
        player({ hand: q.tiles(hand) }),
        player({ hand: q.rest(13) }),
        player({ hand: q.rest(13) }),
        player({ hand: q.rest(13) }),
      ],
      { scoring: 'jipinghu' },
    );
    expect(gd136.legalActions(jp, 0)?.hu).toBe(true);
  });

  it('截胡：同时能胡时归出牌顺序最近的一家', () => {
    const p = new Pool();
    const win = p.one('E');
    const st = baseState([
      player({ hand: [win, ...p.tiles('123m456m789t123p')] }),
      player({ hand: p.tiles('123m456m789t111pE') }),
      player({ hand: p.rest(13) }),
      player({ hand: p.tiles('123m456m789p234tE') }),
    ]);
    const s1 = act(st, 0, { type: 'discard', tile: win.id });
    expect(gd136.legalActions(s1, 1)?.hu).toBe(true);
    expect(gd136.legalActions(s1, 3)?.hu).toBe(true);
    const s3 = settle(act(act(s1, 1, { type: 'hu' }), 3, { type: 'hu' }));
    expect(s3.result?.wins).toHaveLength(1);
    expect(s3.result?.wins[0].seat).toBe(1);
    expect(s3.result?.reason).toBe('hu');
  });

  it('暗杠三家各付 2 分', () => {
    const p = new Pool();
    const four = p.tiles('CCCC');
    const st = baseState([
      player({ hand: [...four, ...p.tiles('123m456m789t1p')] }),
      player({ hand: p.rest(13) }),
      player({ hand: p.rest(13) }),
      player({ hand: p.rest(13) }),
    ]);
    const s1 = act(st, 0, { type: 'gang', tile: four[0].id });
    expect(s1.players[0].melds[0]).toMatchObject({ type: 'kong', kongType: 'an' });
    expect(s1.ledger.filter((e) => e.clause === 'kong.an')).toHaveLength(3);
    expect(s1.ledger.reduce((a, e) => a + e.amount, 0)).toBe(6);
  });

  it('两套番制都能由电脑打到整场结束，分数守恒', () => {
    for (const scoring of ['jipinghu', 'laozhang'] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const { state } = simulate(
          guangdong136,
          4,
          { ...guangdong136.defaultOptions, scoring, rounds: 2 },
          seed,
        );
        expect(state.phase).toBe('matchOver');
        expect(state.scores.reduce((a: number, b: number) => a + b, 0)).toBe(0);
      }
    }
  });
});
