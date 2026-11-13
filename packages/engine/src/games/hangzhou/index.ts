import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import { assignJokers, shantenWithJokers, waitingKinds } from './analysis';
import { hzAiPrompt } from './ai';
import { hangzhouBot } from './bot';
import type { MeldShape, WinScore } from './scoring';
import { evaluateWin } from './scoring';
import type { HzTile } from './tiles';
import {
  JOKER_KIND,
  KINDS,
  countKinds,
  createTiles,
  hzKindOf,
  hzTileOf,
  isHonor,
  sortTiles,
} from './tiles';

export * from './tiles';
export * from './analysis';
export * from './scoring';

/**
 * 杭州麻将（规则版本 hangzhou-cs-2）。
 *
 * 136 张、四人；白板固定为财神，共 4 张，可当任意牌用来胡牌，
 * 但不能碰、杠、吃，也不能被别人碰杠吃胡。可以吃上家的牌。一炮多响。
 * 胡牌：4 面子 + 1 将，或七对；台数取最高、不叠加，另加自摸 / 杠上开花 / 抢杠 / 海底 / 天地胡。
 */

export const RULESET = 'hangzhou-cs-2';

export interface HzOptions {
  baseScore: number;
  /** 盘数，0 为不限 */
  rounds: number;
  /** 可以吃牌 */
  chi: boolean;
  /** 白板财神（关掉就是不带财神的普通杭州麻将） */
  joker: boolean;
}

export type HzAction =
  | { type: 'discard'; tile: number }
  | { type: 'hu' }
  | { type: 'gang'; tile?: number }
  | { type: 'peng' }
  | { type: 'chi'; tiles: number[] }
  | { type: 'pass' }
  | { type: 'ready' };

export type KongType = 'an' | 'zhi' | 'ba';

export interface HzMeld {
  type: 'chi' | 'pung' | 'kong';
  kongType?: KongType;
  /** 顺子为最小的一张；碰杠为牌种 */
  kind: number;
  tiles: HzTile[];
  from: Seat | null;
}

export interface RiverTile {
  tile: HzTile;
  claimedBy?: Seat[];
}

export interface HzWin {
  seat: Seat;
  selfDrawn: boolean;
  tile: HzTile;
  from: Seat | null;
  score: WinScore;
}

export type Clause = 'pay.zimo' | 'pay.dianpao';

export const CLAUSE_NAME: Record<Clause, string> = {
  'pay.zimo': '自摸',
  'pay.dianpao': '点炮',
};

export interface LedgerEntry {
  from: Seat;
  to: Seat;
  amount: number;
  clause: Clause;
}

export interface HzPlayer {
  hand: HzTile[];
  melds: HzMeld[];
  river: RiverTile[];
  hasDrawn: boolean;
}

export type WindowOpt = 'hu' | 'gang' | 'peng' | 'chi' | 'pass';

export interface HzWindow {
  kind: 'claims' | 'rob';
  required: boolean[];
  decisions: (HzAction | null)[];
  options: (WindowOpt[] | null)[];
  source: Seat | null;
  tile: HzTile | null;
  /** 补杠（抢杠）窗口 */
  timely: boolean;
}

export interface HzEvent {
  seq: number;
  type: 'chi' | 'peng' | 'gang' | 'hu' | 'zimo' | 'rob';
  seat: Seat;
  from?: Seat | null;
  kongType?: KongType;
}

export interface HzMeldView {
  type: HzMeld['type'];
  kongType?: KongType;
  kind: number;
  /** 别人的暗杠看不到牌面（null） */
  tiles: HzTile[] | null;
  from: Seat | null;
}

export interface HzPlayerView {
  handCount: number;
  melds: HzMeldView[];
  river: RiverTile[];
  won: boolean;
  /** 已经打完这一盘时亮牌 */
  hand: HzTile[] | null;
}

export interface HzRoundResult {
  round: number;
  reason: 'win' | 'wall';
  wins: HzWin[];
  ledger: LedgerEntry[];
  deltas: number[];
  hands: HzTile[][];
  melds: HzMeld[][];
  nextDealer: Seat;
  dealerKeeps: boolean;
  jokerKind: number | null;
}

export type HzPhase = 'play' | 'roundOver' | 'matchOver';

export interface HzState {
  options: HzOptions;
  rng: number;
  round: number;
  phase: HzPhase;
  dealer: Seat;
  wall: HzTile[];
  jokerKind: number | null;
  players: HzPlayer[];
  turn: Seat;
  /** 刚摸到的牌 */
  drawn: number | null;
  canSelfHu: boolean;
  /** 杠后补的牌：可用于杠上开花 */
  afterKong: boolean;
  window: HzWindow | null;
  lastDiscard: { seat: Seat; id: number } | null;
  discards: number;
  /** 碰、吃、杠的次数（天胡 / 地胡判断） */
  claims: number;
  ledger: LedgerEntry[];
  wins: HzWin[];
  scores: number[];
  ready: boolean[];
  result: HzRoundResult | null;
  history: { round: number; deltas: number[]; wins: { seat: Seat; fan: number }[] }[];
  events: HzEvent[];
  eventSeq: number;
}

export interface HzLegal {
  discard: number[];
  hu: boolean;
  gang: { tile: number; type: KongType }[];
  peng: boolean;
  chi: number[][];
  pass: boolean;
  ready: boolean;
}

export interface HzView {
  seat: Seat | null;
  phase: HzPhase;
  round: number;
  options: HzOptions;
  dealer: Seat;
  wallCount: number;
  turn: Seat | null;
  jokerKind: number | null;
  players: HzPlayerView[];
  hand: HzTile[];
  drawn: number | null;
  legal: HzLegal | null;
  window: { kind: HzWindow['kind']; source: Seat | null; tile: HzTile | null } | null;
  lastDiscard: { seat: Seat; id: number } | null;
  scores: number[];
  roundDeltas: number[];
  visible: number[];
  events: HzEvent[];
  result: HzRoundResult | null;
  ready: boolean[];
  history: HzState['history'];
  wins: HzWin[];
}

const N = 4;
const others = (s: Seat) => [1, 2, 3].map((d) => (s + d) % N);
const nextSeat = (s: Seat) => (s + 1) % N;

const meldShapes = (p: HzPlayer): MeldShape[] =>
  p.melds.map((m) => ({ type: m.type, kind: m.kind }));

type EventInput = HzEvent extends infer E ? (E extends unknown ? Omit<E, 'seq'> : never) : never;

function pushEvent(state: HzState, e: EventInput) {
  state.events.push({ ...e, seq: ++state.eventSeq } as HzEvent);
  if (state.events.length > 16) state.events.shift();
}

function addLedger(state: HzState, from: Seat, to: Seat, amount: number, clause: Clause) {
  state.ledger.push({ from, to, amount, clause });
}

function deltasOf(ledger: readonly LedgerEntry[]): number[] {
  const d = [0, 0, 0, 0];
  for (const e of ledger) {
    d[e.from] -= e.amount;
    d[e.to] += e.amount;
  }
  return d;
}

function newWindow(kind: HzWindow['kind']): HzWindow {
  return {
    kind,
    required: [false, false, false, false],
    decisions: [null, null, null, null],
    options: [null, null, null, null],
    source: null,
    tile: null,
    timely: false,
  };
}

function windowDone(w: HzWindow): boolean {
  return w.required.every((r, s) => !r || w.decisions[s] !== null);
}

function waitingIn(w: HzWindow, seat: Seat): boolean {
  return w.required[seat] && w.decisions[seat] === null;
}

function activeSeats(state: HzState): Seat[] {
  if (state.phase === 'roundOver') return [0, 1, 2, 3].filter((s) => !state.ready[s]);
  if (state.phase === 'matchOver') return [];
  if (state.window) return [0, 1, 2, 3].filter((s) => waitingIn(state.window!, s));
  return [state.turn];
}

const isJokerKind = (state: HzState, kind: number) =>
  state.jokerKind !== null && kind === state.jokerKind;

/** 某座位的手牌（可加上和进的牌）是否和牌 */
function winScore(
  state: HzState,
  p: HzPlayer,
  tile: HzTile | null,
  selfDrawn: boolean,
  opts: { afterKong?: boolean; robbing?: boolean; tianhu?: boolean; dihu?: boolean } = {},
): WinScore | null {
  const concealed = tile ? [...p.hand, tile] : p.hand;
  return evaluateWin(
    concealed,
    meldShapes(p),
    state.jokerKind,
    {
      selfDrawn,
      afterKong: !!opts.afterKong,
      robbing: !!opts.robbing,
      haidi: selfDrawn && state.wall.length === 0,
      tianhu: !!opts.tianhu,
      dihu: !!opts.dihu,
    },
    state.options.baseScore,
  );
}

/** 天胡：庄家起手 14 张就和牌 */
function isTianhu(state: HzState, seat: Seat, p: HzPlayer): boolean {
  return seat === state.dealer && state.discards === 0 && state.claims === 0 && !p.hasDrawn;
}

/** 地胡：第一巡（庄家只打过一张、还没人碰杠）就胡 */
function isDihu(state: HzState, seat: Seat, selfDrawn: boolean): boolean {
  if (state.discards !== 1 || state.claims !== 0) return false;
  return selfDrawn ? seat !== state.dealer : true;
}

/** 手上能和这张牌组成顺子的两张牌（不能吃字牌、不能吃财神） */
function chiPairs(hand: readonly HzTile[], tile: HzTile): number[][] {
  const kind = hzKindOf(tile);
  if (isHonor(kind)) return [];
  const out: number[][] = [];
  const pick = (rank: number) => hand.filter((t) => t.suit === tile.suit && t.rank === rank);
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

function deal(state: HzState): void {
  const rng = new Rng(state.rng);
  const wall = rng.shuffle(createTiles());
  state.rng = rng.state;
  state.players = [0, 1, 2, 3].map(() => ({ hand: [], melds: [], river: [], hasDrawn: false }));
  for (let i = 0; i < 13; i++)
    for (let s = 0; s < N; s++) state.players[(state.dealer + s) % N].hand.push(wall.shift()!);
  state.players[state.dealer].hand.push(wall.shift()!);
  // 主流杭州麻将固定四张白板为财神
  state.jokerKind = state.options.joker ? JOKER_KIND : null;
  state.wall = wall;
  state.turn = state.dealer;
  state.drawn = null;
  state.canSelfHu = true;
  state.afterKong = false;
  state.window = null;
  state.lastDiscard = null;
  state.discards = 0;
  state.claims = 0;
  state.ledger = [];
  state.wins = [];
  state.ready = [false, false, false, false];
  state.result = null;
  state.events = [];
  state.phase = 'play';
}

function draw(state: HzState, seat: Seat, replacement: boolean): void {
  if (state.wall.length === 0) {
    endRound(state, 'wall');
    return;
  }
  const p = state.players[seat];
  const tile = state.wall.shift()!;
  p.hand.push(tile);
  p.hasDrawn = true;
  state.turn = seat;
  state.drawn = tile.id;
  state.canSelfHu = true;
  state.afterKong = replacement;
  state.window = null;
}

function advance(state: HzState, from: Seat): void {
  draw(state, nextSeat(from), false);
}

function endRound(state: HzState, reason: 'win' | 'wall'): void {
  state.window = null;
  const deltas = deltasOf(state.ledger);
  for (let s = 0; s < N; s++) state.scores[s] += deltas[s];
  const dealerWon = state.wins.some((w) => w.seat === state.dealer);
  const dealerKeeps = reason === 'wall' || dealerWon;
  const nextDealer = dealerKeeps ? state.dealer : nextSeat(state.dealer);
  const wins = [...state.wins].sort((a, b) => a.seat - b.seat);
  state.result = {
    round: state.round,
    reason,
    wins,
    ledger: [...state.ledger],
    deltas,
    hands: state.players.map((p) => sortTiles(p.hand, state.jokerKind)),
    melds: state.players.map((p) => p.melds),
    nextDealer,
    dealerKeeps,
    jokerKind: state.jokerKind,
  };
  state.history.push({
    round: state.round,
    deltas,
    wins: wins.map((w) => ({ seat: w.seat, fan: w.score.fanRaw })),
  });
  state.ready = [false, false, false, false];
  const roundsDone = state.options.rounds > 0 && state.round >= state.options.rounds;
  state.phase = roundsDone ? 'matchOver' : 'roundOver';
}

function ronWins(
  state: HzState,
  winners: Seat[],
  supplier: Seat,
  tile: HzTile,
  robbing: boolean,
): void {
  for (const s of winners) {
    const p = state.players[s];
    const score = winScore(state, p, tile, false, {
      robbing,
      dihu: !robbing && isDihu(state, s, false),
    });
    if (!score) continue;
    state.wins.push({ seat: s, selfDrawn: false, tile, from: supplier, score });
    addLedger(state, supplier, s, score.points, 'pay.dianpao');
    pushEvent(state, { type: robbing ? 'rob' : 'hu', seat: s, from: supplier });
  }
  if (state.wins.length) endRound(state, 'win');
}

function completeBa(state: HzState, seat: Seat, tile: HzTile): void {
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

function openClaims(state: HzState, discarder: Seat, tile: HzTile): void {
  const kind = hzKindOf(tile);
  // 财神打出后无人可要（不能碰、杠、吃、胡）
  if (isJokerKind(state, kind)) {
    advance(state, discarder);
    return;
  }
  const w = newWindow('claims');
  w.source = discarder;
  w.tile = tile;
  let any = false;
  for (const s of others(discarder)) {
    const p = state.players[s];
    w.required[s] = true;
    const opts: WindowOpt[] = [];
    if (winScore(state, p, tile, false, {})) opts.push('hu');
    const natural = p.hand.filter((t) => hzKindOf(t) === kind).length;
    if (natural >= 3 && state.wall.length > 0) opts.push('gang');
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

function resolveWindow(state: HzState): void {
  const w = state.window!;
  const source = w.source!;
  const tile = w.tile!;
  const order = others(source);
  const dec = (s: Seat) => w.decisions[s];
  const huSeats = order.filter((s) => dec(s)?.type === 'hu');
  state.window = null;

  if (w.kind === 'rob') {
    if (huSeats.length) {
      ronWins(state, huSeats, source, tile, true);
      if (state.phase !== 'play') return;
    }
    completeBa(state, source, tile);
    return;
  }

  const discarder = state.players[source];
  if (huSeats.length) {
    discarder.river[discarder.river.length - 1].claimedBy = huSeats;
    ronWins(state, huSeats, source, tile, false);
    if (state.phase === 'play') advance(state, source);
    return;
  }
  const kind = hzKindOf(tile);
  const gangSeat = order.find((s) => dec(s)?.type === 'gang');
  if (gangSeat !== undefined) {
    const p = state.players[gangSeat];
    const own = p.hand.filter((t) => hzKindOf(t) === kind).slice(0, 3);
    const ids = new Set(own.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    p.melds.push({ type: 'kong', kongType: 'zhi', kind, tiles: [...own, tile], from: source });
    discarder.river.pop();
    state.lastDiscard = null;
    state.claims++;
    pushEvent(state, { type: 'gang', seat: gangSeat, from: source, kongType: 'zhi' });
    draw(state, gangSeat, true);
    return;
  }
  const pengSeat = order.find((s) => dec(s)?.type === 'peng');
  if (pengSeat !== undefined) {
    const p = state.players[pengSeat];
    const own = p.hand.filter((t) => hzKindOf(t) === kind).slice(0, 2);
    const ids = new Set(own.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    p.melds.push({ type: 'pung', kind, tiles: [...own, tile], from: source });
    discarder.river.pop();
    state.lastDiscard = null;
    state.claims++;
    pushEvent(state, { type: 'peng', seat: pengSeat, from: source });
    state.turn = pengSeat;
    state.drawn = null;
    state.canSelfHu = false;
    state.afterKong = false;
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
    p.melds.push({
      type: 'chi',
      kind: Math.min(...tiles.map(hzKindOf)),
      tiles,
      from: source,
    });
    discarder.river.pop();
    state.lastDiscard = null;
    state.claims++;
    pushEvent(state, { type: 'chi', seat: chiSeat, from: source });
    state.turn = chiSeat;
    state.drawn = null;
    state.canSelfHu = false;
    state.afterKong = false;
    return;
  }
  advance(state, source);
}

// ---------------------------------------------------------------------------
// 合法动作

export function legalActions(state: HzState, seat: Seat): HzLegal | null {
  const L: HzLegal = {
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
    const score = winScore(state, p, null, true, {
      afterKong: state.afterKong,
      tianhu: isTianhu(state, seat, p),
    });
    L.hu = !!score;
  }
  if (state.wall.length > 0) {
    const counts = countKinds(p.hand);
    for (let k = 0; k < KINDS; k++) {
      if (counts[k] !== 4) continue;
      if (isJokerKind(state, k)) continue;
      L.gang.push({ tile: p.hand.find((t) => hzKindOf(t) === k)!.id, type: 'an' });
    }
    for (const m of p.melds) {
      if (m.type !== 'pung' || isJokerKind(state, m.kind)) continue;
      const t = p.hand.find((x) => hzKindOf(x) === m.kind);
      if (t) L.gang.push({ tile: t.id, type: 'ba' });
    }
  }
  return L;
}

// ---------------------------------------------------------------------------

function cleanAction(a: HzAction): HzAction {
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

/** 听牌提示：打出手里的某一张后能听哪些牌（界面用） */
export function waitsAfter(state: HzState, seat: Seat, tileId: number): number[] {
  const p = state.players[seat];
  const rest = p.hand.filter((t) => t.id !== tileId);
  const counts = countKinds(rest);
  return waitingKinds(counts, state.jokerKind, p.melds.length);
}

/** 当前手牌（3n+1 张时）听的牌 */
export function currentWaits(state: HzState, seat: Seat): number[] {
  const p = state.players[seat];
  if (p.hand.length % 3 !== 1) return [];
  return waitingKinds(countKinds(p.hand), state.jokerKind, p.melds.length);
}

/** 剩余的张数提示：某种牌还没出现几张 */
export function remainingOf(state: HzState, seat: Seat | null, kind: number): number {
  return Math.max(0, 4 - visibleCounts(state, seat)[kind]);
}

export const hangzhou: GameDefinition<HzState, HzAction, HzView, HzOptions> = {
  meta: {
    id: 'hangzhou',
    category: 'mahjong',
    name: '杭州麻将',
    nameEn: 'Hangzhou Mahjong',
    tagline: '白板当财神、可以吃：台数越大赢得越多',
    minPlayers: 4,
    maxPlayers: 4,
    defaultPlayers: 4,
    botDelayMs: [450, 950],
    rules: [
      '杭州麻将（规则版本 hangzhou-cs-2）：136 张牌（万、条、筒、东南西北、中发白），四人，可以吃上家的牌。',
      '财神：四张白板固定为财神，可以当任意牌用来胡牌（补面子、补将、补七对都行），但不能碰、杠、吃；打出的白板作废，谁也拿不去。',
      '胡牌：4 个面子 + 1 将，或七对；胡 > 杠 > 碰 > 吃，一张牌可以多人同时胡（一炮多响）。吃只限上家打出的牌。',
      '台数取最高、不叠加：平胡 1 台、碰碰胡 2 台、七对 / 清一色 4 台、清碰 / 豪华七对 6 台、清七对 8 台、清豪华七对 10 台。',
      '另有过程台：自摸 +1、杠上开花 +1、抢杠胡 +1、海底捞月 +1、天胡 / 地胡 +8。分 = 底分 × 2^(台 − 1)，10 台封顶。',
      '自摸三家各付一份；点炮只由点炮者付。庄家胡牌或流局连庄，否则下家坐庄。',
    ],
  },
  defaultOptions: { baseScore: 1, rounds: 4, chi: true, joker: true },
  optionFields: [
    {
      key: 'baseScore',
      label: '底分',
      type: 'select',
      choices: [
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 5, label: '5' },
      ],
    },
    {
      key: 'rounds',
      label: '盘数',
      type: 'select',
      choices: [
        { value: 4, label: '4 盘' },
        { value: 8, label: '8 盘' },
        { value: 16, label: '16 盘' },
        { value: 0, label: '不限' },
      ],
    },
    { key: 'chi', label: '可以吃', hint: '吃上家打出的牌，凑成顺子', type: 'toggle' },
    { key: 'joker', label: '白板财神', hint: '四张白板当万能牌（可关）', type: 'toggle' },
  ],

  setup({ options, seed }) {
    const rng = new Rng(seed);
    const state: HzState = {
      options: { ...options },
      rng: 0,
      round: 1,
      phase: 'play',
      dealer: rng.int(N),
      wall: [],
      jokerKind: null,
      players: [],
      turn: 0,
      drawn: null,
      canSelfHu: true,
      afterKong: false,
      window: null,
      lastDiscard: null,
      discards: 0,
      claims: 0,
      ledger: [],
      wins: [],
      scores: [0, 0, 0, 0],
      ready: [false, false, false, false],
      result: null,
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
        return L.ready ? null : '本盘尚未结束';
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
        if (!t) return '请选择要杠的牌';
        const kind = hzKindOf(t);
        return L.gang.some((g) => hzKindOf(hzTileOf(g.tile)) === kind) ? null : '不能杠';
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
          state.dealer = state.result!.nextDealer;
          state.round++;
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
        openClaims(state, seat, tile);
        return state;
      }
      case 'hu': {
        if (state.window) {
          state.window.decisions[seat] = action;
          if (windowDone(state.window)) resolveWindow(state);
          return state;
        }
        const score = winScore(state, p, null, true, {
          afterKong: state.afterKong,
          tianhu: isTianhu(state, seat, p),
          dihu: isDihu(state, seat, true),
        })!;
        const tile =
          p.hand.find((t) => t.id === state.drawn) ?? p.hand[p.hand.length - 1];
        state.wins.push({ seat, selfDrawn: true, tile, from: null, score });
        for (const s of others(seat)) addLedger(state, s, seat, score.points, 'pay.zimo');
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
        const kind = hzKindOf(target);
        const pung = p.melds.find((m) => m.type === 'pung' && m.kind === kind);
        if (pung) {
          // 补杠：先开抢杠窗口
          p.hand = p.hand.filter((t) => t.id !== target.id);
          state.drawn = null;
          state.canSelfHu = false;
          const w = newWindow('rob');
          w.source = seat;
          w.tile = target;
          w.timely = true;
          let any = false;
          for (const s of others(seat)) {
            const o = state.players[s];
            w.required[s] = true;
            if (winScore(state, o, target, false, { robbing: true })) {
              w.options[s] = ['hu', 'pass'];
              any = true;
            } else {
              w.options[s] = ['pass'];
              w.decisions[s] = { type: 'pass' };
            }
          }
          if (any) state.window = w;
          else completeBa(state, seat, target);
          return state;
        }
        // 暗杠
        const four = p.hand.filter((t) => hzKindOf(t) === kind);
        p.hand = p.hand.filter((t) => hzKindOf(t) !== kind);
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
    const over = state.phase === 'roundOver' || state.phase === 'matchOver';
    const w = state.window;
    const me = seat !== null ? state.players[seat] : null;
    const meldView = (m: HzMeld, owner: number): HzMeldView => {
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
      round: state.round,
      options: state.options,
      dealer: state.dealer,
      wallCount: state.wall.length,
      turn: state.phase === 'play' ? state.turn : null,
      jokerKind: state.jokerKind,
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
      scores: state.scores,
      roundDeltas: deltasOf(state.ledger),
      visible: visibleCounts(state, seat),
      events: state.events,
      result: state.result,
      ready: state.ready,
      history: state.history,
      wins: state.wins,
    };
  },

  isOver: (state) => state.phase === 'matchOver',

  bot: hangzhouBot,
  aiPrompt: hzAiPrompt,
};

function visibleCounts(state: HzState, viewer: Seat | null): number[] {
  const c = new Array<number>(KINDS).fill(0);
  const seen = new Set<number>();
  state.players.forEach((p, s) => {
    const hideAnKong = state.phase === 'play' && s !== viewer;
    for (const m of p.melds) {
      if (hideAnKong && m.kongType === 'an') continue;
      for (const t of m.tiles) seen.add(t.id);
    }
    for (const r of p.river) seen.add(r.tile.id);
    if (s === viewer || state.phase !== 'play') for (const t of p.hand) seen.add(t.id);
  });
  for (const id of seen) c[hzKindOf(hzTileOf(id))]++;
  return c;
}

/** 测试用：把当前手牌当作虚拟牌（财神已安排到合适位置） */
export function virtualCounts(state: HzState, seat: Seat): number[] {
  const p = state.players[seat];
  return assignJokers(countKinds(p.hand), state.jokerKind, p.melds.length);
}

/** 测试用：向听数 */
export function shantenOf(state: HzState, seat: Seat): number {
  const p = state.players[seat];
  return shantenWithJokers(countKinds(p.hand), state.jokerKind, p.melds.length);
}

export { deltasOf };
