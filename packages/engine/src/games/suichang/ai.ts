import { seatName, withRecommended } from '../../core/ai';
import type { Rng } from '../../core/rng';
import type { AiOption, AiPrompt, Seat } from '../../core/types';
import { hzKindOf, kindName, tileName } from '../../mahjong/tiles136';
import { suichangBot } from './bot';
import type { SzAction, SzView } from './index';

const tilesText = (tiles: SzView['hand']) =>
  tiles.length
    ? [...tiles]
        .sort((a, b) => hzKindOf(a) - hzKindOf(b))
        .map(tileName)
        .join(' ')
    : '（无）';

const meldText = (m: SzView['players'][number]['melds'][number]) => {
  if (m.type === 'chi') return `吃${(m.tiles ?? []).map(tileName).join('')}`;
  const name = `${m.type === 'kong' ? '杠' : '碰'}${kindName(m.kind)}`;
  return m.kongType === 'an' ? `暗杠（${name}）` : name;
};

export function szAiPrompt(view: SzView, seat: Seat, rng: Rng): AiPrompt<SzAction> | null {
  const L = view.legal;
  if (!L || L.ready) return null;
  const rec = suichangBot(view, seat, rng);
  const me = view.players[seat];
  const lines = [
    '遂昌麻将：可以吃上家的牌；翻财神，财神可以当任意牌胡，但不能碰杠吃。',
    `第 ${view.session} 盘第 ${view.round} 局，每人 50 筹码；底分 5，庄家底分 ${view.dealerBase}。`,
  ];
  if (view.jokerKind !== null)
    lines.push(`财神：${kindName(view.jokerKind)}（翻出的指示牌 ${view.flip ? tileName(view.flip) : '—'}）`);
  if (view.fly) lines.push(`飞财中：${seatName(seat, view.fly.seat, 4)} 飞了财神，这一圈只能自摸。`);
  lines.push(`你的手牌：${tilesText(view.hand)}`);
  if (me.melds.length) lines.push(`你的副露：${me.melds.map(meldText).join('，')}`);
  for (const d of [1, 2, 3]) {
    const s = (seat + d) % 4;
    const p = view.players[s];
    const parts = [`${seatName(seat, s, 4)}：手牌 ${p.handCount} 张，筹码 ${view.chips[s]}`];
    if (p.melds.length) parts.push(`副露 ${p.melds.map(meldText).join(' ')}`);
    if (p.river.length)
      parts.push(`最近打出 ${p.river.slice(-6).map((r) => tileName(r.tile)).join(' ')}`);
    if (p.won) parts.push('已胡');
    lines.push(parts.join('，'));
  }
  lines.push(`牌墙剩 ${view.wallCount} 张；你当前 ${view.chips[seat]} 筹码。`);

  const options: AiOption<SzAction>[] = [];
  if (L.hu) options.push({ label: view.window ? '胡牌' : '自摸', action: { type: 'hu' } });
  if (view.window?.tile) {
    lines.push(
      `${view.window.source !== null ? seatName(seat, view.window.source, 4) : '有人'}打出 ${tileName(view.window.tile)}，你可以选择：`,
    );
    if (L.gang.length)
      options.push({ label: `杠 ${tileName(view.window.tile)}`, action: { type: 'gang' } });
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
