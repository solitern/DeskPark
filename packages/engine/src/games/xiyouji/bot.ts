import type { Card } from '../../core/cards';
import type { Seat } from '../../core/types';
import type { XyjAction, XyjView } from './index';
import type { XyjOption } from './rules';
import { XYJ_RANKS, isWildCard, playOptions } from './rules';

/**
 * 规则电脑：
 * - 能一手出完就出完；
 * - 领出：出手里同点数最多的一组（不拆王），尽快减少手牌；
 * - 跟牌：优先不用王、且正好用完某个点数的一组；对手快出完时才肯用王硬压。
 */
export function xyjBot(view: XyjView, seat: Seat): XyjAction {
  const hand = view.hand;
  if (view.phase !== 'play') return { type: 'ready' };
  const leading = view.top === null;
  const count = leading ? null : view.count;
  const top = leading ? null : view.top!.rank;
  const opts = playOptions(hand, count, top);

  const asAction = (o: XyjOption): XyjAction => ({ type: 'play', cards: o.cards, as: o.rank });

  // 一手出完
  const finish = opts.find((o) => o.cards.length === hand.length);
  if (finish) return asAction(finish);

  const natCount = (rank: number) => hand.filter((c) => !isWildCard(c) && c.rank === rank).length;
  const danger = view.handCounts.some((n, i) => i !== seat && n > 0 && n <= 3);

  if (leading) {
    // 同点数最多的一组，不用王
    let best: Card[] = [];
    for (const r of XYJ_RANKS) {
      const g = hand.filter((c) => !isWildCard(c) && c.rank === r);
      if (g.length > best.length) best = g;
    }
    if (best.length) return { type: 'play', cards: best.slice(0, 8).map((c) => c.id) };
    // 只剩王
    const w = hand.filter(isWildCard);
    return { type: 'play', cards: w.slice(0, 8).map((c) => c.id), as: 10 };
  }

  if (opts.length === 0) return { type: 'pass' };
  const scored = opts
    .map((o) => {
      const nat = natCount(o.rank);
      // 用王扣分；拆开一组同点数的牌扣分（剩下的越少越好）
      const broken = nat - (o.cards.length - o.wilds);
      return { o, cost: o.wilds * 10 + (broken > 0 ? broken : 0) };
    })
    .sort((a, b) => a.cost - b.cost);
  const pick = scored[0];
  if (pick.o.wilds > 0 && !danger && hand.length > 6) return { type: 'pass' };
  return asAction(pick.o);
}
