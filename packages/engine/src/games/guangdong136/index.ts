import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import { waitingKinds } from './analysis';
import { gd136AiPrompt } from './ai';
import { gd136Bot } from './bot';
import type { ZMeldShape, ZPreset, ZWinScore } from './scoring';
import { evaluateHand, presetOf, scoreWin, Z_FAN_NAME } from './scoring';
import {
  Z_KINDS,
  countKinds,
  createTiles,
  isHonorKind,
  sortTiles,
  tileOfId,
  type Tile,
} from './tiles';

export * from './scoring';
export * from './tiles';
export * from './analysis';

/**
 * 广东麻将 · 字牌版（136 张，规则版本 guangdong-zp-1）。
 *
 * 万、条、筒各 1–9 各 4 张，加东南西北与中发白各 4 张，共 136 张，无花牌。
 * 可吃（只能吃序数牌）、可碰、可杠、可胡；胡 > 杠 > 碰 > 吃，一张牌只归最近的一家（截胡）。
 * 番制两套，可在设置里切换：鸡平胡（1 番起胡）与老章（3 番起胡，不够番不能胡）。
 * 杠分独立结算（暗杠每家 2、直杠放杠者 2、补杠每家 1），与推倒胡一致。
 */

export const RULESET = 'guangdong-zp-1';

export interface GdOptions {
  /** 番制：鸡平胡（1 番起胡）/ 老章（3 番起胡） */
  scoring: ZPreset;
  baseScore: number;
  /** 盘数，0 为不限 */
  rounds: number;
  /** 每人初始筹码，0 为不启用；启用后有人输光（≤ 0）即结束整场 */
  chips: number;
  /** 是否允许吃牌 */
  allowChi: boolean;
}

export type GdAction =
  | { type: 'discard'; tile: number }
  | { type: 'chi'; tiles: number[] }
  | { type: 'peng' }
  | { type: 'gang'; tile?: number }
  | { type: 'hu' }
  | { type: 'pass' }
  | { type: 'ready' };

export type KongType = 'an' | 'zhi' | 'ba';

export interface GdMeld {
  type: 'chow' | 'pung' | 'kong';
  kongType?: KongType;
  /** 顺子记最小牌，碰杠记该牌 */
  kind: number;
  tiles: Tile[];
  from: Seat | null;
}

export interface GdRiverTile {
  tile: Tile;
  claimedBy?: Seat[];
}

export interface GdWin {
  seat: Seat;
  selfDrawn: boolean;
  tile: Tile;
  from: Seat | null;
  score: ZWinScore;
}

export type GdClause = 'pay.zimo' | 'pay.dianpao' | 'kong.an' | 'kong.zhi' | 'kong.ba';

export const GD_CLAUSE_NAME: Record<GdClause, string> = {
  'pay.zimo': '自摸',
  'pay.dianpao': '点炮',
  'kong.an': '暗杠',
  'kong.zhi': '直杠',
  'kong.ba': '补杠',
};

export interface GdLedgerEntry {
  from: Seat;
  to: Seat;
  amount: number;
  clause: GdClause;
}

export interface GdKongReceipt {
  seat: Seat;
  entries: number[];
  gross: number;
  transferred: number;
}

export interface GdPlayer {
  hand: Tile[];
  melds: GdMeld[];
  river: GdRiverTile[];
  won: GdWin | null;
  afterKong: boolean;
  lastReceipt: number | null;
  draws: number;
}

export type GdOpt = 'hu' | 'gang' | 'peng' | 'chi' | 'pass';

export interface GdWindow {
  kind: 'claims' | 'rob';
  required: boolean[];
  decisions: (GdAction | null)[];
  options: (GdOpt[] | null)[];
  chi: (number[][] | null)[];
  source: Seat | null;
  tile: Tile | null;
  afterKong: boolean;
}

export type GdEvent = {
  seq: number;
  type: 'chi' | 'peng' | 'gang' | 'zimo' | 'hu' | 'rob';
  seat: Seat;
  from?: Seat | null;
  kongType?: KongType;
};

export interface GdRoundResult {
  round: number;
  reason: 'hu' | 'wall';
  wins: GdWin[];
  ledger: GdLedgerEntry[];
  deltas: number[];
  hands: Tile[][];
  nextDealer: Seat;
}

export type GdPhase = 'play' | 'roundOver' | 'matchOver';

export interface GdState {
  options: GdOptions;
  rng: number;
  round: number;
  phase: GdPhase;
  dealer: Seat;
  wall: Tile[];
  players: GdPlayer[];
  turn: Seat;
  drawnThisTurn: number | null;
  canSelfHu: boolean;
  window: GdWindow | null;
  lastDiscard: { seat: Seat; id: number } | null;
  discards: number;
  claimsOrKongs: number;
  receipts: GdKongReceipt[];
  ledger: GdLedgerEntry[];
  scores: number[];
  ready: boolean[];
  result: GdRoundResult | null;
  history: { round: number; deltas: number[]; wins: { seat: Seat; fan: number }[] }[];
  events: GdEvent[];
  eventSeq: number;
}

/** 牌型成立但不满足起胡番数时的提示（老章三番起胡常见） */
export interface GdNearWin {
  fan: number;
  need: number;
  patterns: string[];
}

export interface GdLegal {
  discard: number[];
  hu: boolean;
  gang: { tile: number; type: KongType }[];
  peng: boolean;
  chi: number[][];
  pass: boolean;
  ready: boolean;
}

export interface GdPlayerView {
  handCount: number;
  melds: GdMeld[];
  river: GdRiverTile[];
  won: GdWin | null;
  hand: Tile[] | null;
}

export interface GdView {
  seat: Seat | null;
  phase: GdPhase;
  round: number;
  options: GdOptions;
  preset: ZPreset;
  minFan: number;
  cap: number;
  dealer: Seat;
  wallCount: number;
  turn: Seat | null;
  players: GdPlayerView[];
  hand: Tile[];
  drawn: number | null;
  legal: GdLegal | null;
  /** 手里已经成和牌形状、但番数不够起胡（老章）时给玩家看的提示 */
  nearWin: GdNearWin | null;
  window: { kind: GdWindow['kind']; source: Seat | null; tile: Tile | null } | null;
  lastDiscard: { seat: Seat; id: number } | null;
  scores: number[];
  roundDeltas: number[];
  visible: number[];
  events: GdEvent[];
  result: GdRoundResult | null;
  ready: boolean[];
  history: GdState['history'];
}

const N = 4;
const others = (s: Seat) => [1, 2, 3].map((d) => (s + d) % N);

const meldShapes = (p: GdPlayer): ZMeldShape[] =>
  p.melds.map((m) => ({ type: m.type, kind: m.kind }));
const countOfKind = (tiles: Tile[], kind: number) => tiles.filter((t) => t.kind === kind).length;

type EventInput = Omit<GdEvent, 'seq'>;

function pushEvent(state: GdState, e: EventInput) {
  state.events.push({ ...e, seq: ++state.eventSeq } as GdEvent);
  if (state.events.length > 16) state.events.shift();
}

function addLedger(state: GdState, from: Seat, to: Seat, amount: number, clause: GdClause): number {
  state.ledger.push({ from, to, amount, clause });
  return state.ledger.length - 1;
}

function nextSeat(seat: Seat): Seat {
  return (seat + 1) % N;
}

/** 和牌评估：暗手 + 和进的牌 */
function winValue(p: GdPlayer, extra: Tile | null, preset: ZPreset) {
  const tiles = extra ? [...p.hand, extra] : p.hand;
  return evaluateHand(countKinds(tiles), meldShapes(p), preset);
}

/** 这张成了和的牌，是否够番起胡（含过程番） */
function winningScore(p: GdPlayer, extra: Tile | null, preset: ZPreset, selfDrawn: boolean) {
  const value = winValue(p, extra, preset);
  if (!value) return null;
  const score = scoreWin(
    value,
    { selfDrawn, afterKong: false, robbing: false, haidi: false, tianhu: false, dihu: false },
    // 这里只关心番数是否达标，分数用 1 分底分算，不进入账本
    1,
    preset,
  );
  return score.qualifies ? score : null;
}

/** 用一张打出的牌能组成的吃牌组合（两张手牌的 id）；字牌不能吃 */
export function chowOptions(hand: Tile[], kind: number): number[][] {
  if (isHonorKind(kind)) return [];
  const suit = Math.floor(kind / 9);
  const rank = (kind % 9) + 1;
  const out: number[][] = [];
  for (let r = rank - 2; r <= rank; r++) {
    if (r < 1 || r > 7) continue;
    const kinds = [suit * 9 + r - 1, suit * 9 + r, suit * 9 + r + 1];
    if (!kinds.includes(kind)) continue;
    const need = kinds.filter((k) => k !== kind);
    const a = hand.find((t) => t.kind === need[0]);
    const b = hand.find((t) => t.kind === need[1]);
    if (!a || !b) continue;
    out.push([a.id, b.id]);
  }
  return out;
}

function deal(state: GdState): void {
  const rng = new Rng(state.rng);
  const wall = rng.shuffle(createTiles());
  state.rng = rng.state;
  state.players = [0, 1, 2, 3].map(() => ({
    hand: [],
    melds: [],
    river: [],
    won: null,
    afterKong: false,
    lastReceipt: null,
    draws: 0,
  }));
  for (let i = 0; i < 13; i++)
    for (let s = 0; s < N; s++) state.players[(state.dealer + s) % N].hand.push(wall.shift()!);
  state.players[state.dealer].hand.push(wall.shift()!);
  state.wall = wall;
  state.turn = state.dealer;
  state.drawnThisTurn = null;
  state.canSelfHu = true;
  state.window = null;
  state.lastDiscard = null;
  state.discards = 0;
  state.claimsOrKongs = 0;
  state.receipts = [];
  state.ledger = [];
  state.result = null;
  state.ready = [false, false, false, false];
  state.events = [];
  state.phase = 'play';
}

function newWindow(kind: GdWindow['kind'], seats: Seat[]): GdWindow {
  return {
    kind,
    required: [0, 1, 2, 3].map((s) => seats.includes(s)),
    decisions: [null, null, null, null],
    options: [null, null, null, null],
    chi: [null, null, null, null],
    source: null,
    tile: null,
    afterKong: false,
  };
}

function windowDone(w: GdWindow): boolean {
  return w.required.every((r, s) => !r || w.decisions[s] !== null);
}

function waitingIn(w: GdWindow, seat: Seat): boolean {
  return w.required[seat] && w.decisions[seat] === null;
}

function draw(state: GdState, seat: Seat, replacement: boolean): void {
  if (state.wall.length === 0) {
    endRound(state, 'wall');
    return;
  }
  const p = state.players[seat];
  const tile = state.wall.shift()!;
  p.hand.push(tile);
  p.draws++;
  if (!replacement) {
    p.afterKong = false;
    p.lastReceipt = null;
  }
  state.turn = seat;
  state.drawnThisTurn = tile.id;
  state.canSelfHu = true;
  state.window = null;
}

function closeDiscarderKong(state: GdState, seat: Seat) {
  state.players[seat].afterKong = false;
  state.players[seat].lastReceipt = null;
}

function openClaims(state: GdState, discarder: Seat, tile: Tile): void {
  const kind = tile.kind;
  const w = newWindow('claims', []);
  w.source = discarder;
  w.tile = tile;
  w.afterKong = state.players[discarder].afterKong;
  let anyChoice = false;
  for (const s of others(discarder)) {
    const p = state.players[s];
    if (p.won) continue;
    w.required[s] = true;
    const opts: GdOpt[] = [];
    if (winningScore(p, tile, state.options.scoring, false)) opts.push('hu');
    const n = countOfKind(p.hand, kind);
    if (n === 3 && state.wall.length > 0) opts.push('gang');
    if (n >= 2) opts.push('peng');
    const chis = state.options.allowChi ? chowOptions(p.hand, kind) : [];
    if (chis.length) {
      opts.push('chi');
      w.chi[s] = chis;
    }
    if (opts.length === 0) {
      w.decisions[s] = { type: 'pass' };
      w.options[s] = ['pass'];
    } else {
      w.options[s] = [...opts, 'pass'];
      anyChoice = true;
    }
  }
  if (!anyChoice) {
    closeDiscarderKong(state, discarder);
    draw(state, nextSeat(discarder), false);
    return;
  }
  state.window = w;
}

function payKong(state: GdState, seat: Seat, type: KongType, from: Seat | null): void {
  const entries: number[] = [];
  if (type === 'an') {
    for (const s of others(seat)) entries.push(addLedger(state, s, seat, 2, 'kong.an'));
  } else if (type === 'zhi') {
    entries.push(addLedger(state, from!, seat, 2, 'kong.zhi'));
  } else {
    for (const s of others(seat)) entries.push(addLedger(state, s, seat, 1, 'kong.ba'));
  }
  const p = state.players[seat];
  p.afterKong = true;
  if (entries.length) {
    const gross = entries.reduce((a, i) => a + state.ledger[i].amount, 0);
    state.receipts.push({ seat, entries, gross, transferred: 0 });
    p.lastReceipt = state.receipts.length - 1;
  } else {
    p.lastReceipt = null;
  }
  state.claimsOrKongs++;
  pushEvent(state, { type: 'gang', seat, from, kongType: type });
}

function completeBa(state: GdState, seat: Seat, tile: Tile): void {
  const p = state.players[seat];
  const meld = p.melds.find((m) => m.type === 'pung' && m.kind === tile.kind)!;
  meld.type = 'kong';
  meld.kongType = 'ba';
  meld.tiles = [...meld.tiles, tile];
  payKong(state, seat, 'ba', null);
  draw(state, seat, true);
}

function ronWin(state: GdState, winner: Seat, supplier: Seat, tile: Tile, robbing: boolean): void {
  const p = state.players[winner];
  const value = winValue(p, tile, state.options.scoring)!;
  const sp = state.players[supplier];
  const score = scoreWin(
    value,
    {
      selfDrawn: false,
      afterKong: sp.afterKong && !robbing,
      robbing,
      haidi: false,
      tianhu: false,
      dihu: false,
    },
    state.options.baseScore,
    state.options.scoring,
  );
  p.won = { seat: winner, selfDrawn: false, tile, from: supplier, score };
  addLedger(state, supplier, winner, score.points, 'pay.dianpao');
  pushEvent(state, { type: robbing ? 'rob' : 'hu', seat: winner, from: supplier });
  endRound(state, 'hu');
}

function resolveWindow(state: GdState): void {
  const w = state.window!;
  const dec = (s: Seat) => w.decisions[s];
  const order = others(w.source!);
  const huSeats = order.filter((s) => dec(s)?.type === 'hu');
  const source = w.source!;
  const tile = w.tile!;
  state.window = null;

  if (w.kind === 'rob') {
    if (huSeats.length) {
      state.players[source].river.push({ tile, claimedBy: [huSeats[0]] });
      ronWin(state, huSeats[0], source, tile, true);
      return;
    }
    completeBa(state, source, tile);
    return;
  }

  const discarder = state.players[source];
  const riverIdx = discarder.river.length - 1;
  if (huSeats.length) {
    discarder.river[riverIdx].claimedBy = [huSeats[0]];
    ronWin(state, huSeats[0], source, tile, false);
    return;
  }
  const gangSeat = order.find((s) => dec(s)?.type === 'gang');
  if (gangSeat !== undefined) {
    discarder.river.pop();
    state.lastDiscard = null;
    closeDiscarderKong(state, source);
    const p = state.players[gangSeat];
    const kind = tile.kind;
    const own = p.hand.filter((t) => t.kind === kind);
    p.hand = p.hand.filter((t) => t.kind !== kind);
    p.melds.push({ type: 'kong', kongType: 'zhi', kind, tiles: [...own, tile], from: source });
    payKong(state, gangSeat, 'zhi', source);
    draw(state, gangSeat, true);
    return;
  }
  const pengSeat = order.find((s) => dec(s)?.type === 'peng');
  if (pengSeat !== undefined) {
    discarder.river.pop();
    state.lastDiscard = null;
    closeDiscarderKong(state, source);
    const p = state.players[pengSeat];
    const kind = tile.kind;
    const own = p.hand.filter((t) => t.kind === kind).slice(0, 2);
    const ids = new Set(own.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    p.melds.push({ type: 'pung', kind, tiles: [...own, tile], from: source });
    state.claimsOrKongs++;
    pushEvent(state, { type: 'peng', seat: pengSeat, from: source });
    state.turn = pengSeat;
    state.drawnThisTurn = null;
    state.canSelfHu = false;
    return;
  }
  const chiSeat = order.find((s) => dec(s)?.type === 'chi');
  if (chiSeat !== undefined) {
    const a = dec(chiSeat) as { type: 'chi'; tiles: number[] };
    discarder.river.pop();
    state.lastDiscard = null;
    closeDiscarderKong(state, source);
    const p = state.players[chiSeat];
    const picked = p.hand.filter((t) => a.tiles.includes(t.id));
    const ids = new Set(picked.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    const base = Math.min(tile.kind, ...picked.map((t) => t.kind));
    p.melds.push({ type: 'chow', kind: base, tiles: [...picked, tile], from: source });
    state.claimsOrKongs++;
    pushEvent(state, { type: 'chi', seat: chiSeat, from: source });
    state.turn = chiSeat;
    state.drawnThisTurn = null;
    state.canSelfHu = false;
    return;
  }
  closeDiscarderKong(state, source);
  draw(state, nextSeat(source), false);
}

// ---------------------------------------------------------------------------
// 结算

function visibleIds(state: GdState, viewer: Seat | null): Set<number> {
  const ids = new Set<number>();
  state.players.forEach((p, s) => {
    for (const m of p.melds) for (const t of m.tiles) ids.add(t.id);
    for (const r of p.river) ids.add(r.tile.id);
    if (p.won || s === viewer) for (const t of p.hand) ids.add(t.id);
  });
  return ids;
}

function visibleCounts(state: GdState, viewer: Seat | null): number[] {
  const c = new Array<number>(Z_KINDS).fill(0);
  for (const id of visibleIds(state, viewer)) c[Math.floor(id / 4)]++;
  return c;
}

function deltasOf(ledger: readonly GdLedgerEntry[]): number[] {
  const d = [0, 0, 0, 0];
  for (const e of ledger) {
    d[e.from] -= e.amount;
    d[e.to] += e.amount;
  }
  return d;
}

function endRound(state: GdState, reason: 'hu' | 'wall'): void {
  state.window = null;
  const deltas = deltasOf(state.ledger);
  for (let s = 0; s < N; s++) state.scores[s] += deltas[s];
  const wins = state.players
    .filter((p) => p.won)
    .map((p) => p.won!)
    .sort((a, b) => a.seat - b.seat);
  const nextDealer = wins.length ? wins[0].seat : state.dealer;
  state.result = {
    round: state.round,
    reason,
    wins,
    ledger: [...state.ledger],
    deltas,
    hands: state.players.map((p) => sortTiles(p.hand)),
    nextDealer,
  };
  state.history.push({
    round: state.round,
    deltas,
    wins: wins.map((w) => ({ seat: w.seat, fan: w.score.fanRaw })),
  });
  state.ready = [false, false, false, false];
  const roundsDone = state.options.rounds > 0 && state.round >= state.options.rounds;
  const busted = (state.options.chips ?? 0) > 0 && state.scores.some((x) => x <= 0);
  state.phase = roundsDone || busted ? 'matchOver' : 'roundOver';
}

// ---------------------------------------------------------------------------
// 合法动作

export function legalActions(state: GdState, seat: Seat): GdLegal | null {
  const L: GdLegal = {
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
  if (p.won) return null;
  const w = state.window;
  if (w) {
    if (!waitingIn(w, seat)) return null;
    const opts = w.options[seat] ?? [];
    L.hu = opts.includes('hu');
    L.peng = opts.includes('peng');
    L.pass = opts.includes('pass');
    if (opts.includes('gang') && w.kind === 'claims') L.gang = [{ tile: w.tile!.id, type: 'zhi' }];
    if (opts.includes('chi')) L.chi = w.chi[seat] ?? [];
    return L;
  }
  if (state.turn !== seat) return null;
  L.hu = state.canSelfHu && !!winningScore(p, null, state.options.scoring, true);
  L.discard = p.hand.map((t) => t.id);
  if (state.wall.length > 0) {
    const counts = countKinds(p.hand);
    for (let k = 0; k < Z_KINDS; k++) {
      if (counts[k] === 4) L.gang.push({ tile: p.hand.find((t) => t.kind === k)!.id, type: 'an' });
    }
    for (const m of p.melds) {
      if (m.type !== 'pung') continue;
      const t = p.hand.find((x) => x.kind === m.kind);
      if (t) L.gang.push({ tile: t.id, type: 'ba' });
    }
  }
  return L;
}

/** 听牌：返回当前手牌在等哪些牌种（用于界面提示） */
export function waitingOf(state: GdState, seat: Seat): number[] {
  const p = state.players[seat];
  if (p.won) return [];
  return waitingKinds(countKinds(p.hand), p.melds.length);
}

/** 已成和牌形状但番数不够（老章）：给玩家一句解释 */
export function nearWinOf(state: GdState, seat: Seat): GdNearWin | null {
  const p = state.players[seat];
  if (p.won) return null;
  const value = winValue(p, null, state.options.scoring);
  if (!value || value.qualifies) return null;
  const rules = presetOf(state.options.scoring);
  return {
    fan: value.baseFan,
    need: rules.minFan,
    patterns: value.patterns.map((id) => Z_FAN_NAME[id]),
  };
}

// ---------------------------------------------------------------------------

function cleanAction(a: GdAction): GdAction {
  switch (a.type) {
    case 'chi':
      return { type: 'chi', tiles: (Array.isArray(a.tiles) ? a.tiles : []).map(Number) };
    case 'discard':
      return { type: 'discard', tile: Number(a.tile) };
    case 'gang':
      return typeof a.tile === 'number' ? { type: 'gang', tile: Number(a.tile) } : { type: 'gang' };
    default:
      return { type: a.type };
  }
}

const sameIds = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort((m, n) => m - n);
  const y = [...b].sort((m, n) => m - n);
  return x.every((v, i) => v === y[i]);
};

export const guangdong136: GameDefinition<GdState, GdAction, GdView, GdOptions> = {
  meta: {
    id: 'guangdong136',
    category: 'mahjong',
    name: '广东麻将 · 字牌',
    nameEn: 'Guangdong Mahjong (136 tiles)',
    tagline: '136 张带字牌，鸡平胡 / 老章两套番制',
    minPlayers: 4,
    maxPlayers: 4,
    defaultPlayers: 4,
    botDelayMs: [450, 950],
    rules: [
      '广东麻将 · 字牌版（规则版本 guangdong-zp-1）：万、条、筒各 1–9 各 4 张，加东南西北、中发白各 4 张，共 136 张，不含花牌。',
      '可碰、可杠、可胡；吃只能吃序数牌（字牌不能吃）。胡 > 杠 > 碰 > 吃，一张牌只归出牌顺序最近的一家（截胡）。',
      '胡牌：4 个面子（顺子、刻子、杠都算）+ 1 将，或七小对，或十三幺（十三幺为例牌，直接按最高番算）。',
      '番制可在设置里切换。鸡平胡：1 番起胡，封顶 8 番。老章：3 番起胡，不够番不能胡（鸡胡本身不算番）。',
      '番型（两套番表数值不同，以设置里的番制为准）：鸡胡、平胡、碰碰胡、七小对、豪华七对、混一色、清一色、字一色、大三元、小三元、大四喜、小四喜、混老头、清老头、十三幺、门前清、全求人；番数相加，超过封顶按封顶算。',
      '过程番另加：自摸 +1、杠上开花 +1、抢杠 +1、海底捞月 +1、天胡、地胡（数值随番制）。分数 = 底分 × 2^(番 − 1)。',
      '杠分独立结算、不封顶：暗杠每家付 2，直杠（杠别人打出的牌）由放杠者付 2，补杠每家付 1。',
      '一家胡牌本盘立即结束，胡家坐庄；牌墙摸完为荒庄（不查叫、不赔分），庄家连庄。',
      '本规则不含买马 / 奖码，也不含花牌。',
    ],
  },
  defaultOptions: { scoring: 'jipinghu', baseScore: 1, rounds: 8, chips: 0, allowChi: true },
  optionFields: [
    {
      key: 'scoring',
      label: '番制',
      hint: '鸡平胡 1 番起胡；老章 3 番起胡，不够番不能胡',
      type: 'select',
      choices: [
        { value: 'jipinghu', label: '鸡平胡' },
        { value: 'laozhang', label: '老章' },
      ],
    },
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
    {
      key: 'chips',
      label: '筹码',
      hint: '每人初始筹码，有人输光即结束',
      type: 'select',
      choices: [
        { value: 0, label: '不用' },
        { value: 100, label: '100' },
        { value: 200, label: '200' },
        { value: 500, label: '500' },
      ],
    },
    { key: 'allowChi', label: '允许吃牌', hint: '关掉后只能碰、杠、胡', type: 'toggle' },
  ],

  setup({ options, seed }) {
    const rng = new Rng(seed);
    const state: GdState = {
      options: { ...options },
      rng: 0,
      round: 1,
      phase: 'play',
      dealer: rng.int(N),
      wall: [],
      players: [],
      turn: 0,
      drawnThisTurn: null,
      canSelfHu: true,
      window: null,
      lastDiscard: null,
      discards: 0,
      claimsOrKongs: 0,
      receipts: [],
      ledger: [],
      scores: [0, 1, 2, 3].map(() => Math.max(0, options.chips ?? 0)),
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

  activeSeats(state) {
    if (state.phase === 'roundOver') return [0, 1, 2, 3].filter((s) => !state.ready[s]);
    if (state.phase === 'matchOver') return [];
    if (state.window) return [0, 1, 2, 3].filter((s) => waitingIn(state.window!, s));
    return [state.turn];
  },

  validate(state, seat, action) {
    const L = legalActions(state, seat);
    if (!L) return '现在不是你的操作时机';
    const p = state.players[seat];
    switch (action.type) {
      case 'ready':
        return L.ready ? null : '本盘尚未结束';
      case 'discard':
        return L.discard.includes(action.tile) ? null : '不能打这张牌';
      case 'chi': {
        if (!L.chi.length) return '不能吃';
        const ids = action.tiles;
        if (!Array.isArray(ids) || ids.length !== 2) return '吃牌需要两张手牌';
        const tiles = ids.map((id) => p.hand.find((t) => t.id === id));
        if (tiles.some((t) => !t)) return '请选择自己的手牌';
        return L.chi.some((c) => sameIds(c, ids)) ? null : '这两张牌吃不了';
      }
      case 'hu':
        return L.hu ? null : '还不能胡';
      case 'peng':
        return L.peng ? null : '不能碰';
      case 'gang': {
        if (state.window) return L.gang.length ? null : '不能杠';
        const t = action.tile !== undefined ? p.hand.find((x) => x.id === action.tile) : null;
        if (!t) return '请选择要杠的牌';
        return L.gang.some((g) => tileOfId(g.tile).kind === t.kind) ? null : '不能杠';
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
        state.drawnThisTurn = null;
        openClaims(state, seat, tile);
        return state;
      }
      case 'chi':
      case 'peng':
      case 'pass': {
        if (state.window) {
          state.window.decisions[seat] = action;
          if (windowDone(state.window)) resolveWindow(state);
          return state;
        }
        return state;
      }
      case 'hu': {
        if (state.window) {
          state.window.decisions[seat] = action;
          if (windowDone(state.window)) resolveWindow(state);
          return state;
        }
        const value = winValue(p, null, state.options.scoring)!;
        const tianhu = seat === state.dealer && state.discards === 0 && state.claimsOrKongs === 0;
        const dihu = seat !== state.dealer && p.draws === 1 && state.claimsOrKongs === 0 && !tianhu;
        const haidi = state.drawnThisTurn !== null && state.wall.length === 0;
        const score = scoreWin(
          value,
          { selfDrawn: true, afterKong: p.afterKong, robbing: false, haidi, tianhu, dihu },
          state.options.baseScore,
          state.options.scoring,
        );
        const tile = p.hand.find((t) => t.id === state.drawnThisTurn) ?? p.hand[p.hand.length - 1];
        p.won = { seat, selfDrawn: true, tile, from: null, score };
        for (const s of others(seat)) {
          if (!state.players[s].won) addLedger(state, s, seat, score.points, 'pay.zimo');
        }
        pushEvent(state, { type: 'zimo', seat });
        p.afterKong = false;
        p.lastReceipt = null;
        endRound(state, 'hu');
        return state;
      }
      case 'gang': {
        if (state.window) {
          state.window.decisions[seat] = action;
          if (windowDone(state.window)) resolveWindow(state);
          return state;
        }
        const target = p.hand.find((t) => t.id === action.tile)!;
        const kind = target.kind;
        const pung = p.melds.find((m) => m.type === 'pung' && m.kind === kind);
        if (pung) {
          p.hand = p.hand.filter((t) => t.id !== target.id);
          state.drawnThisTurn = null;
          const w = newWindow('rob', []);
          w.source = seat;
          w.tile = target;
          let any = false;
          for (const s of others(seat)) {
            const o = state.players[s];
            if (o.won) continue;
            w.required[s] = true;
            if (winningScore(o, target, state.options.scoring, false)) {
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
        const four = p.hand.filter((t) => t.kind === kind);
        p.hand = p.hand.filter((t) => t.kind !== kind);
        p.melds.push({ type: 'kong', kongType: 'an', kind, tiles: four, from: null });
        state.drawnThisTurn = null;
        payKong(state, seat, 'an', null);
        draw(state, seat, true);
        return state;
      }
    }
    return state;
  },

  view(state, seat) {
    const over = state.phase === 'roundOver' || state.phase === 'matchOver';
    const w = state.window;
    const me = seat !== null ? state.players[seat] : null;
    const rules = presetOf(state.options.scoring);
    return {
      seat,
      phase: state.phase,
      round: state.round,
      options: state.options,
      preset: state.options.scoring,
      minFan: rules.minFan,
      cap: rules.cap,
      dealer: state.dealer,
      wallCount: state.wall.length,
      turn: state.phase === 'play' ? state.turn : null,
      players: state.players.map((p) => ({
        handCount: p.hand.length,
        melds: p.melds,
        river: p.river,
        won: p.won,
        hand: over || p.won ? sortTiles(p.hand) : null,
      })),
      hand: me ? sortTiles(me.hand) : [],
      drawn: seat !== null && state.turn === seat && !w ? state.drawnThisTurn : null,
      legal: seat !== null ? legalActions(state, seat) : null,
      nearWin: seat !== null && state.phase === 'play' && !w ? nearWinOf(state, seat) : null,
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
    };
  },

  isOver: (state) => state.phase === 'matchOver',

  bot: gd136Bot,
  aiPrompt: gd136AiPrompt,
};

/** 测试与界面用：账本折算 */
export { deltasOf };
