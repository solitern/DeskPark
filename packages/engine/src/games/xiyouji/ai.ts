import { seatName, withRecommended } from '../../core/ai';
import type { Card } from '../../core/cards';
import type { AiOption, AiPrompt, Seat } from '../../core/types';
import { xyjBot } from './bot';
import type { XyjAction, XyjView } from './index';
import { XYJ_NAME, callOut, isWildCard, playOptions } from './rules';

const cardName = (c: Card) => (isWildCard(c) ? '万能牌' : (XYJ_NAME[c.rank] ?? ''));
const handText = (cards: readonly Card[]) => {
  const m = new Map<string, number>();
  for (const c of cards) m.set(cardName(c), (m.get(cardName(c)) ?? 0) + 1);
  return [...m].map(([k, n]) => `${k}×${n}`).join('，') || '（无）';
};

/** 西游记：把局面整理给大模型，候选只含合法动作（第 1 个是规则电脑的建议） */
export function xyjAiPrompt(view: XyjView, seat: Seat): AiPrompt<XyjAction> | null {
  if (view.phase !== 'play' || view.turn !== seat) return null;
  const leading = view.top === null;
  const rec = xyjBot(view, seat);
  const opts = playOptions(view.hand, leading ? null : view.count, leading ? null : view.top!.rank);
  const options: AiOption<XyjAction>[] = opts.map((o) => ({
    label: `出${callOut(o.rank, o.cards.length)}${o.wilds ? `（用 ${o.wilds} 张万能牌）` : ''}`,
    action: { type: 'play', cards: o.cards, as: o.rank },
  }));
  if (!leading) options.unshift({ label: '不要', action: { type: 'pass' } });
  if (options.length <= 1 && JSON.stringify(options[0]?.action) === JSON.stringify(rec))
    return null;

  const lines = [
    '玩法：西游记，4 人，谁先出完谁赢。师傅（10）压徒弟，徒弟（悟空 5 > 八戒 8 > 沙僧 3）压妖怪，妖怪（大妖 K > 中妖 Q > 小妖 J）压师傅；同点不能压；王是万能牌。',
    '出 1～8 张同点数的牌，跟牌张数必须与本轮首手相同且压得过；本轮不要过也可以再出。出完时剩牌最多的人按张数扣分给赢家。',
    `你的手牌（${view.hand.length} 张）：${handText(view.hand)}`,
  ];
  for (const d of [1, 2, 3]) {
    const s = (seat + d) % 4;
    lines.push(`${seatName(seat, s, 4)}：剩 ${view.handCounts[s]} 张，积分 ${view.scores[s]}`);
  }
  if (leading) lines.push('现在由你领出，张数任意。');
  else
    lines.push(
      `桌上最大：${seatName(seat, view.top!.seat, 4)}出的${callOut(view.top!.rank, view.top!.cards.length)}，本轮要出 ${view.count} 张。`,
    );
  return { situation: lines.join('\n'), options: withRecommended(rec, options) };
}
