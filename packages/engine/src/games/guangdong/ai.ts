import { seatName, withRecommended } from '../../core/ai';
import type { Rng } from '../../core/rng';
import type { AiOption, AiPrompt, Seat } from '../../core/types';
import type { Tile } from '../../mahjong/tiles';
import { kindOf, tileName } from '../../mahjong/tiles';
import { gdBot } from './bot';
import type { GdAction, GdMeld, GdView } from './index';

const tilesText = (tiles: readonly Tile[]) =>
  tiles.length
    ? [...tiles]
        .sort((a, b) => kindOf(a) - kindOf(b))
        .map(tileName)
        .join(' ')
    : '（无）';

const meldText = (m: GdMeld) => {
  const kind = m.type === 'chow' ? '吃' : m.type === 'kong' ? '杠' : '碰';
  return `${kind}${m.tiles.map(tileName).join('')}`;
};

export function gdAiPrompt(view: GdView, seat: Seat, rng: Rng): AiPrompt<GdAction> | null {
  const L = view.legal;
  if (!L || L.ready) return null;
  const rec = gdBot(view, seat, rng);
  const me = view.players[seat];
  const lines = [
    '广东麻将（推倒胡）：108 张只有万条筒；可吃可碰可杠；一家胡牌本盘立即结束，点炮只由点炮者付分。',
  ];
  lines.push(
    `你的手牌：${tilesText(view.hand)}${view.drawn !== null ? `（刚摸到 ${tileName(view.hand.find((t) => t.id === view.drawn) ?? view.hand[0])}）` : ''}`,
  );
  if (me.melds.length) lines.push(`你的吃碰杠：${me.melds.map(meldText).join('，')}`);
  for (const d of [1, 2, 3]) {
    const s = (seat + d) % 4;
    const p = view.players[s];
    const parts = [`${seatName(seat, s, 4)}：手牌 ${p.handCount} 张`];
    if (p.melds.length) parts.push(`副露 ${p.melds.map(meldText).join(' ')}`);
    if (p.river.length)
      parts.push(`最近打出 ${p.river.slice(-6).map((r) => tileName(r.tile)).join(' ')}`);
    if (p.won) parts.push('已胡');
    lines.push(parts.join('，'));
  }
  lines.push(`牌墙剩 ${view.wallCount} 张。`);

  const options: AiOption<GdAction>[] = [];
  if (view.window?.tile) {
    lines.push(
      `${view.window.source !== null ? seatName(seat, view.window.source, 4) : '有人'}打出 ${tileName(view.window.tile)}，你可以选择：`,
    );
  }
  if (L.hu) options.push({ label: view.window ? '胡牌' : '自摸', action: { type: 'hu' } });
  if (view.window) {
    if (L.gang.length) options.push({ label: '杠这张牌', action: { type: 'gang' } });
    if (L.peng) options.push({ label: '碰', action: { type: 'peng' } });
    for (const ids of L.chi) {
      const tiles = ids.map((id) => view.hand.find((t) => t.id === id)).filter(Boolean) as Tile[];
      options.push({ label: `吃 ${tiles.map(tileName).join(' + ')}`, action: { type: 'chi', tiles: ids } });
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
  const seenKind = new Set<number>();
  for (const id of L.discard) {
    const t = view.hand.find((x) => x.id === id);
    if (!t || seenKind.has(kindOf(t))) continue;
    seenKind.add(kindOf(t));
    options.push({ label: `打出 ${tileName(t)}`, action: { type: 'discard', tile: id } });
  }
  if (!options.length) return null;

  // 推荐的打法可能是同一种牌的另一张：换成候选里的那张
  let r = rec;
  if (rec.type === 'discard') {
    const t = view.hand.find((x) => x.id === rec.tile);
    const same = options.find(
      (o) =>
        o.action.type === 'discard' &&
        t &&
        view.hand.find(
          (x) => x.id === (o.action as { tile: number }).tile && kindOf(x) === kindOf(t),
        ),
    );
    if (same) r = same.action;
  }
  return { situation: lines.join('\n'), options: withRecommended(r, options, 40) };
}
