import { describe, expect, it } from 'vitest';
import type { mj, sc } from '../src';
import { Rng, mj as M, sc as S, sichuan } from '../src';

/** 「123m456m789s」→ 牌（m 万、s 条、p 筒），同种牌自动用不同的副本 id */
function tiles(spec: string, used = new Map<number, number>()): mj.Tile[] {
  const out: mj.Tile[] = [];
  for (const [, digits, suit] of spec.matchAll(/(\d+)([msp])/g)) {
    const si = { m: 0, s: 1, p: 2 }[suit as 'm' | 's' | 'p'];
    for (const d of digits) {
      const kind = si * 9 + Number(d) - 1;
      const copy = used.get(kind) ?? 0;
      used.set(kind, copy + 1);
      out.push(M.tileOf(si * 36 + (Number(d) - 1) * 4 + copy));
    }
  }
  return out;
}

interface Opts {
  hand: string;
  que?: mj.MjSuit;
  /** 自己回合（14 张）还是等待 / 抢牌 */
  window?: { tile: string; from: number; peng?: boolean; hu?: boolean; gang?: boolean };
  /** 对手：缺门与牌河 */
  opps?: { que: mj.MjSuit; river?: string; melds?: string[] }[];
  wall?: number;
}

function view(o: Opts): sc.ScView {
  const used = new Map<number, number>();
  const hand = tiles(o.hand, used);
  const que = o.que ?? 'tong';
  const players: sc.ScPlayerView[] = [0, 1, 2, 3].map((s) => {
    const opp = s === 0 ? null : o.opps?.[s - 1];
    return {
      handCount: s === 0 ? hand.length : 13,
      melds: (opp?.melds ?? []).map((m) => {
        const ts = tiles(m, used);
        return { type: 'pung' as const, kind: M.kindOf(ts[0]), tiles: ts, from: 0 };
      }),
      river: opp?.river ? tiles(opp.river, used).map((tile) => ({ tile })) : [],
      que: s === 0 ? que : (opp?.que ?? 'wan'),
      queChosen: true,
      exchangeChosen: true,
      won: null,
      hand: null,
    };
  });
  const w = o.window ? tiles(o.window.tile, used)[0] : null;
  // 看得见的牌：自己的手牌、牌河、碰杠、桌上这张
  const visible = new Array<number>(27).fill(0);
  for (const [kind, n] of used) visible[kind] = n;
  const hasQue = hand.some((t) => t.suit === que);
  const legal: sc.ScLegal = {
    discard: o.window ? [] : hand.filter((t) => !hasQue || t.suit === que).map((t) => t.id),
    hu: !!o.window?.hu,
    gang: o.window?.gang && w ? [{ tile: w.id, type: 'zhi' }] : [],
    peng: !!o.window?.peng,
    pass: !!o.window,
    exchange: false,
    que: false,
    ready: false,
    mustHu: false,
  };
  return {
    seat: 0,
    phase: 'play',
    round: 1,
    options: { baseScore: 1, exchange: true, jingoudiao: false, rounds: 8, chips: 0 },
    dealer: 0,
    wallCount: o.wall ?? 40,
    turn: o.window ? o.window.from : 0,
    players,
    hand,
    drawn: null,
    legal,
    window: o.window && w ? { kind: 'claims', source: o.window.from, tile: w } : null,
    lastDiscard: null,
    exchangeDir: null,
    exchange: null,
    scores: [0, 0, 0, 0],
    roundDeltas: [0, 0, 0, 0],
    visible,
    myKongIncome: 0,
    myAfterKong: null,
    events: [],
    result: null,
    ready: [false, false, false, false],
    history: [],
  };
}

const name = (v: sc.ScView, id: number) => M.tileName(v.hand.find((t) => t.id === id)!);

describe('麻将导师：出牌', () => {
  it('打掉孤张，打完就听牌，并说出听哪张', () => {
    const v = view({ hand: '123m456m57m789s22s1s' });
    const c = S.coachSichuan(v);
    expect(c.stage).toBe('discard');
    expect(name(v, c.advice.tiles[0])).toBe('1条');
    expect(c.options[0].shanten).toBe(0);
    // 4567 万：听 3 万、6 万
    expect(c.options[0].waits.map((w) => M.kindName(w.kind))).toEqual(['3万', '6万']);
    expect(c.points[0]).toContain('听 3万');
  });

  it('打掉多余的一张就听三面：23456 万听 1、4、7 万', () => {
    const v = view({ hand: '23m9m456m789s222s55s' });
    const c = S.coachSichuan(v);
    expect(name(v, c.advice.tiles[0])).toBe('9万');
    expect(c.options[0].waits.map((w) => M.kindName(w.kind))).toEqual(['1万', '4万', '7万']);
    // 4 万自己手里有一张
    expect(c.options[0].waits.map((w) => w.left)).toEqual([4, 3, 4]);
  });

  it('手里有缺门：先打缺门', () => {
    const v = view({ hand: '123m456m789s22s57m38p', que: 'tong' });
    const c = S.coachSichuan(v);
    expect(c.title).toMatch(/^先打缺门/);
    expect(M.tileOf(c.advice.tiles[0]).suit).toBe('tong');
    expect(c.status).toContain('2 张缺门');
  });

  it('评价玩家选中的牌：退向听要指出来', () => {
    const v = view({ hand: '123m456m57m789s22s1s' });
    const c = S.coachSichuan(v);
    const bad = v.hand.find((t) => M.tileName(t) === '5万')!;
    const j = S.coachSelected(v, c, [bad.id]);
    // v2 按期望差分档：推荐的 1 条约 1.72 分，5 万约 1.34 分，只差 0.38 底，属于 good；
    // 文案仍要指出「退成一向听」。（2026-11-20 经确认，原为 bad）
    expect(j?.tone).toBe('good');
    expect(j?.text).toContain('退成');
    const good = S.coachSelected(v, c, [c.advice.tiles[0]]);
    expect(good?.tone).toBe('best');
  });

  it('对手缺的那门对他绝对安全', () => {
    // 三家都打了十张牌，可能已经听牌；三家都缺条
    const v = view({
      hand: '123m456m57m789s22s1s',
      opps: [
        { que: 'tiao', river: '1199p2288p55p' },
        { que: 'tiao', river: '3377p4466p55p' },
        { que: 'tiao', river: '88m99m1199p66p' },
      ],
    });
    const c = S.coachSichuan(v);
    const tiao = c.options.filter((o) => M.kindSuit(o.kind) === 'tiao');
    expect(tiao.length).toBeGreaterThan(0);
    expect(tiao.every((o) => o.danger === 0)).toBe(true);
  });
});

describe('麻将导师：碰杠胡', () => {
  it('能胡时算出番数；前期宽叫的清一色等自摸期望更高，建议过', () => {
    const v = view({
      hand: '123m456m789m22m57m',
      que: 'tong',
      window: { tile: '6m', from: 2, hu: true },
    });
    const c = S.coachSichuan(v);
    // v2：胡 = 4 分；过 ≈ 7.0 分（过水后胡牌率约 89%，按自摸 ×3 家加权平均 7.9 分，
    // 这个局面里对手还没出牌、几乎没有威胁），高出余量 max(1 底, 20%)，所以建议过。
    // （2026-11-20 经确认，原为 hu）
    expect(c.advice.action).toBe('pass');
    expect(c.points[0]).toMatch(/清一色.*3 番/);
  });

  it('碰了能更快听牌：建议碰', () => {
    // 碰 9 条后打掉 1 万就听牌
    const v = view({
      hand: '123m456m78s99s1m55s',
      window: { tile: '9s', from: 1, peng: true },
    });
    const c = S.coachSichuan(v);
    expect(c.advice.action).toBe('peng');
  });

  it('对子很多、在做七对：碰了不会更快就建议过', () => {
    const v = view({
      hand: '11m33m55m77m22s44s9s',
      window: { tile: '1m', from: 3, peng: true },
    });
    const c = S.coachSichuan(v);
    expect(c.advice.action).toBe('pass');
    expect(c.points.join()).toContain('七对');
  });
});

describe('麻将导师：换三张、定缺', () => {
  it('换三张换最弱的一门，定缺定最少的一门', () => {
    const v = view({ hand: '1123m556789p2s7s9s' });
    v.phase = 'exchange';
    v.legal = { ...v.legal!, discard: [], exchange: true };
    v.exchangeDir = 'next';
    const c = S.coachSichuan(v);
    expect(c.stage).toBe('exchange');
    expect(c.advice.tiles.map((id) => M.tileOf(id).suit)).toEqual(['tiao', 'tiao', 'tiao']);
    expect(S.coachSelected(v, c, c.advice.tiles)?.tone).toBe('best');

    v.phase = 'dingque';
    v.legal = { ...v.legal, exchange: false, que: true };
    const q = S.coachSichuan(v);
    expect(q.advice.suit).toBe('tiao');
  });
});

describe('麻将导师 v2：期望得分', () => {
  it('tingOfView 与 tingOf 对同一手牌结果一致（随机 1000 手）', () => {
    let checked = 0;
    for (let seed = 1; checked < 1000 && seed < 400; seed++) {
      let st = sichuan.setup({
        players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, isBot: true })),
        options: sichuan.defaultOptions,
        seed,
      });
      const rng = new Rng(seed);
      for (let i = 0; i < 400 && st.phase !== 'roundOver' && st.phase !== 'matchOver'; i++) {
        if (st.phase === 'play' && i % 3 === 0)
          for (const seat of [0, 1, 2, 3]) {
            const p = st.players[seat];
            if (p.won) continue;
            const v = sichuan.view(st, seat);
            const a = S.tingOf(st, seat);
            const b = S.tingOfView(p.hand, p.melds, p.que, v.visible, st.options);
            expect(b ? { kind: b.kind, points: b.points } : null).toEqual(
              a ? { kind: a.kind, points: a.points } : null,
            );
            checked++;
          }
        const act = sichuan.activeSeats(st);
        if (!act.length) break;
        const seat = act[0];
        st = sichuan.apply(st, seat, sichuan.bot(sichuan.view(st, seat), seat, rng));
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1000);
  });

  it('清一色 vs 平胡：牌墙多时做清一色，牌墙 ≤ 12 时走进张多的平胡', () => {
    const hand = '112356666789m34s';
    const many = S.coachSichuan(view({ hand, wall: 52 }));
    const few = S.coachSichuan(view({ hand, wall: 10 }));
    const v = view({ hand });
    expect(name(v, many.advice.tiles[0])).toBe('3条');
    expect(many.options[0].route).toMatch(/^清一色·万/);
    expect(many.options[0].shanten).toBe(1);
    expect(name(v, few.advice.tiles[0])).toBe('1万');
    expect(few.options[0].route).toBe('平胡');
    const flushInFew = few.options.find((o) => o.kind === many.options[0].kind)!;
    expect(few.options[0].ukeire).toBeGreaterThan(flushInFew.ukeire);
  });

  it('听牌选择：听 3 张的清一色比听 8 张的平胡值钱（牌墙还多时）', () => {
    // 同一桌面（看得见的牌由这手 14 张决定）：5 万已见一张，3 条、6 条都没见过
    const v = view({ hand: '111m123m789m99m46m5m', wall: 52 });
    const flush = S.coachEvalHand(v, tiles('123m456m789m22m46m'));
    const wide = S.coachEvalHand(v, tiles('123m789m22m456s45s'));
    expect(flush.shanten).toBe(0);
    expect(wide.shanten).toBe(0);
    expect(flush.ukeire).toBe(3);
    expect(wide.ukeire).toBe(8);
    expect(flush.route).toContain('清一色');
    expect(flush.ev).toBeGreaterThan(wide.ev);
  });

  it('巴杠：第四张不是这回合刚摸的，不收钱，文案也不说每家付', () => {
    // 已碰 5 万（副本 1–3），手里还有第 4 张（副本 0）
    const v = view({ hand: '123m789m22s456s5m79s' });
    const pung = [1, 2, 3].map((c) => M.tileOf(4 * 4 + c));
    v.players[0].melds = [{ type: 'pung', kind: 4, tiles: pung, from: 1 }];
    for (const t of pung) v.visible[M.kindOf(t)]++;
    const fourth = v.hand.find((t) => M.kindOf(t) === 4)!;
    v.legal!.gang = [{ tile: fourth.id, type: 'ba' }];
    const stale = S.coachKong(v, fourth.id);
    expect(stale.income).toBe(0);
    expect(stale.text).not.toContain('每家付');
    // 刚摸到的才是及时雨：每个还没胡的对手付 1 分
    v.drawn = fourth.id;
    const timely = S.coachKong(v, fourth.id);
    expect(timely.income).toBe(3);
    expect(timely.text).toContain('每家付你 1 分');
  });

  it('防守：下家疑似清一色万且多半听牌、我还两向听时，弃和并且不打万子', () => {
    const v = view({
      hand: '1379m12478s299s',
      opps: [
        { que: 'tong', river: '1123s3678s99p55p', melds: ['555m', '888m'] },
        { que: 'tiao' },
        { que: 'wan' },
      ],
      wall: 20,
    });
    const c = S.coachSichuan(v);
    expect(c.options[0].shanten).toBeGreaterThanOrEqual(2);
    expect(c.defense).toBe(true);
    expect(M.tileOf(c.advice.tiles[0]).suit).not.toBe('wan');
  });

  it('确定性：同一局面调用两次结果完全相同', () => {
    let st = sichuan.setup({
      players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, isBot: true })),
      options: sichuan.defaultOptions,
      seed: 11,
    });
    const rng = new Rng(11);
    let seen = 0;
    for (let i = 0; i < 300 && st.phase !== 'roundOver' && st.phase !== 'matchOver'; i++) {
      const seat = sichuan.activeSeats(st)[0];
      const v = sichuan.view(st, seat);
      if (v.legal) {
        expect(S.coachSichuan(v)).toEqual(S.coachSichuan(v));
        seen++;
      }
      st = sichuan.apply(st, seat, sichuan.bot(v, seat, rng));
    }
    expect(seen).toBeGreaterThan(20);
  });
});

/** 打一盘电脑对局，收集「轮到某人出牌、没有抢牌窗口」的局面 */
function discardViews(seed: number, every = 4): sc.ScView[] {
  let st = sichuan.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, isBot: true })),
    options: sichuan.defaultOptions,
    seed,
  });
  const rng = new Rng(seed);
  const out: sc.ScView[] = [];
  for (let i = 0; i < 600 && st.phase !== 'roundOver' && st.phase !== 'matchOver'; i++) {
    const seat = sichuan.activeSeats(st)[0];
    const v = sichuan.view(st, seat);
    if (st.phase === 'play' && !v.window && v.legal?.discard.length && i % every === 0) out.push(v);
    st = sichuan.apply(st, seat, sichuan.bot(v, seat, rng));
  }
  return out;
}

describe('麻将导师 v2：精算', () => {
  it('原地推演与 apply 结果完全一致', () => {
    for (const seed of [3, 4, 5]) {
      let a = sichuan.setup({
        players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, isBot: true })),
        options: { ...sichuan.defaultOptions, rounds: 1 },
        seed,
      });
      let b = JSON.parse(JSON.stringify(a)) as sc.ScState;
      const ra = new Rng(seed);
      const rb = new Rng(seed);
      for (let i = 0; i < 600 && a.phase !== 'matchOver'; i++) {
        const seat = sichuan.activeSeats(a)[0];
        a = sichuan.apply(a, seat, sichuan.bot(sichuan.view(a, seat), seat, ra));
        b = S.applyInPlace(b, seat, sichuan.bot(sichuan.view(b, seat), seat, rb));
      }
      expect(b).toEqual(a);
    }
  });

  it('determinize：1000 次采样都满足牌墙长度、对手没有缺门、换出牌位置、牌总数 108', () => {
    let n = 0;
    for (let seed = 1; n < 1000 && seed < 60; seed++) {
      for (const v of discardViews(seed, 9)) {
        const me = v.seat!;
        const shift = v.exchangeDir === 'next' ? 1 : v.exchangeDir === 'prev' ? 3 : 2;
        const receiver = (me + shift) % 4;
        const seen = new Set<number>();
        for (const p of v.players) {
          for (const r of p.river) seen.add(r.tile.id);
          for (const m of p.melds) for (const t of m.tiles) seen.add(t.id);
        }
        const hiddenGiven = (v.exchange?.given ?? []).filter((t) => !seen.has(t.id));
        for (let k = 0; k < 4 && n < 1000; k++, n++) {
          const d = S.determinize(v, new Rng(seed * 100 + k));
          const st = d.state;
          expect(st.wall.length).toBe(v.wallCount);
          const ids = S._tilesOf(st).map((t) => t.id);
          expect(ids.length).toBe(108);
          expect(new Set(ids).size).toBe(108);
          expect(st.players[me].hand.map((t) => t.id).sort()).toEqual(
            v.hand.map((t) => t.id).sort(),
          );
          for (const t of hiddenGiven)
            expect(st.players[receiver].hand.some((x) => x.id === t.id)).toBe(true);
          if (!d.relaxed)
            for (let s = 0; s < 4; s++) {
              const p = v.players[s];
              const last = p.river.at(-1)?.tile;
              if (s === me || p.won || !p.que || !last || last.suit === p.que) continue;
              expect(st.players[s].hand.some((t) => t.suit === p.que)).toBe(false);
            }
          for (let s = 0; s < 4; s++)
            if (!v.players[s].won) expect(st.players[s].hand.length).toBe(v.players[s].handCount);
        }
      }
    }
    expect(n).toBe(1000);
  });

  it('确定性：同一局面精算两次结果完全相同', () => {
    const v = discardViews(7, 6)[6];
    const fast = S.coachSichuan(v);
    const tiles = fast.options.slice(0, 3).map((o) => o.tile);
    const opts = { budgetMs: Infinity, maxPerCandidate: 32, batch: 16 };
    const a = S.mcEvaluate(v, tiles, opts);
    const b = S.mcEvaluate(v, tiles, opts);
    expect(b).toEqual(a);
    expect(Object.keys(a).length).toBeGreaterThan(0);
    const withMc = S.coachSichuan(v, { mc: { stats: a } });
    expect(withMc.mode).toBe('mc');
    expect(S.coachSichuan(v, { mc: { stats: a } })).toEqual(withMc);
  });

  it('性能：随机 200 个局面，快速模式 p95 < 30 ms（CI 放宽到 100 ms）', () => {
    const views: sc.ScView[] = [];
    for (let seed = 200; views.length < 200; seed++) views.push(...discardViews(seed, 5));
    const times: number[] = [];
    // 先热身，免得把第一次编译算进去
    for (const v of views.slice(0, 10)) S.coachSichuan(v);
    for (const v of views.slice(0, 200)) {
      const t0 = performance.now();
      S.coachSichuan(v);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    expect(p95).toBeLessThan(process.env.CI ? 100 : 30);
  });
});

describe('麻将导师：对手模型（神经网络）', () => {
  it('TypeScript 推理与 PyTorch 导出时的结果一致', async () => {
    const { predictOpp, oppNetAvailable } = await import('../src/games/sichuan/coach/oppnet');
    const check = (await import('./fixtures/oppnet-check.json')).default as {
      x: number[][];
      win: number[][];
      tenpai: number[];
      fan: number[][];
    };
    expect(oppNetAvailable()).toBe(true);
    check.x.forEach((x, i) => {
      const p = predictOpp(Float32Array.from(x));
      p.win.forEach((w, k) => expect(w).toBeCloseTo(check.win[i][k], 4));
      expect(p.tenpai).toBeCloseTo(check.tenpai[i], 4);
      p.fan.forEach((f, j) => expect(f).toBeCloseTo(check.fan[i][j], 4));
    });
  });

  it('导师默认用模型估计对手，缺门的牌对他仍然是 0', () => {
    const v = view({
      hand: '123m456m57m789s22s1s',
      opps: [
        { que: 'tiao', river: '1199p2288p55p' },
        { que: 'tiao', river: '3377p4466p55p' },
        { que: 'tiao', river: '88m99m1199p66p' },
      ],
    });
    const c = S.coachSichuan(v);
    const h = S.coachSichuan(v, { params: { opponentModel: 'heuristic' } });
    // 模型与经验公式给出的风险不同，说明确实换成了模型
    expect(c.options.map((o) => o.risk)).not.toEqual(h.options.map((o) => o.risk));
    expect(c.options.filter((o) => M.kindSuit(o.kind) === 'tiao').every((o) => o.risk === 0)).toBe(
      true,
    );
  });
});
