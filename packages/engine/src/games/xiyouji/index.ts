import { clone } from '../../core/clone';
import type { Card } from '../../core/cards';
import { cardLabel, pickCards, removeCards, sortCards } from '../../core/cards';
import { Rng } from '../../core/rng';
import type { GameDefinition, Seat } from '../../core/types';
import { xyjAiPrompt } from './ai';
import { xyjBot } from './bot';
import { beats, createXyjDeck, resolvePlay, sortValue } from './rules';

export * from './rules';

/**
 * 西游记 —— 4 人出牌游戏，谁先出完谁赢。
 *
 * 每盘 60 张牌每人 15 张。庄家先出，可出 1～8 张同点数的牌（王可补任意点）；
 * 后面的人张数必须相同且点数能压过。本轮已「不要」的人，别人压过之后仍可再出。
 * 其余三家都不要时，最后出牌的人重新领出，张数任意。
 * 有人出完即结束：剩余三家中手牌最多的（并列都算）按剩余张数扣分，先出完的人得这些分。
 */

export type XyjPhase = 'play' | 'roundOver' | 'matchOver';

export interface XyjOptions {
  /** 盘数，0 表示不限 */
  rounds: number;
}

export type XyjAction =
  { type: 'play'; cards: number[]; as?: number } | { type: 'pass' } | { type: 'ready' };

export interface XyjPlay {
  seat: Seat;
  cards: Card[];
  rank: number;
}

export type XyjMove = { type: 'play'; cards: Card[]; rank: number } | { type: 'pass' } | null;

export interface XyjFlip {
  card: Card;
  seat: Seat;
}

export interface XyjResult {
  round: number;
  winner: Seat;
  /** 结算时各家剩余张数 */
  left: number[];
  /** 被扣分的座位 */
  losers: Seat[];
  deltas: number[];
  hands: Card[][];
}

/** 最近一个动作，界面据此播报（seq 每步递增） */
export interface XyjEvent {
  seq: number;
  seat: Seat;
  kind: 'play' | 'pass' | 'lead';
  rank?: number;
  count?: number;
}

export interface XyjState {
  options: XyjOptions;
  rng: number;
  round: number;
  phase: XyjPhase;
  dealer: Seat;
  /** 第一盘翻牌定庄 */
  flip: XyjFlip | null;
  hands: Card[][];
  turn: Seat;
  /** 本轮桌面上最大的一手；null 表示该 turn 领出 */
  top: XyjPlay | null;
  /** 本轮规定的张数 */
  count: number | null;
  /** 自上一手出牌后连续「不要」的人数 */
  passes: number;
  lastMoves: XyjMove[];
  scores: number[];
  result: XyjResult | null;
  ready: boolean[];
  event: XyjEvent | null;
  seq: number;
}

export interface XyjView {
  seat: Seat | null;
  phase: XyjPhase;
  round: number;
  options: XyjOptions;
  dealer: Seat;
  flip: XyjFlip | null;
  hand: Card[];
  handCounts: number[];
  turn: Seat | null;
  top: XyjPlay | null;
  count: number | null;
  lastMoves: XyjMove[];
  scores: number[];
  result: XyjResult | null;
  ready: boolean[];
  event: XyjEvent | null;
}

const N = 4;
const HAND = 15;

function deal(s: XyjState, firstRound: boolean): void {
  const rng = new Rng(s.rng);
  const deck = rng.shuffle(createXyjDeck());
  s.hands = Array.from({ length: N }, (_, i) =>
    sortCards(deck.slice(i * HAND, (i + 1) * HAND), sortValue),
  );
  if (firstRound) {
    // 翻牌定庄：随机翻开一张，摸到这张牌的人坐庄
    const card = deck[rng.int(deck.length)];
    const seat = s.hands.findIndex((h) => h.some((c) => c.id === card.id));
    s.flip = { card, seat };
    s.dealer = seat;
  } else {
    s.flip = null;
  }
  s.rng = rng.state;
  s.turn = s.dealer;
  s.top = null;
  s.count = null;
  s.passes = 0;
  s.lastMoves = [null, null, null, null];
  s.result = null;
  s.ready = [false, false, false, false];
  s.phase = 'play';
  s.event = { seq: ++s.seq, seat: s.dealer, kind: 'lead' };
}

function settle(s: XyjState, winner: Seat): void {
  const left = s.hands.map((h) => h.length);
  const others = [0, 1, 2, 3].filter((i) => i !== winner);
  const most = Math.max(...others.map((i) => left[i]));
  const losers = others.filter((i) => left[i] === most);
  const deltas = [0, 0, 0, 0];
  for (const l of losers) {
    deltas[l] -= most;
    deltas[winner] += most;
  }
  for (let i = 0; i < N; i++) s.scores[i] += deltas[i];
  s.result = { round: s.round, winner, left, losers, deltas, hands: s.hands.map((h) => [...h]) };
  s.dealer = winner;
  s.phase = 'roundOver';
}

function idsOf(a: unknown): number[] | null {
  if (!Array.isArray(a)) return null;
  if (!a.every((x) => typeof x === 'number' && Number.isInteger(x))) return null;
  return a as number[];
}

export const xiyouji: GameDefinition<XyjState, XyjAction, XyjView, XyjOptions> = {
  meta: {
    id: 'xiyouji',
    category: 'poker',
    name: '西游记',
    nameEn: 'Journey West',
    tagline: '师傅压徒弟，徒弟压妖怪，妖怪压师傅',
    minPlayers: 4,
    maxPlayers: 4,
    defaultPlayers: 4,
    botDelayMs: [600, 1200],
    rules: [
      '用两副牌中的 3、5、8、10、J、Q、K 和大小王，共 60 张，每人 15 张。',
      '10 师傅；5 悟空、8 八戒、3 沙僧是徒弟；K 大妖、Q 中妖、J 小妖是妖怪；大小王是万能牌。',
      '师傅压徒弟，徒弟压妖怪，妖怪压师傅，反过来不行。徒弟里 5 > 8 > 3，妖怪里 K > Q > J，同点不能压。',
      '可出单张、对子，最多八张，必须同点数，王可补任意点；只出王时由出牌人指定点数。',
      '庄家先出，后面的人张数必须与本轮首手相同且能压过。本轮已经不要的人，别人压过之后还能再出。',
      '其余三家都不要时，最后出牌的人重新领出，张数任意。',
      '谁先出完本盘结束：剩余三家中手牌最多的按剩余张数扣分（并列都扣），先出完的人得这些分，其他人不变。',
      '第一盘翻牌定庄（摸到翻开那张牌的人坐庄），之后谁赢谁坐庄。',
    ],
  },
  defaultOptions: { rounds: 4 },
  optionFields: [
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
    const rounds = Number(options?.rounds);
    const s: XyjState = {
      options: { rounds: Number.isFinite(rounds) ? Math.max(0, Math.floor(rounds)) : 4 },
      rng: seed >>> 0,
      round: 1,
      phase: 'play',
      dealer: 0,
      flip: null,
      hands: [],
      turn: 0,
      top: null,
      count: null,
      passes: 0,
      lastMoves: [null, null, null, null],
      scores: [0, 0, 0, 0],
      result: null,
      ready: [false, false, false, false],
      event: null,
      seq: 0,
    };
    deal(s, true);
    return s;
  },

  activeSeats(s) {
    if (s.phase === 'play') return [s.turn];
    if (s.phase === 'roundOver') return [0, 1, 2, 3].filter((i) => !s.ready[i]);
    return [];
  },

  validate(s, seat, action) {
    if (!action || typeof action !== 'object') return '无效操作';
    if (!Number.isInteger(seat) || seat < 0 || seat >= N) return '无效座位';
    switch (action.type) {
      case 'ready':
        if (s.phase !== 'roundOver') return '本盘尚未结束';
        return s.ready[seat] ? '已准备' : null;
      case 'pass':
        if (s.phase !== 'play' || s.turn !== seat) return '还没轮到你';
        return s.top === null ? '你是领出方，必须出牌' : null;
      case 'play': {
        if (s.phase !== 'play' || s.turn !== seat) return '还没轮到你';
        const ids = idsOf(action.cards);
        if (!ids || ids.length === 0) return '请选择要出的牌';
        const cards = pickCards(s.hands[seat], ids);
        if (!cards) return '请选择自己的手牌';
        const rank = resolvePlay(cards, action.as);
        if (rank === null) {
          if (cards.length > 8) return '最多出八张';
          if (cards.every((c) => c.suit === 'J')) return '请为万能牌指定点数';
          return '必须是同点数的牌';
        }
        if (s.top) {
          if (cards.length !== s.count) return `本轮要出 ${s.count} 张`;
          if (!beats(rank, s.top.rank)) return '压不过桌上的牌';
        }
        return null;
      }
      default:
        return '未知操作';
    }
  },

  apply(prev, seat, action) {
    const s = clone(prev);
    if (action.type === 'ready') {
      s.ready[seat] = true;
      if (s.ready.every(Boolean)) {
        if (s.options.rounds > 0 && s.round >= s.options.rounds) s.phase = 'matchOver';
        else {
          s.round++;
          deal(s, false);
        }
      }
      return s;
    }
    if (action.type === 'pass') {
      s.lastMoves[seat] = { type: 'pass' };
      s.passes++;
      s.event = { seq: ++s.seq, seat, kind: 'pass' };
      if (s.passes >= N - 1 && s.top) {
        // 三家都不要：最后出牌的人重新领出
        s.turn = s.top.seat;
        s.top = null;
        s.count = null;
        s.passes = 0;
        s.lastMoves = [null, null, null, null];
      } else {
        s.turn = (seat + 1) % N;
      }
      return s;
    }
    const cards = pickCards(s.hands[seat], action.cards)!;
    const rank = resolvePlay(cards, action.as)!;
    s.hands[seat] = removeCards(s.hands[seat], action.cards)!;
    if (s.top === null) {
      s.count = cards.length;
      s.lastMoves = [null, null, null, null];
    }
    s.top = { seat, cards, rank };
    s.lastMoves[seat] = { type: 'play', cards, rank };
    s.passes = 0;
    s.event = { seq: ++s.seq, seat, kind: 'play', rank, count: cards.length };
    if (s.hands[seat].length === 0) settle(s, seat);
    else s.turn = (seat + 1) % N;
    return s;
  },

  view(s, seat) {
    const over = s.phase !== 'play';
    return {
      seat,
      phase: s.phase,
      round: s.round,
      options: s.options,
      dealer: s.dealer,
      flip: s.flip,
      hand: seat === null ? [] : s.hands[seat],
      handCounts: s.hands.map((h) => h.length),
      turn: over ? null : s.turn,
      top: s.top,
      count: s.count,
      lastMoves: s.lastMoves,
      scores: s.scores,
      result: s.result,
      ready: s.ready,
      event: s.event,
    };
  },

  isOver: (s) => s.phase === 'matchOver',

  aiPrompt: (view, seat) => xyjAiPrompt(view, seat),
  bot: (view, seat) => xyjBot(view, seat),
};

/** 调试用：一手牌的文字描述 */
export function describePlay(p: XyjPlay): string {
  return p.cards.map(cardLabel).join(' ');
}
