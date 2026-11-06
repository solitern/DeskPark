import { describe, expect, it } from 'vitest';
import type { AnyGame } from '../src';
import {
  Rng,
  SYSTEM_SEAT,
  chess,
  doudizhu,
  gemguild,
  guandan,
  heluogangci,
  hexisle,
  highcard,
  onecard,
  shuangsheng,
  sichuan,
  spellstones,
  texas,
  xiangqi,
} from '../src';

/** 状态里不允许出现 NaN / Infinity（会让筹码、分数等永久损坏） */
function badNumber(x: unknown, path = '$'): string | null {
  if (typeof x === 'number') return Number.isFinite(x) ? null : path;
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) {
      const r = badNumber(x[i], `${path}[${i}]`);
      if (r) return r;
    }
  } else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      const r = badNumber(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

const JUNK: unknown[] = [
  undefined,
  null,
  NaN,
  Infinity,
  -1,
  0,
  1,
  3.5,
  1e9,
  '1',
  'abc',
  true,
  [],
  {},
  [0, 0, 0],
];

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore', 'gold'];
const GG = ['white', 'blue', 'green', 'red', 'black', 'gold', 'pink'];

/** 联机时恶意客户端可能发来的各种畸形动作 */
function junkActions(types: string[], ids: number[], rng: Rng): unknown[] {
  const pick = <T>(a: T[]) => a[rng.int(a.length)];
  const resMap = () =>
    rng.next() < 0.3
      ? pick(JUNK)
      : Object.fromEntries(
          RES.slice(0, 5).map((r) => [r, rng.next() < 0.2 ? pick(JUNK) : rng.int(3)]),
        );
  const field = () => (rng.next() < 0.4 && ids.length ? pick(ids) : pick(JUNK));
  const out: unknown[] = [null, 42, 'play', [], {}];
  for (let i = 0; i < 24; i++) {
    const type = rng.next() < 0.15 ? pick(['bogus', 'continue', '', '__proto__']) : pick(types);
    out.push({
      type,
      cards: rng.next() < 0.5 ? [pick(ids), pick(ids)] : field(),
      card: field(),
      tile: field(),
      tiles: rng.next() < 0.5 ? [pick(ids), pick(ids), pick(ids)] : field(),
      to: field(),
      score: field(),
      suit: rng.next() < 0.5 ? pick(['wan', 'tiao', 'tong', 'xx']) : field(),
      spell: rng.next() < 0.6 ? pick([1, 2, 3, 4, 5, 6, 7, 8]) : field(),
      color: rng.next() < 0.6 ? pick(['R', 'Y', 'G', 'B', 'X']) : field(),
      uno: rng.next() < 0.5 ? rng.next() < 0.5 : field(),
      at: rng.next() < 0.6 ? rng.int(80) - 4 : field(),
      hex: rng.next() < 0.6 ? rng.int(22) - 1 : field(),
      victim: rng.next() < 0.6 ? rng.int(6) - 1 : field(),
      kind: pick(['knight', 'road', 'plenty', 'monopoly', 'vp', 'xx']),
      res: pick([['ore', 'ore'], ['wheat'], ['x'], 'ore', [], field()]),
      give: rng.next() < 0.5 ? pick(RES) : resMap(),
      get: rng.next() < 0.6 ? pick(RES) : field(),
      want: resMap(),
      gems:
        rng.next() < 0.5
          ? [pick(GG), pick(GG), pick(GG)].slice(0, 1 + rng.int(3))
          : rng.next() < 0.5
            ? Object.fromEntries(
                [...GG, 'gold'].map((g) => [g, rng.next() < 0.2 ? pick(JUNK) : rng.int(3)]),
              )
            : field(),
      level: rng.next() < 0.6 ? rng.int(5) : field(),
      id: rng.next() < 0.6 ? rng.int(12) : field(),
      from: rng.next() < 0.7 ? rng.int(96) - 3 : field(),
      promo: pick(['q', 'r', 'b', 'n', 'k', 'p', 'x']),
    });
  }
  return out;
}

function fuzz(def: AnyGame, players: number, options: unknown, types: string[], seed: number) {
  const rng = new Rng(seed);
  let state = def.setup({
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, isBot: true })),
    options,
    seed,
  });
  for (let step = 0; step < 3000 && !def.isOver(state); step++) {
    const active = def.activeSeats(state);
    if (!active.length) {
      state = def.apply(state, SYSTEM_SEAT, def.autoAdvance!(state)!.action);
      continue;
    }
    const seat = active[rng.int(active.length)];
    // 手里的牌 id（以及若干不存在的 id）
    const s = state as { hands?: { id: number }[][]; players?: { hand?: { id: number }[] }[] };
    const raw = s.hands?.[seat] ?? s.players?.[seat]?.hand ?? [];
    const hand = Array.isArray(raw) ? raw : [];
    const ids = [...hand.map((c) => c.id), 9999, -5];
    if (step % 3 === 0) {
      for (const a of junkActions(types, ids, rng)) {
        let err: string | null;
        try {
          err = def.validate(state, seat, a as never);
        } catch {
          continue; // Table.act 会把校验时的异常当作无效操作
        }
        if (err) continue;
        const next = def.apply(state, seat, a as never);
        const bad = badNumber(next);
        if (bad)
          throw new Error(
            `${def.meta.id}：动作 ${JSON.stringify(a)} 通过校验后状态出现非法数字 ${bad}`,
          );
        state = next;
        break;
      }
      if (def.isOver(state) || !def.activeSeats(state).includes(seat)) continue;
    }
    state = def.apply(state, seat, def.bot(def.view(state, seat), seat, rng));
  }
}

describe('畸形动作模糊测试（模拟恶意联机客户端）', () => {
  it('斗地主', () => {
    for (let seed = 1; seed <= 15; seed++)
      fuzz(doudizhu, 3, doudizhu.defaultOptions, ['bid', 'play', 'pass', 'ready'], seed);
  });
  it('掼蛋', () => {
    for (let seed = 1; seed <= 6; seed++)
      fuzz(guandan, 4, guandan.defaultOptions, ['play', 'pass', 'return', 'ready'], seed);
  });
  it('德州扑克', () => {
    for (let seed = 1; seed <= 15; seed++)
      fuzz(
        texas,
        5,
        texas.defaultOptions,
        ['fold', 'check', 'call', 'raise', 'allin', 'ready'],
        seed,
      );
  });
  it('双升', () => {
    for (let seed = 1; seed <= 6; seed++)
      fuzz(
        shuangsheng,
        4,
        shuangsheng.defaultOptions,
        ['declare', 'pass', 'bury', 'play', 'ready', 'deal', 'dealt', 'flip', 'collect'],
        seed,
      );
  });
  it('四川麻将', () => {
    for (let seed = 1; seed <= 8; seed++)
      fuzz(
        sichuan,
        4,
        sichuan.defaultOptions,
        ['exchange', 'que', 'discard', 'hu', 'gang', 'peng', 'pass', 'ready'],
        seed,
      );
  });
  it('河洛杠次', () => {
    for (let seed = 1; seed <= 8; seed++)
      fuzz(
        heluogangci,
        4,
        heluogangci.defaultOptions,
        ['discard', 'gang', 'peng', 'pass', 'pici', 'hu', 'ready'],
        seed,
      );
  });
  it('魔法出包', () => {
    for (let seed = 1; seed <= 20; seed++)
      fuzz(spellstones, 2 + (seed % 4), {}, ['cast', 'stop', 'ready'], seed);
  });
  it('UON', () => {
    for (let seed = 1; seed <= 20; seed++)
      fuzz(
        onecard,
        2 + (seed % 7),
        { target: seed % 2 ? 0 : 250, stack: seed % 3 === 0 },
        ['play', 'draw', 'keep', 'challenge', 'uno', 'catch', 'pass', 'ready', 'close'],
        seed,
      );
  });
  it('卡旦岛', () => {
    for (let seed = 1; seed <= 10; seed++)
      fuzz(
        hexisle,
        2 + (seed % 3),
        { target: 10, friendly: seed % 2 === 0 },
        [
          'settle',
          'road',
          'city',
          'roll',
          'discard',
          'robber',
          'buy',
          'dev',
          'bank',
          'offer',
          'accept',
          'reject',
          'cancel',
          'end',
        ],
        seed,
      );
  });
  it('宝石商会', () => {
    for (let seed = 1; seed <= 12; seed++)
      fuzz(
        gemguild,
        2 + (seed % 3),
        { target: 15 },
        ['take', 'reserve', 'buy', 'discard', 'noble', 'pass'],
        seed,
      );
  });
  it('国际象棋', () => {
    for (let seed = 1; seed <= 3; seed++)
      fuzz(chess, 2, { level: 1, side: seed % 2 ? 'w' : 'b' }, ['move', 'resign', 'undo'], seed);
  });
  it('中国象棋', () => {
    for (let seed = 1; seed <= 3; seed++)
      fuzz(xiangqi, 2, { level: 1, side: seed % 2 ? 'r' : 'b' }, ['move', 'resign', 'undo'], seed);
  });
  it('比大小：非出牌动作不能冒充「继续」', () => {
    for (let seed = 1; seed <= 15; seed++) fuzz(highcard, 4, { rounds: 2 }, ['choose'], seed);
    const st = highcard.setup({
      players: [0, 1, 2].map((i) => ({ name: `P${i}`, isBot: false })),
      options: { rounds: 1 },
      seed: 1,
    });
    const card = (st as { hands: { id: number }[][] }).hands[0][0].id;
    expect(highcard.validate(st, 0, { type: 'bogus', card } as never)).not.toBeNull();
  });
});
