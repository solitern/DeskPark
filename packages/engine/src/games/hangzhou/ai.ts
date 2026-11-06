import { seatName, withRecommended } from '../../core/ai';
import type { Rng } from '../../core/rng';
import type { AiOption, AiPrompt, Seat } from '../../core/types';
import { hangzhouBot } from './bot';
import type { HzAction, HzView } from './index';
import type { HzTile } from './tiles';
import { hzKindOf, kindName, tileName } from './tiles';

const tilesText = (tiles: readonly HzTile[]) =>
  tiles.length
    ? [...tiles]
        .sort((a, b) => hzKindOf(a) - hzKindOf(b))
        .map(tileName)
        .join(' ')
    : '（无）';

const meldText = (m: HzView['players'][number]['melds'][number]) => {
  if (m.type === 'chi') return `吃${(m.tiles ?? []).map(tileName).join('')}`;
  const name = `${m.type === 'kong' ? '杠' : '碰'}${kindName(m.kind)}`;
  return m.kongType === 'an' ? `暗杠（${name}）` : name;
};

export function hzAiPrompt(view: HzView, seat: Seat, rng: Rng): AiPrompt<HzAction> | null {
  const L = view.legal;
  if (!L || L.ready) return null;
  const rec = hangzhouBot(view, seat, rng);
  const me = view.players[seat];
  const lines = [
    '杭州麻将：可以吃上家的牌；白板是财神，可以当任意牌用来胡牌，但不能碰、杠、吃，打出的财神谁也拿不去。',
  ];
  if (view.jokerKind !== null)
    lines.push(`财神：${kindName(view.jokerKind)}，全场共 4 张`);
  lines.push(`你的手牌：${tilesText(view.hand)}`);
  if (me.melds.length) lines.push(`你的副露：${me.melds.map(meldText).join('，')}`);
  for (const d of [1, 2, 3]) {
    const s = (seat + d) % 4;
    const p = view.players[s];
    const parts = [`${seatName(seat, s, 4)}：手牌 ${p.handCount} 张`];
    if (p.melds.length) parts.push(`副露 ${p.melds.map(meldText).join(' ')}`);
    if (p.river.length) parts.push(`最近打出 ${p.river.slice(-6).map((r) => tileName(r.tile)).join(' ')}`);
    if (p.won) parts.push('已胡');
    lines.push(parts.join('，'));
  }
  lines.push(
    `牌墙剩 ${view.wallCount} 张；当前总分 ${view.scores.join(' / ')}，本盘已结算 ${view.roundDeltas
      .map((x) => (x > 0 ? `+${x}` : `${x}`))
      .join(' / ')}。`,
  );

  const options: AiOption<HzAction>[] = [];
  if (L.hu) options.push({ label: view.window ? '胡牌' : '自摸', action: { type: 'hu' } });
  if (view.window?.tile) {
    lines.push(
      `${view.window.source !== null ? seatName(seat, view.window.source, 4) : '有人'}打出 ${tileName(view.window.tile)}，你可以选择：`,
    );
    if (L.gang.length) options.push({ label: `杠 ${tileName(view.window.tile)}`, action: { type: 'gang' } });
    if (L.peng) options.push({ label: `碰 ${tileName(view.window.tile)}`, action: { type: 'peng' } });
    for (const pair of L.chi) {
      const tiles = pair.map((id) => view.hand.find((t) => t.id === id)!).filter(Boolean);
      options.push({
        label: `吃 ${[...tiles, view.window.tile].map(tileName).join('')}`,
        action: { type: 'chi', tiles: pair },
      });
    }
  } else {
    for (const g of L.gang) {
      const t = view.hand.find((x) => x.id === g.tile);
      options.push({
        label: `${g.type === 'an' ? '暗杠' : '补杠'} ${t ? tileName(t) : ''}`,
        action: { type: 'gang', tile: g.tile },
      });
    }
  }
  if (L.pass) options.push({ label: L.hu ? '过（不胡）' : '过', action: { type: 'pass' } });
  if (view.window) {
    lines.push('如果选择「过」，就放弃这次碰杠吃和胡的机会。');
  } else {
    for (const id of L.discard) {
      const t = view.hand.find((x) => x.id === id);
      if (!t) continue;
      options.push({ label: `打出 ${tileName(t)}`, action: { type: 'discard', tile: id } });
    }
  }
  if (!options.length) return null;
  return { situation: lines.join('\n'), options: withRecommended(rec, options) };
}
