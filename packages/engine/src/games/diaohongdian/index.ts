import type { Card } from '../../core/cards';
import { createDeck, sortCards } from '../../core/cards';
import { clone } from '../../core/clone';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import { SYSTEM_SEAT } from '../../core/types';
import { dhAiPrompt } from './ai';
import { dhBot } from './bot';
import type { DhOptions } from './scoring';
import {
  RED_FIVE_BONUS,
  cardPoints,
  isRedCardSuit,
  isRedFive,
  pairs,
  partners,
  pilePoints,
  redFivePairs,
} from './scoring';

/**
 * 潮汕钓红点（捡红点）—— 52 张扑克，家常版规则。
 *
 * 每人轮流：出一张手牌去"钓"台面上能配对的牌（配不上就留在台面），然后必须翻一张底牌，
 * 翻出来的牌能配就直接钓走。只有红桃 / 方块计分，黑桃梅花 0 分。
 */

export type DhPhase = 'play' | 'pick' | 'flip' | 'roundEnd' | 'matchOver';

export type DhAction =
  | { type: 'play'; card: number }
  | { type: 'pick'; target: number }
  | { type: 'flip' }
  | { type: 'next' };

export interface DhPending {
  card: Card;
  matches: Card[];
  /** 这次配对是出牌造成的，还是翻底牌造成的 */
  from: 'play' | 'flip';
}

export interface DhLast {
  seat: Seat;
  played: Card | null;
  captured: Card[];
  flipped: Card | null;
}

export interface DhRoundResult {
  gains: number[];
  leftover: Card[];
  lastCatcher: Seat | null;
}

export interface DhState {
  options: DhOptions;
  rng: number;
  round: number;
  phase: DhPhase;
  turn: Seat;
  hands: Card[][];
  table: Card[];
  stock: Card[];
  piles: Card[][];
  /** 本局钓到的红 5 对子数 */
  bonus: number[];
  /** 累计总分 */
  scores: number[];
  /** 本局得分（含房规奖励） */
  roundScores: number[];
  pending: DhPending | null;
  last: DhLast | null;
  lastRound: DhRoundResult | null;
  lastCatcher: Seat | null;
}

export interface DhView {
  seat: Seat | null;
  phase: DhPhase;
  round: number;
  options: DhOptions;
  turn: Seat;
  hand: Card[];
  handCounts: number[];
  table: Card[];
  stockCount: number;
  piles: Card[][];
  pileScores: number[];
  /** 本局已钓到的红 5 对子数 */
  bonus: number[];
  scores: number[];
  roundScores: number[];
  pending: DhPending | null;
  last: DhLast | null;
  lastRound: DhRoundResult | null;
}

/** 各人数的发牌：手牌 / 台面明牌 / 底牌，三部分加起来正好 52 张 */
const DEALS: Record<number, { hand: number; table: number; stock: number }> = {
  2: { hand: 10, table: 12, stock: 20 },
  3: { hand: 7, table: 10, stock: 21 },
  4: { hand: 5, table: 8, stock: 24 },
};

const dealOf = (n: number) => DEALS[n] ?? DEALS[4];

const byRank = (c: Card) => c.rank;

function deal(state: DhState): void {
  const players = state.hands.length;
  const spec = dealOf(players);
  const rng = new Rng(state.rng);
  const deck = rng.shuffle(createDeck(1, false));
  state.rng = rng.state;
  state.hands = state.hands.map(() => []);
  let i = 0;
  for (let k = 0; k < spec.hand; k++)
    for (let s = 0; s < players; s++) state.hands[s].push(deck[i++]);
  state.hands = state.hands.map((h) => sortCards(h, byRank));
  state.table = deck.slice(i, i + spec.table);
  i += spec.table;
  state.stock = deck.slice(i, i + spec.stock);
  state.piles = state.hands.map(() => []);
  state.bonus = state.hands.map(() => 0);
  state.roundScores = state.hands.map(() => 0);
  state.phase = 'play';
  state.turn = 0;
  state.pending = null;
  state.last = null;
  state.lastRound = null;
  state.lastCatcher = null;
}

/** 能和这张牌配对的台面牌 */
const matchesOf = (table: readonly Card[], card: Card) =>
  table.filter((t) => pairs(t.rank, card.rank));

/** 收一对牌到某个座位的得分堆；同时记录红 5 对子 */
function capture(state: DhState, seat: Seat, played: Card, target: Card, bonus: boolean): void {
  state.table = state.table.filter((t) => t.id !== target.id);
  state.piles[seat].push(played, target);
  state.lastCatcher = seat;
  if (bonus && played.rank === 5 && target.rank === 5) state.bonus[seat] += 1;
}

/** 出牌 / 翻牌之后：进入翻底牌阶段，没有底牌就直接结算本局 */
function startFlip(state: DhState): void {
  state.pending = null;
  if (state.stock.length > 0) state.phase = 'flip';
  else endTurn(state);
}

/** 轮到下一家；手牌和底牌都空了就结算 */
function endTurn(state: DhState): void {
  const done =
    state.stock.length === 0 && state.hands.every((h) => h.length === 0);
  if (done) {
    finishRound(state);
    return;
  }
  state.turn = (state.turn + 1) % state.hands.length;
  state.phase = 'play';
  state.pending = null;
}

function finishRound(state: DhState): void {
  const { redAce, tableEnd, redFiveBonus } = state.options;
  const gains = state.piles.map(
    (pile, i) =>
      pilePoints(pile, redAce) + (redFiveBonus ? state.bonus[i] * RED_FIVE_BONUS : 0),
  );
  const leftover = state.table;
  if (tableEnd === 'last' && state.lastCatcher !== null) {
    const extra =
      pilePoints(leftover, redAce) + (redFiveBonus ? redFivePairs(leftover) * RED_FIVE_BONUS : 0);
    gains[state.lastCatcher] += extra;
  }
  state.roundScores = gains;
  state.scores = state.scores.map((s, i) => s + gains[i]);
  state.lastRound = { gains, leftover, lastCatcher: state.lastCatcher };
  state.phase = state.round >= state.options.rounds ? 'matchOver' : 'roundEnd';
  state.pending = null;
}

export const diaohongdian: GameDefinition<DhState, DhAction, DhView, DhOptions> = {
  meta: {
    id: 'diaohongdian',
    category: 'poker',
    name: '钓红点',
    nameEn: 'Red Point Fishing',
    tagline: '出牌钓红牌，只有红牌算分 · 潮汕家常玩法',
    minPlayers: 2,
    maxPlayers: 4,
    defaultPlayers: 4,
    botDelayMs: [500, 1100],
    rules: [
      '去掉大小王共 52 张。2 人：每人 10 张、台面 12 张、底牌 20 张；3 人：每人 7 张、台面 10 张、底牌 21 张；4 人：每人 5 张、台面 8 张、底牌 24 张。',
      '配对只看点数和：A+9、2+8、3+7、4+6、5+5；10、J、Q、K 必须同牌才配。花色不影响能否配对。',
      '每轮先出一张手牌：能和台面配上，就把两张收进自己的得分堆；配不上，这张牌就留在台面。',
      '出完手牌后必须翻 1 张底牌：翻出来的牌能配就钓走（台面上有几张可配时由你挑），配不上就留在台面。',
      '只有红桃与方块计分，黑桃梅花 0 分：红 2–8 按牌面分数，红 9、10、J、Q、K 各 10 分，红 A 按开局约定 10 或 20 分。',
      '手牌与底牌全部打完后结算：台面剩下的牌按房规作废或归最后钓牌的人。可选红 5 对子每对额外 +10。',
      '打满设定局数后累计分数最高者获胜。',
    ],
  },
  defaultOptions: { redAce: 10, tableEnd: 'void', redFiveBonus: false, rounds: 3 },
  optionFields: [
    {
      key: 'redAce',
      label: '红 A 分值',
      hint: '开局前和牌友说好，红桃 A 与方块 A 各算多少分',
      type: 'select',
      choices: [
        { value: 10, label: '10 分' },
        { value: 20, label: '20 分' },
      ],
    },
    {
      key: 'tableEnd',
      label: '残局',
      hint: '牌打完后台面剩下的牌怎么处理',
      type: 'select',
      choices: [
        { value: 'void', label: '作废' },
        { value: 'last', label: '归最后钓牌的人' },
      ],
    },
    {
      key: 'redFiveBonus',
      label: '红 5 对子',
      hint: '钓到一对红 5 额外加 10 分',
      type: 'toggle',
    },
    {
      key: 'rounds',
      label: '局数',
      type: 'select',
      choices: [
        { value: 1, label: '1 局' },
        { value: 3, label: '3 局' },
        { value: 5, label: '5 局' },
      ],
    },
  ],

  setup({ players, options, seed }) {
    const state: DhState = {
      options: { ...options },
      rng: seed >>> 0,
      round: 1,
      phase: 'play',
      turn: 0,
      hands: players.map(() => []),
      table: [],
      stock: [],
      piles: players.map(() => []),
      bonus: players.map(() => 0),
      scores: players.map(() => 0),
      roundScores: players.map(() => 0),
      pending: null,
      last: null,
      lastRound: null,
      lastCatcher: null,
    };
    deal(state);
    return state;
  },

  activeSeats(state) {
    if (state.phase === 'play' || state.phase === 'pick' || state.phase === 'flip')
      return [state.turn];
    return [];
  },

  validate(state, seat, action) {
    if (action.type === 'next')
      return seat === SYSTEM_SEAT && state.phase === 'roundEnd' ? null : '无效操作';
    if (state.phase === 'roundEnd' || state.phase === 'matchOver') return '本局已结束';
    if (seat !== state.turn) return '还没轮到你';
    if (action.type === 'play') {
      if (state.phase !== 'play') return '现在不能出牌';
      if (!state.hands[seat].some((c) => c.id === action.card)) return '请选择一张手牌';
      return null;
    }
    if (action.type === 'flip') {
      if (state.stock.length === 0) return '底牌已经翻完了';
      if (state.phase === 'flip') return null;
      // 手牌已经出完时，这一轮就是单纯翻底牌
      return state.phase === 'play' && state.hands[seat].length === 0 ? null : '现在不能翻牌';
    }
    if (action.type === 'pick') {
      if (state.phase !== 'pick' || !state.pending) return '现在不能选择配对';
      return state.pending.matches.some((c) => c.id === action.target) ? null : '请选择台面上能配对的牌';
    }
    return '未知操作';
  },

  apply(prev, seat, action) {
    const state = clone(prev);
    if (action.type === 'next') {
      state.round += 1;
      deal(state);
      return state;
    }
    const me = state.turn;
    if (action.type === 'play') {
      const card = state.hands[me].find((c) => c.id === action.card)!;
      state.hands[me] = state.hands[me].filter((c) => c.id !== card.id);
      const matches = matchesOf(state.table, card);
      state.last = { seat: me, played: card, captured: [], flipped: null };
      if (matches.length === 0) {
        state.table = [...state.table, card];
        startFlip(state);
      } else if (matches.length === 1) {
        capture(state, me, card, matches[0], state.options.redFiveBonus);
        state.last = { seat: me, played: card, captured: [card, matches[0]], flipped: null };
        startFlip(state);
      } else {
        state.phase = 'pick';
        state.pending = { card, matches, from: 'play' };
      }
      return state;
    }
    if (action.type === 'pick') {
      const pending = state.pending!;
      const target = pending.matches.find((c) => c.id === action.target)!;
      capture(state, me, pending.card, target, state.options.redFiveBonus);
      state.last = {
        seat: me,
        played: pending.from === 'play' ? pending.card : null,
        captured: [pending.card, target],
        flipped: pending.from === 'flip' ? pending.card : null,
      };
      if (pending.from === 'play') startFlip(state);
      else endTurn(state);
      return state;
    }
    // flip：翻一张底牌
    const card = state.stock[0];
    state.stock = state.stock.slice(1);
    const matches = matchesOf(state.table, card);
    state.last = { seat: me, played: null, captured: [], flipped: card };
    if (matches.length === 0) {
      state.table = [...state.table, card];
      endTurn(state);
    } else if (matches.length === 1) {
      capture(state, me, card, matches[0], state.options.redFiveBonus);
      state.last = { seat: me, played: null, captured: [card, matches[0]], flipped: card };
      endTurn(state);
    } else {
      state.phase = 'pick';
      state.pending = { card, matches, from: 'flip' };
    }
    return state;
  },

  view(state, seat) {
    const redAce = state.options.redAce;
    const withBonus = (pile: Card[], i: number) =>
      pilePoints(pile, redAce) +
      (state.options.redFiveBonus ? state.bonus[i] * RED_FIVE_BONUS : 0);
    return {
      seat,
      phase: state.phase,
      round: state.round,
      options: state.options,
      turn: state.turn,
      hand: seat === null ? [] : state.hands[seat],
      handCounts: state.hands.map((h) => h.length),
      table: state.table,
      stockCount: state.stock.length,
      piles: state.piles,
      pileScores: state.piles.map(withBonus),
      bonus: state.bonus,
      scores: state.scores,
      roundScores: state.roundScores,
      pending: state.phase === 'pick' ? state.pending : null,
      last: state.last,
      lastRound: state.phase === 'roundEnd' || state.phase === 'matchOver' ? state.lastRound : null,
    };
  },

  isOver: (state) => state.phase === 'matchOver',

  autoAdvance(state) {
    return state.phase === 'roundEnd'
      ? { delayMs: 2600, action: { type: 'next' } }
      : null;
  },

  aiPrompt: (view, seat, rng) => dhAiPrompt(view, seat, rng, dhBot),

  bot(view, seat, rng) {
    return dhBot(view, seat, rng);
  },
};

/** 给界面用：某张牌在当前房规下值多少分 */
export const pointsOf = (card: Card, options: DhOptions) => cardPoints(card, options.redAce);
export {
  RED_FIVE_BONUS,
  cardPoints,
  isRedCardSuit,
  isRedFive,
  pairs,
  partners,
  pilePoints,
  redFivePairs,
};
export type { DhOptions };
