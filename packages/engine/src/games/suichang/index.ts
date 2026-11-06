import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import {
  createTiles,
  hzKindOf,
  isHonor,
  kindRank,
  kindSuit,
  sortTiles,
} from '../../mahjong/tiles136';
import { explosiveWait, waits } from './analysis';
import { szAiPrompt } from './ai';
import { suichangBot } from './bot';
import type { MeldShape, WinScore } from './scoring';
import {
  JIAN_BAI,
  splitTiles,
  type Tile,
} from './tiles';
import {
  BASE_SCORE,
  DEALER_BASE,
  DEALER_STEP,
  START_CHIPS,
  THREE_CLEAR_BONUS,
  WALL_RESERVE,
  evaluateWin,
  robAmount,
} from './scoring';

export * from './tiles';
export * from './analysis';
export * from './scoring';

type HzTile = Tile;

/**
 * 遂昌麻将（规则版本 suichang-1）。
 *
 * 136 张、四人。翻财神：从牌墙尾翻一张，翻到的牌的种类就是财神；翻开的这张移出牌墙，
 * 所以该种类剩 3 张，这 3 张是万能牌（可当任意牌、可做将、不能碰杠吃、可打出飞财）。
 * 白板则全部变成该种类的普通牌（例如翻到一万，4 张白板都当一万，可以吃碰杠、可以点炮）。
 * 飞财后下、对、上家各摸一次的「一圈」内，所有人只能摸牌进张、只能自摸；
 * 飞财者本人下一次摸牌自摸 +1 番。
 *
 * 计分：平胡 0 番 = 1 倍，倍数 = 2^番；自摸三家付、点炮者双倍、其余两家单倍；
 * 底分 5，庄家 6 / 8 / 10…（连庄 +2）。每人每盘 50 筹码，有人清零本盘结束，
 * 三家同时清零为三清，每家额外 50。
 */

export const RULESET = 'suichang-1';

export interface SzOptions {
  /** 盘数：一盘打到有人筹码清零为止 */
  sessions: number;
  chi: boolean;
  joker: boolean;
}

export type SzAction =
  | { type: 'discard'; tile: number }
  | { type: 'hu' }
  | { type: 'gang'; tile?: number }
  | { type: 'peng' }
  | { type: 'chi'; tiles: number[] }
  | { type: 'pass' }
  | { type: 'ready' };

export type KongType = 'an' | 'zhi' | 'ba';

export interface SzMeld {
  type: 'chi' | 'pung' | 'kong';
  kongType?: KongType;
  kind: number;
  tiles: HzTile[];
  from: Seat | null;
}

export interface RiverTile {
  tile: HzTile;
  claimedBy?: Seat[];
}

export interface SzWin {
  seat: Seat;
  selfDrawn: boolean;
  robbing: boolean;
  tile: HzTile;
  from: Seat | null;
  score: WinScore;
}

export type Clause = 'pay.zimo' | 'pay.dianpao' | 'pay.rob' | 'pay.yellow' | 'bonus.sanqing';

export const CLAUSE_NAME: Record<Clause, string> = {
  'pay.zimo': '自摸',
  'pay.dianpao': '点炮',
  'pay.rob': '抢杠承包',
  'pay.yellow': '荒庄',
  'bonus.sanqing': '三清',
};

export interface LedgerEntry {
  from: Seat;
  to: Seat;
  /** 应付 */
  due: number;
  /** 实际付（筹码不足时只付到 0） */
  actual: number;
  clause: Clause;
}

export interface SzPlayer {
  hand: HzTile[];
  melds: SzMeld[];
  river: RiverTile[];
  hasDrawn: boolean;
}

export type WindowOpt = 'hu' | 'gang' | 'peng' | 'chi' | 'pass';

export interface SzWindow {
  kind: 'claims' | 'rob';
  required: boolean[];
  decisions: (SzAction | null)[];
  options: (WindowOpt[] | null)[];
  source: Seat | null;
  tile: HzTile | null;
}

export interface SzEvent {
  seq: number;
  type: 'chi' | 'peng' | 'gang' | 'hu' | 'zimo' | 'rob' | 'fly';
  seat: Seat;
  from?: Seat | null;
  kongType?: KongType;
}

export interface SzMeldView {
  type: SzMeld['type'];
  kongType?: KongType;
  kind: number;
  tiles: HzTile[] | null;
  from: Seat | null;
}

export interface SzPlayerView {
  handCount: number;
  melds: SzMeldView[];
  river: RiverTile[];
  won: boolean;
  hand: HzTile[] | null;
}

export interface SzRoundResult {
  session: number;
  round: number;
  reason: 'win' | 'wall';
  wins: SzWin[];
  ledger: LedgerEntry[];
  deltas: number[];
  chipsAfter: number[];
  dealer: Seat;
  /** 本局庄家的底分（结算时已经算好，下一局会变） */
  dealerBase: number;
  nextDealer: Seat;
  dealerKeeps: boolean;
  sessionEnded: boolean;
  sanqing: boolean;
  jokerKind: number | null;
  /** 本盘待结算（抢杠承包、三清），盘末统一结 */
  pending: LedgerEntry[];
}

export interface SzSessionResult {
  session: number;
  rounds: number;
  chips: number[];
  deltas: number[];
  sanqing: boolean;
  pending: LedgerEntry[];
}

export type SzPhase = 'play' | 'roundOver' | 'matchOver';

export interface SzState {
  options: SzOptions;
  rng: number;
  session: number;
  round: number;
  phase: SzPhase;
  dealer: Seat;
  dealerStreak: number;
  chips: number[];
  wall: HzTile[];
  /** 留底的 34 张（荒庄判定用，不参与摸牌） */
  reserve: HzTile[];
  flip: HzTile | null;
  /** 本局财神：翻出的牌的种类（3 张）；白板替身为该种类的普通牌 */
  jokerKind: number | null;
  players: SzPlayer[];
  turn: Seat;
  drawn: number | null;
  canSelfHu: boolean;
  afterKong: boolean;
  dihuChance: boolean;
  window: SzWindow | null;
  lastDiscard: { seat: Seat; id: number } | null;
  discards: number;
  claims: number;
  /** 飞财的那一圈：seat 打的财神，left 表示还有几家的正常摸牌 */
  fly: { seat: Seat; left: number } | null;
  flyBonus: boolean[];
  roundLedger: LedgerEntry[];
  /** 抢杠承包与三清，等一盘结束再结算 */
  pending: LedgerEntry[];
  wins: SzWin[];
  result: SzRoundResult | null;
  sessionResult: SzSessionResult | null;
  ready: boolean[];
  history: {
    session: number;
    round: number;
    reason: 'win' | 'wall';
    deltas: number[];
    chipsAfter: number[];
    wins: { seat: Seat; fan: number; robbing: boolean }[];
  }[];
  events: SzEvent[];
  eventSeq: number;
}

export interface SzLegal {
  discard: number[];
  hu: boolean;
  gang: { tile: number; type: KongType }[];
  peng: boolean;
  chi: number[][];
  pass: boolean;
  ready: boolean;
}

export interface SzView {
  seat: Seat | null;
  phase: SzPhase;
  session: number;
  round: number;
  options: SzOptions;
  dealer: Seat;
  dealerStreak: number;
  dealerBase: number;
  chips: number[];
  wallCount: number;
  turn: Seat | null;
  flip: HzTile | null;
  jokerKind: number | null;
  fly: { seat: Seat; left: number } | null;
  flyBonus: boolean;
  players: SzPlayerView[];
  hand: HzTile[];
  drawn: number | null;
  legal: SzLegal | null;
  window: { kind: SzWindow['kind']; source: Seat | null; tile: HzTile | null } | null;
  lastDiscard: { seat: Seat; id: number } | null;
  visible: number[];
  events: SzEvent[];
  result: SzRoundResult | null;
  sessionResult: SzSessionResult | null;
  ready: boolean[];
  history: SzState['history'];
  wins: SzWin[];
}

const N = 4;
const MAX_ROUNDS = 60;

const others = (s: Seat) => [1, 2, 3].map((d) => (s + d) % N);
const nextSeat = (s: Seat) => (s + 1) % N;
const meldShapes = (p: SzPlayer): MeldShape[] =>
  p.melds.map((m) => ({ type: m.type, kind: m.kind }));

const dealerBaseOf = (state: SzState) => DEALER_BASE + DEALER_STEP * state.dealerStreak;

/** 一笔钱用谁的底分：涉及庄家用庄底分，两个闲家之间用 5 */
function baseBetween(state: SzState, a: Seat, b: Seat): number {
  return a === state.dealer || b === state.dealer ? dealerBaseOf(state) : BASE_SCORE;
}

type EventInput = SzEvent extends infer E ? (E extends unknown ? Omit<E, 'seq'> : never) : never;

function pushEvent(state: SzState, e: EventInput) {
  state.events.push({ ...e, seq: ++state.eventSeq } as SzEvent);
  if (state.events.length > 16) state.events.shift();
}

function pay(state: SzState, from: Seat, to: Seat, due: number, clause: Clause): void {
  const actual = Math.max(0, Math.min(state.chips[from], due));
  state.chips[from] -= actual;
  state.chips[to] += actual;
  state.roundLedger.push({ from, to, due, actual, clause });
}

function pendingPay(state: SzState, from: Seat, to: Seat, due: number, clause: Clause): void {
  state.pending.push({ from, to, due, actual: due, clause });
}

function newWindow(kind: SzWindow['kind']): SzWindow {
  return {
    kind,
    required: [false, false, false, false],
    decisions: [null, null, null, null],
    options: [null, null, null, null],
    source: null,
    tile: null,
  };
}

function windowDone(w: SzWindow): boolean {
  return w.required.every((r, s) => !r || w.decisions[s] !== null);
}

function waitingIn(w: SzWindow, seat: Seat): boolean {
  return w.required[seat] && w.decisions[seat] === null;
}

function canDraw(state: SzState): boolean {
  return state.wall.length > 0;
}

function activeSeats(state: SzState): Seat[] {
  if (state.phase === 'roundOver') return [0, 1, 2, 3].filter((s) => !state.ready[s]);
  if (state.phase === 'matchOver') return [];
  if (state.window) return [0, 1, 2, 3].filter((s) => waitingIn(state.window!, s));
  return [state.turn];
}

const isJoker = (t: Pick<Tile, 'joker'>) => !!t.joker;

/** 和牌评估（`tile` 为和进的那张；自摸传 null） */
function scoreFor(
  state: SzState,
  p: SzPlayer,
  tile: HzTile | null,
  selfDrawn: boolean,
  opts: {
    afterKong?: boolean;
    tianhu?: boolean;
    dihu?: boolean;
    flyBonus?: boolean;
    explosive?: boolean;
  } = {},
): WinScore | null {
  const concealed = tile ? [...p.hand, tile] : p.hand;
  return evaluateWin(concealed, meldShapes(p), state.jokerKind, {
    selfDrawn,
    afterKong: !!opts.afterKong,
    tianhu: !!opts.tianhu,
    dihu: !!opts.dihu,
    flyBonus: !!opts.flyBonus,
    explosive: !!opts.explosive,
  });
}

function isTianhu(state: SzState, seat: Seat, p: SzPlayer): boolean {
  return seat === state.dealer && state.discards === 0 && state.claims === 0 && !p.hasDrawn;
}

/** 自摸时的爆头判定：把摸到的那张拿掉，剩下的 13 张是不是「4 组面子 + 财神」 */
function explosiveOf(state: SzState, p: SzPlayer): boolean {
  if (state.jokerKind === null || state.drawn === null) return false;
  const pre = p.hand.filter((t) => t.id !== state.drawn);
  const { real, jokers } = splitTiles(pre, state.jokerKind);
  return explosiveWait(real, jokers, p.melds.length);
}

/** 这张牌能不能点炮胡（爆头不能点炮） */
function canRon(state: SzState, p: SzPlayer, tile: HzTile): boolean {
  const { real, jokers } = splitTiles(p.hand, state.jokerKind);
  if (explosiveWait(real, jokers, p.melds.length)) return false;
  return !!scoreFor(state, p, tile, false);
}

function chiPairs(hand: readonly HzTile[], tile: HzTile): number[][] {
  const kind = hzKindOf(tile);
  if (isHonor(kind)) return [];
  const out: number[][] = [];
  const pick = (rank: number) =>
    hand.filter((t) => t.suit === tile.suit && t.rank === rank && !isJoker(t));
  for (const [a, b] of [
    [tile.rank - 2, tile.rank - 1],
    [tile.rank - 1, tile.rank + 1],
    [tile.rank + 1, tile.rank + 2],
  ]) {
    if (a < 1 || b > 9) continue;
    const ta = pick(a);
    const tb = pick(b);
    if (ta.length && tb.length) out.push([ta[0].id, tb[0].id]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 发牌与推进

/** 发牌后处理财神：翻出的种类标记为万能牌；白板改成该种类的普通牌 */
function prepareTiles(tiles: readonly Tile[], flipKind: number): Tile[] {
  const targetSuit = kindSuit(flipKind);
  const targetRank = kindRank(flipKind);
  return tiles.map((t) => {
    const face = hzKindOf(t);
    if (face === flipKind) return { ...t, joker: true };
    if (face === JIAN_BAI && flipKind !== JIAN_BAI) {
      return { ...t, suit: targetSuit, rank: targetRank, sub: true, joker: false };
    }
    return t;
  });
}

function deal(state: SzState): void {
  const rng = new Rng(state.rng);
  const wall = rng.shuffle(createTiles());
  state.rng = rng.state;
  state.round++;
  state.players = [0, 1, 2, 3].map(() => ({ hand: [], melds: [], river: [], hasDrawn: false }));
  for (let i = 0; i < 13; i++)
    for (let s = 0; s < N; s++) state.players[(state.dealer + s) % N].hand.push(wall.shift()!);
  state.players[state.dealer].hand.push(wall.shift()!);
  // 翻财神：从牌墙尾翻一张，翻到的牌的种类就是财神（3 张万能牌）；白板替成这一张
  state.flip = null;
  state.jokerKind = null;
  if (state.options.joker && wall.length > 0) {
    state.flip = wall.pop()!;
    state.jokerKind = hzKindOf(state.flip);
  }
  // 留最后 34 张不摸（线下「摸完 3 个牌堆」即荒庄）
  state.reserve = wall.splice(Math.max(0, wall.length - WALL_RESERVE), WALL_RESERVE);
  state.wall = wall;
  if (state.jokerKind !== null) {
    const fk = state.jokerKind;
    for (const p of state.players) p.hand = prepareTiles(p.hand, fk);
    state.wall = prepareTiles(state.wall, fk);
    state.reserve = prepareTiles(state.reserve, fk);
  }
  state.turn = state.dealer;
  state.drawn = null;
  state.canSelfHu = true;
  state.afterKong = false;
  state.dihuChance = false;
  state.window = null;
  state.lastDiscard = null;
  state.discards = 0;
  state.claims = 0;
  state.fly = null;
  state.flyBonus = [false, false, false, false];
  state.roundLedger = [];
  state.wins = [];
  state.ready = [false, false, false, false];
  state.result = null;
  state.sessionResult = null;
  state.events = [];
  state.eventSeq = 0;
  state.phase = 'play';
}

function draw(state: SzState, seat: Seat, replacement: boolean): void {
  if (!canDraw(state)) {
    endRound(state, 'wall');
    return;
  }
  const p = state.players[seat];
  const tile = replacement ? state.wall.pop()! : state.wall.shift()!;
  const firstDraw = !p.hasDrawn;
  p.hand.push(tile);
  p.hasDrawn = true;
  state.turn = seat;
  state.drawn = tile.id;
  state.canSelfHu = true;
  state.afterKong = replacement;
  state.dihuChance =
    !replacement && seat !== state.dealer && firstDraw && state.claims === 0 && state.discards <= 1;
  state.window = null;
  if (!replacement && state.fly && state.fly.seat !== seat) {
    state.fly.left -= 1;
    if (state.fly.left <= 0) state.fly = null;
  }
}

function advance(state: SzState, from: Seat): void {
  draw(state, nextSeat(from), false);
}

function endRound(state: SzState, reason: 'win' | 'wall'): void {
  state.window = null;
  if (reason === 'wall') {
    const d = state.dealer;
    for (const s of others(d)) pay(state, d, s, BASE_SCORE, 'pay.yellow');
  }
  const deltas = [0, 0, 0, 0];
  for (const e of state.roundLedger) {
    deltas[e.from] -= e.actual;
    deltas[e.to] += e.actual;
  }
  const dealerWon = state.wins.some((w) => w.seat === state.dealer);
  const dealerKeeps = reason === 'wall' || dealerWon;
  const nextDealer = dealerKeeps ? state.dealer : nextSeat(state.dealer);
  const dealerBase = dealerBaseOf(state);

  const zeroCount = state.chips.filter((c) => c <= 0).length;
  let sessionEnded = false;
  let sanqing = false;
  if (zeroCount > 0) {
    sessionEnded = true;
    if (zeroCount === 3) {
      const winner = state.chips.findIndex((c) => c > 0);
      if (winner >= 0 && state.wins.some((w) => w.seat === winner)) {
        sanqing = true;
        for (let s = 0; s < N; s++) {
          if (s === winner || state.chips[s] > 0) continue;
          pendingPay(state, s, winner, THREE_CLEAR_BONUS, 'bonus.sanqing');
        }
      }
    }
  } else if (state.round >= MAX_ROUNDS) {
    sessionEnded = true;
  }

  const wins = [...state.wins].sort((a, b) => a.seat - b.seat);
  state.result = {
    session: state.session,
    round: state.round,
    reason,
    wins,
    ledger: [...state.roundLedger],
    deltas,
    chipsAfter: [...state.chips],
    dealer: state.dealer,
    dealerBase,
    nextDealer,
    dealerKeeps,
    sessionEnded,
    sanqing,
    jokerKind: state.jokerKind,
    pending: [...state.pending],
  };
  state.history.push({
    session: state.session,
    round: state.round,
    reason,
    deltas,
    chipsAfter: [...state.chips],
    wins: wins.map((w) => ({ seat: w.seat, fan: w.score.fan, robbing: w.robbing })),
  });

  if (sessionEnded) {
    for (const e of state.pending) {
      state.chips[e.from] -= e.actual;
      state.chips[e.to] += e.actual;
    }
    state.sessionResult = {
      session: state.session,
      rounds: state.round,
      chips: [...state.chips],
      deltas: state.chips.map((c) => c - START_CHIPS),
      sanqing,
      pending: [...state.pending],
    };
  }

  state.dealer = nextDealer;
  state.dealerStreak = dealerKeeps ? state.dealerStreak + 1 : 0;
  state.phase =
    sessionEnded && state.session >= state.options.sessions ? 'matchOver' : 'roundOver';
}

function completeBa(state: SzState, seat: Seat, tile: HzTile): void {
  const p = state.players[seat];
  const meld = p.melds.find((m) => m.type === 'pung' && m.kind === hzKindOf(tile));
  if (meld) {
    meld.type = 'kong';
    meld.kongType = 'ba';
    meld.tiles = [...meld.tiles, tile];
  }
  pushEvent(state, { type: 'gang', seat, kongType: 'ba' });
  draw(state, seat, true);
}

function openClaims(state: SzState, discarder: Seat, tile: HzTile): void {
  // 飞财这一圈：只能摸牌进张，不能吃碰明杠，也不能点炮胡
  if (state.fly) {
    advance(state, discarder);
    return;
  }
  const kind = hzKindOf(tile);
  if (isJoker(tile)) {
    advance(state, discarder);
    return;
  }
  const w = newWindow('claims');
  w.source = discarder;
  w.tile = tile;
  // 截胡：只给离出牌者最近的一家胡
  let huSeat: Seat | null = null;
  for (const s of others(discarder)) {
    if (canRon(state, state.players[s], tile)) {
      huSeat = s;
      break;
    }
  }
  let any = false;
  for (const s of others(discarder)) {
    const p = state.players[s];
    w.required[s] = true;
    const opts: WindowOpt[] = [];
    if (s === huSeat) opts.push('hu');
    const natural = p.hand.filter((t) => hzKindOf(t) === kind && !isJoker(t)).length;
    if (natural >= 3 && canDraw(state)) opts.push('gang');
    if (natural >= 2) opts.push('peng');
    if (
      state.options.chi &&
      s === nextSeat(discarder) &&
      chiPairs(p.hand, tile).length > 0
    )
      opts.push('chi');
    if (opts.length === 0) {
      w.decisions[s] = { type: 'pass' };
      w.options[s] = ['pass'];
    } else {
      w.options[s] = [...opts, 'pass'];
      any = true;
    }
  }
  if (!any) {
    advance(state, discarder);
    return;
  }
  state.window = w;
}

function ronWin(
  state: SzState,
  winner: Seat,
  supplier: Seat,
  tile: HzTile,
  robbing: boolean,
): boolean {
  const p = state.players[winner];
  const score = scoreFor(state, p, tile, false);
  if (!score) return false;
  state.wins.push({
    seat: winner,
    selfDrawn: false,
    robbing,
    tile,
    from: supplier,
    score,
  });
  pushEvent(state, { type: robbing ? 'rob' : 'hu', seat: winner, from: supplier });
  if (robbing) {
    // 抢杠承包：只有杠的人付，底分 50，按牌型番翻倍，等一盘结束结算
    pendingPay(state, supplier, winner, robAmount(score), 'pay.rob');
  } else {
    const mult = score.multiplier;
    const shooterDue = 2 * baseBetween(state, supplier, winner) * mult;
    pay(state, supplier, winner, shooterDue, 'pay.dianpao');
    for (const s of others(supplier)) {
      if (s === winner) continue;
      pay(state, s, winner, baseBetween(state, s, winner) * mult, 'pay.dianpao');
    }
  }
  endRound(state, 'win');
  return true;
}

function resolveWindow(state: SzState): void {
  const w = state.window!;
  const source = w.source!;
  const tile = w.tile!;
  const order = others(source);
  const dec = (s: Seat) => w.decisions[s];
  const huSeat = order.find((s) => dec(s)?.type === 'hu');
  state.window = null;

  if (w.kind === 'rob') {
    if (huSeat !== undefined) {
      ronWin(state, huSeat, source, tile, true);
      if (state.phase !== 'play') return;
    }
    completeBa(state, source, tile);
    return;
  }

  if (huSeat !== undefined) {
    const discarder = state.players[source];
    discarder.river[discarder.river.length - 1].claimedBy = [huSeat];
    ronWin(state, huSeat, source, tile, false);
    if (state.phase === 'play') advance(state, source);
    return;
  }

  const kind = hzKindOf(tile);
  const gangSeat = order.find((s) => dec(s)?.type === 'gang');
  if (gangSeat !== undefined) {
    const p = state.players[gangSeat];
    const own = p.hand.filter((t) => hzKindOf(t) === kind && !isJoker(t)).slice(0, 3);
    const ids = new Set(own.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    p.melds.push({ type: 'kong', kongType: 'zhi', kind, tiles: [...own, tile], from: source });
    state.players[source].river.pop();
    state.lastDiscard = null;
    state.claims++;
    pushEvent(state, { type: 'gang', seat: gangSeat, from: source, kongType: 'zhi' });
    draw(state, gangSeat, true);
    return;
  }
  const pengSeat = order.find((s) => dec(s)?.type === 'peng');
  if (pengSeat !== undefined) {
    const p = state.players[pengSeat];
    const own = p.hand.filter((t) => hzKindOf(t) === kind && !isJoker(t)).slice(0, 2);
    const ids = new Set(own.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    p.melds.push({ type: 'pung', kind, tiles: [...own, tile], from: source });
    state.players[source].river.pop();
    state.lastDiscard = null;
    state.claims++;
    pushEvent(state, { type: 'peng', seat: pengSeat, from: source });
    state.turn = pengSeat;
    state.drawn = null;
    state.canSelfHu = false;
    state.afterKong = false;
    state.dihuChance = false;
    return;
  }
  const chiSeat = order.find((s) => dec(s)?.type === 'chi');
  if (chiSeat !== undefined) {
    const p = state.players[chiSeat];
    const action = dec(chiSeat) as { tiles: number[] };
    const ids = new Set(action.tiles);
    const own = p.hand.filter((t) => ids.has(t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    const tiles = [...own, tile].sort((a, b) => hzKindOf(a) - hzKindOf(b));
    p.melds.push({ type: 'chi', kind: Math.min(...tiles.map(hzKindOf)), tiles, from: source });
    state.players[source].river.pop();
    state.lastDiscard = null;
    state.claims++;
    pushEvent(state, { type: 'chi', seat: chiSeat, from: source });
    state.turn = chiSeat;
    state.drawn = null;
    state.canSelfHu = false;
    state.afterKong = false;
    state.dihuChance = false;
    return;
  }
  advance(state, source);
}

// ---------------------------------------------------------------------------
// 合法动作

export function legalActions(state: SzState, seat: Seat): SzLegal | null {
  const L: SzLegal = {
    discard: [],
    hu: false,
    gang: [],
    peng: false,
    chi: [],
    pass: false,
    ready: false,
  };
  if (state.phase === 'roundOver') {
    if (state.ready[seat]) return null;
    L.ready = true;
    return L;
  }
  if (state.phase !== 'play') return null;
  const p = state.players[seat];
  const w = state.window;
  if (w) {
    if (!waitingIn(w, seat)) return null;
    const opts = w.options[seat] ?? [];
    L.hu = opts.includes('hu');
    L.pass = opts.includes('pass');
    L.peng = opts.includes('peng');
    if (opts.includes('gang')) L.gang = [{ tile: w.tile!.id, type: 'zhi' }];
    if (opts.includes('chi') && w.tile) L.chi = chiPairs(p.hand, w.tile);
    return L;
  }
  if (state.turn !== seat) return null;
  L.discard = p.hand.map((t) => t.id);
  if (state.canSelfHu) {
    const explosive = explosiveOf(state, p);
    const score = scoreFor(state, p, null, true, {
      afterKong: state.afterKong,
      tianhu: isTianhu(state, seat, p),
      dihu: state.dihuChance,
      flyBonus: state.flyBonus[seat],
      explosive,
    });
    L.hu = !!score;
  }
  if (canDraw(state)) {
    const normal = new Array<number>(34).fill(0);
    for (const t of p.hand) if (!isJoker(t)) normal[hzKindOf(t)]++;
    for (let k = 0; k < 34; k++) {
      if (normal[k] !== 4) continue;
      const t = p.hand.find((x) => !isJoker(x) && hzKindOf(x) === k)!;
      L.gang.push({ tile: t.id, type: 'an' });
    }
    for (const m of p.melds) {
      if (m.type !== 'pung') continue;
      const t = p.hand.find((x) => !isJoker(x) && hzKindOf(x) === m.kind);
      if (t) L.gang.push({ tile: t.id, type: 'ba' });
    }
  }
  return L;
}

function cleanAction(a: SzAction): SzAction {
  switch (a.type) {
    case 'discard':
      return { type: 'discard', tile: Number(a.tile) };
    case 'gang':
      return typeof a.tile === 'number' ? { type: 'gang', tile: Number(a.tile) } : { type: 'gang' };
    case 'chi':
      return { type: 'chi', tiles: Array.isArray(a.tiles) ? a.tiles.map(Number) : [] };
    default:
      return { type: a.type };
  }
}

/** 听牌提示（界面用） */
export function currentWaits(state: SzState, seat: Seat): number[] {
  const p = state.players[seat];
  if (p.hand.length % 3 !== 1) return [];
  const { real, jokers } = splitTiles(p.hand, state.jokerKind);
  return waits(real, jokers, state.jokerKind, p.melds.length);
}

export function waitsAfter(state: SzState, seat: Seat, tileId: number): number[] {
  const p = state.players[seat];
  const rest = p.hand.filter((t) => t.id !== tileId);
  const { real, jokers } = splitTiles(rest, state.jokerKind);
  return waits(real, jokers, state.jokerKind, p.melds.length);
}

/** 手牌是否爆头（白板替身不算财神） */
export function isExplosiveHand(
  hand: readonly Tile[],
  jokerKind: number | null,
  melds: number,
): boolean {
  const { real, jokers } = splitTiles(hand, jokerKind);
  return explosiveWait(real, jokers, melds);
}

/** 手牌听牌（给界面用，自动拆出财神） */
export function handWaits(
  hand: readonly Tile[],
  jokerKind: number | null,
  melds: number,
): number[] {
  const { real, jokers } = splitTiles(hand, jokerKind);
  return waits(real, jokers, jokerKind, melds);
}

export const suichang: GameDefinition<SzState, SzAction, SzView, SzOptions> = {
  meta: {
    id: 'suichang',
    category: 'mahjong',
    name: '遂昌麻将',
    nameEn: 'Suichang Mahjong',
    tagline: '翻财神、可以吃：财神做将听所有牌，50 筹码一盘打到有人清袋',
    minPlayers: 4,
    maxPlayers: 4,
    defaultPlayers: 4,
    botDelayMs: [450, 950],
    rules: [
      '遂昌麻将（规则版本 suichang-1）：136 张牌（万、条、筒、东南西北、中发白），四人，可以吃上家的牌。',
      '翻财神：从牌墙尾翻一张，翻到的牌的种类就是财神；翻开的这张移出牌墙，所以该种类只剩 3 张万能牌（可当任意牌胡、可做将、可单吊，不能碰杠吃）。白板全部变成该种类的普通牌（例如翻到一万，4 张白板都当一万，可以吃碰杠、可以点炮；翻到白板时则 3 张白板是万能牌）。',
      '飞财：主动打出财神叫飞财。飞财后下、对、上家各摸一次的「一圈」内，所有人只能摸牌进张、只能自摸，不能吃碰、明杠、抢杠和点炮胡；暗杠、补杠可以。飞财者本人下一次摸牌自摸 +1 番。',
      '行牌：只能吃上家；碰、明杠、暗杠、补杠；杠后从牌墙尾补牌；补杠可以被抢杠；多人能胡时截胡，只算离出牌者最近的一家，其余两家仍各付一份。',
      '胡牌：4 面子 + 1 将、七对、豪华七对、清一色、混一色、碰碰胡、字一色、不搭（普通 / 正规 / 豪华 / 超豪华 / 七风）、全落地（吃碰杠后手牌只剩一张）；一家胡牌本局结束。',
      '平胡 0 番 = 1 倍，倍数 = 2^番，不封顶；碰碰胡、混一色、七对各 +1，清一色 +2，字一色 +3（可叠碰碰胡），豪华七对 +1（七对共 2 番），不搭正规 +1 / 豪华 +2 / 超豪华 +3，七风 +1（七张字牌齐全，不能用财神补缺），全落地 +1。',
      '过程番：自摸 +1、杠上开花 +1、天胡 / 地胡 +2（不再叠自摸）、飞财自摸 +1、爆头 +1（财神做将，只能自摸，不能点炮）。',
      '付款：自摸三家各付；点炮者付双份、其余两家各付一份；底分 5，涉及庄家时按庄家底分（6 / 8 / 10…，连庄 +2，无上限）。',
      '抢杠承包：抢杠胡只有被抢杠的人付，底分按 50、按牌型番翻倍，等一盘结束再结算。',
      '荒庄：牌墙留 34 张不摸（摸完 102 张）即荒庄，庄家给其余三家各 5 分，庄家继续坐庄；连庄底分 +2。',
      '筹码：每人每盘 50，有人清零本盘结束（只付到 0）；三家同时清零为三清，每家额外付 50；每盘结束结算并重置。',
    ],
  },
  defaultOptions: { sessions: 1, chi: true, joker: true },
  optionFields: [
    {
      key: 'sessions',
      label: '盘数',
      hint: '一盘打到有人筹码清零为止',
      type: 'select',
      choices: [
        { value: 1, label: '1 盘' },
        { value: 3, label: '3 盘' },
        { value: 5, label: '5 盘' },
      ],
    },
    { key: 'chi', label: '可以吃', hint: '吃上家打出的牌', type: 'toggle' },
    {
      key: 'joker',
      label: '翻财神',
      hint: '翻出的 3 张为万能财神，白板变成翻出的那张普通牌',
      type: 'toggle',
    },
  ],

  setup({ options, seed }) {
    const rng = new Rng(seed);
    const state: SzState = {
      options: { ...options },
      rng: 0,
      session: 1,
      round: 0,
      phase: 'play',
      dealer: rng.int(N),
      dealerStreak: 0,
      chips: [START_CHIPS, START_CHIPS, START_CHIPS, START_CHIPS],
      wall: [],
      reserve: [],
      flip: null,
      jokerKind: null,
      players: [],
      turn: 0,
      drawn: null,
      canSelfHu: true,
      afterKong: false,
      dihuChance: false,
      window: null,
      lastDiscard: null,
      discards: 0,
      claims: 0,
      fly: null,
      flyBonus: [false, false, false, false],
      roundLedger: [],
      pending: [],
      wins: [],
      result: null,
      sessionResult: null,
      ready: [false, false, false, false],
      history: [],
      events: [],
      eventSeq: 0,
    };
    state.rng = rng.state;
    deal(state);
    return state;
  },

  activeSeats,

  validate(state, seat, action) {
    const L = legalActions(state, seat);
    if (!L) return '现在不是你的操作时机';
    const p = state.players[seat];
    switch (action.type) {
      case 'ready':
        return L.ready ? null : '本局尚未结束';
      case 'discard':
        return L.discard.includes(action.tile) ? null : '不能打这张牌';
      case 'hu':
        return L.hu ? null : '还不能胡';
      case 'peng':
        return L.peng ? null : '不能碰';
      case 'chi': {
        if (!L.chi.length) return '不能吃';
        if (!Array.isArray(action.tiles) || action.tiles.length !== 2) return '请选择两张牌';
        const key = [...action.tiles].sort((a, b) => a - b).join(',');
        return L.chi.some((pair) => [...pair].sort((a, b) => a - b).join(',') === key)
          ? null
          : '不能这样吃';
      }
      case 'gang': {
        if (state.window) return L.gang.length ? null : '不能杠';
        const t = p.hand.find((x) => x.id === action.tile);
        if (!t || isJoker(t)) return '请选择要杠的牌';
        return L.gang.some((g) => g.tile === t.id) ? null : '不能杠';
      }
      case 'pass':
        return L.pass ? null : '现在不能过';
      default:
        return '未知操作';
    }
  },

  apply(prev, seat, raw) {
    const action = cleanAction(raw);
    const state = clone(prev);
    const p = state.players[seat];
    switch (action.type) {
      case 'ready': {
        state.ready[seat] = true;
        if (state.ready.every(Boolean)) {
          if (state.result?.sessionEnded) {
            state.session++;
            state.round = 0;
            state.chips = [START_CHIPS, START_CHIPS, START_CHIPS, START_CHIPS];
            state.dealerStreak = 0;
            state.pending = [];
            state.ready = [false, false, false, false];
          }
          deal(state);
        }
        return state;
      }
      case 'discard': {
        const tile = p.hand.find((t) => t.id === action.tile)!;
        p.hand = p.hand.filter((t) => t.id !== tile.id);
        p.river.push({ tile });
        state.lastDiscard = { seat, id: tile.id };
        state.discards++;
        state.drawn = null;
        state.canSelfHu = false;
        state.afterKong = false;
        state.dihuChance = false;
        state.flyBonus[seat] = false;
        if (isJoker(tile)) {
          state.fly = { seat, left: 3 };
          state.flyBonus[seat] = true;
          pushEvent(state, { type: 'fly', seat });
          advance(state, seat);
        } else {
          openClaims(state, seat, tile);
        }
        return state;
      }
      case 'hu': {
        if (state.window) {
          state.window.decisions[seat] = action;
          if (windowDone(state.window)) resolveWindow(state);
          return state;
        }
        const explosive = explosiveOf(state, p);
        const score = scoreFor(state, p, null, true, {
          afterKong: state.afterKong,
          tianhu: isTianhu(state, seat, p),
          dihu: state.dihuChance,
          flyBonus: state.flyBonus[seat],
          explosive,
        })!;
        const tile = p.hand.find((t) => t.id === state.drawn) ?? p.hand[p.hand.length - 1];
        state.wins.push({ seat, selfDrawn: true, robbing: false, tile, from: null, score });
        const mult = score.multiplier;
        for (const s of others(seat)) {
          pay(state, s, seat, baseBetween(state, s, seat) * mult, 'pay.zimo');
        }
        pushEvent(state, { type: 'zimo', seat });
        endRound(state, 'win');
        return state;
      }
      case 'gang': {
        if (state.window) {
          state.window.decisions[seat] = action;
          if (windowDone(state.window)) resolveWindow(state);
          return state;
        }
        const target = p.hand.find((t) => t.id === action.tile)!;
        if (isJoker(target)) return state;
        const kind = hzKindOf(target);
        const pung = p.melds.find((m) => m.type === 'pung' && m.kind === kind);
        if (pung) {
          p.hand = p.hand.filter((t) => t.id !== target.id);
          state.drawn = null;
          state.canSelfHu = false;
          if (state.fly) {
            completeBa(state, seat, target);
            return state;
          }
          const w = newWindow('rob');
          w.source = seat;
          w.tile = target;
          // 截胡：只问离补杠者最近、且能胡的一家
          let robSeat: Seat | null = null;
          for (const s of others(seat)) {
            if (canRon(state, state.players[s], target)) {
              robSeat = s;
              break;
            }
          }
          if (robSeat !== null) {
            for (const s of others(seat)) {
              w.required[s] = true;
              w.options[s] = s === robSeat ? ['hu', 'pass'] : ['pass'];
              if (s !== robSeat) w.decisions[s] = { type: 'pass' };
            }
            state.window = w;
          } else {
            completeBa(state, seat, target);
          }
          return state;
        }
        const four = p.hand.filter((t) => hzKindOf(t) === kind && !isJoker(t));
        p.hand = p.hand.filter((t) => !(hzKindOf(t) === kind && !isJoker(t)));
        p.melds.push({ type: 'kong', kongType: 'an', kind, tiles: four, from: null });
        state.drawn = null;
        state.canSelfHu = false;
        state.claims++;
        pushEvent(state, { type: 'gang', seat, kongType: 'an' });
        draw(state, seat, true);
        return state;
      }
      case 'peng':
      case 'pass':
      case 'chi': {
        state.window!.decisions[seat] = action;
        if (windowDone(state.window!)) resolveWindow(state);
        return state;
      }
    }
    return state;
  },

  view(state, seat) {
    const w = state.window;
    const me = seat !== null ? state.players[seat] : null;
    const over = state.phase !== 'play';
    const meldView = (m: SzMeld, owner: Seat): SzMeldView => {
      const hidden = m.kongType === 'an' && owner !== seat && !over;
      return {
        type: m.type,
        kongType: m.kongType,
        kind: m.kind,
        tiles: hidden ? null : m.tiles,
        from: m.from,
      };
    };
    return {
      seat,
      phase: state.phase,
      session: state.session,
      round: state.round,
      options: state.options,
      // 局结束后仍显示「本局庄」，下一局庄在 result.nextDealer 里
      dealer: state.phase === 'play' || !state.result ? state.dealer : state.result.dealer,
      dealerStreak: state.dealerStreak,
      dealerBase:
        state.phase === 'play' || !state.result ? dealerBaseOf(state) : state.result.dealerBase,
      chips: state.chips,
      wallCount: state.wall.length,
      turn: state.phase === 'play' ? state.turn : null,
      flip: state.flip,
      jokerKind: state.jokerKind,
      fly: state.fly,
      flyBonus: seat !== null ? state.flyBonus[seat] : false,
      players: state.players.map((p, s) => ({
        handCount: p.hand.length,
        melds: p.melds.map((m) => meldView(m, s)),
        river: p.river,
        won: state.wins.some((x) => x.seat === s),
        hand: over ? sortTiles(p.hand, state.jokerKind) : null,
      })),
      hand: me ? sortTiles(me.hand, state.jokerKind) : [],
      drawn: seat !== null && state.turn === seat && !w ? state.drawn : null,
      legal: seat !== null ? legalActions(state, seat) : null,
      window:
        w && seat !== null && w.required[seat]
          ? { kind: w.kind, source: w.source, tile: w.tile }
          : null,
      lastDiscard: state.lastDiscard,
      visible: visibleCounts(state, seat),
      events: state.events,
      result: state.result,
      sessionResult: state.sessionResult,
      ready: state.ready,
      history: state.history,
      wins: state.wins,
    };
  },

  isOver: (state) => state.phase === 'matchOver',

  bot: suichangBot,
  aiPrompt: szAiPrompt,
};

function visibleCounts(state: SzState, viewer: Seat | null): number[] {
  const c = new Array<number>(34).fill(0);
  const add = (t: Tile) => c[hzKindOf(t)]++;
  state.players.forEach((p, s) => {
    const hideAnKong = state.phase === 'play' && s !== viewer;
    for (const m of p.melds) {
      if (hideAnKong && m.kongType === 'an') continue;
      for (const t of m.tiles) add(t);
    }
    for (const r of p.river) add(r.tile);
    if (s === viewer || state.phase !== 'play') for (const t of p.hand) add(t);
  });
  return c;
}
