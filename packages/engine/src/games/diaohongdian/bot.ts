import type { Card } from '../../core/cards';
import type { Rng } from '../../core/rng';
import type { Seat } from '../../core/types';
import { cardPoints, pairs } from './scoring';
import type { DhAction, DhView } from './index';

/** 电脑策略：能钓红牌就钓值钱的那张，钓不到就先把没用的黑牌甩出去。 */
export function dhBot(view: DhView, seat: Seat, rng: Rng): DhAction {
  const redAce = view.options.redAce;
  const pts = (c: Card) => cardPoints(c, redAce);
  const hand = view.hand;

  if (view.phase === 'pick' && view.pending) {
    const targets = [...view.pending.matches].sort(
      (a, b) => pts(b) - pts(a) || a.rank - b.rank,
    );
    return { type: 'pick', target: targets[0].id };
  }
  if (view.phase === 'flip') return { type: 'flip' };
  if (hand.length === 0) return { type: 'flip' };

  // 每张手牌能钓到的最高分（台面没有可配的牌时为 0）
  const best = hand.map((c) => {
    const targets = view.table.filter((t) => pairs(t.rank, c.rank));
    const gain = targets.reduce((m, t) => Math.max(m, pts(t) + pts(c)), 0);
    return { card: c, gain };
  });
  const maxGain = Math.max(...best.map((b) => b.gain));
  const pool = best.filter((b) => b.gain === maxGain);
  // 同样能钓到的牌里，优先甩掉分值低的（黑牌、小牌）；分也相同就随机
  const sorted = pool.sort((a, b) => pts(a.card) - pts(b.card) || a.card.rank - b.card.rank);
  const pick = sorted[Math.min(sorted.length - 1, Math.floor(rng.next() * Math.min(2, sorted.length)))];
  return { type: 'play', card: pick.card.id };
}
