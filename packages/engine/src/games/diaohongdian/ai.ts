import { cardsText, seatName, withRecommended } from '../../core/ai';
import { cardLabel } from '../../core/cards';
import type { Card } from '../../core/cards';
import type { Rng } from '../../core/rng';
import type { AiPrompt, Seat } from '../../core/types';
import { cardPoints, pairs } from './scoring';
import type { DhAction, DhView } from './index';

export function dhAiPrompt(
  view: DhView,
  seat: Seat,
  rng: Rng,
  bot: (v: DhView, s: Seat, r: Rng) => DhAction,
): AiPrompt<DhAction> | null {
  if (view.phase === 'roundEnd' || view.phase === 'matchOver') return null;
  const n = view.handCounts.length;
  const redAce = view.options.redAce;
  const pts = (c: Card) => cardPoints(c, redAce);
  const lines = [
    `潮汕钓红点：出牌去钓台面上能配对的牌，只有红桃 / 方块计分（黑桃梅花 0 分），红 A 按 ${redAce} 分算。现在是第 ${view.round} 局。`,
    `台面 ${view.table.length} 张：${cardsText(view.table)}`,
    `你的手牌：${cardsText(view.hand)}`,
    `底牌还剩 ${view.stockCount} 张；累计比分：${view.scores
      .map((sc, s) => `${seatName(seat, s, n)} ${sc}`)
      .join('，')}`,
  ];
  if (view.phase === 'pick' && view.pending)
    lines.push(
      `你打出的 ${cardLabel(view.pending.card)} 能配多张牌，需要挑一张：${cardsText(view.pending.matches)}`,
    );
  if (view.phase === 'flip') lines.push('你已经出完这一轮的手牌，现在要翻一张底牌。');

  let options: { label: string; action: DhAction }[];
  if (view.phase === 'pick' && view.pending) {
    options = view.pending.matches.map((c) => ({
      label: `钓 ${cardLabel(c)}（${pts(c)} 分）`,
      action: { type: 'pick' as const, target: c.id },
    }));
  } else if (view.phase === 'flip' || view.hand.length === 0) {
    options = [{ label: '翻 1 张底牌', action: { type: 'flip' as const } }];
  } else {
    options = view.hand.map((c) => {
      const targets = view.table.filter((t) => pairs(t.rank, c.rank));
      const gain = targets.reduce((m, t) => Math.max(m, pts(t) + pts(c)), 0);
      return {
        label: gain > 0 ? `出 ${cardLabel(c)}（可钓 ${gain} 分）` : `出 ${cardLabel(c)}（钓不到）`,
        action: { type: 'play' as const, card: c.id },
      };
    });
  }
  if (!options.length) return null;
  return { situation: lines.join('\n'), options: withRecommended(bot(view, seat, rng), options) };
}
