import type { Card } from '@park/engine';
import { sh } from '@park/engine';
import { useEffect, useRef } from 'react';
import { speak } from '../../lib/speech';

/** 双升语音报牌：出牌、毙牌、垫牌、甩牌、亮主反主、本局结果 */

const SUIT_NAME: Record<string, string> = { S: '黑桃', H: '红桃', C: '梅花', D: '方块' };
const RANK_NAME: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

const rankName = (c: Card) =>
  c.suit === 'J' ? (c.rank === 17 ? '大王' : '小王') : (RANK_NAME[c.rank] ?? String(c.rank));
const cardName = (c: Card) => (c.suit === 'J' ? rankName(c) : SUIT_NAME[c.suit] + rankName(c));

function declText(d: sh.Declaration): string {
  if (d.suit === null) return '无主';
  return SUIT_NAME[d.suit] + '为主';
}

/** 首家出牌怎么报 */
export function leadText(cards: readonly Card[], ctx: sh.SsCtx): string {
  const comps = sh.decompose(cards, ctx);
  if (comps.length > 1) return '甩牌';
  const c = comps[0];
  if (!c) return '';
  const top = sh.sortSs(c.cards, ctx)[0];
  if (c.kind === 'tractor') return '拖拉机';
  if (c.kind === 'pair') return '对' + rankName(top);
  return cardName(top);
}

/** 跟牌怎么报：毙 / 盖毙 / 大 / 垫牌；普通跟牌不报 */
export function followText(plays: readonly sh.TrickPlay[], ctx: sh.SsCtx): string {
  const i = plays.length - 1;
  if (i < 1) return '';
  const lead = plays[0].cards;
  const leadSuit = sh.esuit(lead[0], ctx);
  const cards = plays[i].cards;
  const allTrump = cards.every((c) => sh.isTrump(c, ctx));
  const allLeadSuit = cards.every((c) => sh.esuit(c, ctx) === leadSuit);
  const wins = sh.trickWinnerIndex(plays, ctx) === i;
  const prevWinner = sh.trickWinnerIndex(plays.slice(0, i), ctx);
  if (leadSuit !== 'T' && allTrump) {
    if (!wins) return '';
    const prevKilled = prevWinner > 0 && plays[prevWinner].cards.every((c) => sh.isTrump(c, ctx));
    return prevKilled ? '盖毙' : '毙了';
  }
  if (!allLeadSuit) return '垫牌';
  return wins ? '大你' : '';
}

export function useShuangshengVoice(v: sh.SsView, players: { name: string }[]) {
  const ctx: sh.SsCtx = { level: v.level, trump: v.decl ? v.decl.suit : null };
  const lastPlay = useRef('');
  const lastDecl = useRef('');
  const lastFail = useRef('');
  const lastResult = useRef(0);

  // 出牌
  const trick = v.trick;
  const plays = trick?.plays ?? [];
  const tail = plays[plays.length - 1];
  const playKey = tail ? `${v.round}:${tail.seat}:${tail.cards.map((c) => c.id).join(',')}` : '';
  useEffect(() => {
    if (!tail || playKey === lastPlay.current) return;
    lastPlay.current = playKey;
    const text = plays.length === 1 ? leadText(tail.cards, ctx) : followText(plays, ctx);
    if (text) speak(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);

  // 甩牌失败
  const fail = v.throwFail;
  const failKey = fail ? `${v.round}:${fail.seat}:${fail.tried.map((c) => c.id).join(',')}` : '';
  useEffect(() => {
    if (!fail || failKey === lastFail.current) return;
    lastFail.current = failKey;
    speak('甩牌失败', { interrupt: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failKey]);

  // 亮主 / 反主 / 翻底定主
  const d = v.decl;
  const declKey = d ? `${v.round}:${d.seat}:${d.suit}:${d.strength}:${d.flip ? 1 : 0}` : '';
  useEffect(() => {
    if (!d || declKey === lastDecl.current) return;
    const first = !lastDecl.current.startsWith(`${v.round}:`);
    lastDecl.current = declKey;
    const who = players[d.seat]?.name ?? '';
    if (d.fallback) speak(`${who}坐庄，打无主`);
    else if (d.flip) speak(`翻底定主，${declText(d)}`);
    else speak(`${who}${first ? '亮主' : '反主'}，${declText(d)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declKey]);

  // 本局结果
  const r = v.result;
  useEffect(() => {
    if (!r || lastResult.current === r.round) return;
    lastResult.current = r.round;
    if (r.matchWon) {
      speak('庄家打过A，赢下整场', { interrupt: false });
      return;
    }
    const verdict =
      r.side === 'dealer'
        ? r.up > 0
          ? `庄家守住，升${r.up}级`
          : '庄家守住'
        : r.up > 0
          ? `闲家上台，升${r.up}级`
          : '闲家上台';
    speak(`闲家${r.defenderPoints}分，${verdict}`, { interrupt: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.round]);
}
