import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import { waitingKinds } from '../../mahjong/analysis';
import type { MjSuit, Tile } from '../../mahjong/tiles';
import {
  KINDS,
  MJ_SUITS,
  countKinds,
  createTiles,
  kindOf,
  kindSuit,
  sortTiles,
  suitsOf,
  tileOf,
} from '../../mahjong/tiles';
import { scAiPrompt } from './ai';
import { sichuanBot } from './bot';
import type { MeldShape, WinScore } from './scoring';
import { FAN_CAP, evaluateHand, scoreOf, scoreWin } from './scoring';

export * from './scoring';
export * from './coach';
export * from './coach/mc';

/**
 * 四川麻将 · 成都血战到底（规则版本 chengdu-xz-1）。
 *
 * 108 张、不能吃、换三张（可关）、定缺；胡 > 杠 > 碰 > 过，一炮多响；过水；最后四张必胡；
 * 胡牌者退出，三家胡或牌墙摸完结束；刮风下雨、呼叫转移、查花猪、查大叫、退税。
 */

export const RULESET = 'chengdu-xz-1';

export interface ScOptions {
  baseScore: number;
  exchange: boolean;
  jingoudiao: boolean;
  /** 盘数，0 为不限 */
  rounds: number;
  /** 每人初始筹码，0 为不启用；启用后有人输光（≤ 0）即结束整场 */
  chips: number;
}

export type ScAction =
  | { type: 'exchange'; tiles: number[] }
  | { type: 'que'; suit: MjSuit }
  | { type: 'discard'; tile: number }
  | { type: 'hu' }
  | { type: 'gang'; tile?: number }
  | { type: 'peng' }
  | { type: 'pass' }
  | { type: 'ready' };

export type KongType = 'an' | 'zhi' | 'ba';

export interface ScMeld {
  type: 'pung' | 'kong';
  kongType?: KongType;
  kind: number;
  tiles: Tile[];
  from: Seat | null;
}

export interface RiverTile {
  tile: Tile;
  claimedBy?: Seat[];
}

export interface ScWin {
  seat: Seat;
  group: number;
  selfDrawn: boolean;
  tile: Tile;
  from: Seat | null;
  score: WinScore;
}

export type Clause =
  | 'pay.zimo'
  | 'pay.dianpao'
  | 'pay.hujiao_zhuanyi'
  | 'kong.xia_yu'
  | 'kong.gua_feng_zhi'
  | 'kong.gua_feng_ba'
  | 'tax.huazhu'
  | 'tax.chajiao'
  | 'tax.tuishui';

export const CLAUSE_NAME: Record<Clause, string> = {
  'pay.zimo': '自摸',
  'pay.dianpao': '点炮',
  'pay.hujiao_zhuanyi': '呼叫转移',
  'kong.xia_yu': '下雨（暗杠）',
  'kong.gua_feng_zhi': '刮风（直杠）',
  'kong.gua_feng_ba': '刮风（巴杠）',
  'tax.huazhu': '查花猪',
  'tax.chajiao': '查大叫',
  'tax.tuishui': '退税',
};

export interface LedgerEntry {
  from: Seat;
  to: Seat;
  amount: number;
  clause: Clause;
}

export interface KongReceipt {
  seat: Seat;
  entries: number[];
  gross: number;
  transferred: number;
}

export interface ScPlayer {
  hand: Tile[];
  melds: ScMeld[];
  river: RiverTile[];
  que: MjSuit | null;
  won: ScWin | null;
  passHu: boolean;
  afterKong: boolean;
  lastReceipt: number | null;
  hasDrawn: boolean;
}

export type WindowOpt = 'hu' | 'gang' | 'peng' | 'pass';

export interface ScWindow {
  kind: 'exchange' | 'dingque' | 'claims' | 'rob';
  /** 需要表态的座位（创建窗口时一次定死） */
  required: boolean[];
  /** 各座位的决定：null 表示尚未提交 */
  decisions: (ScAction | null)[];
  options: (WindowOpt[] | null)[];
  mustHu: boolean[];
  source: Seat | null;
  tile: Tile | null;
  afterKong: boolean;
  timely: boolean;
}

export type ScEvent =
  | {
      seq: number;
      type: 'peng' | 'gang' | 'zimo' | 'hu' | 'rob';
      seat: Seat;
      from?: Seat | null;
      kongType?: KongType;
    }
  | { seq: number; type: 'exchange'; dir: ExchangeDir }
  | { seq: number; type: 'que' };

export type ExchangeDir = 'next' | 'prev' | 'across';

export interface TingInfo {
  seat: Seat;
  kind: number;
  points: number;
}

export interface ScRoundResult {
  round: number;
  reason: 'three' | 'wall';
  wins: ScWin[];
  ledger: LedgerEntry[];
  deltas: number[];
  huazhu: Seat[];
  ting: TingInfo[];
  notReady: Seat[];
  hands: Tile[][];
  nextDealer: Seat;
}

export type ScPhase = 'exchange' | 'dingque' | 'play' | 'roundOver' | 'matchOver';

export interface ScState {
  options: ScOptions;
  rng: number;
  round: number;
  phase: ScPhase;
  dealer: Seat;
  wall: Tile[];
  players: ScPlayer[];
  turn: Seat;
  drawnThisTurn: number | null;
  canSelfHu: boolean;
  mustHuSelf: boolean;
  dihuChance: boolean;
  window: ScWindow | null;
  /** 最近一张仍留在牌河里的弃牌 */
  lastDiscard: { seat: Seat; id: number } | null;
  exchangeDir: ExchangeDir | null;
  exchanged: { given: Tile[]; received: Tile[] }[] | null;
  discards: number;
  claimsOrKongs: number;
  receipts: KongReceipt[];
  ledger: LedgerEntry[];
  groups: number;
  firstGroup: { seats: Seat[]; supplier: Seat | null } | null;
  scores: number[];
  ready: boolean[];
  result: ScRoundResult | null;
  history: { round: number; deltas: number[]; wins: { seat: Seat; fan: number }[] }[];
  events: ScEvent[];
  eventSeq: number;
}

export interface ScLegal {
  discard: number[];
  hu: boolean;
  gang: { tile: number; type: KongType }[];
  peng: boolean;
  pass: boolean;
  exchange: boolean;
  que: boolean;
  ready: boolean;
  mustHu: boolean;
}

export interface ScPlayerView {
  handCount: number;
  melds: ScMeld[];
  river: RiverTile[];
  que: MjSuit | null;
  queChosen: boolean;
  exchangeChosen: boolean;
  won: ScWin | null;
  /** 公开的手牌：已胡玩家亮牌、局末全部亮牌 */
  hand: Tile[] | null;
}

export interface ScView {
  seat: Seat | null;
  phase: ScPhase;
  round: number;
  options: ScOptions;
  dealer: Seat;
  wallCount: number;
  turn: Seat | null;
  players: ScPlayerView[];
  hand: Tile[];
  drawn: number | null;
  legal: ScLegal | null;
  window: { kind: ScWindow['kind']; source: Seat | null; tile: Tile | null } | null;
  lastDiscard: { seat: Seat; id: number } | null;
  exchangeDir: ExchangeDir | null;
  exchange: { given: Tile[]; received: Tile[] } | null;
  scores: number[];
  roundDeltas: number[];
  /** 从本座位视角已可见的每种牌张数（用于剩余张数、死叫判断） */
  visible: number[];
  /** 自己本盘收到、还没被转走的杠钱（流局没听牌时要退税）；只给自己看，其他人为 0 */
  myKongIncome: number;
  /** 自己刚杠完：下一张打出被胡就是杠上炮，这次杠收的钱会转给胡家（呼叫转移）。值为会被转走的钱，不在杠后为 null */
  myAfterKong: number | null;
  events: ScEvent[];
  result: ScRoundResult | null;
  ready: boolean[];
  history: ScState['history'];
}

const N = 4;
const others = (s: Seat) => [1, 2, 3].map((d) => (s + d) % N);

const hasQue = (p: ScPlayer) => p.que !== null && p.hand.some((t) => t.suit === p.que);
const meldShapes = (p: ScPlayer): MeldShape[] =>
  p.melds.map((m) => ({ type: m.type, kind: m.kind }));
const countOfKind = (tiles: Tile[], kind: number) => tiles.filter((t) => kindOf(t) === kind).length;

type EventInput = ScEvent extends infer E ? (E extends unknown ? Omit<E, 'seq'> : never) : never;

function pushEvent(state: ScState, e: EventInput) {
  state.events.push({ ...e, seq: ++state.eventSeq } as ScEvent);
  if (state.events.length > 16) state.events.shift();
}

function addLedger(state: ScState, from: Seat, to: Seat, amount: number, clause: Clause): number {
  state.ledger.push({ from, to, amount, clause });
  return state.ledger.length - 1;
}

function activeSeats(state: ScState): Seat[] {
  return [0, 1, 2, 3].filter((s) => !state.players[s].won);
}

function nextActive(state: ScState, from: Seat): Seat {
  for (let d = 1; d <= N; d++) {
    const s = (from + d) % N;
    if (!state.players[s].won) return s;
  }
  return from;
}

/** 和牌评估：暗手 + 和进的牌 */
function winValue(state: ScState, p: ScPlayer, extra: Tile | null) {
  const tiles = extra ? [...p.hand, extra] : p.hand;
  if (p.que && tiles.some((t) => t.suit === p.que)) return null;
  return evaluateHand(countKinds(tiles), meldShapes(p), { jingoudiao: state.options.jingoudiao });
}

function deal(state: ScState): void {
  const rng = new Rng(state.rng);
  const wall = rng.shuffle(createTiles());
  state.exchangeDir = state.options.exchange
    ? (['next', 'prev', 'across'] as const)[rng.int(3)]
    : null;
  state.rng = rng.state;
  state.players = [0, 1, 2, 3].map(() => ({
    hand: [],
    melds: [],
    river: [],
    que: null,
    won: null,
    passHu: false,
    afterKong: false,
    lastReceipt: null,
    hasDrawn: false,
  }));
  for (let i = 0; i < 13; i++)
    for (let s = 0; s < N; s++) state.players[(state.dealer + s) % N].hand.push(wall.shift()!);
  state.players[state.dealer].hand.push(wall.shift()!);
  state.wall = wall;
  state.turn = state.dealer;
  state.drawnThisTurn = null;
  state.canSelfHu = true;
  state.mustHuSelf = false;
  state.dihuChance = false;
  state.exchanged = null;
  state.lastDiscard = null;
  state.discards = 0;
  state.claimsOrKongs = 0;
  state.receipts = [];
  state.ledger = [];
  state.groups = 0;
  state.firstGroup = null;
  state.result = null;
  state.ready = [false, false, false, false];
  state.events = [];
  const kind = state.options.exchange ? 'exchange' : 'dingque';
  state.phase = kind;
  state.window = newWindow(kind, [0, 1, 2, 3]);
}

function newWindow(kind: ScWindow['kind'], seats: Seat[]): ScWindow {
  return {
    kind,
    required: [0, 1, 2, 3].map((s) => seats.includes(s)),
    decisions: [null, null, null, null],
    options: [null, null, null, null],
    mustHu: [false, false, false, false],
    source: null,
    tile: null,
    afterKong: false,
    timely: false,
  };
}

// ---------------------------------------------------------------------------
// 回合推进

/** 窗口里所有必填座位都已表态 */
function windowDone(w: ScWindow): boolean {
  return w.required.every((r, s) => !r || w.decisions[s] !== null);
}

function waitingIn(w: ScWindow, seat: Seat): boolean {
  return w.required[seat] && w.decisions[seat] === null;
}

function draw(state: ScState, seat: Seat, replacement: boolean): void {
  if (state.wall.length === 0) {
    endRound(state, 'wall');
    return;
  }
  const p = state.players[seat];
  state.mustHuSelf = state.wall.length <= 4;
  state.dihuChance =
    !replacement && seat !== state.dealer && !p.hasDrawn && state.claimsOrKongs === 0;
  const tile = state.wall.shift()!;
  p.hand.push(tile);
  p.hasDrawn = true;
  p.passHu = false;
  if (!replacement) {
    p.afterKong = false;
    p.lastReceipt = null;
  }
  state.turn = seat;
  state.drawnThisTurn = tile.id;
  state.canSelfHu = true;
  state.window = null;
}

function closeDiscarderKong(state: ScState, seat: Seat) {
  state.players[seat].afterKong = false;
  state.players[seat].lastReceipt = null;
}

function recordWinGroup(state: ScState, seats: Seat[], supplier: Seat | null) {
  if (!state.firstGroup) state.firstGroup = { seats, supplier };
}

function finishIfThree(state: ScState): boolean {
  if (state.players.filter((p) => p.won).length >= 3) {
    endRound(state, 'three');
    return true;
  }
  return false;
}

function openClaims(state: ScState, discarder: Seat, tile: Tile): void {
  const kind = kindOf(tile);
  const w = newWindow('claims', []);
  w.source = discarder;
  w.tile = tile;
  w.afterKong = state.players[discarder].afterKong;
  const mustWindow = state.wall.length <= 4;
  let anyChoice = false;
  for (const s of others(discarder)) {
    const p = state.players[s];
    if (p.won) continue;
    w.required[s] = true;
    const opts: WindowOpt[] = [];
    const blocked = hasQue(p) || tile.suit === p.que;
    if (!blocked) {
      const canHu = !!winValue(state, p, tile);
      if (canHu && mustWindow) {
        w.mustHu[s] = true;
        w.options[s] = ['hu'];
        anyChoice = true;
        continue;
      }
      if (canHu && !p.passHu) opts.push('hu');
      const n = countOfKind(p.hand, kind);
      if (n === 3 && state.wall.length > 0) opts.push('gang');
      if (n >= 2) opts.push('peng');
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
    draw(state, nextActive(state, discarder), false);
    return;
  }
  state.window = w;
}

function payKong(
  state: ScState,
  seat: Seat,
  type: KongType,
  from: Seat | null,
  timely: boolean,
): void {
  const entries: number[] = [];
  if (type === 'an') {
    for (const s of others(seat))
      if (!state.players[s].won) entries.push(addLedger(state, s, seat, 2, 'kong.xia_yu'));
  } else if (type === 'zhi') {
    entries.push(addLedger(state, from!, seat, 2, 'kong.gua_feng_zhi'));
  } else if (timely) {
    for (const s of others(seat))
      if (!state.players[s].won) entries.push(addLedger(state, s, seat, 1, 'kong.gua_feng_ba'));
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

function completeBa(state: ScState, seat: Seat, tile: Tile, timely: boolean): void {
  const p = state.players[seat];
  const meld = p.melds.find((m) => m.type === 'pung' && m.kind === kindOf(tile))!;
  meld.type = 'kong';
  meld.kongType = 'ba';
  meld.tiles = [...meld.tiles, tile];
  payKong(state, seat, 'ba', null, timely);
  draw(state, seat, true);
}

function ronWins(
  state: ScState,
  winners: Seat[],
  supplier: Seat,
  tile: Tile,
  robbing: boolean,
  afterKong: boolean,
) {
  const group = ++state.groups;
  const supplierP = state.players[supplier];
  for (const s of winners) {
    const p = state.players[s];
    const value = winValue(state, p, tile)!;
    const score = scoreWin(
      value,
      {
        selfDrawn: false,
        afterKong: afterKong && !robbing,
        robbing,
        haidi: false,
        tianhu: false,
        dihu: false,
      },
      state.options.baseScore,
    );
    p.won = { seat: s, group, selfDrawn: false, tile, from: supplier, score };
    addLedger(state, supplier, s, score.points, 'pay.dianpao');
    pushEvent(state, { type: robbing ? 'rob' : 'hu', seat: s, from: supplier });
  }
  // 呼叫转移：杠上炮时把杠分转给每位胡牌者
  if (!robbing && afterKong && supplierP.lastReceipt !== null) {
    const r = state.receipts[supplierP.lastReceipt];
    if (r.gross > 0) {
      for (const s of winners) addLedger(state, supplier, s, r.gross, 'pay.hujiao_zhuanyi');
      r.transferred += r.gross * winners.length;
    }
  }
  recordWinGroup(state, winners, winners.length === 1 ? null : supplier);
}

function resolveWindow(state: ScState): void {
  const w = state.window!;
  const dec = (s: Seat) => w.decisions[s];
  const order = others(w.source!);
  const huSeats = order.filter((s) => dec(s)?.type === 'hu');
  // 过水：当时能胡却没有胡成
  for (const s of order) {
    if (w.options[s]?.includes('hu') && dec(s)?.type !== 'hu') state.players[s].passHu = true;
  }
  const source = w.source!;
  const tile = w.tile!;
  state.window = null;

  if (w.kind === 'rob') {
    if (huSeats.length) {
      state.players[source].river.push({ tile, claimedBy: huSeats });
      ronWins(state, huSeats, source, tile, true, false);
      closeDiscarderKong(state, source);
      if (!finishIfThree(state)) draw(state, nextActive(state, source), false);
    } else {
      completeBa(state, source, tile, w.timely);
    }
    return;
  }

  const discarder = state.players[source];
  const riverIdx = discarder.river.length - 1;
  if (huSeats.length) {
    discarder.river[riverIdx].claimedBy = huSeats;
    ronWins(state, huSeats, source, tile, false, w.afterKong);
    closeDiscarderKong(state, source);
    if (!finishIfThree(state)) draw(state, nextActive(state, source), false);
    return;
  }
  const gangSeat = order.find((s) => dec(s)?.type === 'gang');
  if (gangSeat !== undefined) {
    discarder.river.pop();
    state.lastDiscard = null;
    closeDiscarderKong(state, source);
    const p = state.players[gangSeat];
    const kind = kindOf(tile);
    const own = p.hand.filter((t) => kindOf(t) === kind);
    p.hand = p.hand.filter((t) => kindOf(t) !== kind);
    p.melds.push({ type: 'kong', kongType: 'zhi', kind, tiles: [...own, tile], from: source });
    payKong(state, gangSeat, 'zhi', source, false);
    draw(state, gangSeat, true);
    return;
  }
  const pengSeat = order.find((s) => dec(s)?.type === 'peng');
  if (pengSeat !== undefined) {
    discarder.river.pop();
    state.lastDiscard = null;
    closeDiscarderKong(state, source);
    const p = state.players[pengSeat];
    const kind = kindOf(tile);
    const own = p.hand.filter((t) => kindOf(t) === kind).slice(0, 2);
    const ids = new Set(own.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    p.melds.push({ type: 'pung', kind, tiles: [...own, tile], from: source });
    state.claimsOrKongs++;
    pushEvent(state, { type: 'peng', seat: pengSeat, from: source });
    state.turn = pengSeat;
    state.drawnThisTurn = null;
    state.canSelfHu = false;
    state.mustHuSelf = false;
    state.dihuChance = false;
    return;
  }
  closeDiscarderKong(state, source);
  draw(state, nextActive(state, source), false);
}

// ---------------------------------------------------------------------------
// 结算

function visibleIds(state: ScState, viewer: Seat | null): Set<number> {
  const ids = new Set<number>();
  state.players.forEach((p, s) => {
    for (const m of p.melds) for (const t of m.tiles) ids.add(t.id);
    for (const r of p.river) ids.add(r.tile.id);
    if (p.won || s === viewer) for (const t of p.hand) ids.add(t.id);
  });
  return ids;
}

function visibleCounts(state: ScState, viewer: Seat | null): number[] {
  const c = new Array<number>(KINDS).fill(0);
  const all = createTilesCache();
  for (const id of visibleIds(state, viewer)) c[kindOf(all[id])]++;
  return c;
}

let tilesCache: Tile[] | null = null;
function createTilesCache(): Tile[] {
  if (!tilesCache) tilesCache = createTiles();
  return tilesCache;
}

/** 下叫判定：返回查叫分最大的活张，未下叫返回 null */
export function tingOf(state: ScState, seat: Seat): TingInfo | null {
  const p = state.players[seat];
  if (hasQue(p)) return null;
  const counts = countKinds(p.hand);
  const shapes = meldShapes(p);
  const waits = waitingKinds(counts, shapes.length, (k) => kindSuit(k) !== p.que);
  if (!waits.length) return null;
  const visible = visibleCounts(state, seat);
  let best: TingInfo | null = null;
  for (const k of waits) {
    if (visible[k] >= 4) continue; // 死叫
    const c = [...counts];
    c[k]++;
    const v = evaluateHand(c, shapes, { jingoudiao: state.options.jingoudiao });
    if (!v) continue;
    const points = scoreOf(v.base, state.options.baseScore);
    if (!best || points > best.points) best = { seat, kind: k, points };
  }
  return best;
}

function settle(state: ScState): { huazhu: Seat[]; ting: TingInfo[]; notReady: Seat[] } {
  const base = state.options.baseScore;
  const nonWon = activeSeats(state);
  const huazhu = nonWon.filter((s) => {
    const p = state.players[s];
    return suitsOf([...p.hand, ...p.melds.flatMap((m) => m.tiles)]).size === 3;
  });
  for (const h of huazhu) {
    for (let s = 0; s < N; s++) {
      if (s !== h && !huazhu.includes(s))
        addLedger(state, h, s, scoreOf(FAN_CAP, base), 'tax.huazhu');
    }
  }
  const candidates = nonWon.filter((s) => !huazhu.includes(s));
  const ting: TingInfo[] = [];
  const notReady: Seat[] = [];
  for (const s of candidates) {
    const t = tingOf(state, s);
    if (t) ting.push(t);
    else notReady.push(s);
  }
  for (const n of notReady)
    for (const t of ting) addLedger(state, n, t.seat, t.points, 'tax.chajiao');
  // 退税：未胡且未下叫（含花猪）的玩家退回仍保留的杠分
  const refunders = nonWon.filter((s) => !ting.some((t) => t.seat === s));
  for (const s of refunders) {
    for (const r of state.receipts) {
      if (r.seat !== s || r.gross === 0 || r.transferred > 0) continue;
      for (const i of [...r.entries]) {
        const e = state.ledger[i];
        addLedger(state, e.to, e.from, e.amount, 'tax.tuishui');
      }
    }
  }
  return { huazhu, ting, notReady };
}

function deltasOf(ledger: readonly LedgerEntry[]): number[] {
  const d = [0, 0, 0, 0];
  for (const e of ledger) {
    d[e.from] -= e.amount;
    d[e.to] += e.amount;
  }
  return d;
}

function endRound(state: ScState, reason: 'three' | 'wall'): void {
  state.window = null;
  const { huazhu, ting, notReady } = settle(state);
  const deltas = deltasOf(state.ledger);
  for (let s = 0; s < N; s++) state.scores[s] += deltas[s];
  const g = state.firstGroup;
  const nextDealer = g
    ? g.seats.length === 1
      ? g.seats[0]
      : (g.supplier ?? state.dealer)
    : state.dealer;
  const wins = state.players
    .filter((p) => p.won)
    .map((p) => p.won!)
    .sort((a, b) => a.group - b.group || a.seat - b.seat);
  state.result = {
    round: state.round,
    reason,
    wins,
    ledger: [...state.ledger],
    deltas,
    huazhu,
    ting,
    notReady,
    hands: state.players.map((p) => sortTiles(p.hand, p.que)),
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

export function legalActions(state: ScState, seat: Seat): ScLegal | null {
  const L: ScLegal = {
    discard: [],
    hu: false,
    gang: [],
    peng: false,
    pass: false,
    exchange: false,
    que: false,
    ready: false,
    mustHu: false,
  };
  if (state.phase === 'roundOver') {
    if (state.ready[seat]) return null;
    L.ready = true;
    return L;
  }
  const w = state.window;
  if (state.phase === 'exchange') {
    if (!w || !waitingIn(w, seat)) return null;
    L.exchange = true;
    return L;
  }
  if (state.phase === 'dingque') {
    if (!w || !waitingIn(w, seat)) return null;
    L.que = true;
    return L;
  }
  if (state.phase !== 'play') return null;
  const p = state.players[seat];
  if (p.won) return null;
  if (w) {
    if (!waitingIn(w, seat)) return null;
    const opts = w.options[seat] ?? [];
    L.mustHu = w.mustHu[seat];
    L.hu = opts.includes('hu');
    L.peng = opts.includes('peng');
    L.pass = opts.includes('pass');
    if (opts.includes('gang')) L.gang = [{ tile: w.tile!.id, type: 'zhi' }];
    return L;
  }
  if (state.turn !== seat) return null;
  const que = hasQue(p);
  const canHu = state.canSelfHu && !que && !!winValue(state, p, null);
  if (canHu && state.mustHuSelf) {
    L.hu = true;
    L.mustHu = true;
    return L;
  }
  L.hu = canHu;
  L.discard = (que ? p.hand.filter((t) => t.suit === p.que) : p.hand).map((t) => t.id);
  if (!que && state.wall.length > 0) {
    const counts = countKinds(p.hand);
    for (let k = 0; k < KINDS; k++) {
      if (counts[k] === 4)
        L.gang.push({ tile: p.hand.find((t) => kindOf(t) === k)!.id, type: 'an' });
    }
    for (const m of p.melds) {
      if (m.type !== 'pung') continue;
      const t = p.hand.find((x) => kindOf(x) === m.kind);
      if (t) L.gang.push({ tile: t.id, type: 'ba' });
    }
  }
  return L;
}

// ---------------------------------------------------------------------------

function cleanAction(a: ScAction): ScAction {
  switch (a.type) {
    case 'exchange':
      return { type: 'exchange', tiles: a.tiles.map(Number) };
    case 'que':
      return { type: 'que', suit: a.suit };
    case 'discard':
      return { type: 'discard', tile: Number(a.tile) };
    case 'gang':
      return typeof a.tile === 'number' ? { type: 'gang', tile: a.tile } : { type: 'gang' };
    default:
      return { type: a.type };
  }
}

/**
 * 在原状态上执行动作，会修改 state。只给导师精算的模拟推演用（省去每步深拷贝）；
 * 正式对局用 sichuan.apply（不改入参），两者结果完全相同。
 */
export function applyInPlace(state: ScState, seat: Seat, raw: ScAction): ScState {
  // 只保留各动作需要的字段：决定会存进状态，不能带上客户端附加的任意数据
  const action = cleanAction(raw);
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
    case 'exchange': {
      state.window!.decisions[seat] = action;
      if (windowDone(state.window!)) {
        const shift = state.exchangeDir === 'next' ? 1 : state.exchangeDir === 'prev' ? 3 : 2;
        const given = state.players.map((pl, s) => {
          const ids = new Set((state.window!.decisions[s] as { tiles: number[] }).tiles);
          const out = pl.hand.filter((t) => ids.has(t.id));
          pl.hand = pl.hand.filter((t) => !ids.has(t.id));
          return out;
        });
        state.exchanged = [0, 1, 2, 3].map((s) => ({
          given: given[s],
          received: given[(s + N - shift) % N],
        }));
        for (let s = 0; s < N; s++) state.players[(s + shift) % N].hand.push(...given[s]);
        pushEvent(state, { type: 'exchange', dir: state.exchangeDir! });
        state.phase = 'dingque';
        state.window = newWindow('dingque', [0, 1, 2, 3]);
      }
      return state;
    }
    case 'que': {
      state.window!.decisions[seat] = action;
      if (windowDone(state.window!)) {
        state.players.forEach((pl, s) => {
          pl.que = (state.window!.decisions[s] as { suit: MjSuit }).suit;
        });
        pushEvent(state, { type: 'que' });
        state.phase = 'play';
        state.window = null;
        state.turn = state.dealer;
        state.drawnThisTurn = null;
        state.canSelfHu = true;
        state.mustHuSelf = false;
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
      state.dihuChance = false;
      openClaims(state, seat, tile);
      return state;
    }
    case 'hu': {
      if (state.window) {
        state.window.decisions[seat] = action;
        if (windowDone(state.window)) resolveWindow(state);
        return state;
      }
      // 自摸
      const value = winValue(state, p, null)!;
      const tianhu =
        seat === state.dealer &&
        state.discards === 0 &&
        state.claimsOrKongs === 0 &&
        state.drawnThisTurn === null;
      const ctx = {
        selfDrawn: true,
        afterKong: p.afterKong,
        robbing: false,
        haidi: state.drawnThisTurn !== null && state.wall.length === 0,
        tianhu,
        dihu: state.dihuChance,
      };
      const score = scoreWin(value, ctx, state.options.baseScore);
      const tile = p.hand.find((t) => t.id === state.drawnThisTurn) ?? p.hand[p.hand.length - 1];
      const group = ++state.groups;
      p.won = { seat, group, selfDrawn: true, tile, from: null, score };
      for (const s of others(seat)) {
        if (!state.players[s].won) addLedger(state, s, seat, score.points, 'pay.zimo');
      }
      pushEvent(state, { type: 'zimo', seat });
      recordWinGroup(state, [seat], null);
      p.afterKong = false;
      p.lastReceipt = null;
      if (!finishIfThree(state)) draw(state, nextActive(state, seat), false);
      return state;
    }
    case 'gang': {
      if (state.window) {
        state.window.decisions[seat] = action;
        if (windowDone(state.window)) resolveWindow(state);
        return state;
      }
      const target = p.hand.find((t) => t.id === action.tile)!;
      const kind = kindOf(target);
      const pung = p.melds.find((m) => m.type === 'pung' && m.kind === kind);
      if (pung) {
        // 巴杠：先开抢杠窗口
        const timely = state.drawnThisTurn === target.id;
        p.hand = p.hand.filter((t) => t.id !== target.id);
        state.drawnThisTurn = null;
        const w = newWindow('rob', []);
        w.source = seat;
        w.tile = target;
        w.timely = timely;
        const must = state.wall.length <= 4;
        let any = false;
        for (const s of others(seat)) {
          const o = state.players[s];
          if (o.won) continue;
          w.required[s] = true;
          const can = !hasQue(o) && target.suit !== o.que && !!winValue(state, o, target);
          if (can && must) {
            w.mustHu[s] = true;
            w.options[s] = ['hu'];
            any = true;
          } else if (can && !o.passHu) {
            w.options[s] = ['hu', 'pass'];
            any = true;
          } else {
            w.options[s] = ['pass'];
            w.decisions[s] = { type: 'pass' };
          }
        }
        if (any) state.window = w;
        else completeBa(state, seat, target, timely);
        return state;
      }
      // 暗杠
      const four = p.hand.filter((t) => kindOf(t) === kind);
      p.hand = p.hand.filter((t) => kindOf(t) !== kind);
      p.melds.push({ type: 'kong', kongType: 'an', kind, tiles: four, from: null });
      state.drawnThisTurn = null;
      payKong(state, seat, 'an', null, false);
      draw(state, seat, true);
      return state;
    }
    case 'peng':
    case 'pass': {
      state.window!.decisions[seat] = action;
      if (windowDone(state.window!)) resolveWindow(state);
      return state;
    }
  }
  return state;
}

export const sichuan: GameDefinition<ScState, ScAction, ScView, ScOptions> = {
  meta: {
    id: 'sichuan',
    category: 'mahjong',
    name: '四川麻将',
    nameEn: 'Sichuan Mahjong',
    tagline: '血战到底：换三张、定缺，胡了还要继续打',
    minPlayers: 4,
    maxPlayers: 4,
    defaultPlayers: 4,
    botDelayMs: [450, 950],
    rules: [
      '成都血战到底（规则版本 chengdu-xz-1）：只用万、条、筒共 108 张，不能吃，只能碰、杠、胡。',
      '开局换三张（可关）：每人交出同一花色的三张，方向在选牌前公布。随后定缺：每人选一门花色，手上有缺门时只能先打缺门，且不能碰、杠、胡。',
      '胡牌：4 个面子 + 1 将，或七对；手牌最多两门花色、不含缺门。胡 > 杠 > 碰，一张牌可以多人同时胡（一炮多响）。',
      '血战到底：胡牌者退出本盘，其余玩家继续，直到三家胡牌或牌墙摸完。',
      '番型取最高不叠加：平胡 1、对对胡 2、清一色 / 暗七对 / 全幺九 3、清对 / 将对 / 清七对 / 龙七对 / 清幺九 4；另加根（四张相同）、杠上花、杠上炮、抢杠、海底捞月 各 +1，天胡 / 地胡 +4。自摸不加番。',
      '分数 = 底分 × 2^(番 − 1)，5 番封顶。自摸由未胡的每家各付一份，点炮只由点炮者付。',
      '刮风下雨：暗杠每家付 2，直杠点杠者付 2，巴杠每家付 1（仅当第四张是本回合刚摸到的「及时雨」）。杠上炮时杠分转给胡牌者（呼叫转移）。',
      '过水：能胡却没胡，在下次摸牌前不能胡别人打出的牌。牌墙只剩 4 张及以下时，能胡必须胡。',
      '流局查账：三门花色未打缺的是花猪，向其他人各赔 5 番封顶分；未听牌的向听牌者按其最大番赔付（查大叫）；未听牌者退还杠分（退税）。',
    ],
  },
  defaultOptions: { baseScore: 1, exchange: true, jingoudiao: false, rounds: 8, chips: 0 },
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
    { key: 'exchange', label: '换三张', type: 'toggle' },
    { key: 'jingoudiao', label: '金钩钓', hint: '单钓将且其余全是碰杠时 +1 番', type: 'toggle' },
  ],

  setup({ options, seed }) {
    const rng = new Rng(seed);
    const state: ScState = {
      options: { ...options },
      rng: 0,
      round: 1,
      phase: 'exchange',
      dealer: rng.int(N),
      wall: [],
      players: [],
      turn: 0,
      drawnThisTurn: null,
      canSelfHu: true,
      mustHuSelf: false,
      dihuChance: false,
      window: null,
      lastDiscard: null,
      exchangeDir: null,
      exchanged: null,
      discards: 0,
      claimsOrKongs: 0,
      receipts: [],
      ledger: [],
      groups: 0,
      firstGroup: null,
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
      case 'exchange': {
        if (!L.exchange) return '现在不能换牌';
        const ids = action.tiles;
        if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3)
          return '请选择三张牌';
        const tiles = ids.map((id) => p.hand.find((t) => t.id === id));
        if (tiles.some((t) => !t)) return '请选择自己的手牌';
        if (new Set(tiles.map((t) => t!.suit)).size !== 1) return '换三张必须是同一花色';
        return null;
      }
      case 'que':
        if (!L.que) return '现在不能定缺';
        return MJ_SUITS.includes(action.suit) ? null : '请选择一门花色';
      case 'discard':
        if (L.mustHu) return '最后四张，能胡必须胡';
        if (!L.discard.includes(action.tile))
          return hasQue(p) ? '手上有缺门，必须先打缺门' : '不能打这张牌';
        return null;
      case 'hu':
        return L.hu ? null : '还不能胡';
      case 'peng':
        if (L.mustHu) return '最后四张，能胡必须胡';
        return L.peng ? null : '不能碰';
      case 'gang': {
        if (L.mustHu) return '最后四张，能胡必须胡';
        if (state.window) return L.gang.length ? null : '不能杠';
        const t = p.hand.find((x) => x.id === action.tile);
        if (!t) return '请选择要杠的牌';
        return L.gang.some((g) => kindOf(tileOf(g.tile)) === kindOf(t)) ? null : '不能杠';
      }
      case 'pass':
        if (L.mustHu) return '最后四张，能胡必须胡';
        return L.pass ? null : '现在不能过';
      default:
        return '未知操作';
    }
  },

  apply: (prev, seat, raw) => applyInPlace(clone(prev), seat, raw),

  view(state, seat) {
    const over = state.phase === 'roundOver' || state.phase === 'matchOver';
    const queRevealed = state.phase === 'play' || over;
    const w = state.window;
    const me = seat !== null ? state.players[seat] : null;
    return {
      seat,
      phase: state.phase,
      round: state.round,
      options: state.options,
      dealer: state.dealer,
      wallCount: state.wall.length,
      turn: state.phase === 'play' ? state.turn : null,
      players: state.players.map((p, s) => ({
        handCount: p.hand.length,
        melds: p.melds,
        river: p.river,
        que: queRevealed || s === seat ? p.que : null,
        queChosen: state.phase === 'dingque' ? !!w?.decisions[s] : p.que !== null,
        exchangeChosen: state.phase === 'exchange' ? !!w?.decisions[s] : true,
        won: p.won,
        hand: over || p.won ? sortTiles(p.hand, p.que) : null,
      })),
      hand: me ? sortTiles(me.hand, me.que) : [],
      drawn: seat !== null && state.turn === seat && !w ? state.drawnThisTurn : null,
      legal: seat !== null ? legalActions(state, seat) : null,
      // 抢牌窗口只给需要决定的座位看：否则旁人能从「窗口打开了」推断出有人能碰 / 胡这张牌
      window:
        w && (w.kind === 'claims' || w.kind === 'rob') && seat !== null && w.required[seat]
          ? { kind: w.kind, source: w.source, tile: w.tile }
          : null,
      lastDiscard: state.lastDiscard,
      exchangeDir: state.exchangeDir,
      exchange: seat !== null && state.exchanged ? state.exchanged[seat] : null,
      scores: state.scores,
      roundDeltas: deltasOf(state.ledger),
      visible: visibleCounts(state, seat),
      myKongIncome:
        seat === null
          ? 0
          : state.receipts
              .filter((r) => r.seat === seat && r.transferred === 0)
              .reduce((a, r) => a + r.gross, 0),
      myAfterKong:
        me && me.afterKong
          ? me.lastReceipt !== null
            ? state.receipts[me.lastReceipt].gross
            : 0
          : null,
      events: state.events,
      result: state.result,
      ready: state.ready,
      history: state.history,
    };
  },

  isOver: (state) => state.phase === 'matchOver',

  bot: sichuanBot,
  aiPrompt: scAiPrompt,
};

/** 测试用：直接执行终局结算与账本折算 */
export { settle as _settle, deltasOf };
