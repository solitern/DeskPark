import { seatName, withRecommended } from '../../core/ai';
import type { Rng } from '../../core/rng';
import type { AiOption, AiPrompt, Seat } from '../../core/types';
import { gd136Bot } from './bot';
import type { GdAction, GdMeld, GdView } from './index';
import { Z_FAN_NAME } from './scoring';
import { sortTiles, tileLabel, type Tile } from './tiles';

const tilesText = (tiles: readonly Tile[]) =>
  tiles.length ? sortTiles(tiles).map(tileLabel).join(' ') : '（无）';

const meldText = (m: GdMeld) => {
  const kind = m.type === 'chow' ? '吃' : m.type === 'kong' ? '杠' : '碰';
  return `${kind}${m.tiles.map(tileLabel).join('')}`;
};

export function gd136AiPrompt(view: GdView, seat: Seat, rng: Rng): AiPrompt<GdAction> | null {
  const L = view.legal;
  if (!L || L.ready) return null;
  const rec = gd136Bot(view, seat, rng);
  const me = view.players[seat];
  const presetName = view.preset === 'laozhang' ? '老章（3 番起胡）' : '鸡平胡（1 番起胡）';
  const lines = [
    `广东麻将 · 字牌版：136 张（万条筒 + 东南西北 + 中发白），无花牌；可碰可杠，吃只能吃序数牌；一家胡牌本盘立即结束，点炮只由点炮者付分。`,
    `当前番制：${presetName}，封顶 ${view.cap} 番；杠分独立结算。`,
  ];
  lines.push(
    `你的手牌：${tilesText(view.hand)}${
      view.drawn !== null
        ? `（刚摸到 ${tileLabel(view.hand.find((t) => t.id === view.drawn) ?? view.hand[0])}）`
        : ''
    }`,
  );
  if (me.melds.length) lines.push(`你的吃碰杠：${me.melds.map(meldText).join('，')}`);
  if (view.nearWin)
    lines.push(
      `注意：你手里已是和牌形状（${view.nearWin.patterns.map((id) => Z_FAN_NAME[id as keyof typeof Z_FAN_NAME] ?? id).join('、')}，${view.nearWin.fan} 番），但本番制要 ${view.nearWin.need} 番起胡，这手牌不能胡，需要继续做番。`,
    );
  for (const d of [1, 2, 3]) {
    const s = (seat + d) % 4;
    const p = view.players[s];
    const parts = [`${seatName(seat, s, 4)}：手牌 ${p.handCount} 张`];
    if (p.melds.length) parts.push(`副露 ${p.melds.map(meldText).join(' ')}`);
    if (p.river.length)
      parts.push(
        `最近打出 ${p.river
          .slice(-6)
          .map((r) => tileLabel(r.tile))
          .join(' ')}`,
      );
    if (p.won) parts.push('已胡');
    lines.push(parts.join('，'));
  }
  lines.push(`牌墙剩 ${view.wallCount} 张。`);

  const options: AiOption<GdAction>[] = [];
  if (view.window?.tile) {
    lines.push(
      `${view.window.source !== null ? seatName(seat, view.window.source, 4) : '有人'}打出 ${tileLabel(view.window.tile)}，你可以选择：`,
    );
  }
  if (L.hu) options.push({ label: view.window ? '胡牌' : '自摸', action: { type: 'hu' } });
  if (view.window) {
    if (L.gang.length) options.push({ label: '杠这张牌', action: { type: 'gang' } });
    if (L.peng) options.push({ label: '碰', action: { type: 'peng' } });
    for (const ids of L.chi) {
      const tiles = ids.map((id) => view.hand.find((t) => t.id === id)).filter(Boolean) as Tile[];
      options.push({
        label: `吃 ${tiles.map(tileLabel).join(' + ')}`,
        action: { type: 'chi', tiles: ids },
      });
    }
  } else {
    for (const g of L.gang) {
      const t = view.hand.find((x) => x.id === g.tile);
      options.push({
        label: `${g.type === 'an' ? '暗杠' : '补杠'} ${t ? tileLabel(t) : ''}`,
        action: { type: 'gang', tile: g.tile },
      });
    }
  }
  if (L.pass) options.push({ label: L.hu ? '过（不胡）' : '过', action: { type: 'pass' } });
  const seenKind = new Set<number>();
  for (const id of L.discard) {
    const t = view.hand.find((x) => x.id === id);
    if (!t || seenKind.has(t.kind)) continue;
    seenKind.add(t.kind);
    options.push({ label: `打出 ${tileLabel(t)}`, action: { type: 'discard', tile: id } });
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
        view.hand.find((x) => x.id === (o.action as { tile: number }).tile && x.kind === t.kind),
    );
    if (same) r = same.action;
  }
  return { situation: lines.join('\n'), options: withRecommended(r, options, 40) };
}
