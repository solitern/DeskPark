import { clone } from '../../../core/clone';
import { Rng } from '../../../core/rng';
import type { Tile } from '../../../mahjong/tiles';
import { createTiles, kindOf, tileOf } from '../../../mahjong/tiles';
import { sichuanBot } from '../bot';
import type { ScMcStat } from '../coach';
import type { LedgerEntry, ScPlayer, ScState, ScView } from '../index';
import { applyInPlace, sichuan } from '../index';
import { hiddenGiven } from './ev';
import type { ScCoachParams } from './params';
import { SC_COACH_PARAMS } from './params';

/**
 * 精算（算法说明第 7 节）：把看不见的牌按已知约束随机补全成一个完整局面，
 * 先执行候选动作，再让四家都用 sichuanBot 打到本盘结束，看自己的分数变化。
 * 直接用引擎自己的规则和结算，不会和实际计分有偏差。只用于自己回合的出牌。
 */

/** 换三张：我给出去的牌落在谁手里 */
function receiverOf(v: ScView): number | null {
  const me = v.seat ?? 0;
  const shift =
    v.exchangeDir === 'next'
      ? 1
      : v.exchangeDir === 'prev'
        ? 3
        : v.exchangeDir === 'across'
          ? 2
          : null;
  return shift === null ? null : (me + shift) % 4;
}

/** 对手手里确定没有缺门：已定缺，且最后打出的不是缺门（规则强制先打缺门） */
function noQueOf(v: ScView, s: number): boolean {
  const p = v.players[s];
  const last = p.river.at(-1)?.tile;
  return !!p.que && !!last && last.suit !== p.que;
}

/** 由 view 的关键字段算出的种子：同一局面每次结果一致 */
export function viewSeed(v: ScView): number {
  let h = 2166136261;
  const mix = (x: number) => (h = Math.imul(h ^ (x + 7), 16777619));
  mix(v.round);
  mix(v.wallCount);
  mix(v.seat ?? 9);
  for (const t of v.hand) mix(t.id);
  for (const p of v.players) {
    for (const r of p.river) mix(r.tile.id);
    for (const m of p.melds) for (const t of m.tiles) mix(t.id);
  }
  return h >>> 0;
}

export interface Determinized {
  state: ScState;
  /** 50 次都满足不了「对手没有缺门」时放开了这条约束 */
  relaxed: boolean;
  /** 自己已经入账的杠钱（在推演的账本里，算得分变化时要扣掉） */
  banked: number;
}

/** 采样一个与 view 一致的完整局面（只在自己回合、没有抢牌窗口时使用） */
export function determinize(v: ScView, rng: Rng): Determinized {
  const me = v.seat ?? 0;
  if (v.window) throw new Error('determinize: 只支持自己出牌的局面');
  const known = new Set<number>();
  for (const t of v.hand) known.add(t.id);
  for (const p of v.players) {
    for (const m of p.melds) for (const t of m.tiles) known.add(t.id);
    for (const r of p.river) known.add(r.tile.id);
    for (const t of p.hand ?? []) known.add(t.id);
  }
  const given = hiddenGiven(v);
  const receiver = receiverOf(v);
  const placed = new Set(given);
  const pool = createTiles()
    .map((t) => t.id)
    .filter((id) => !known.has(id) && !placed.has(id));
  const opps = [0, 1, 2, 3].filter((s) => s !== me && !v.players[s].won);

  for (let attempt = 0; attempt < 51; attempt++) {
    const strict = attempt < 50;
    const shuffled = rng.shuffle([...pool]);
    const used = new Set<number>();
    const out = new Map<number, number[]>();
    let ok = true;
    for (const s of opps) {
      const need = v.players[s].handCount;
      const h = s === receiver ? [...given] : [];
      const que = v.players[s].que;
      const ban = strict && noQueOf(v, s) ? que : null;
      for (const id of shuffled) {
        if (h.length >= need) break;
        if (used.has(id)) continue;
        if (ban && tileOf(id).suit === ban) continue;
        used.add(id);
        h.push(id);
      }
      if (h.length < need) {
        ok = false;
        break;
      }
      out.set(s, h);
    }
    if (ok) {
      // 牌墙：剩下的牌，顺序已经随机
      const wall = shuffled.filter((id) => !used.has(id));
      if (wall.length !== v.wallCount)
        throw new Error(`determinize: 牌墙 ${wall.length} 张，应为 ${v.wallCount} 张`);
      return {
        state: buildState(v, out, wall, rng),
        relaxed: !strict,
        banked: v.myKongIncome ?? 0,
      };
    }
  }
  throw new Error('determinize: 无法补全手牌');
}

function buildState(v: ScView, hands: Map<number, number[]>, wall: number[], rng: Rng): ScState {
  const me = v.seat ?? 0;
  const all = createTiles();
  const ledger: LedgerEntry[] = [];
  const receipts: ScState['receipts'] = [];
  const other = [1, 2, 3].map((d) => (me + d) % 4)[0];
  const players: ScPlayer[] = v.players.map((p, s) => ({
    hand:
      s === me
        ? [...v.hand]
        : p.won
          ? [...(p.hand ?? [])]
          : (hands.get(s) ?? []).map((id) => all[id]),
    melds: p.melds.map((m) => ({ ...m, tiles: [...m.tiles] })),
    river: p.river.map((r) => ({
      tile: r.tile,
      ...(r.claimedBy ? { claimedBy: [...r.claimedBy] } : {}),
    })),
    que: p.que,
    won: p.won,
    passHu: false,
    afterKong: s === me && v.myAfterKong !== null,
    lastReceipt: null,
    hasDrawn: true,
  }));
  // 自己已收的杠钱：做成账本里的收据，流局退税、杠上炮呼叫转移才能正确结算
  const income = v.myKongIncome ?? 0;
  const last = v.myAfterKong ?? 0;
  if (income - last > 0) {
    ledger.push({ from: other, to: me, amount: income - last, clause: 'kong.xia_yu' });
    receipts.push({ seat: me, entries: [ledger.length - 1], gross: income - last, transferred: 0 });
  }
  if (last > 0) {
    ledger.push({ from: other, to: me, amount: last, clause: 'kong.gua_feng_zhi' });
    receipts.push({ seat: me, entries: [ledger.length - 1], gross: last, transferred: 0 });
    players[me].lastReceipt = receipts.length - 1;
  }
  const wonSeats = v.players.map((p, s) => (p.won ? s : -1)).filter((s) => s >= 0);
  return {
    options: v.options,
    rng: rng.int(4294967296),
    round: v.round,
    phase: 'play',
    dealer: v.dealer,
    wall: wall.map((id) => all[id]),
    players,
    turn: me,
    drawnThisTurn: v.drawn,
    canSelfHu: !!v.legal?.hu || v.drawn !== null,
    mustHuSelf: !!v.legal?.mustHu,
    dihuChance: false,
    window: null,
    lastDiscard: v.lastDiscard,
    exchangeDir: v.exchangeDir,
    exchanged: null,
    discards: v.players.reduce((a, p) => a + p.river.length, 0),
    claimsOrKongs: v.players.reduce((a, p) => a + p.melds.length, 0),
    receipts,
    ledger,
    groups: Math.max(0, ...v.players.map((p) => p.won?.group ?? 0)),
    firstGroup: wonSeats.length ? { seats: [wonSeats[0]], supplier: null } : null,
    scores: [...v.scores],
    ready: [false, false, false, false],
    result: null,
    history: [],
    events: [],
    eventSeq: 0,
  };
}

export interface RolloutResult {
  delta: number;
  won: boolean;
  dealIn: boolean;
  chajiao: boolean;
}

/** 从采样局面出发：先打出 tile，再四家都用 sichuanBot 打到本盘结束 */
export function rollout(d: Determinized, me: number, tile: number, rng: Rng): RolloutResult {
  // 采样局面要给几个候选共用：先拷贝一份，之后原地推演（不必每步深拷贝）
  let st = applyInPlace(clone(d.state), me, { type: 'discard', tile });
  for (let step = 0; step < 2000 && st.phase === 'play'; step++) {
    const seat = sichuan.activeSeats(st)[0];
    if (seat === undefined) break;
    st = applyInPlace(st, seat, sichuanBot(sichuan.view(st, seat), seat, rng));
  }
  const r = st.result;
  if (!r) return { delta: 0, won: false, dealIn: false, chajiao: false };
  return {
    delta: r.deltas[me] - d.banked,
    won: r.wins.some((w) => w.seat === me),
    dealIn: r.wins.some((w) => !w.selfDrawn && w.from === me),
    chajiao: r.ledger.some((e) => e.clause === 'tax.chajiao' && e.from === me),
  };
}

export interface McOptions {
  /** 时间预算（毫秒），不传用参数里的；Infinity 表示只按局数停（测试用，结果确定） */
  budgetMs?: number;
  maxPerCandidate?: number;
  batch?: number;
  params?: ScCoachParams;
  now?: () => number;
}

/**
 * 对几个候选出牌做精算：所有候选共用同一批采样局面和随机数（common random numbers），
 * 逐轮每个候选加 batch 局；落后第一名超过 z 倍标准误（按配对差算）的淘汰。
 * 返回按牌种的统计。
 */
export function mcEvaluate(
  v: ScView,
  tiles: readonly number[],
  opts: McOptions = {},
): Record<number, ScMcStat> {
  const params = opts.params ?? SC_COACH_PARAMS;
  const budget = opts.budgetMs ?? params.mc.budgetMs;
  const maxN = opts.maxPerCandidate ?? params.mc.maxPerCandidate;
  const batch = opts.batch ?? params.mc.batch;
  const now = opts.now ?? (() => Date.now());
  const me = v.seat ?? 0;
  const t0 = now();
  const seed = viewSeed(v);
  const uniq = [...new Map(tiles.map((id) => [kindOf(tileOf(id)), id])).values()];
  const samples: Determinized[] = [];
  const sample = (j: number) => (samples[j] ??= determinize(v, new Rng(seed + j * 7919)));
  const data = new Map<number, RolloutResult[]>(uniq.map((id) => [id, []]));
  let alive = [...uniq];
  let n = 0;
  /** 上一轮每个候选花的时间 */
  let perCand = 0;
  while (alive.length && n < maxN) {
    // 预计下一轮会超出预算就停（第一轮总要算）
    if (n > 0 && now() - t0 + perCand * alive.length > budget) break;
    const r0 = now();
    const ran = alive.length;
    const end = Math.min(maxN, n + batch);
    for (const id of alive) {
      const rows = data.get(id)!;
      for (let j = n; j < end; j++)
        rows.push(rollout(sample(j), me, id, new Rng(seed ^ (j * 104729 + 1))));
    }
    n = end;
    if (alive.length > 1) {
      const mean = (id: number) => data.get(id)!.reduce((a, r) => a + r.delta, 0) / n;
      const leader = alive.reduce((a, b) => (mean(b) > mean(a) ? b : a));
      const lead = data.get(leader)!;
      alive = alive.filter((id) => {
        if (id === leader) return true;
        const rows = data.get(id)!;
        const diffs = rows.map((r, j) => r.delta - lead[j].delta);
        const m = diffs.reduce((a, b) => a + b, 0) / n;
        const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
        return m + params.mc.z * (sd / Math.sqrt(n)) >= 0;
      });
    }
    perCand = (now() - r0) / ran;
    if (alive.length <= 1 || now() - t0 > budget) break;
  }
  const out: Record<number, ScMcStat> = {};
  for (const id of uniq) {
    const rows = data.get(id)!;
    if (!rows.length) continue;
    const m = rows.reduce((a, r) => a + r.delta, 0) / rows.length;
    const sd = Math.sqrt(
      rows.reduce((a, r) => a + (r.delta - m) ** 2, 0) / Math.max(1, rows.length - 1),
    );
    out[kindOf(tileOf(id))] = {
      mean: m,
      se: sd / Math.sqrt(rows.length),
      pWin: rows.filter((r) => r.won).length / rows.length,
      pDealIn: rows.filter((r) => r.dealIn).length / rows.length,
      pChajiao: rows.filter((r) => r.chajiao).length / rows.length,
      n: rows.length,
      kept: alive.includes(id),
    };
  }
  return out;
}

/** 测试用：采样出的局面里，各座位手牌与牌墙的牌 */
export function _tilesOf(state: ScState): Tile[] {
  return [
    ...state.wall,
    ...state.players.flatMap((p) => [
      ...p.hand,
      ...p.melds.flatMap((m) => m.tiles),
      ...p.river.map((r) => r.tile),
    ]),
  ];
}
