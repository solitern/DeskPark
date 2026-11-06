import { describe, expect, it } from 'vitest';
import type { hz as HZ } from '../src';
import { Rng, hangzhou, hz, simulate } from '../src';

type Tile = HZ.HzTile;
type State = HZ.HzState;

// ---------------------------------------------------------------------------
// 夹具：用 "123m 456p 11s EE" 记法生成牌（m 万、s 条、p 筒，E 东 S 南 W 西 N 北 Z 中 F 发 B 白）

const HONOR: Record<string, number> = { E: 27, S: 28, W: 29, N: 30, Z: 31, F: 32, B: 33 };

class Pool {
  used = new Map<number, number>();
  one(kind: number): Tile {
    const copy = this.used.get(kind) ?? 0;
    if (copy >= 4) throw new Error(`more than 4 of kind ${kind}`);
    this.used.set(kind, copy + 1);
    return hz.hzTileOf(kind * 4 + copy);
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

const CTX = {
  selfDrawn: false,
  afterKong: false,
  robbing: false,
  haidi: false,
  tianhu: false,
  dihu: false,
};

const win = (spec: string, melds: HZ.MeldShape[] = [], jokerKind: number | null = null) =>
  hz.evaluateWin(new Pool().tiles(spec), melds, jokerKind, CTX, 1);

function player(p: Partial<HZ.HzPlayer> = {}): HZ.HzPlayer {
  return { hand: [], melds: [], river: [], hasDrawn: true, ...p };
}

function baseState(players: HZ.HzPlayer[], patch: Partial<State> = {}): State {
  const s = hangzhou.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    options: { ...hangzhou.defaultOptions, joker: false },
    seed: 1,
  });
  return {
    ...s,
    phase: 'play',
    window: null,
    players,
    ledger: [],
    wins: [],
    discards: 5,
    claims: 1,
    drawn: null,
    canSelfHu: true,
    afterKong: false,
    jokerKind: null,
    ...patch,
  };
}

const act = (s: State, seat: number, a: HZ.HzAction) => {
  const err = hangzhou.validate(s, seat, a);
  if (err) throw new Error(`seat ${seat} ${JSON.stringify(a)}: ${err}`);
  return hangzhou.apply(s, seat, a);
};

// ---------------------------------------------------------------------------

describe('杭麻 · 牌', () => {
  it('136 张，万条筒 + 风牌 + 箭牌', () => {
    const all = hz.createTiles();
    expect(all).toHaveLength(136);
    expect(all[0]).toMatchObject({ suit: 'wan', rank: 1 });
    expect(all[35]).toMatchObject({ suit: 'wan', rank: 9 });
    expect(all[107]).toMatchObject({ suit: 'tong', rank: 9 });
    expect(all[108]).toMatchObject({ suit: 'feng', rank: 1 });
    expect(all[135]).toMatchObject({ suit: 'jian', rank: 3 });
    expect(hz.kindName(27)).toBe('东风');
    expect(hz.kindName(30)).toBe('北风');
    expect(hz.kindName(31)).toBe('中');
    expect(hz.kindName(33)).toBe('白');
  });

  it('主流规则：四张白板固定为财神', () => {
    const s = hangzhou.setup({
      players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
      options: { ...hangzhou.defaultOptions, joker: true },
      seed: 1,
    });
    expect(hz.JOKER_KIND).toBe(kindOf('B'));
    expect(s.jokerKind).toBe(kindOf('B'));
    expect(s.wall).toHaveLength(83);
    const dealt = [
      ...s.wall,
      ...s.players.flatMap((p) => p.hand),
    ].map((t) => t.id);
    expect(dealt).toHaveLength(136);
    expect(new Set(dealt).size).toBe(136);
    // 关掉财神时白板只是普通箭牌
    const plain = hangzhou.setup({
      players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
      options: { ...hangzhou.defaultOptions, joker: false },
      seed: 1,
    });
    expect(plain.jokerKind).toBeNull();
  });
});

describe('杭麻 · 牌型与台数', () => {
  it('平胡 1 台（字牌做将也可以）', () => {
    expect(win('123m 456m 789m 123s 55p')!.patterns).toEqual(['pinghu']);
    expect(win('123m 456p 789s EEE ZZ')!.patterns).toEqual(['pinghu']);
  });

  it('碰碰胡 2 台、七对 4 台、清一色 4 台', () => {
    expect(win('111m 333m 555p 777s 99p')!.patterns).toEqual(['pengpeng']);
    expect(win('1122334455m 6677p')!.patterns).toEqual(['qidui']);
    expect(win('123456789m 234m 55m')!.patterns).toEqual(['qingyise']);
  });

  it('清碰 6 台、豪华七对 6 台、清七对 8 台、清豪华七对 10 台', () => {
    const qp = win('111m 333m 555m 777m 99m')!;
    expect(qp.patterns).toEqual(['qingpeng']);
    expect(qp.fanRaw).toBe(6);
    const hh = win('1111m 2233p 4455s 66s')!;
    expect(hh.patterns).toEqual(['haohuaqidui']);
    expect(hh.fanRaw).toBe(6);
    expect(win('11223344556677m')!.patterns).toEqual(['qingqidui']);
    expect(win('11112233445566m')!.patterns).toEqual(['qinghaohua']);
    expect(win('11112233445566m')!.fanRaw).toBe(10);
  });

  it('过程台：自摸、杠上开花、抢杠、海底、天胡', () => {
    expect(
      hz.evaluateWin(
        new Pool().tiles('123456789m 234m 55m'),
        [],
        null,
        { ...CTX, selfDrawn: true },
        1,
      )!.fanRaw,
    ).toBe(5);
    expect(
      hz.evaluateWin(new Pool().tiles('123456789m 234m 55m'), [], null, { ...CTX, selfDrawn: true, afterKong: true }, 1)!
        .fanRaw,
    ).toBe(6);
    expect(
      hz.evaluateWin(new Pool().tiles('123456789m 234m 55m'), [], null, { ...CTX, robbing: true }, 1)!.fanRaw,
    ).toBe(5);
    expect(
      hz.evaluateWin(new Pool().tiles('123456789m 234m 55m'), [], null, { ...CTX, tianhu: true }, 1)!.fanRaw,
    ).toBe(12);
  });

  it('番数封顶 10 台：底分 ×2^(台−1)', () => {
    const s = win('11112233445566m')!;
    expect(s.fanRaw).toBe(10);
    expect(s.points).toBe(512);
    const tian = hz.evaluateWin(
      new Pool().tiles('11112233445566m'),
      [],
      null,
      { ...CTX, tianhu: true },
      2,
    )!;
    expect(tian.fanCharged).toBe(10);
    expect(tian.points).toBe(1024);
  });
});

describe('杭麻 · 财神', () => {
  it('财神可以补成将牌', () => {
    const jokerKind = kindOf('1p');
    const v = win('123m 456m 789m 123s 9p 1p', [], jokerKind);
    expect(v).not.toBeNull();
    expect(v!.patterns).toEqual(['pinghu']);
  });

  it('财神可以补成七对', () => {
    const jokerKind = kindOf('1p');
    const v = win('1122334455m 667p 1p', [], jokerKind);
    expect(v!.qidui).toBe(true);
  });

  it('财神当万用：白板不影响清一色', () => {
    const pool = new Pool();
    const tiles = [
      ...pool.tiles('123456789m 22m'),
      pool.one(hz.JOKER_KIND),
      pool.one(hz.JOKER_KIND),
      pool.one(hz.JOKER_KIND),
    ];
    const v = hz.evaluateWin(tiles, [], hz.JOKER_KIND, CTX, 1);
    expect(v).not.toBeNull();
    expect(v!.qingyise).toBe(true);
    expect(v!.patterns).toContain('qingyise');
  });

  it('听牌把财神算进去', () => {
    const pool = new Pool();
    const tiles = pool.tiles('123m 456m 789m 123s 9p');
    const jokerKind = kindOf('1p');
    const waits = hz.waitingKinds(hz.countKinds(tiles), jokerKind, 0);
    expect(waits).toContain(kindOf('9p'));
  });

  it('财神不能碰、不能杠：打出财神无人可要', () => {
    const pool = new Pool();
    const jokerKind = kindOf('1p');
    const joker = pool.one(jokerKind);
    const players = [
      player({ hand: [...pool.tiles('2345678m 234s 567p'), joker] }),
      player({ hand: pool.tiles('11p 234567m 234567s') }),
      player({ hand: pool.tiles('22p 345m 345s 678p 9m 9s') }),
      player({ hand: pool.tiles('33p 456m 456s 789p 1m 1s') }),
    ];
    let s = baseState(players, { jokerKind, turn: 0, wall: pool.tiles('1m 9m 2s 8p') });
    // 财神不能当作 1 筒来碰
    s = act(s, 0, { type: 'discard', tile: joker.id });
    expect(s.window).toBeNull();
    expect(s.turn).toBe(1);
  });
});

describe('杭麻 · 行牌', () => {
  it('可以吃上家的牌', () => {
    const pool = new Pool();
    const three = pool.one(kindOf('3m'));
    const players = [
      player({ hand: [...pool.tiles('5p 6p 7p 8p 9p 1s 3s 5s 7s 9s EE E'), three] }),
      player({ hand: pool.tiles('12m 456789p 13579s') }),
      player({ hand: pool.tiles('99m 111p 2468s 2456s') }),
      player({ hand: pool.tiles('88m 222p 1379s 2469s') }),
    ];
    let s = baseState(players, { turn: 0, wall: pool.tiles('2m 4m 6m 8m') });
    s = act(s, 0, { type: 'discard', tile: three.id });
    expect(s.window?.kind).toBe('claims');
    const ids = s.players[1].hand.filter((t) => t.suit === 'wan').map((t) => t.id);
    s = act(s, 1, { type: 'chi', tiles: ids });
    expect(s.players[1].melds[0].type).toBe('chi');
    expect(s.turn).toBe(1);
    expect(s.drawn).toBeNull();
  });

  it('碰优先于吃', () => {
    const pool = new Pool();
    const three = pool.one(kindOf('3m'));
    const pair = pool.tiles('33m');
    const players = [
      player({ hand: [...pool.tiles('5p 6p 7p 8p 9p 1s 3s 5s 7s 9s EE E'), three] }),
      player({ hand: pool.tiles('12m 456789p 13579s') }),
      player({ hand: [...pool.tiles('99m 111p 2468s 2456s'), ...pair] }),
      player({ hand: pool.tiles('88m 222p 1379s 2469s') }),
    ];
    let s = baseState(players, { turn: 0, wall: pool.tiles('2m 4m 6m 8m') });
    s = act(s, 0, { type: 'discard', tile: three.id });
    const ids = s.players[1].hand.filter((t) => t.suit === 'wan').map((t) => t.id);
    s = act(s, 1, { type: 'chi', tiles: ids });
    expect(s.window).not.toBeNull();
    s = act(s, 2, { type: 'peng' });
    expect(s.players[2].melds[0].type).toBe('pung');
    expect(s.players[1].melds).toHaveLength(0);
    expect(s.turn).toBe(2);
  });

  it('一炮多响：两家同时胡', () => {
    const pool = new Pool();
    const five = pool.one(kindOf('5p'));
    const players = [
      player({ hand: [...pool.tiles('1m 2s 4s 6s 8s 11p 33p 77p 99p'), five] }),
      player({ hand: pool.tiles('123m 456m 789m 123s 5p') }),
      player({ hand: pool.tiles('123p 456p 789p 789s 5p') }),
      player({ hand: pool.tiles('2468m 1359s 2468p') }),
    ];
    let s = baseState(players, { turn: 0, wall: pool.tiles('2m 4m 6m 8m') });
    s = act(s, 0, { type: 'discard', tile: five.id });
    expect(s.window?.kind).toBe('claims');
    s = act(s, 1, { type: 'hu' });
    s = act(s, 2, { type: 'hu' });
    expect(s.phase).not.toBe('play');
    expect(s.wins.map((w) => w.seat)).toEqual([1, 2]);
    expect(s.wins.every((w) => !w.selfDrawn && w.from === 0)).toBe(true);
    expect(s.ledger.filter((e) => e.clause === 'pay.dianpao')).toHaveLength(2);
    expect(hz.deltasOf(s.ledger).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('抢杠胡', () => {
    const pool = new Pool();
    const pung = pool.tiles('333m');
    const fourth = pool.one(kindOf('3m'));
    const players = [
      player({ hand: [...pool.tiles('5p 6p 7p 8p 9p 1s 3s 5s 7s 9s'), fourth] }),
      player({ hand: pool.tiles('12m 456p 789p 123s 55s') }),
      player({ hand: pool.tiles('99m 111p 2468s 2456s') }),
      player({ hand: pool.tiles('88m 222p 1379s 2469s') }),
    ];
    let s = baseState(players, {
      turn: 0,
      wall: pool.tiles('2m 4m 6m 8m'),
    });
    s.players[0].melds = [{ type: 'pung', kind: kindOf('3m'), tiles: pung, from: 3 }];
    s = act(s, 0, { type: 'gang', tile: fourth.id });
    expect(s.window?.kind).toBe('rob');
    s = act(s, 1, { type: 'hu' });
    expect(s.wins.map((w) => w.seat)).toEqual([1]);
    expect(s.wins[0].score.items.map((i) => i.id)).toEqual(['pinghu', 'qianggang']);
    expect(s.players[0].melds[0].type).toBe('pung');
  });

  it('自摸由三家各付一份；庄家胡牌连庄', () => {
    const pool = new Pool();
    const players = [
      player({ hand: pool.tiles('123m 456m 789m 123s 55p') }),
      player({ hand: pool.tiles('2m 4m 6m 8m 1s 3s 5s 7s 9s 1p 3p 5p 7p') }),
      player({ hand: pool.tiles('2p 4p 6p 8p 2s 4s 6s 8s 1m 3m 5m 7m 9m') }),
      player({ hand: pool.tiles('2468s 13579p 2468p') }),
    ];
    let s = baseState(players, { turn: 0, dealer: 0, wall: pool.tiles('2m 4m 6m 8m') });
    s = act(s, 0, { type: 'hu' });
    expect(s.wins[0].selfDrawn).toBe(true);
    expect(s.ledger).toHaveLength(3);
    expect(s.result!.nextDealer).toBe(0);
    expect(s.result!.dealerKeeps).toBe(true);
  });

  it('只有自己的手牌和暗杠对别人不可见', () => {
    const pool = new Pool();
    const anKong = pool.tiles('1111s');
    const players = [
      player({ hand: pool.tiles('123m 456m 789m 234s 55p') }),
      player({
        hand: pool.tiles('2m 4m 6m 8m 3s 5s 7s 9s 1p 3p 5p 7p 9p'),
        melds: [{ type: 'kong', kongType: 'an', kind: kindOf('1s'), tiles: anKong, from: null }],
      }),
      player({ hand: pool.tiles('2p 4p 6p 8p 2s 4s 6s 8s 1m 3m 5m 7m 9m') }),
      player({ hand: pool.tiles('2468s 13579p 2468p') }),
    ];
    const s = baseState(players, { turn: 0 });
    const v0 = hangzhou.view(s, 0);
    expect(v0.players[1].melds[0].tiles).toBeNull();
    expect(v0.players[1].hand).toBeNull();
    const v1 = hangzhou.view(s, 1);
    expect(v1.players[1].melds[0].tiles).toHaveLength(4);
    expect(v1.players[0].hand).toBeNull();
    expect(hangzhou.view(s, null).players.every((p) => p.hand === null)).toBe(true);
  });
});

describe('杭麻 · 整局模拟', () => {
  function allIds(s: State): number[] {
    const ids = [
      ...s.wall.map((t) => t.id),
      ...s.players.flatMap((p) =>
        [...p.hand, ...p.melds.flatMap((m) => m.tiles), ...p.river.map((r) => r.tile)].map(
          (t) => t.id,
        ),
      ),
    ];
    if (s.window?.kind === 'rob') ids.push(s.window.tile!.id);
    return ids;
  }

  it('电脑对战：牌张守恒、每盘零和、不会产生非法动作', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = new Rng(seed * 17);
      let s = hangzhou.setup({
        players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
        options: { baseScore: 1, rounds: 2, chi: seed % 2 === 0, joker: true },
        seed,
      });
      let steps = 0;
      while (!hangzhou.isOver(s) && steps++ < 6000) {
        const seats = hangzhou.activeSeats(s);
        const seat = seats[rng.int(seats.length)];
        const a = hangzhou.bot(hangzhou.view(s, seat), seat, rng);
        const err = hangzhou.validate(s, seat, a);
        if (err) throw new Error(`seed ${seed} step ${steps}: ${err} ${JSON.stringify(a)}`);
        s = hangzhou.apply(s, seat, a);
        if (s.phase === 'play') {
          const ids = allIds(s);
          expect(ids).toHaveLength(136);
          expect(new Set(ids).size).toBe(136);
        }
      }
      expect(s.phase).toBe('matchOver');
      for (const h of s.history) expect(h.deltas.reduce((a, b) => a + b, 0)).toBe(0);
      expect(s.scores.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it('simulate 可以跑完设定盘数', () => {
    const { state } = simulate(
      hangzhou,
      4,
      { ...hangzhou.defaultOptions, rounds: 3 },
      2026,
      40000,
    );
    expect(state.phase).toBe('matchOver');
    expect(state.history).toHaveLength(3);
  });
});
