import type { Card } from '../../core/cards';
import type { Rng } from '../../core/rng';
import type { Seat } from '../../core/types';
import type { Comp, SsCtx } from './cards';
import {
  cardPoints,
  decompose,
  esuit,
  isTrump,
  longestRun,
  pairPool,
  removeItems,
  seq,
  shapeValue,
  sumPoints,
} from './cards';
import type { DeclOption } from './declare';
import type { SsAction, SsView } from './index';
import { followError, trickWinnerIndex } from './play';

/**
 * 双升电脑玩家（只读 view）：
 * - 亮主：主牌够多才亮，发牌后（庄方 / 对手轮到时）有就亮；反主要求换主后主牌明显更多；
 * - 扣底：扣副牌里的小牌，尽量扣短门、不扣分；
 * - 领出：副牌拖拉机 / A 先走，庄方主多时调主，否则出短门小牌；
 * - 跟牌：队友大时送分，能管上就用最小的管，没该门时能毙就毙。
 */

type Mode = 'low' | 'high' | 'points';
const ids = (cards: readonly Card[]) => cards.map((c) => c.id);
const teamOf = (s: Seat) => s % 2;

function trumpCountFor(hand: readonly Card[], level: number, suit: Card['suit'] | null): number {
  return hand.filter(
    (c) => c.suit === 'J' || c.rank === level || (suit !== null && c.suit === suit),
  ).length;
}

function bestOption(hand: readonly Card[], level: number, opts: DeclOption[]) {
  let best: { o: DeclOption; n: number } | null = null;
  for (const o of opts) {
    const n = trumpCountFor(hand, level, o.suit) + o.strength * 0.5;
    if (!best || n > best.n) best = { o, n };
  }
  return best;
}

/** 弃牌代价：越小越先出 */
function discardCost(c: Card, ctx: SsCtx, mode: Mode): number {
  const trump = isTrump(c, ctx) ? 60 + seq(c, ctx) : 0;
  const pts = cardPoints(c);
  const ptCost = mode === 'points' ? -pts * 2 : pts * 3;
  return trump + ptCost + seq(c, ctx);
}

/**
 * 按领出牌型从 pool（同一门的牌）里凑出 n 张的跟牌：先凑拖拉机，再凑对子，最后补单张。
 * mode：low 尽量小、high 尽量大、points 尽量带分。
 */
function buildFrom(pool: readonly Card[], lead: Comp[], n: number, ctx: SsCtx, mode: Mode): Card[] {
  if (pool.length <= n) return [...pool];
  let pairs = pairPool(pool, ctx);
  const chosen: Card[] = [];
  const needPairs = lead.reduce((s, c) => s + c.pairs, 0);
  let usedPairs = 0;
  for (const comp of lead) {
    if (comp.kind !== 'tractor') continue;
    const run = longestRun(pairs);
    const r = Math.min(comp.pairs, run.length);
    if (r < 2) break;
    const take = mode === 'low' ? run.slice(run.length - r) : run.slice(0, r);
    pairs = removeItems(pairs, take);
    chosen.push(...take.flatMap((p) => p.cards));
    usedPairs += r;
  }
  const extra = Math.min(needPairs, usedPairs + pairs.length) - usedPairs;
  if (extra > 0) {
    const sorted = [...pairs].sort((a, b) => (mode === 'high' ? b.seq - a.seq : a.seq - b.seq));
    for (const p of sorted.slice(0, extra)) chosen.push(...p.cards);
  }
  const used = new Set(ids(chosen));
  const rest = pool.filter((c) => !used.has(c.id));
  rest.sort((a, b) =>
    mode === 'high'
      ? seq(b, ctx) - seq(a, ctx)
      : discardCost(a, ctx, mode) - discardCost(b, ctx, mode),
  );
  chosen.push(...rest.slice(0, n - chosen.length));
  return chosen;
}

/** 合法跟牌：本门按牌型凑，不够再从其他牌里按 mode 垫 */
export function buildFollow(
  hand: readonly Card[],
  leadCards: readonly Card[],
  ctx: SsCtx,
  mode: Mode = 'low',
): Card[] {
  const n = leadCards.length;
  const suit = esuit(leadCards[0], ctx);
  const lead = decompose(leadCards, ctx);
  const inSuit = hand.filter((c) => esuit(c, ctx) === suit);
  const play = buildFrom(inSuit, lead, n, ctx, mode);
  if (play.length < n) {
    const used = new Set(ids(play));
    const rest = hand
      .filter((c) => !used.has(c.id))
      .sort((a, b) => discardCost(a, ctx, mode) - discardCost(b, ctx, mode));
    play.push(...rest.slice(0, n - play.length));
  }
  return play;
}

function safeFollow(hand: Card[], lead: Card[], ctx: SsCtx, mode: Mode): Card[] {
  for (const m of [mode, 'high', 'low'] as Mode[]) {
    const p = buildFollow(hand, lead, ctx, m);
    if (!followError(hand, lead, p, ctx)) return p;
  }
  return buildFollow(hand, lead, ctx, 'high');
}

export function ssBot(view: SsView, seat: Seat, rng: Rng): SsAction {
  const hand = view.hand;
  switch (view.phase) {
    case 'roundOver':
      return { type: 'ready' };
    case 'deal': {
      const best = bestOption(hand, view.level, view.declOptions);
      if (!best) return { type: 'pass' };
      const enough = best.n >= Math.max(3, hand.length * 0.3) || hand.length >= 20;
      return enough || best.o.strength === 2
        ? { type: 'declare', cards: ids(best.o.cards) }
        : { type: 'pass' };
    }
    case 'declare': {
      const level = view.levels[teamOf(seat)];
      const best = bestOption(hand, level, view.declOptions);
      return best ? { type: 'declare', cards: ids(best.o.cards) } : { type: 'pass' };
    }
    case 'fan': {
      const best = bestOption(hand, view.level, view.declOptions);
      if (!best || !view.decl) return { type: 'pass' };
      const cur = trumpCountFor(hand, view.level, view.decl.suit);
      const now = trumpCountFor(hand, view.level, best.o.suit);
      return now >= cur + 3 && now >= 9
        ? { type: 'declare', cards: ids(best.o.cards) }
        : { type: 'pass' };
    }
    case 'bury':
      return { type: 'bury', cards: ids(chooseBury(hand, view)) };
    case 'play':
      return { type: 'play', cards: ids(choosePlay(view, seat, rng)) };
    default:
      return { type: 'pass' };
  }
}

function ctxOfView(view: SsView): SsCtx {
  return { level: view.level, trump: view.decl ? view.decl.suit : null };
}

function chooseBury(hand: Card[], view: SsView): Card[] {
  const ctx = ctxOfView(view);
  const len = new Map<string, number>();
  for (const c of hand) if (!isTrump(c, ctx)) len.set(c.suit, (len.get(c.suit) ?? 0) + 1);
  const pairIds = new Set(pairPool(hand, ctx).flatMap((p) => ids(p.cards)));
  const cost = (c: Card) =>
    isTrump(c, ctx)
      ? 200 + seq(c, ctx)
      : seq(c, ctx) * 2 +
        cardPoints(c) * 2.5 +
        (pairIds.has(c.id) ? 10 : 0) +
        (seq(c, ctx) >= 11 ? 30 : 0) +
        (len.get(c.suit) ?? 0) * 1.2;
  return [...hand].sort((a, b) => cost(a) - cost(b) || a.id - b.id).slice(0, 8);
}

function choosePlay(view: SsView, seat: Seat, rng: Rng): Card[] {
  const ctx = ctxOfView(view);
  const hand = view.hand;
  const trick = view.trick!;
  if (!trick.plays.length) return chooseLead(hand, view, seat, ctx, rng);
  const lead = trick.plays[0].cards;
  const n = lead.length;
  const comps = decompose(lead, ctx);
  const leadSuit = esuit(lead[0], ctx);
  const winnerSeat = trick.plays[trickWinnerIndex(trick.plays, ctx)].seat;
  const partnerWinning = teamOf(winnerSeat) === teamOf(seat);
  const lastToPlay = trick.plays.length === 3;
  const wins = (cards: Card[]) => {
    const plays = [...trick.plays, { seat, cards }];
    return plays[trickWinnerIndex(plays, ctx)].seat === seat;
  };
  const inSuit = hand.filter((c) => esuit(c, ctx) === leadSuit);

  if (partnerWinning) {
    // 队友大：最后一家或队友牌够大时送分，否则小牌
    const best = trick.plays.find((p) => p.seat === winnerSeat)!.cards;
    const bestSuit = esuit(best[0], ctx);
    const bestTop = Math.max(...best.map((c) => seq(c, ctx)));
    const solid =
      bestSuit === 'T'
        ? leadSuit !== 'T' || bestTop >= (ctx.trump === null ? 2 : 14)
        : bestTop >= 11;
    return safeFollow(hand, lead, ctx, lastToPlay || solid ? 'points' : 'low');
  }

  if (inSuit.length >= n) {
    if (n === 1) {
      const asc = [...inSuit].sort((a, b) => seq(a, ctx) - seq(b, ctx));
      const win = asc.find((c) => wins([c]));
      if (win) return [win];
      return safeFollow(hand, lead, ctx, 'low');
    }
    const high = safeFollow(hand, lead, ctx, 'high');
    if (wins(high)) return high;
    return safeFollow(hand, lead, ctx, 'low');
  }

  if (inSuit.length === 0 && leadSuit !== 'T') {
    const trumps = hand.filter((c) => isTrump(c, ctx));
    const trickPts = sumPoints(trick.plays.flatMap((p) => p.cards));
    if (trumps.length >= n && (trickPts > 0 || n > 1 || trumps.length >= 7 || rng.next() < 0.4)) {
      let ruff: Card[] | null = null;
      if (n === 1) {
        const asc = [...trumps].sort((a, b) => seq(a, ctx) - seq(b, ctx));
        const w = asc.find((c) => wins([c]));
        if (w) ruff = [w];
      } else {
        const r = buildFrom(trumps, comps, n, ctx, 'high');
        if (r.length === n && shapeValue(r, comps, ctx) !== null && wins(r)) ruff = r;
      }
      if (ruff && !followError(hand, lead, ruff, ctx)) return ruff;
    }
  }
  return safeFollow(hand, lead, ctx, 'low');
}

function chooseLead(hand: Card[], view: SsView, seat: Seat, ctx: SsCtx, rng: Rng): Card[] {
  const bySuit = new Map<string, Card[]>();
  for (const c of hand) {
    const s = esuit(c, ctx);
    bySuit.set(s, [...(bySuit.get(s) ?? []), c]);
  }
  const offSuits = [...bySuit.entries()].filter(([s]) => s !== 'T');
  const trumps = bySuit.get('T') ?? [];
  const comps = (cards: Card[]) => decompose(cards, ctx);

  // 1. 副牌拖拉机
  for (const [, cards] of offSuits) {
    const t = comps(cards).find((c) => c.kind === 'tractor');
    if (t) return t.cards;
  }
  // 2. 副牌最大的牌（A，或级牌为 A 时的 K）
  for (const [, cards] of offSuits) {
    const top = comps(cards).find((c) => c.top >= 11);
    if (top) return top.cards;
  }
  const dealerSide = teamOf(seat) === view.dealerTeam;
  // 3. 庄方主多：调主（先出主拖拉机 / 对子，再小主）
  if (trumps.length >= 8 && (dealerSide || trumps.length >= 11)) {
    const tc = comps(trumps);
    const multi = tc.filter((c) => c.pairs >= 1).sort((a, b) => a.top - b.top);
    if (multi.length && rng.next() < 0.7) return multi[0].cards;
    const small = [...trumps].sort((a, b) => seq(a, ctx) - seq(b, ctx))[0];
    return [small];
  }
  // 4. 副牌大对子
  for (const [, cards] of offSuits) {
    const p = comps(cards).find((c) => c.kind === 'pair' && c.top >= 7);
    if (p) return p.cards;
  }
  // 5. 最短副牌门里的小牌（尽量不带分）
  if (offSuits.length) {
    offSuits.sort((a, b) => a[1].length - b[1].length || rng.next() - 0.5);
    const cards = offSuits[0][1];
    const pick = [...cards].sort(
      (a, b) => cardPoints(a) * 3 + seq(a, ctx) - (cardPoints(b) * 3 + seq(b, ctx)),
    )[0];
    return [pick];
  }
  const small = [...trumps].sort((a, b) => seq(a, ctx) - seq(b, ctx))[0];
  return [small];
}
