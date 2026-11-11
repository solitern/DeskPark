import { describe, expect, it } from 'vitest';
import type { sz as SZ } from '../src';
import { Rng, hz, simulate, sz, suichang } from '../src';

type Tile = SZ.Tile;
type State = SZ.SzState;

// ---------------------------------------------------------------------------
// 夹具：123m 456p 11s EE 记法（m 万、s 条、p 筒；E 东 S 南 W 西 N 北 Z 中 F 发 B 白）

const HONOR: Record<string, number> = { E: 27, S: 28, W: 29, N: 30, Z: 31, F: 32, B: 33 };

class Pool {
  used = new Map<number, number>();
  one(kind: number): Tile {
    const copy = this.used.get(kind) ?? 0;
    this.used.set(kind, copy + 1);
    return hz.hzTileOf(kind * 4 + (copy % 4));
  }
  tiles(spec: string): Tile[] {
    const out: Tile[] = [];
    for (const token of spec.split(/\s+/).filter(Boolean)) {
      const m = /^(\d+)([msp])$/.exec(token);
      if (m) {
        const suitIndex = m[2] === 'm' ? 0 : m[2] === 's' ? 1 : 2;
        for (const ch of m[1]) out.push(this.one(suitIndex * 9 + Number(ch) - 1));
      } else {
        for (const ch of token) {
          const kind = HONOR[ch];
          if (kind === undefined) throw new Error(`bad token ${token}`);
          out.push(this.one(kind));
        }
      }
    }
    return out;
  }
}

const kindOf = (spec: string) => hz.hzKindOf(new Pool().tiles(spec)[0]);

const CTX: SZ.WinContext = {
  selfDrawn: false,
  afterKong: false,
  tianhu: false,
  dihu: false,
  flyBonus: false,
  explosive: false,
};

const win = (spec: string, melds: SZ.MeldShape[] = [], jokerKind: number | null = null, ctx = {}) => {
  const tiles = new Pool()
    .tiles(spec)
    .map((t) => (jokerKind !== null && hz.hzKindOf(t) === jokerKind ? { ...t, joker: true } : t));
  const opts = ctx as Record<string, unknown>;
  const winningTileId =
    (opts.winningTileId as number | undefined) ??
    (opts.selfDrawn ? tiles[tiles.length - 1]?.id : undefined);
  return sz.evaluateWin(tiles, melds, jokerKind, { ...CTX, ...ctx, winningTileId });
};

function player(p: Partial<SZ.SzPlayer> = {}): SZ.SzPlayer {
  return { hand: [], melds: [], river: [], hasDrawn: true, ...p };
}

function baseState(players: SZ.SzPlayer[], patch: Partial<State> = {}): State {
  const s = suichang.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    options: { sessions: 1, chi: true, joker: false },
    seed: 1,
  });
  return {
    ...s,
    phase: 'play',
    window: null,
    players,
    dealer: 0,
    dealerStreak: 0,
    chips: [50, 50, 50, 50],
    roundLedger: [],
    pending: [],
    wins: [],
    discards: 5,
    claims: 1,
    drawn: null,
    canSelfHu: true,
    afterKong: false,
    dihuChance: false,
    jokerKind: null,
    flip: null,
    fly: null,
    flyBonus: [false, false, false, false],
    ready: [false, false, false, false],
    ...patch,
  };
}

const act = (s: State, seat: number, a: SZ.SzAction) => {
  const err = suichang.validate(s, seat, a);
  if (err) throw new Error(`seat ${seat} ${JSON.stringify(a)}: ${err}`);
  return suichang.apply(s, seat, a);
};

const JUNK = [
  '1m 3m 5m 7m 9m 2s 4s 6s 8s 1p 3p 5p 7p',
  '2m 4m 6m 8m 1s 3s 5s 7s 9s 2p 4p 6p 8p',
  '1m 4m 7m 2s 5s 8s 1p 4p 7p 2m 5m 8m 3s',
  '3m 6m 9m 3s 6s 9s 3p 6p 9p 1m 2m 4m 6m',
];

// ---------------------------------------------------------------------------

describe('遂昌麻将 · 牌与开局', () => {
  it('136 张，翻开的牌本身是财神，场上只剩 3 张', () => {
    const s = suichang.setup({
      players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
      options: { sessions: 1, chi: true, joker: true },
      seed: 7,
    });
    expect(s.wall).toHaveLength(48);
    expect(s.reserve).toHaveLength(34);
    expect(s.flip).not.toBeNull();
    const flipKind = hz.hzKindOf(s.flip!);
    expect(s.jokerKind).toBe(flipKind);
    const allTiles = [
      ...s.wall,
      ...s.reserve,
      ...(s.flip ? [s.flip] : []),
      ...s.players.flatMap((p) => p.hand),
    ];
    // 翻出的种类剩 3 张才是万能财神；白板（若翻到的不是白板）变成该种类的普通牌
    expect(allTiles.filter((t) => t.joker)).toHaveLength(3);
    if (flipKind !== kindOf('B')) {
      expect(allTiles.filter((t) => t.sub)).toHaveLength(4);
      expect(allTiles.filter((t) => t.sub).every((t) => hz.hzKindOf(t) === flipKind)).toBe(true);
    }
    // 白板当一万：白板 23789 万 123 筒 123 条 东东 可以胡
    const one = kindOf('1m');
    const subWhite = { ...new Pool().one(one), sub: true };
    expect(
      sz.evaluateWin(
        [...new Pool().tiles('23789m 123p 123s EE'), subWhite],
        [],
        one,
        CTX,
      ),
    ).not.toBeNull();
    const all = allTiles.map((t) => t.id);
    expect(all).toHaveLength(136);
    expect(new Set(all).size).toBe(136);
    expect(s.chips).toEqual([50, 50, 50, 50]);
  });
});

describe('遂昌麻将 · 番与计分', () => {
  it('平胡 0 番 = 1 倍；自摸 +1 番', () => {
    expect(win('123m 456m 789m 123s 55p')!.fan).toBe(0);
    expect(win('123m 456m 789m 123s 55p', [], null, { selfDrawn: true })!.fan).toBe(1);
  });

  it('碰碰胡 / 混一色 / 七对 / 清一色 / 字一色 / 豪华七对', () => {
    expect(win('111m 333m 555p 777s 99p')!.fan).toBe(1);
    expect(win('123m 456m 789m EEE 55m')!.fan).toBe(1);
    expect(win('1122334455m 6677p')!.fan).toBe(1);
    expect(win('123456789m 234m 55m')!.fan).toBe(2);
    expect(win('11112233445566m')!.fan).toBe(4); // 清一色 2 + 七对 1 + 豪华 1
    expect(win('EEE SSS WWW NNN ZZ')!.fan).toBe(4); // 字一色 3 + 碰碰胡 1
  });

  it('不搭：普通 0 番，正规 +1，豪华 +2，超豪华 +3', () => {
    const ordinary = win('E S W N Z 147m 258p 149s')!;
    expect(ordinary.buda).toBe('ordinary');
    expect(ordinary.fan).toBe(0);
    expect(win('E S W N Z 147m 147p 258s')!.buda).toBe('regular');
    expect(win('E S W N Z 147m 258p 369s')!.buda).toBe('luxury');
    expect(win('E S W N Z 147m 147p 147s')!.buda).toBe('ultra');
    expect(win('E S W N Z 147m 147p 147s')!.fan).toBe(3);
    expect(win('E S W N Z 147m 147p 147s', [], null, { selfDrawn: true })!.fan).toBe(4);
  });

  it('不搭可以点炮、可以叠自摸；财神可以补位', () => {
    const v = win('E S W N Z 147m 258p 149s', [], null, { selfDrawn: true })!;
    expect(v.buda).toBe('ordinary');
    expect(v.fan).toBe(1);
    // 财神补一张 9 条 → 豪华不搭
    const jokerKind = kindOf('1p');
    const withJoker = win('E S W N Z 147m 258p 36s 1p', [], jokerKind)!;
    expect(withJoker.buda).toBe('luxury');
  });

  it('不搭里白板算字牌：白板 + 5 字 + 147/258/369 = 豪华不搭', () => {
    const sub = { ...new Pool().one(kindOf('1m')), sub: true };
    const hand = [...new Pool().tiles('258m 147s 369p E S W N'), sub];
    const v = sz.evaluateWin(hand, [], kindOf('1m'), CTX)!;
    expect(v.buda).toBe('luxury');
    expect(v.fan).toBe(2);
  });

  it('七风里白板也算白板字牌', () => {
    const sub = { ...new Pool().one(kindOf('1m')), sub: true };
    const hand = [...new Pool().tiles('147m 258p 9s E S W N Z F'), sub];
    const v = sz.evaluateWin(hand, [], kindOf('1m'), CTX)!;
    expect(v.buda).toBe('ordinary');
    expect(v.patterns.map((p) => p.id)).toContain('qifeng');
    expect(v.fan).toBe(1);
  });

  it('敲头：财神做将，听所有牌，只能自摸', () => {
    const jokerKind = kindOf('1p');
    const pool = new Pool();
    const joker = { ...pool.one(jokerKind), joker: true };
    const tiles = [...pool.tiles('123m 456m 789m 123s'), joker, pool.one(kindOf('5p'))];
    const v = sz.evaluateWin(tiles, [], jokerKind, { ...CTX, selfDrawn: true, explosive: true })!;
    expect(v.fan).toBe(2); // 敲头 1 + 自摸 1
    // 13 张的敲头听牌形
    const hand13 = [...pool.tiles('123m 456m 789m 123s'), joker];
    expect(sz.isExplosiveHand(hand13, jokerKind, 0)).toBe(true);
    expect(sz.handWaits(hand13, jokerKind, 0)).toHaveLength(34);
  });

  it('七对敲头：6 个对子 + 财神，胡任意牌，3 番（8 倍）', () => {
    const jokerKind = kindOf('1s');
    const v = win('11m 33m 55m 77m 99m 11p 1s 5p', [], jokerKind, { selfDrawn: true })!;
    expect(v.patterns.map((p) => p.id)).toEqual(
      expect.arrayContaining(['qidui', 'qiaotou', 'zimo']),
    );
    expect(v.fan).toBe(3); // 七对 1 + 敲头 1 + 自摸 1
    // 听任意牌
    const pool = new Pool();
    const joker = { ...pool.one(jokerKind), joker: true };
    const hand13 = [...pool.tiles('11m 33m 55m 77m 99m 11p'), joker];
    expect(sz.isSevenPairsQiaotouHand(hand13, jokerKind)).toBe(true);
    expect(sz.handWaits(hand13, jokerKind, 0)).toHaveLength(34);
    // 豪华七对敲头：豪华 +1，共 4 番（16 倍）
    const hh = win('1111p 22m 33m 44m 55m 1s 6p', [], jokerKind, { selfDrawn: true })!;
    expect(hh.patterns.map((p) => p.id)).toEqual(
      expect.arrayContaining(['qidui', 'haohua', 'qiaotou', 'zimo']),
    );
    expect(hh.fan).toBe(4);
  });

  it('多财神七对点炮只算七对，不算敲头', () => {
    const jokerKind = kindOf('1s');
    const v = win('11m 33m 55m 77m 99m 2p 1s 1s 5p', [], jokerKind)!;
    expect(v.patterns.map((p) => p.id)).toContain('qidui');
    expect(v.patterns.map((p) => p.id)).not.toContain('qiaotou');
    expect(v.fan).toBe(1);
  });

  it('多财神七对敲头：两个财神也听任意牌', () => {
    const jokerKind = kindOf('1s');
    const v = win('11m 33m 55m 77m 99m 2p 1s 1s 5p', [], jokerKind, {
      selfDrawn: true,
    })!;
    expect(v.patterns.map((p) => p.id)).toEqual(
      expect.arrayContaining(['qidui', 'qiaotou', 'zimo']),
    );
    expect(v.fan).toBe(3);
    const pool = new Pool();
    const jokers = [
      { ...pool.one(jokerKind), joker: true },
      { ...pool.one(jokerKind), joker: true },
    ];
    const hand13 = [...pool.tiles('11m 33m 55m 77m 99m 2p'), ...jokers];
    expect(sz.isSevenPairsQiaotouHand(hand13, jokerKind)).toBe(true);
  });

  it('白板当一万：白板 23789万 123筒 123条 东东 可以胡', () => {
    const one = kindOf('1m');
    const subWhite = { ...new Pool().one(one), sub: true };
    const hand = [...new Pool().tiles('23789m 123p 123s EE'), subWhite];
    const v = sz.evaluateWin(hand, [], one, CTX);
    expect(v).not.toBeNull();
    expect(v!.fan).toBe(0);
  });

  it('七风：七张字牌齐全 +1 番，财神不能补缺', () => {
    const hand = 'E S W N Z F B 147m 258p 9s';
    const v = win(hand)!;
    expect(v.buda).toBe('ordinary');
    expect(v.fan).toBe(1);
    expect(v.patterns.map((p) => p.id)).toContain('qifeng');
    expect(win(hand, [], null, { selfDrawn: true })!.fan).toBe(2);
    // 缺东、用别的财神补：能胡，但不算七风
    const jokerKind = kindOf('1p');
    const noEast = win('S W N Z F B 147m 258p 9s 1p', [], jokerKind)!;
    expect(noEast.buda).toBe('ordinary');
    expect(noEast.fan).toBe(0);
    // 财神正好是东：可以当东用，算七风
    const eastJoker = win('S W N Z F B 147m 258p 9s E', [], kindOf('E'))!;
    expect(eastJoker.fan).toBe(1);
  });

  it('全落地：4 组副露 + 将 +1 番（吃碰杠都算）', () => {
    const melds: SZ.MeldShape[] = [
      { type: 'chi', kind: kindOf('1m') },
      { type: 'chi', kind: kindOf('4m') },
      { type: 'chi', kind: kindOf('7m') },
      { type: 'chi', kind: kindOf('1p') },
    ];
    const v = win('55s', melds)!;
    expect(v.patterns.map((p) => p.id)).toContain('quanluodi');
    expect(v.fan).toBe(1);
    // 四组碰 + 将：碰碰胡 1 + 全落地 1
    const pungs: SZ.MeldShape[] = ['1m', '3m', '5m', '7p'].map((s) => ({
      type: 'pung' as const,
      kind: kindOf(s),
    }));
    const pv = win('99s', pungs)!;
    expect(pv.fan).toBe(2);
    expect(pv.patterns.map((p) => p.id)).toEqual(expect.arrayContaining(['pengpeng', 'quanluodi']));
  });

  it('天胡 / 地胡 +2 番，不再叠自摸', () => {
    expect(win('123m 456m 789m 123s 55p', [], null, { selfDrawn: true, tianhu: true })!.fan).toBe(2);
    expect(win('123m 456m 789m 123s 55p', [], null, { selfDrawn: true, dihu: true })!.fan).toBe(2);
  });

  it('飞财自摸 +1 番', () => {
    expect(
      win('123m 456m 789m 123s 55p', [], null, { selfDrawn: true, flyBonus: true })!.fan,
    ).toBe(2);
  });
});

describe('遂昌麻将 · 支付', () => {
  it('一庄自摸平胡：三家各付 12', () => {
    const pool = new Pool();
    const players = [
      player({ hand: pool.tiles('123m 456m 789m 123s 55p') }),
      player({ hand: pool.tiles(JUNK[1]) }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0, dealer: 0 });
    s = act(s, 0, { type: 'hu' });
    expect(s.chips).toEqual([86, 38, 38, 38]);
  });

  it('庄家点炮：庄赔 48、两个闲各 20（截图中的 1 盘 1 局）', () => {
    const pool = new Pool();
    const nine = pool.one(kindOf('9s'));
    const players = [
      player({ hand: pool.tiles('E S W N Z 147m 258p 36s') }),
      player({ hand: [...pool.tiles('2468m 1357s 2468p 1p'), nine] }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    // 九尾（1 号位）是本局庄家，也是点炮者；铁蛋（2 号位）只是下一局坐庄
    let s = baseState(players, { turn: 1, dealer: 1 });
    s = act(s, 1, { type: 'discard', tile: nine.id });
    s = act(s, 0, { type: 'hu' });
    expect(s.result!.wins[0].score.fan).toBe(2); // 豪华不搭
    expect(s.result!.dealer).toBe(1);
    expect(s.result!.dealerBase).toBe(6);
    expect(s.result!.nextDealer).toBe(2);
    expect(s.result!.deltas).toEqual([88, -48, -20, -20]);
    expect(s.chips).toEqual([138, 2, 30, 30]);
  });

  it('闲家点炮胡：点炮者 10、庄 6、另一闲 5', () => {
    const pool = new Pool();
    const five = pool.one(kindOf('5p'));
    const players = [
      player({ hand: pool.tiles(JUNK[0]) }),
      player({ hand: pool.tiles('123m 456m 789m 123s 5p') }),
      player({ hand: [...pool.tiles(JUNK[2].replace('3s', '2s')), five] }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 2, dealer: 0 });
    s = act(s, 2, { type: 'discard', tile: five.id });
    expect(s.window?.kind).toBe('claims');
    s = act(s, 1, { type: 'hu' });
    expect(s.chips).toEqual([44, 71, 40, 45]);
  });

  it('清碰自摸：闲家赢，庄付 96、两个闲各付 80（筹码足够时）', () => {
    const pool = new Pool();
    const players = [
      player({ hand: pool.tiles(JUNK[0]) }),
      player({ hand: pool.tiles('111m 333m 555m 777m 99m') }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 1, chips: [200, 200, 200, 200] });
    s = act(s, 1, { type: 'hu' });
    expect(s.chips).toEqual([104, 456, 120, 120]);
    expect(s.result!.wins[0].score.fan).toBe(4);
  });

  it('荒庄：庄家给三家各 5，继续坐庄且底分 +2', () => {
    const pool = new Pool();
    const players = [
      player({ hand: [...pool.tiles('1m 4m 7m 9m 2s 6s 8s 1p 3p 5p 7p 9p'), pool.one(kindOf('9m'))] }),
      player({ hand: pool.tiles(JUNK[1]) }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0, wall: [] });
    s = act(s, 0, { type: 'discard', tile: s.players[0].hand[0].id });
    expect(s.phase).toBe('roundOver');
    expect(s.result!.reason).toBe('wall');
    expect(s.chips).toEqual([35, 55, 55, 55]);
    expect(s.dealerStreak).toBe(1);
  });

  it('抢杠承包：只有杠的人付，平胡 50、碰碰胡 100，盘末结算', () => {
    const pool = new Pool();
    const pung = pool.tiles('333m');
    const fourth = pool.one(kindOf('3m'));
    const players = [
      player({ hand: [...pool.tiles('5p 6p 7p 8p 9p 1s 3s 5s 7s 9s'), fourth] }),
      player({ hand: pool.tiles('12m 456p 789p 123s 55s') }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0, wall: pool.tiles('1m 4m 7m 9m 2s') });
    s.players[0].melds = [{ type: 'pung', kind: kindOf('3m'), tiles: pung, from: 3 }];
    s = act(s, 0, { type: 'gang', tile: fourth.id });
    expect(s.window?.kind).toBe('rob');
    s = act(s, 1, { type: 'hu' });
    expect(s.result!.pending).toHaveLength(1);
    expect(s.result!.pending[0]).toMatchObject({ from: 0, to: 1, due: 50, clause: 'pay.rob' });
    expect(s.chips).toEqual([50, 50, 50, 50]);
  });

  it('三清：一手把三家都打到 0，每家再付 50', () => {
    const pool = new Pool();
    const players = [
      player({ hand: pool.tiles(JUNK[0]) }),
      player({ hand: pool.tiles('111m 333m 555m 777m 99m') }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 1 });
    s = act(s, 1, { type: 'hu' });
    expect(s.chips.every((c) => c <= 0 || c >= 300)).toBe(true);
    expect(s.sessionResult!.sanqing).toBe(true);
    expect(s.phase).toBe('matchOver');
    expect(s.sessionResult!.chips.reduce((a, b) => a + b, 0)).toBe(200);
    expect(s.sessionResult!.chips[1]).toBe(350);
  });
});

describe('遂昌麻将 · 行牌', () => {
  it('截胡：只给离出牌者最近的一家胡', () => {
    const pool = new Pool();
    const five = pool.one(kindOf('5p'));
    const players = [
      player({ hand: [...pool.tiles(JUNK[0].replace('7p', '9p')), five] }),
      player({ hand: pool.tiles('123m 456m 789m 123s 5p') }),
      player({ hand: pool.tiles('123p 456p 789p 789s 5p') }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0 });
    s = act(s, 0, { type: 'discard', tile: five.id });
    expect(s.window!.options[1]).toContain('hu');
    expect(s.window!.options[2] ?? []).not.toContain('hu');
  });

  it('财神不能用来吃', () => {
    const pool = new Pool();
    const jokerKind = kindOf('5m');
    const six = pool.one(kindOf('6m'));
    const joker = { ...pool.one(jokerKind), joker: true };
    const players = [
      player({ hand: [...pool.tiles(JUNK[0].replace('7p', '9p')), six] }),
      player({ hand: [...pool.tiles('4m 1p 2p 1s 2s 3s 4s 5s 6s 7s 8s 9s'), joker] }),
      player({ hand: [...pool.tiles(JUNK[2]), ...pool.tiles('66m')] }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0, jokerKind });
    s = act(s, 0, { type: 'discard', tile: six.id });
    // 1 号位有 4 万 + 财神（5 万），但财神不能用来吃 6 万
    expect(s.window).not.toBeNull();
    expect(s.window!.options[1] ?? []).not.toContain('chi');
  });

  it('飞财：打出的财神作废；一圈内不能吃碰点炮，飞财者下一次自摸 +1 番', () => {
    const pool = new Pool();
    const jokerKind = kindOf('1p');
    const joker = { ...pool.one(jokerKind), joker: true };
    const players = [
      player({ hand: [...pool.tiles('2345678m 234s 567p'), joker] }),
      player({ hand: pool.tiles(JUNK[1]) }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, {
      turn: 0,
      jokerKind,
      flip: pool.one(kindOf('9p')),
      wall: pool.tiles('1m 4m 7m 9m 2s 5s 8s 1p 4p 7p'),
    });
    s = act(s, 0, { type: 'discard', tile: joker.id });
    // 打出去之后先轮到下家摸一张，所以还剩 2 家
    expect(s.fly).toEqual({ seat: 0, left: 2 });
    expect(s.flyBonus[0]).toBe(true);
    // 下家、对家、上家各摸一次（中途若有应牌窗口就全部过掉）
    for (let step = 0; step < 3; step++) {
      const seat = s.turn;
      s = act(s, seat, { type: 'discard', tile: s.players[seat].hand[0].id });
      while (s.window) {
        const waiter = s.window.required.findIndex(
          (r, idx) => r && s.window!.decisions[idx] === null,
        );
        s = act(s, waiter, { type: 'pass' });
      }
    }
    expect(s.fly).toBeNull();
    expect(s.turn).toBe(0);
    expect(s.flyBonus[0]).toBe(true);
  });

  it('敲头不听点炮：4 面 + 财神 的牌型不会被别人点炮胡', () => {
    const pool = new Pool();
    const jokerKind = kindOf('1p');
    const joker = { ...pool.one(jokerKind), joker: true };
    const five = pool.one(kindOf('5p'));
    const players = [
      player({ hand: [...pool.tiles(JUNK[0].replace('7p', '9p')), five] }),
      player({ hand: [...pool.tiles('123m 456m 789m 123s'), joker] }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0, jokerKind });
    s = act(s, 0, { type: 'discard', tile: five.id });
    expect(s.window).toBeNull();
    expect(s.turn).toBe(1);
  });

  it('七对敲头不听点炮：6 对 + 财神 只能自摸', () => {
    const pool = new Pool();
    const jokerKind = kindOf('1s');
    const joker = { ...pool.one(jokerKind), joker: true };
    const one = pool.one(kindOf('1m'));
    const players = [
      player({ hand: [...pool.tiles(JUNK[0]), one] }),
      player({ hand: [...pool.tiles('11m 33m 55m 77m 99m 11p'), joker] }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0, jokerKind });
    s = act(s, 0, { type: 'discard', tile: one.id });
    // 1 号位可以碰 1 万，但不能点炮胡
    expect(s.window).not.toBeNull();
    expect(s.window!.options[1] ?? []).not.toContain('hu');
    expect(s.window!.options[1] ?? []).toContain('peng');
  });
  it('多财神七对敲头不听点炮', () => {
    const pool = new Pool();
    const jokerKind = kindOf('1s');
    const jokers = [
      { ...pool.one(jokerKind), joker: true },
      { ...pool.one(jokerKind), joker: true },
    ];
    const one = pool.one(kindOf('1m'));
    const players = [
      player({ hand: [...pool.tiles(JUNK[0]), one] }),
      player({ hand: [...pool.tiles('11m 33m 55m 77m 99m 2p'), ...jokers] }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, { turn: 0, jokerKind });
    s = act(s, 0, { type: 'discard', tile: one.id });
    // 1 号位可以碰 1 万，但多财神敲头也只能自摸
    expect(s.window).not.toBeNull();
    expect(s.window!.options[1] ?? []).not.toContain('hu');
    expect(s.window!.options[1] ?? []).toContain('peng');
  });
});

describe('遂昌麻将 · 调试', () => {
  it('debug 为指定座位预留下一张牌', () => {
    const pool = new Pool();
    const players = [0, 1, 2, 3].map(() => player());
    const s = baseState(players, { wall: pool.tiles('1m 2m 3m 4m') });
    const next = act(s, 0, { type: 'debug', kind: kindOf('3m') });
    expect(next.debugDraw?.seat).toBe(0);
    expect(hz.hzKindOf(next.debugDraw!.tile)).toBe(kindOf('3m'));
    expect(next.wall.map((t) => hz.hzKindOf(t))).not.toContain(kindOf('3m'));
    expect(next.wall).toHaveLength(3);
  });

  it('debug 的牌留给指定座位，不会给下一位摸牌的人', () => {
    const pool = new Pool();
    const one = pool.one(kindOf('1m'));
    const debugTile = pool.one(kindOf('3m'));
    const players = [
      player({ hand: [...pool.tiles(JUNK[0]), one] }),
      player({ hand: pool.tiles(JUNK[1]) }),
      player({ hand: pool.tiles(JUNK[2]) }),
      player({ hand: pool.tiles(JUNK[3]) }),
    ];
    let s = baseState(players, {
      turn: 0,
      wall: pool.tiles('2m 4m 5m 6m'),
      debugDraw: { seat: 1, tile: debugTile },
    });
    s = act(s, 0, { type: 'discard', tile: one.id });
    while (s.window) {
      const waiter = s.window.required.findIndex(
        (r, idx) => r && s.window!.decisions[idx] === null,
      );
      s = act(s, waiter, { type: 'pass' });
    }
    expect(s.players[1].hand.some((t) => t.id === debugTile.id)).toBe(true);
    expect(s.debugDraw).toBeNull();
  });

  it('debug 优先发真财神，不发白板替身', () => {
    const pool = new Pool();
    const jokerKind = kindOf('1p');
    const sub = { ...pool.one(jokerKind), sub: true };
    const real = { ...pool.one(jokerKind), joker: true };
    const players = [0, 1, 2, 3].map(() => player());
    const s = baseState(players, { wall: [sub, real] });
    const next = act(s, 0, { type: 'debug', kind: jokerKind });
    expect(next.debugDraw?.tile.joker).toBe(true);
    expect(next.debugDraw?.tile.id).toBe(real.id);
  });

  it('debug 指定的牌不在牌墙里时校验失败', () => {
    const pool = new Pool();
    const players = [0, 1, 2, 3].map(() => player());
    const s = baseState(players, { wall: pool.tiles('1m') });
    expect(suichang.validate(s, 0, { type: 'debug', kind: kindOf('9p') })).not.toBeNull();
  });
});

describe('遂昌麻将 · 整盘模拟', () => {
  function allTileIds(s: State): number[] {
    const ids = [
      ...s.wall.map((t) => t.id),
      ...s.reserve.map((t) => t.id),
      ...(s.flip ? [s.flip.id] : []),
      ...s.players.flatMap((p) =>
        [...p.hand, ...p.melds.flatMap((m) => m.tiles), ...p.river.map((r) => r.tile)].map(
          (t) => t.id,
        ),
      ),
    ];
    if (s.window?.kind === 'rob') ids.push(s.window.tile!.id);
    return ids;
  }

  it('电脑对战：牌张守恒 136、筹码总数 200、不会产生非法动作', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = new Rng(seed * 23);
      let s = suichang.setup({
        players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
        options: { sessions: 1, chi: seed % 2 === 0, joker: true },
        seed,
      });
      let steps = 0;
      while (!suichang.isOver(s) && steps++ < 12000) {
        const seats = suichang.activeSeats(s);
        const seat = seats[rng.int(seats.length)];
        const a = suichang.bot(suichang.view(s, seat), seat, rng);
        const err = suichang.validate(s, seat, a);
        if (err) throw new Error(`seed ${seed} step ${steps}: ${err} ${JSON.stringify(a)}`);
        s = suichang.apply(s, seat, a);
        if (s.phase === 'play') {
          const ids = allTileIds(s);
          expect(ids).toHaveLength(136);
          expect(new Set(ids).size).toBe(136);
        }
        expect(s.chips.reduce((a, b) => a + b, 0)).toBe(200);
      }
      expect(s.phase).toBe('matchOver');
      expect(s.sessionResult!.chips.reduce((a, b) => a + b, 0)).toBe(200);
    }
  });

  it('simulate 可以跑完一盘', () => {
    const { state } = simulate(
      suichang,
      4,
      { sessions: 1, chi: true, joker: true },
      2026,
      40000,
    );
    expect(state.phase).toBe('matchOver');
    expect(state.sessionResult).not.toBeNull();
  });
});
