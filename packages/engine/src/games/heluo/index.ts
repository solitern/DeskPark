import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import { hlAiPrompt } from './ai';
import { heluoBot } from './bot';
import type { KongType, WinKind } from './scoring';
import { kongDeltas, winDeltas } from './scoring';
import type { HlTile } from './tiles';
import { countHlKinds, createHlTiles, isHlWin, sortHlTiles } from './tiles';

export * from './scoring';
export * from './tiles';

/**
 * 河洛杠次（洛阳杠次 / 杠呲）。
 *
 * 136 张、无花牌、4 人、不能吃，只能碰和杠。牌墙尾端最后一摞上面的一张亮出为「次牌」，
 * 不能摸走。开杠后先拿次牌试胡（即「次」），组不成再从次牌下一张补牌。
 * 硬次只能靠次胡牌；软次还可以自摸。手里有三张与次牌相同的牌可直接「屁次」。
 * 剩余张数进入包次区后，打出生张被别人杠出次，由放张者包次。
 */

const N = 4;

export type HlPhase = 'play' | 'roundOver' | 'matchOver';
export type HlMode = 'soft' | 'hard';

export interface HlOptions {
  /** soft 软次（可自摸）/ hard 硬次（只能次） */
  mode: HlMode;
  /** 是否启用包次 */
  baoCi: boolean;
  /** 牌墙剩余不多于此张数时进入包次区 */
  baoThreshold: number;
  /** 盘数，0 表示不限 */
  rounds: number;
}

export interface HlMeld {
  type: 'pung' | 'kong';
  kongType?: KongType;
  kind: number;
  tiles: HlTile[];
  /** 明杠 / 碰：牌来自谁 */
  from: Seat | null;
  /** 碰（以及由碰补成的加杠）当初的出牌人 */
  pengFrom: Seat | null;
}

export interface HlRiverTile {
  tile: HlTile;
  claimedBy?: Seat[];
}

export interface HlWin {
  seat: Seat;
  kind: WinKind;
  tile: HlTile | null;
  /** 明次 / 包次的付款人（明次为出杠牌的人，包次为放张者） */
  from: Seat | null;
  deltas: number[];
}

export interface HlPlayer {
  hand: HlTile[];
  melds: HlMeld[];
  river: HlRiverTile[];
  won: HlWin | null;
}

export type ClaimChoice = 'gang' | 'peng' | 'pass';

export interface ClaimWindow {
  kind: 'claims';
  required: boolean[];
  decisions: ({ type: ClaimChoice } | null)[];
  options: (ClaimChoice[] | null)[];
  source: Seat;
  tile: HlTile;
  /** 这张牌打出时已在包次区且是生张 */
  baoFresh: boolean;
}

export interface GangLedgerEntry {
  from: Seat;
  to: Seat;
  amount: number;
  clause: string;
}

export interface HlResult {
  round: number;
  reason: 'win' | 'wall';
  win: HlWin | null;
  /** 本盘总得分（胡牌分 + 杠分；荒庄为 0） */
  deltas: number[];
  gangDeltas: number[];
  /** 杠分是否计入（荒庄作废） */
  gangCounted: boolean;
  nextDealer: Seat;
  hands: HlTile[][];
}

export type HlEvent =
  | { type: 'peng'; seat: Seat; from: Seat; seq: number }
  | { type: 'gang'; seat: Seat; from: Seat | null; seq: number }
  | { type: 'ci' | 'pici' | 'zimo'; seat: Seat; from: Seat | null; seq: number };

type HlEventInput = HlEvent extends infer E
  ? E extends { seq: number }
    ? Omit<E, 'seq'>
    : never
  : never;

export interface HlState {
  options: HlOptions;
  rng: number;
  round: number;
  phase: HlPhase;
  dealer: Seat;
  wall: HlTile[];
  ciTile: HlTile | null;
  ciKind: number;
  players: HlPlayer[];
  turn: Seat;
  /** 当前玩家本回合已摸牌（或补牌），可以自摸 / 开杠 */
  turnDrawn: boolean;
  drawnThisTurn: number | null;
  window: ClaimWindow | null;
  lastDiscard: { seat: Seat; id: number } | null;
  discards: number;
  gangDeltas: number[];
  gangLedger: GangLedgerEntry[];
  scores: number[];
  ready: boolean[];
  result: HlResult | null;
  history: { round: number; deltas: number[]; win: WinKind | null }[];
  events: HlEvent[];
  eventSeq: number;
}

export type HlAction =
  | { type: 'discard'; tile: number }
  | { type: 'gang'; tile?: number }
  | { type: 'peng' }
  | { type: 'pass' }
  | { type: 'pici' }
  | { type: 'hu' }
  | { type: 'ready' };

export interface HlLegal {
  discard: number[];
  /** ci：这一杠开出来正好用次牌胡（界面直接显示「次」） */
  gang: { tile: number; type: KongType; ci: boolean }[];
  peng: boolean;
  pass: boolean;
  pici: boolean;
  hu: boolean;
  ready: boolean;
}

export interface HlPlayerView {
  handCount: number;
  melds: HlMeld[];
  river: HlRiverTile[];
  won: HlWin | null;
  /** 只有本盘结束或已胡时才亮出 */
  hand: HlTile[] | null;
}

export interface HlView {
  seat: Seat | null;
  phase: HlPhase;
  round: number;
  options: HlOptions;
  dealer: Seat;
  ciTile: HlTile | null;
  ciKind: number;
  wallCount: number;
  baoActive: boolean;
  turn: Seat | null;
  players: HlPlayerView[];
  hand: HlTile[];
  drawn: number | null;
  legal: HlLegal | null;
  window: { source: Seat; tile: HlTile } | null;
  lastDiscard: { seat: Seat; id: number } | null;
  scores: number[];
  roundDeltas: number[];
  result: HlResult | null;
  ready: boolean[];
  events: HlEvent[];
  history: HlState['history'];
}

const nextThree = (s: Seat): Seat[] => [1, 2, 3].map((d) => (s + d) % N);
const countKind = (tiles: readonly HlTile[], kind: number) =>
  tiles.filter((t) => t.kind === kind).length;

function pushEvent(s: HlState, e: HlEventInput) {
  s.events.push({ ...e, seq: ++s.eventSeq } as HlEvent);
  if (s.events.length > 16) s.events.shift();
}

function nextActive(s: HlState, from: Seat): Seat {
  for (let d = 1; d <= N; d++) {
    const p = (from + d) % N;
    if (!s.players[p].won) return p;
  }
  return from;
}

/** 是否已进入包次区 */
export function inBaoZone(s: Pick<HlState, 'options' | 'wall'>): boolean {
  return s.options.baoCi && s.wall.length <= s.options.baoThreshold;
}

/** 生张：桌面（牌河与副露）上还没出现过的牌 */
function isFresh(s: HlState, kind: number): boolean {
  for (const p of s.players)
    if (p.river.some((r) => r.tile.kind === kind) || p.melds.some((m) => m.kind === kind))
      return false;
  return true;
}

/** 洗牌、亮次牌、发牌，开始新一盘 */
function deal(s: HlState) {
  const rng = new Rng(s.rng);
  const tiles = rng.shuffle(createHlTiles());
  const ci = tiles.pop()!;
  s.ciTile = ci;
  s.ciKind = ci.kind;
  s.rng = rng.state;
  s.players = [0, 1, 2, 3].map(() => ({ hand: [], melds: [], river: [], won: null }));
  for (let i = 0; i < 13; i++)
    for (let k = 0; k < N; k++) s.players[(s.dealer + k) % N].hand.push(tiles.shift()!);
  s.players[s.dealer].hand.push(tiles.shift()!);
  s.wall = tiles;
  s.turn = s.dealer;
  s.turnDrawn = false;
  s.drawnThisTurn = null;
  s.window = null;
  s.lastDiscard = null;
  s.discards = 0;
  s.gangDeltas = [0, 0, 0, 0];
  s.gangLedger = [];
  s.ready = [false, false, false, false];
  s.result = null;
  s.events = [];
  s.eventSeq = 0;
  s.phase = 'play';
}

/** 从牌墙头摸牌 */
function drawFront(s: HlState, seat: Seat) {
  if (s.wall.length === 0) return wallOver(s);
  const t = s.wall.shift()!;
  s.players[seat].hand.push(t);
  s.turn = seat;
  s.turnDrawn = true;
  s.drawnThisTurn = t.id;
  s.window = null;
}

/** 开杠没次上：从次牌下一张（牌墙尾）补牌 */
function drawBack(s: HlState, seat: Seat) {
  if (s.wall.length === 0) return wallOver(s);
  const t = s.wall.pop()!;
  s.players[seat].hand.push(t);
  s.turn = seat;
  s.turnDrawn = true;
  s.drawnThisTurn = t.id;
  s.window = null;
}

function addGang(s: HlState, d: number[], to: Seat, clause: string) {
  for (let i = 0; i < N; i++)
    if (i !== to && d[i] < 0) s.gangLedger.push({ from: i, to, amount: -d[i], clause });
  s.gangDeltas = s.gangDeltas.map((x, i) => x + d[i]);
}

function finishWin(
  s: HlState,
  seat: Seat,
  kind: WinKind,
  tile: HlTile | null,
  from: Seat | null,
  baoFrom: Seat | null,
) {
  const deltas = winDeltas(kind, seat, from, baoFrom).map((x, i) => x + s.gangDeltas[i]);
  const win: HlWin = { seat, kind, tile, from: kind === 'baoci' ? baoFrom : from, deltas };
  s.players[seat].won = win;
  s.scores = s.scores.map((x, i) => x + deltas[i]);
  s.result = {
    round: s.round,
    reason: 'win',
    win,
    deltas,
    gangDeltas: [...s.gangDeltas],
    gangCounted: true,
    nextDealer: seat,
    hands: s.players.map((p) => [...p.hand]),
  };
  s.history.push({ round: s.round, deltas, win: kind });
  s.phase = 'roundOver';
  s.window = null;
  pushEvent(s, {
    type: kind === 'pici' ? 'pici' : kind === 'zimo' ? 'zimo' : 'ci',
    seat,
    from,
  });
}

/** 荒庄：庄家不换，杠分作废 */
function wallOver(s: HlState) {
  s.result = {
    round: s.round,
    reason: 'wall',
    win: null,
    deltas: [0, 0, 0, 0],
    gangDeltas: [...s.gangDeltas],
    gangCounted: false,
    nextDealer: s.dealer,
    hands: s.players.map((p) => [...p.hand]),
  };
  s.history.push({ round: s.round, deltas: [0, 0, 0, 0], win: null });
  s.phase = 'roundOver';
  s.window = null;
}

/**
 * 开杠之后：先拿次牌试胡；能胡就是「次」（触发次的这一杠不另算杠分），
 * 否则记杠分并从牌墙尾补牌。
 */
function afterKong(
  s: HlState,
  seat: Seat,
  type: KongType,
  from: Seat | null,
  baoFrom: Seat | null,
) {
  const p = s.players[seat];
  if (s.ciTile && isHlWin(countHlKinds([...p.hand, s.ciTile]), p.melds.length)) {
    const kind: WinKind = baoFrom !== null ? 'baoci' : type === 'an' ? 'anci' : 'mingci';
    finishWin(s, seat, kind, s.ciTile, from, baoFrom);
    return;
  }
  addGang(s, kongDeltas(type, seat, from), seat, `gang.${type}`);
  pushEvent(s, { type: 'gang', seat, from });
  drawBack(s, seat);
}

function windowDone(w: ClaimWindow) {
  return w.required.every((r, i) => !r || w.decisions[i] !== null);
}

/** 有人打出牌后，开放碰 / 杠的表态窗口（不能吃、不能点炮胡） */
function openClaims(s: HlState, source: Seat, tile: HlTile, baoFresh: boolean) {
  const w: ClaimWindow = {
    kind: 'claims',
    required: [false, false, false, false],
    decisions: [null, null, null, null],
    options: [null, null, null, null],
    source,
    tile,
    baoFresh,
  };
  let any = false;
  for (const seat of nextThree(source)) {
    const p = s.players[seat];
    if (p.won) continue;
    w.required[seat] = true;
    const opts: ClaimChoice[] = [];
    const n = countKind(p.hand, tile.kind);
    if (n >= 3 && s.wall.length > 0) opts.push('gang');
    if (n >= 2) opts.push('peng');
    if (opts.length === 0) {
      w.decisions[seat] = { type: 'pass' };
      w.options[seat] = ['pass'];
    } else {
      w.options[seat] = [...opts, 'pass'];
      any = true;
    }
  }
  if (any) s.window = w;
  else drawFront(s, nextActive(s, source));
}

/** 表态结束：杠 > 碰 > 过；同级按出牌顺序靠前者优先 */
function resolveClaims(s: HlState) {
  const w = s.window!;
  const order = nextThree(w.source);
  const dec = (seat: Seat) => w.decisions[seat];
  const tile = w.tile;
  const source = w.source;
  const baoFrom = w.baoFresh && inBaoZone(s) ? source : null;
  s.window = null;

  const ganger = order.find((seat) => dec(seat)?.type === 'gang');
  if (ganger !== undefined) {
    const r = s.players[source].river;
    r[r.length - 1].claimedBy = [ganger];
    s.lastDiscard = null;
    const p = s.players[ganger];
    const own = p.hand.filter((t) => t.kind === tile.kind);
    p.hand = p.hand.filter((t) => t.kind !== tile.kind);
    p.melds.push({
      type: 'kong',
      kongType: 'ming',
      kind: tile.kind,
      tiles: [...own, tile],
      from: source,
      pengFrom: null,
    });
    s.turn = ganger;
    s.turnDrawn = false;
    s.drawnThisTurn = null;
    afterKong(s, ganger, 'ming', source, baoFrom);
    return;
  }

  const penger = order.find((seat) => dec(seat)?.type === 'peng');
  if (penger !== undefined) {
    const r = s.players[source].river;
    r[r.length - 1].claimedBy = [penger];
    s.lastDiscard = null;
    const p = s.players[penger];
    const two = p.hand.filter((t) => t.kind === tile.kind).slice(0, 2);
    const ids = new Set(two.map((t) => t.id));
    p.hand = p.hand.filter((t) => !ids.has(t.id));
    p.melds.push({
      type: 'pung',
      kind: tile.kind,
      tiles: [...two, tile],
      from: source,
      pengFrom: source,
    });
    pushEvent(s, { type: 'peng', seat: penger, from: source });
    s.turn = penger;
    s.turnDrawn = false;
    s.drawnThisTurn = null;
    return;
  }

  drawFront(s, nextActive(s, source));
}

/** 假如开这一杠（手里拿走 remove 张该种牌、副露变为 meldCount），次牌能否胡 */
function kongWinsCi(s: HlState, p: HlState['players'][number], kind: number, meldCount: number) {
  if (!s.ciTile) return false;
  const rest = p.hand.filter((t) => t.kind !== kind);
  return isHlWin(countHlKinds([...rest, s.ciTile]), meldCount);
}

export function legalOf(s: HlState, seat: Seat): HlLegal {
  const none: HlLegal = {
    discard: [],
    gang: [],
    peng: false,
    pass: false,
    pici: false,
    hu: false,
    ready: false,
  };
  if (seat < 0 || seat >= N) return none;
  if (s.phase === 'roundOver') return { ...none, ready: !s.ready[seat] };
  if (s.phase !== 'play') return none;
  const p = s.players[seat];

  if (s.window) {
    const w = s.window;
    if (!w.required[seat] || w.decisions[seat] !== null) return none;
    const opts = w.options[seat] ?? [];
    return {
      ...none,
      peng: opts.includes('peng'),
      pass: opts.includes('pass'),
      gang: opts.includes('gang')
        ? [{ tile: w.tile.id, type: 'ming', ci: kongWinsCi(s, p, w.tile.kind, p.melds.length + 1) }]
        : [],
    };
  }

  if (s.turn !== seat || p.won) return none;
  // 摸牌后（或庄家起手）才能开暗杠 / 加杠；碰牌后只能出牌
  const canKong = s.turnDrawn || (s.discards === 0 && seat === s.dealer);
  const gang: HlLegal['gang'] = [];
  if (canKong) {
    const seen = new Set<number>();
    for (const t of p.hand) {
      if (seen.has(t.kind)) continue;
      seen.add(t.kind);
      if (countKind(p.hand, t.kind) >= 4)
        gang.push({ tile: t.id, type: 'an', ci: kongWinsCi(s, p, t.kind, p.melds.length + 1) });
      else if (p.melds.some((m) => m.type === 'pung' && m.kind === t.kind))
        gang.push({ tile: t.id, type: 'ba', ci: kongWinsCi(s, p, t.kind, p.melds.length) });
    }
  }
  // 屁次：手里有三张次牌即可，其余手牌不论
  const pici = countKind(p.hand, s.ciKind) >= 3;
  const hu =
    s.options.mode === 'soft' && s.turnDrawn && isHlWin(countHlKinds(p.hand), p.melds.length);
  return { ...none, discard: p.hand.map((t) => t.id), gang, pici, hu };
}

export const heluogangci: GameDefinition<HlState, HlAction, HlView, HlOptions> = {
  meta: {
    id: 'heluogangci',
    category: 'mahjong',
    name: '河洛杠次',
    nameEn: 'Heluo Gangci',
    tagline: '136 张，靠杠出次',
    minPlayers: 4,
    maxPlayers: 4,
    defaultPlayers: 4,
    rules: [
      '136 张、无花牌，4 人，带字牌，不能吃，只能碰和杠。',
      '牌墙尾端最后一摞上面的一张亮出为次牌，不能摸走。',
      '开杠后拿次牌试胡（次），组不成则从次牌下一张补牌。',
      '明次：出杠牌的人 -2，另外两家各 -1，赢家 +4；加杠出的次算明次，-2 由当初碰的出牌人出。',
      '暗次 / 屁次：每家 -2，赢家 +6。',
      '屁次：手里有三张与次牌相同的牌即可屁次，其余手牌是什么都算。',
      '软次可自摸：每家 -0.5，赢家 +1.5；硬次只能次。',
      '杠分：明杠点杠者付 0.5；加杠由当初被碰的那家付 0.5；暗杠三家各付 0.5。',
      '包次：牌墙剩 5 墩（10 张）起，打出生张被别人明杠直接杠出次，放张者 -4，赢家 +4；暗次、加杠次不算包次。',
      '胡牌者下一盘坐庄；荒庄不换庄，杠分作废；触发次的那一杠不另算杠分。',
    ],
  },
  defaultOptions: { mode: 'soft', baoCi: true, baoThreshold: 10, rounds: 4 },
  optionFields: [
    {
      key: 'mode',
      label: '次模式',
      type: 'select',
      choices: [
        { value: 'soft', label: '软次（可自摸）' },
        { value: 'hard', label: '硬次（只能次）' },
      ],
    },
    { key: 'baoCi', label: '包次', type: 'toggle' },
    {
      key: 'rounds',
      label: '盘数',
      type: 'select',
      choices: [
        { value: 1, label: '1 盘' },
        { value: 4, label: '4 盘' },
        { value: 8, label: '8 盘' },
        { value: 0, label: '不限' },
      ],
    },
  ],

  setup({ options, seed }) {
    const opts: HlOptions = {
      mode: options?.mode === 'hard' ? 'hard' : 'soft',
      baoCi: options?.baoCi !== false,
      baoThreshold: Number.isFinite(options?.baoThreshold) ? options.baoThreshold : 10,
      rounds: Number.isFinite(options?.rounds) ? Math.max(0, Math.floor(options.rounds)) : 4,
    };
    const s: HlState = {
      options: opts,
      rng: seed >>> 0,
      round: 1,
      phase: 'play',
      dealer: 0,
      wall: [],
      ciTile: null,
      ciKind: 0,
      players: [],
      turn: 0,
      turnDrawn: false,
      drawnThisTurn: null,
      window: null,
      lastDiscard: null,
      discards: 0,
      gangDeltas: [0, 0, 0, 0],
      gangLedger: [],
      scores: [0, 0, 0, 0],
      ready: [false, false, false, false],
      result: null,
      history: [],
      events: [],
      eventSeq: 0,
    };
    deal(s);
    return s;
  },

  activeSeats(s) {
    if (s.phase === 'roundOver') return [0, 1, 2, 3].filter((i) => !s.ready[i]);
    if (s.phase === 'matchOver') return [];
    if (s.window)
      return [0, 1, 2, 3].filter((i) => s.window!.required[i] && s.window!.decisions[i] === null);
    return [s.turn];
  },

  validate(s, seat, action) {
    if (!action || typeof action !== 'object') return '未知操作';
    const L = legalOf(s, seat);
    switch (action.type) {
      case 'ready':
        return L.ready ? null : '本盘尚未结束';
      case 'discard':
        return L.discard.includes(action.tile) ? null : '不能打这张牌';
      case 'gang':
        if (s.window) return L.gang.length ? null : '不能杠';
        return L.gang.some((g) => g.tile === action.tile) ? null : '不能杠';
      case 'peng':
        return L.peng ? null : '不能碰';
      case 'pass':
        return L.pass ? null : '现在不能过';
      case 'pici':
        return L.pici ? null : '不能屁次';
      case 'hu':
        return L.hu ? null : '还不能胡';
      default:
        return '未知操作';
    }
  },

  apply(prev, seat, action) {
    const s = clone(prev);
    const p = s.players[seat];
    switch (action.type) {
      case 'ready': {
        s.ready[seat] = true;
        if (s.ready.every(Boolean)) {
          if (s.options.rounds > 0 && s.round >= s.options.rounds) s.phase = 'matchOver';
          else {
            s.dealer = s.result!.nextDealer;
            s.round++;
            deal(s);
          }
        }
        return s;
      }
      case 'discard': {
        const tile = p.hand.find((t) => t.id === action.tile)!;
        const baoFresh = inBaoZone(s) && isFresh(s, tile.kind);
        p.hand = p.hand.filter((t) => t.id !== tile.id);
        p.river.push({ tile });
        s.lastDiscard = { seat, id: tile.id };
        s.discards++;
        s.turnDrawn = false;
        s.drawnThisTurn = null;
        openClaims(s, seat, tile, baoFresh);
        return s;
      }
      case 'peng':
      case 'pass':
      case 'gang': {
        if (s.window) {
          s.window.decisions[seat] = { type: action.type };
          if (windowDone(s.window)) resolveClaims(s);
          return s;
        }
        // 自己回合：暗杠或加杠
        const tile = p.hand.find((t) => t.id === (action as { tile?: number }).tile)!;
        const kind = tile.kind;
        s.turnDrawn = false;
        s.drawnThisTurn = null;
        const pung = p.melds.find((m) => m.type === 'pung' && m.kind === kind);
        if (pung) {
          p.hand = p.hand.filter((t) => t.id !== tile.id);
          pung.type = 'kong';
          pung.kongType = 'ba';
          pung.tiles = [...pung.tiles, tile];
          afterKong(s, seat, 'ba', pung.pengFrom, null);
          return s;
        }
        const four = p.hand.filter((t) => t.kind === kind);
        p.hand = p.hand.filter((t) => t.kind !== kind);
        p.melds.push({
          type: 'kong',
          kongType: 'an',
          kind,
          tiles: four,
          from: null,
          pengFrom: null,
        });
        afterKong(s, seat, 'an', null, null);
        return s;
      }
      case 'pici':
        finishWin(s, seat, 'pici', null, null, null);
        return s;
      case 'hu': {
        const tile =
          p.hand.find((t) => t.id === s.drawnThisTurn) ?? p.hand[p.hand.length - 1] ?? null;
        finishWin(s, seat, 'zimo', tile, null, null);
        return s;
      }
    }
    return s;
  },

  view(s, seat) {
    const over = s.phase === 'roundOver' || s.phase === 'matchOver';
    const w = s.window;
    const me = seat === null ? null : s.players[seat];
    return {
      seat,
      phase: s.phase,
      round: s.round,
      options: s.options,
      dealer: s.dealer,
      ciTile: s.ciTile,
      ciKind: s.ciKind,
      wallCount: s.wall.length,
      baoActive: inBaoZone(s),
      turn: s.phase === 'play' ? s.turn : null,
      players: s.players.map((p) => ({
        handCount: p.hand.length,
        melds: p.melds,
        river: p.river,
        won: p.won,
        hand: over || p.won ? sortHlTiles(p.hand) : null,
      })),
      hand: me ? sortHlTiles(me.hand) : [],
      drawn: seat !== null && s.turn === seat && !w ? s.drawnThisTurn : null,
      legal: seat === null ? null : legalOf(s, seat),
      window: w && seat !== null && w.required[seat] ? { source: w.source, tile: w.tile } : null,
      lastDiscard: s.lastDiscard,
      scores: s.scores,
      roundDeltas: s.result ? s.result.deltas : [0, 0, 0, 0],
      result: s.result,
      ready: s.ready,
      events: s.events,
      history: s.history,
    };
  },

  isOver: (s) => s.phase === 'matchOver',

  bot: heluoBot,
  aiPrompt: hlAiPrompt,
};
