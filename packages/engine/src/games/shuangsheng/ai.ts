import { cardsText, seatName, withRecommended } from '../../core/ai';
import type { Card } from '../../core/cards';
import type { Rng } from '../../core/rng';
import type { AiOption, AiPrompt, Seat } from '../../core/types';
import { buildFollow, ssBot } from './bot';
import type { SsCtx } from './cards';
import { decompose, esuit, isTrump, sortSs, sumPoints } from './cards';
import { declLabel } from './declare';
import type { SsAction, SsView } from './index';
import { followError, leadError, trickWinnerIndex } from './play';

const LEVEL_LABEL = (lv: number) =>
  (({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }) as Record<number, string>)[lv] ?? String(lv);
const ids = (cards: readonly Card[]) => cards.map((c) => c.id).sort((a, b) => a - b);
const SUIT_NAME: Record<string, string> = { S: '黑桃', H: '红桃', C: '梅花', D: '方块', T: '主牌' };
const KIND_NAME = { single: '单张', pair: '对子', tractor: '拖拉机' } as const;

function norm(a: SsAction): SsAction {
  return a.type === 'play' || a.type === 'declare' || a.type === 'bury'
    ? { ...a, cards: [...a.cards].sort((x, y) => x - y) }
    : a;
}

function handText(hand: readonly Card[], ctx: SsCtx): string {
  const groups = new Map<string, Card[]>();
  for (const c of sortSs(hand, ctx)) {
    const s = esuit(c, ctx);
    groups.set(s, [...(groups.get(s) ?? []), c]);
  }
  return [...groups.entries()]
    .map(([s, cards]) => `${SUIT_NAME[s]}(${cards.length}) ${cardsText(cards)}`)
    .join('；');
}

/** 领出的候选：每门拆出的拖拉机、对子、单张（单张每门取大小两头） */
function leadOptions(hand: readonly Card[], ctx: SsCtx): AiOption<SsAction>[] {
  const bySuit = new Map<string, Card[]>();
  for (const c of hand) {
    const s = esuit(c, ctx);
    bySuit.set(s, [...(bySuit.get(s) ?? []), c]);
  }
  const out: AiOption<SsAction>[] = [];
  for (const [s, cards] of bySuit) {
    const comps = decompose(cards, ctx);
    const multi = comps.filter((c) => c.pairs >= 1);
    const singles = sortSs(cards, ctx);
    const picks = [...multi.map((c) => c.cards), [singles[0]], [singles[singles.length - 1]]];
    for (const p of picks) {
      if (leadError(p, ctx)) continue;
      const kind = decompose(p, ctx)[0]?.kind ?? 'single';
      out.push({
        label: `${SUIT_NAME[s]}${KIND_NAME[kind]}：${cardsText(sortSs(p, ctx))}`,
        action: { type: 'play', cards: ids(p) },
      });
    }
  }
  return out;
}

/** 跟牌候选：按小、大、带分三种凑法；单张跟时列出每张不同的合法牌 */
function followOptions(hand: readonly Card[], lead: readonly Card[], ctx: SsCtx) {
  const out: AiOption<SsAction>[] = [];
  const push = (p: Card[], tag: string) => {
    if (followError(hand, lead, p, ctx)) return;
    out.push({
      label: `${tag}：${cardsText(sortSs(p, ctx))}`,
      action: { type: 'play', cards: ids(p) },
    });
  };
  if (lead.length === 1) {
    const seen = new Set<string>();
    for (const c of sortSs(hand, ctx)) {
      const key = `${c.suit}${c.rank}`;
      if (seen.has(key)) continue;
      seen.add(key);
      push([c], '出');
    }
    return out;
  }
  push(buildFollow(hand, lead, ctx, 'low'), '跟小牌');
  push(buildFollow(hand, lead, ctx, 'high'), '跟大牌');
  push(buildFollow(hand, lead, ctx, 'points'), '送分');
  const trumps = hand.filter((c) => isTrump(c, ctx));
  if (esuit(lead[0], ctx) !== 'T' && !hand.some((c) => esuit(c, ctx) === esuit(lead[0], ctx))) {
    push(buildFollow(trumps.length >= lead.length ? trumps : hand, lead, ctx, 'high'), '用主牌毙');
  }
  return out;
}

export function ssAiPrompt(view: SsView, seat: Seat, rng: Rng): AiPrompt<SsAction> | null {
  // 发牌中亮主有时限、扣底组合太多，交给规则电脑
  if (!['declare', 'fan', 'play'].includes(view.phase)) return null;
  if (view.phase === 'play' && (view.waiting !== seat || !view.trick)) return null;
  if ((view.phase === 'declare' || view.phase === 'fan') && !view.declOptions.length) return null;

  const rec = norm(ssBot(view, seat, rng));
  const ctx: SsCtx = { level: view.level, trump: view.decl ? view.decl.suit : null };
  const partner = (seat + 2) % 4;
  const myTeam = seat % 2;
  const dealerSide = view.dealerTeam === myTeam;
  const lines = [
    `玩法：双升（升级 / 拖拉机），两副牌 4 人，你和${seatName(seat, partner, 4)}是一队。分牌 5、10、K，共 200 分；闲家拿到 80 分上台。`,
    `本局打 ${LEVEL_LABEL(view.level)}，主：${view.decl ? declLabel(view.decl) : '未定'}。你方${dealerSide ? '是庄方' : '是闲家'}，闲家已得 ${view.points} 分。级数：你方 ${LEVEL_LABEL(view.levels[myTeam])}，对方 ${LEVEL_LABEL(view.levels[1 - myTeam])}。`,
  ];

  let options: AiOption<SsAction>[];
  if (view.phase === 'declare' || view.phase === 'fan') {
    const level = view.phase === 'declare' ? view.levels[myTeam] : view.level;
    const hint = { level, trump: null };
    lines.push(`你的手牌（${view.hand.length} 张）：${cardsText(sortSs(view.hand, hint))}`);
    lines.push(
      view.phase === 'declare'
        ? '现在轮到你决定是否亮主（亮了就坐庄）。主牌越多越适合亮。'
        : `现在可以反主（换主、换底，庄不变）。当前主由${seatName(seat, view.decl!.seat, 4)}亮出。`,
    );
    options = view.declOptions.map((o) => ({
      label: `${view.phase === 'fan' ? '反主' : '亮主'}：${declLabel(o)}（${cardsText(o.cards)}）`,
      action: { type: 'declare', cards: ids(o.cards) } as SsAction,
    }));
    options.push({ label: '不亮', action: { type: 'pass' } });
  } else {
    const trick = view.trick!;
    lines.push(`你的手牌（${view.hand.length} 张）：${handText(view.hand, ctx)}`);
    if (!trick.plays.length) {
      lines.push('这一墩由你领出（同一门可以甩牌，但被人管住会失败）。');
      options = leadOptions(view.hand, ctx);
    } else {
      const win = trick.plays[trickWinnerIndex(trick.plays, ctx)].seat;
      for (const p of trick.plays)
        lines.push(
          `${seatName(seat, p.seat, 4)}${p.seat % 2 === myTeam ? '（队友）' : '（对手）'}出：${cardsText(p.cards)}`,
        );
      const pts = sumPoints(trick.plays.flatMap((p) => p.cards));
      lines.push(
        `现在最大的是${seatName(seat, win, 4)}${win % 2 === myTeam ? '（自己人）' : '（对手）'}，这墩已有 ${pts} 分。你要跟 ${trick.plays[0].cards.length} 张。`,
      );
      options = followOptions(view.hand, trick.plays[0].cards, ctx);
    }
    if (view.lastTrick?.winner != null)
      lines.push(`上一墩由${seatName(seat, view.lastTrick.winner, 4)}拿下。`);
  }
  const all = withRecommended(rec, options);
  return all.length > 1 ? { situation: lines.join('\n'), options: all } : null;
}
