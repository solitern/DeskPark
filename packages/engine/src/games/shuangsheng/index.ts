import type { Card } from '../../core/cards';
import { BIG_JOKER, createDeck, pickCards, removeCards } from '../../core/cards';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import { SYSTEM_SEAT } from '../../core/types';
import { ssBot } from './bot';
import type { SsCtx } from './cards';
import { bottomMultiplier, cardPoints, decompose, sortSs, sumPoints, upgradeFor } from './cards';
import type { DeclOption, Declaration } from './declare';
import { canOverride, initialOptions, overrideOptions, parseDeclaration } from './declare';
import type { TrickPlay } from './play';
import { followError, leadError, throwFailure, trickWinnerIndex } from './play';
import { ssAiPrompt } from './ai';

export * from './cards';
export * from './declare';
export * from './play';
export { buildFollow, ssBot } from './bot';

export interface SsOptions {
  /** 起始级牌（规则为从 2 打起） */
  startLevel: number;
}

export type SsAction =
  // 系统动作（SYSTEM_SEAT）
  | { type: 'deal' }
  | { type: 'dealt' }
  | { type: 'flip' }
  | { type: 'collect' }
  // 玩家动作
  | { type: 'declare'; cards: number[] }
  | { type: 'pass' }
  | { type: 'bury'; cards: number[] }
  | { type: 'play'; cards: number[] }
  | { type: 'ready' };

export type SsPhase =
  'deal' | 'declare' | 'flip' | 'bury' | 'fan' | 'play' | 'trickEnd' | 'roundOver' | 'matchOver';

export interface SsTrick {
  leader: Seat;
  plays: TrickPlay[];
  /** 本墩赢家（四家出完后才有） */
  winner: Seat | null;
  points: number;
}

export interface SsThrowFail {
  seat: Seat;
  tried: Card[];
  played: Card[];
}

export interface SsRoundResult {
  round: number;
  level: number;
  dealer: Seat;
  dealerTeam: 0 | 1;
  /** 闲家总得分（含抠底） */
  defenderPoints: number;
  /** 底牌分与倍数；scored 表示闲家抠底成功 */
  bottom: Card[];
  bottomPoints: number;
  multiplier: number;
  scored: boolean;
  side: 'dealer' | 'defender';
  up: number;
  levelsBefore: [number, number];
  levelsAfter: [number, number];
  matchWon: boolean;
}

export interface SsState {
  options: SsOptions;
  rng: number;
  round: number;
  phase: SsPhase;
  levels: [number, number];
  /** 本局打的级 */
  level: number;
  /** 庄方 */
  dealerTeam: 0 | 1;
  /** 本局庄方亮主的先后顺序（第一局为 [0, 2]） */
  order: Seat[];
  dealer: Seat | null;
  decl: Declaration | null;
  hands: Card[][];
  deck: Card[];
  dealNext: Seat;
  bottom: Card[];
  /** 发牌中「不亮」过的亮法（出现新的可亮情况才会再问） */
  waived: string[][];
  queue: Seat[];
  burier: Seat | null;
  /** 扣底者拿到的底牌 id（界面高亮用） */
  fromBottom: number[];
  flipped: Card[];
  trick: SsTrick | null;
  lastTrick: SsTrick | null;
  turn: Seat;
  throwFail: SsThrowFail | null;
  /** 闲家得分 */
  points: number;
  scoreCards: Card[];
  played: Card[];
  ready: boolean[];
  result: SsRoundResult | null;
  history: SsRoundResult[];
  winnerTeam: 0 | 1 | null;
}

export interface SsView {
  seat: Seat | null;
  phase: SsPhase;
  round: number;
  options: SsOptions;
  levels: [number, number];
  level: number;
  dealerTeam: 0 | 1;
  dealer: Seat | null;
  decl: Declaration | null;
  /** 是否已经定主 */
  trumpKnown: boolean;
  hand: Card[];
  handCounts: number[];
  dealt: number;
  /** 该座位当前可用的亮主 / 反主方式 */
  declOptions: DeclOption[];
  /** 正在等待谁（亮主 / 反主 / 扣底 / 出牌） */
  waiting: Seat | null;
  burier: Seat | null;
  fromBottom: number[];
  /** 底牌：扣底者本人或本局结束后可见 */
  bottom: Card[] | null;
  flipped: Card[];
  trick: SsTrick | null;
  /** 当前一墩暂时最大的座位 */
  winning: Seat | null;
  lastTrick: SsTrick | null;
  throwFail: SsThrowFail | null;
  points: number;
  scoreCards: Card[];
  played: Card[];
  ready: boolean[];
  result: SsRoundResult | null;
  revealed: Card[][] | null;
  history: SsRoundResult[];
  winnerTeam: 0 | 1 | null;
}

const N = 4;
const DEAL_COUNT = 100;
const BOTTOM = 8;
export const teamOf = (s: Seat): 0 | 1 => (s % 2) as 0 | 1;
export const partnerOf = (s: Seat): Seat => (s + 2) % N;
export const LEVEL_LABEL = (lv: number) =>
  (({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }) as Record<number, string>)[lv] ?? String(lv);

export const ctxOf = (s: { level: number; decl: Declaration | null }): SsCtx => ({
  level: s.level,
  trump: s.decl ? s.decl.suit : null,
});

const isSeat = (s: Seat) => Number.isInteger(s) && s >= 0 && s < N;
const isIdList = (x: unknown): x is number[] =>
  Array.isArray(x) && x.length <= 40 && x.every((v) => Number.isInteger(v));

/** 发牌中可亮的选项「指纹」：手里该花色张数变化后才会再次询问 */
function dealKeys(state: SsState, seat: Seat): string[] {
  const hand = state.hands[seat];
  return initialOptions(hand, state.level).map(
    (o) => `${o.suit}${o.strength}:${hand.filter((c) => c.suit === o.suit).length}`,
  );
}

const canDeclareInDeal = (state: SsState) =>
  state.phase === 'deal' && state.round === 1 && !state.decl;

function seatOptions(state: SsState, seat: Seat): DeclOption[] {
  if (!isSeat(seat)) return [];
  const hand = state.hands[seat];
  if (canDeclareInDeal(state)) return initialOptions(hand, state.level);
  if (state.phase === 'declare' && state.queue[0] === seat)
    return initialOptions(hand, state.levels[teamOf(seat)]);
  if (state.phase === 'fan' && state.queue[0] === seat && state.decl)
    return overrideOptions(hand, state.level, state.decl, seat);
  return [];
}

function startRound(state: SsState): void {
  const rng = new Rng(state.rng);
  const deck = rng.shuffle(createDeck(2, true));
  state.rng = rng.state;
  state.deck = deck.slice(0, DEAL_COUNT);
  state.bottom = deck.slice(DEAL_COUNT);
  state.hands = [[], [], [], []];
  state.dealNext = state.order[0];
  state.level = state.levels[state.dealerTeam];
  state.dealer = null;
  state.decl = null;
  state.waived = [[], [], [], []];
  state.queue = [];
  state.burier = null;
  state.fromBottom = [];
  state.flipped = [];
  state.trick = null;
  state.lastTrick = null;
  state.turn = state.order[0];
  state.throwFail = null;
  state.points = 0;
  state.scoreCards = [];
  state.played = [];
  state.ready = [false, false, false, false];
  state.result = null;
  state.phase = 'deal';
}

function startBury(state: SsState, seat: Seat): void {
  state.fromBottom = state.bottom.map((c) => c.id);
  state.hands[seat] = [...state.hands[seat], ...state.bottom];
  state.bottom = [];
  state.burier = seat;
  state.queue = [];
  state.phase = 'bury';
}

function finishDeal(state: SsState): void {
  if (state.decl) {
    state.dealer = state.decl.seat;
    state.dealerTeam = teamOf(state.decl.seat);
    startBury(state, state.decl.seat);
    return;
  }
  if (state.round === 1) {
    state.phase = 'flip';
    return;
  }
  const first = state.order[0];
  state.queue = [...state.order, (first + 1) % N, (first + 3) % N];
  state.phase = 'declare';
  pruneQueue(state);
  if (!state.queue.length) state.phase = 'flip';
}

/** 去掉队首没有可用亮法 / 反法的座位 */
function pruneQueue(state: SsState): void {
  while (state.queue.length && seatOptions(state, state.queue[0]).length === 0) state.queue.shift();
}

function startFan(state: SsState): void {
  const b = state.burier!;
  state.queue = [1, 2, 3, 4].map((d) => (b + d) % N);
  state.phase = 'fan';
  pruneQueue(state);
  if (!state.queue.length) startPlay(state);
}

function startPlay(state: SsState): void {
  state.phase = 'play';
  state.queue = [];
  state.turn = state.dealer!;
  state.trick = { leader: state.dealer!, plays: [], winner: null, points: 0 };
  state.throwFail = null;
}

function flipOne(state: SsState): void {
  const c = state.bottom[state.flipped.length];
  state.flipped.push(c);
  const holder = [0, 1, 2, 3].find((s) =>
    state.hands[s].some((x) => x.suit === c.suit && x.rank === c.rank),
  );
  if (holder !== undefined) {
    const joker = c.suit === 'J';
    state.decl = {
      seat: holder,
      suit: joker ? null : c.suit,
      strength: joker ? (c.rank === BIG_JOKER ? 4 : 3) : 1,
      cards: [c],
      flip: true,
    };
    setDealer(state, holder);
    return;
  }
  if (state.flipped.length >= BOTTOM) {
    // 底牌全部翻完仍没定出：第一局由 0 号座位、之后由庄方第一顺位坐庄，打无主（只有双大王可反）
    const seat = state.round === 1 ? 0 : state.order[0];
    state.decl = { seat, suit: null, strength: 3, cards: [], flip: true, fallback: true };
    setDealer(state, seat);
  }
}

function setDealer(state: SsState, seat: Seat): void {
  state.dealer = seat;
  state.dealerTeam = teamOf(seat);
  state.level = state.levels[state.dealerTeam];
  startBury(state, seat);
}

function finishRound(state: SsState, last: SsTrick): void {
  const ctx = ctxOf(state);
  const dealerTeam = state.dealerTeam;
  const scored = teamOf(last.winner!) !== dealerTeam;
  const multiplier = bottomMultiplier(decompose(last.plays[0].cards, ctx));
  const bottomPoints = sumPoints(state.bottom);
  if (scored && bottomPoints > 0) {
    state.points += bottomPoints * multiplier;
    state.scoreCards.push(...state.bottom.filter((c) => cardPoints(c) > 0));
  }
  const { side, up } = upgradeFor(state.points);
  const before: [number, number] = [...state.levels];
  const matchWon = side === 'dealer' && state.level === 14;
  const upTeam = side === 'dealer' ? dealerTeam : ((1 - dealerTeam) as 0 | 1);
  if (!matchWon) state.levels[upTeam] = Math.min(14, state.levels[upTeam] + up);
  const dealer = state.dealer!;
  const result: SsRoundResult = {
    round: state.round,
    level: state.level,
    dealer,
    dealerTeam,
    defenderPoints: state.points,
    bottom: [...state.bottom],
    bottomPoints,
    multiplier,
    scored,
    side,
    up: matchWon ? 0 : up,
    levelsBefore: before,
    levelsAfter: [...state.levels],
    matchWon,
  };
  state.result = result;
  state.history.push(result);
  // 下一局的庄方与亮主顺序
  if (side === 'dealer') state.order = [dealer, partnerOf(dealer)];
  else state.order = [(dealer + 1) % N, (dealer + 3) % N];
  state.ready = [false, false, false, false];
  if (matchWon) {
    state.winnerTeam = dealerTeam;
    state.phase = 'matchOver';
  } else {
    state.phase = 'roundOver';
  }
}

/**
 * apply 用的拷贝：状态里的牌对象、历史结果、上一墩等一旦生成就不再修改，可以共享；
 * 只复制本次可能被改动的数组与对象（比整份 JSON 深拷贝快得多，长对局的历史不会拖慢每一步）。
 */
function copyState(s: SsState): SsState {
  return {
    ...s,
    levels: [...s.levels],
    order: [...s.order],
    hands: s.hands.map((h) => [...h]),
    deck: [...s.deck],
    bottom: [...s.bottom],
    waived: s.waived.map((w) => [...w]),
    queue: [...s.queue],
    fromBottom: [...s.fromBottom],
    flipped: [...s.flipped],
    trick: s.trick ? { ...s.trick, plays: [...s.trick.plays] } : null,
    scoreCards: [...s.scoreCards],
    played: [...s.played],
    ready: [...s.ready],
    history: [...s.history],
  };
}

export const shuangsheng: GameDefinition<SsState, SsAction, SsView, SsOptions> = {
  meta: {
    id: 'shuangsheng',
    category: 'poker',
    name: '双升',
    nameEn: 'Shuangsheng',
    tagline: '两副牌四人对家，亮主抠底，打过 A 者胜',
    minPlayers: 4,
    maxPlayers: 4,
    defaultPlayers: 4,
    botDelayMs: [600, 1100],
    rules: [
      '两副牌共 108 张，四人对家组队（你与上方玩家一队），每人 25 张，底牌 8 张。双方都从 2 打起，打到 A 并守住为胜。',
      '分牌：5 为 5 分，10 和 K 为 10 分，共 200 分；只有闲家（非庄方）拿到的分才计入。',
      '主牌从大到小：大王、小王、主花色级牌、其他花色级牌、主花色 A…2（跳过级牌）。无主时只有王和级牌是主。副牌 A 最大，不同副牌花色之间不比大小，同样大的牌先出者大。',
      '亮主：级牌 + 同色王（♠♣ 配小王，♥♦ 配大王）。王 + 单张级牌为弱主，王 + 一对级牌为强主；对王不能直接亮无主，亮了之后不能自己加固。',
      '第一局边发牌边亮，先亮者坐庄；之后各局发完牌后由庄方两人先亮（谁亮谁坐庄），庄方亮不起则对手亮并打自己的级、成为庄方；都亮不起就翻底。',
      '翻底：依次翻开底牌，翻出的花色为主（翻到王为无主），该牌另一张在谁手里谁坐庄；另一张也在底里就继续翻。翻到数字为弱主，翻到小王为小无主（只能被双大王反），翻到大王为大无主（不能反）。8 张翻完仍未定主：第一局 0 号座位、之后庄方首位坐庄，打无主（同小无主）。',
      '庄家拿底扣 8 张后进入反主：从庄家下家起每人一次机会，有人反成功就从反主者下家重新轮一圈，一圈无人反即开打。弱主可被同色王 + 一对级牌（换花色）或双王（无主）反；强主只能被双王反；双小王只能被双大王反；双大王不能反；无主后不能反回花色。反主者拿底重扣，庄家不变。',
      '出牌：单张、对子（完全相同的两张）、拖拉机（同门相邻对子，跳过级牌；主牌可跨层：对大王—对小王—对主级牌—对副级牌—对主 A，无主时对大王—对小王—对级牌）。允许甩牌：同门里每一组都没有任何一家能管上才成功，失败则强制出其中最小的一组，不罚分。',
      '跟牌：有该门必须跟该门，按领出的牌型尽量跟拖拉机、对子，不够用同门补，再不够垫其他牌。没有该门可以用主牌毙，牌型完全一致才算毙上；多家毙牌比最大的一组。庄家先出，每墩最大者下一墩先出。',
      '抠底：最后一墩闲家赢，底牌分翻倍计入闲家：单张 ×2、对子 ×4、n 连对 ×2^(n+1)，甩牌按其中最大的牌型。庄方赢最后一墩则底分不计。',
      '升级：闲家 0 分庄方升 3 级；5–35 分升 2 级；40–75 分升 1 级；80–115 分闲家上台不升级；120–155 分闲家上台并升 1 级，之后每多 40 分再升 1 级。升级最多到 A，A 必须实打；庄方打 A 守住（闲家不到 80 分）即赢得整场。',
    ],
  },
  defaultOptions: { startLevel: 2 },
  optionFields: [
    {
      key: 'startLevel',
      label: '起始级牌',
      hint: '规则从 2 打起；从更高的级数开始，对局更快结束',
      type: 'select',
      choices: [
        { value: 2, label: '从 2 打起' },
        { value: 8, label: '从 8 打起' },
        { value: 12, label: '从 Q 打起' },
      ],
    },
  ],

  setup({ options, seed }) {
    const raw = Number(options?.startLevel);
    const start = Number.isInteger(raw) ? Math.min(14, Math.max(2, raw)) : 2;
    const state: SsState = {
      options: { startLevel: start },
      rng: seed >>> 0,
      round: 1,
      phase: 'deal',
      levels: [start, start],
      level: start,
      dealerTeam: 0,
      order: [0, 2],
      dealer: null,
      decl: null,
      hands: [[], [], [], []],
      deck: [],
      dealNext: 0,
      bottom: [],
      waived: [[], [], [], []],
      queue: [],
      burier: null,
      fromBottom: [],
      flipped: [],
      trick: null,
      lastTrick: null,
      turn: 0,
      throwFail: null,
      points: 0,
      scoreCards: [],
      played: [],
      ready: [false, false, false, false],
      result: null,
      history: [],
      winnerTeam: null,
    };
    startRound(state);
    return state;
  },

  activeSeats(state) {
    switch (state.phase) {
      case 'deal':
        if (!canDeclareInDeal(state)) return [];
        return [0, 1, 2, 3].filter((s) =>
          dealKeys(state, s).some((k) => !state.waived[s].includes(k)),
        );
      case 'declare':
      case 'fan':
        return state.queue.length ? [state.queue[0]] : [];
      case 'bury':
        return state.burier === null ? [] : [state.burier];
      case 'play':
        return [state.turn];
      case 'roundOver':
        return [0, 1, 2, 3].filter((s) => !state.ready[s]);
      default:
        return [];
    }
  },

  validate(state, seat, action) {
    const system = seat === SYSTEM_SEAT;
    switch (action.type) {
      case 'deal':
        if (!system) return '无效操作';
        return state.phase === 'deal' && state.deck.length > 0 ? null : '现在不能发牌';
      case 'dealt':
        if (!system) return '无效操作';
        return state.phase === 'deal' && state.deck.length === 0 ? null : '还没发完牌';
      case 'flip':
        if (!system) return '无效操作';
        return state.phase === 'flip' && state.flipped.length < BOTTOM ? null : '现在不能翻底';
      case 'collect':
        if (!system) return '无效操作';
        return state.phase === 'trickEnd' ? null : '现在不能收牌';
    }
    if (!isSeat(seat)) return '无效操作';
    switch (action.type) {
      case 'declare': {
        if (!isIdList(action.cards)) return '请选择要亮的牌';
        const cards = pickCards(state.hands[seat], action.cards);
        if (!cards) return '请选择要亮的牌';
        if (canDeclareInDeal(state) || (state.phase === 'declare' && state.queue[0] === seat)) {
          const level = state.phase === 'declare' ? state.levels[teamOf(seat)] : state.level;
          const opt = parseDeclaration(cards, level);
          if (!opt) return '亮主须是级牌 + 同色王（♠♣ 配小王，♥♦ 配大王）';
          if (opt.strength > 2) return '对王不能直接亮无主';
          return null;
        }
        if (state.phase === 'fan' && state.queue[0] === seat && state.decl) {
          const opt = parseDeclaration(cards, state.level);
          if (!opt) return '反主须是同色王 + 一对级牌，或一对王';
          if (!canOverride(state.decl, opt, seat)) return '这样反不了当前的主';
          return null;
        }
        return '现在不能亮主';
      }
      case 'pass':
        if (canDeclareInDeal(state)) return null;
        if ((state.phase === 'declare' || state.phase === 'fan') && state.queue[0] === seat)
          return null;
        return '现在不能操作';
      case 'bury': {
        if (state.phase !== 'bury' || state.burier !== seat) return '现在不需要扣底';
        if (!isIdList(action.cards) || action.cards.length !== BOTTOM)
          return `请选择 ${BOTTOM} 张牌扣底`;
        if (!pickCards(state.hands[seat], action.cards)) return `请选择 ${BOTTOM} 张牌扣底`;
        return null;
      }
      case 'play': {
        if (state.phase !== 'play' || state.turn !== seat || !state.trick) return '还没轮到你出牌';
        if (!isIdList(action.cards)) return '请选择要出的牌';
        const cards = pickCards(state.hands[seat], action.cards);
        if (!cards || !cards.length) return '请选择要出的牌';
        const ctx = ctxOf(state);
        const lead = state.trick.plays[0];
        if (!lead) return leadError(cards, ctx);
        return followError(state.hands[seat], lead.cards, cards, ctx);
      }
      case 'ready':
        if (state.phase !== 'roundOver') return '本局尚未结束';
        return state.ready[seat] ? '已经准备' : null;
      default:
        return '未知操作';
    }
  },

  apply(prev, seat, action) {
    const state = copyState(prev);
    switch (action.type) {
      case 'deal': {
        // 第一局边发边亮，一次一张；之后各局发完才亮，一次发一圈（每人一张）
        const count = canDeclareInDeal(state) ? 1 : N;
        for (let i = 0; i < count && state.deck.length; i++) {
          state.hands[state.dealNext].push(state.deck.shift()!);
          state.dealNext = (state.dealNext + 1) % N;
        }
        break;
      }
      case 'dealt':
        finishDeal(state);
        break;
      case 'flip':
        flipOne(state);
        break;
      case 'declare': {
        const cards = pickCards(state.hands[seat], action.cards)!;
        if (state.phase === 'deal') {
          const opt = parseDeclaration(cards, state.level)!;
          state.decl = { seat, suit: opt.suit, strength: opt.strength, cards };
          state.dealerTeam = teamOf(seat);
        } else if (state.phase === 'declare') {
          const opt = parseDeclaration(cards, state.levels[teamOf(seat)])!;
          state.decl = { seat, suit: opt.suit, strength: opt.strength, cards };
          setDealer(state, seat);
        } else {
          const opt = parseDeclaration(cards, state.level)!;
          state.decl = { seat, suit: opt.suit, strength: opt.strength, cards };
          startBury(state, seat);
        }
        break;
      }
      case 'pass': {
        if (state.phase === 'deal') {
          state.waived[seat] = [...new Set([...state.waived[seat], ...dealKeys(state, seat)])];
        } else if (state.phase === 'declare') {
          state.queue.shift();
          pruneQueue(state);
          if (!state.queue.length) state.phase = 'flip';
        } else {
          state.queue.shift();
          pruneQueue(state);
          if (!state.queue.length) startPlay(state);
        }
        break;
      }
      case 'bury': {
        const cards = pickCards(state.hands[seat], action.cards)!;
        state.hands[seat] = removeCards(state.hands[seat], action.cards)!;
        state.bottom = cards;
        state.fromBottom = [];
        startFan(state);
        break;
      }
      case 'play': {
        const ctx = ctxOf(state);
        const trick = state.trick!;
        let cards = pickCards(state.hands[seat], action.cards)!;
        if (trick.plays.length === 0) {
          state.throwFail = null;
          const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => state.hands[s]);
          const fail = throwFailure(cards, others, ctx);
          if (fail) {
            state.throwFail = { seat, tried: sortSs(cards, ctx), played: fail.cards };
            cards = fail.cards;
          }
        }
        const sorted = sortSs(cards, ctx);
        state.hands[seat] = removeCards(
          state.hands[seat],
          cards.map((c) => c.id),
        )!;
        trick.plays.push({ seat, cards: sorted });
        state.played.push(...sorted);
        if (trick.plays.length === N) {
          trick.winner = trick.plays[trickWinnerIndex(trick.plays, ctx)].seat;
          trick.points = sumPoints(trick.plays.flatMap((p) => p.cards));
          state.phase = 'trickEnd';
        } else {
          state.turn = (seat + 1) % N;
        }
        break;
      }
      case 'collect': {
        const trick = state.trick!;
        const winner = trick.winner!;
        if (teamOf(winner) !== state.dealerTeam) {
          state.points += trick.points;
          state.scoreCards.push(
            ...trick.plays.flatMap((p) => p.cards).filter((c) => cardPoints(c) > 0),
          );
        }
        state.lastTrick = trick;
        state.throwFail = null;
        if (state.hands.every((h) => h.length === 0)) {
          state.trick = null;
          finishRound(state, trick);
        } else {
          state.trick = { leader: winner, plays: [], winner: null, points: 0 };
          state.turn = winner;
          state.phase = 'play';
        }
        break;
      }
      case 'ready': {
        state.ready[seat] = true;
        if (state.ready.every(Boolean)) {
          state.round++;
          state.dealerTeam = teamOf(state.order[0]);
          startRound(state);
        }
        break;
      }
    }
    return state;
  },

  view(state, seat) {
    const over = state.phase === 'roundOver' || state.phase === 'matchOver';
    const ctx = ctxOf(state);
    const mine = seat !== null && isSeat(seat);
    const trick = state.trick;
    let winning: Seat | null = null;
    if (trick && trick.plays.length) winning = trick.plays[trickWinnerIndex(trick.plays, ctx)].seat;
    const waiting =
      state.phase === 'declare' || state.phase === 'fan'
        ? (state.queue[0] ?? null)
        : state.phase === 'bury'
          ? state.burier
          : state.phase === 'play'
            ? state.turn
            : null;
    const showBottom =
      over ||
      (mine &&
        seat === state.burier &&
        (state.phase === 'fan' || state.phase === 'play' || state.phase === 'trickEnd'));
    return {
      seat,
      phase: state.phase,
      round: state.round,
      options: state.options,
      levels: state.levels,
      level: state.level,
      dealerTeam: state.dealerTeam,
      dealer: state.dealer,
      decl: state.decl,
      trumpKnown: !!state.decl,
      hand: mine ? sortSs(state.hands[seat], ctx) : [],
      handCounts: state.hands.map((h) => h.length),
      dealt: DEAL_COUNT - state.deck.length,
      // 发牌中「不亮」过的情况不再提示，直到手里出现新的可亮情况
      declOptions:
        mine &&
        !(
          canDeclareInDeal(state) &&
          dealKeys(state, seat).every((k) => state.waived[seat].includes(k))
        )
          ? seatOptions(state, seat)
          : [],
      waiting,
      burier: state.burier,
      fromBottom: mine && seat === state.burier ? state.fromBottom : [],
      bottom: showBottom ? state.bottom : null,
      flipped: state.flipped,
      trick,
      winning,
      lastTrick: state.lastTrick,
      throwFail: state.throwFail,
      points: state.points,
      scoreCards: state.scoreCards,
      played: state.played,
      ready: state.ready,
      result: state.result,
      revealed: over ? state.hands : null,
      history: state.history,
      winnerTeam: state.winnerTeam,
    };
  },

  isOver(state) {
    return state.phase === 'matchOver';
  },

  autoAdvance(state) {
    switch (state.phase) {
      case 'deal':
        if (state.deck.length > 0)
          return { delayMs: canDeclareInDeal(state) ? 70 : 140, action: { type: 'deal' } };
        return { delayMs: canDeclareInDeal(state) ? 1500 : 600, action: { type: 'dealt' } };
      case 'flip':
        return { delayMs: 900, action: { type: 'flip' } };
      case 'trickEnd':
        return { delayMs: 1100, action: { type: 'collect' } };
      default:
        return null;
    }
  },

  bot: ssBot,
  aiPrompt: ssAiPrompt,
};
