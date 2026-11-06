import { seatName, withRecommended } from '../../core/ai';
import type { Rng } from '../../core/rng';
import type { AiOption, AiPrompt, Seat } from '../../core/types';
import { heluoBot } from './bot';
import type { HlAction, HlMeld, HlView } from './index';
import { KONG_NAME } from './scoring';
import type { HlTile } from './tiles';
import { hlKindName, sortHlTiles } from './tiles';

const tilesText = (tiles: readonly HlTile[]) =>
  tiles.length
    ? sortHlTiles(tiles)
        .map((t) => hlKindName(t.kind))
        .join(' ')
    : '（无）';

const meldText = (m: HlMeld) =>
  m.type === 'pung'
    ? `碰${hlKindName(m.kind)}`
    : `${KONG_NAME[m.kongType ?? 'ming']}${hlKindName(m.kind)}`;

/** 河洛杠次：把局面整理给大模型，候选只含合法动作（第 1 个是规则电脑的建议） */
export function hlAiPrompt(view: HlView, seat: Seat, rng: Rng): AiPrompt<HlAction> | null {
  const L = view.legal;
  if (!L || L.ready || view.phase !== 'play') return null;
  const rec = heluoBot(view, seat, rng);
  const options: AiOption<HlAction>[] = [];
  if (L.pici) options.push({ label: '屁次（手里三张次牌，直接胡）', action: { type: 'pici' } });
  if (L.hu) options.push({ label: '自摸胡牌', action: { type: 'hu' } });

  if (view.window) {
    const name = hlKindName(view.window.tile.kind);
    if (L.gang.length)
      options.push({
        label: `明杠 ${name}${L.gang[0].ci ? '（开杠就能次胡）' : ''}`,
        action: { type: 'gang' },
      });
    if (L.peng) options.push({ label: `碰 ${name}`, action: { type: 'peng' } });
    if (L.pass) options.push({ label: '不要', action: { type: 'pass' } });
  } else {
    for (const g of L.gang) {
      const t = view.hand.find((x) => x.id === g.tile);
      options.push({
        label: `${KONG_NAME[g.type]} ${t ? hlKindName(t.kind) : ''}${g.ci ? '（开杠就能次胡）' : ''}`,
        action: { type: 'gang', tile: g.tile },
      });
    }
    const recTile = rec.type === 'discard' ? view.hand.find((t) => t.id === rec.tile) : undefined;
    const seen = new Set<number>();
    for (const t of sortHlTiles(view.hand.filter((x) => L.discard.includes(x.id)))) {
      if (seen.has(t.kind)) continue;
      seen.add(t.kind);
      const id = recTile && recTile.kind === t.kind ? recTile.id : t.id;
      options.push({
        label: `打 ${hlKindName(t.kind)}${t.kind === view.ciKind ? '（次牌同种）' : ''}`,
        action: { type: 'discard', tile: id },
      });
    }
  }
  if (options.length <= 1) return null;

  const mode = view.options.mode === 'soft' ? '软次（可自摸，也可次）' : '硬次（只能靠次胡牌）';
  const lines = [
    `玩法：河洛杠次，136 张，只能碰和杠，不能吃。${mode}。开杠先拿次牌试胡，胡了叫「次」；手里有三张与次牌同种可以「屁次」。`,
    `次牌：${view.ciTile ? hlKindName(view.ciTile.kind) : hlKindName(view.ciKind)}。牌墙剩 ${view.wallCount} 张${view.baoActive ? '，已进入包次区（打生张被别人杠出次要包次）' : ''}。`,
    `你的手牌（${view.hand.length} 张）：${tilesText(view.hand)}${view.drawn !== null ? `；刚摸到 ${hlKindName(Math.floor(view.drawn / 4))}` : ''}`,
  ];
  const mine = view.players[seat];
  if (mine.melds.length) lines.push(`你的副露：${mine.melds.map(meldText).join('，')}`);
  for (const d of [1, 2, 3]) {
    const s = (seat + d) % 4;
    const p = view.players[s];
    const river = p.river.slice(-8).map((r) => hlKindName(r.tile.kind));
    lines.push(
      `${seatName(seat, s, 4)}：手牌 ${p.handCount} 张${p.melds.length ? `，副露 ${p.melds.map(meldText).join('，')}` : ''}${p.won ? '，已胡' : ''}；最近打出 ${river.length ? river.join(' ') : '（无）'}`,
    );
  }
  if (view.window) {
    lines.push(
      `${seatName(seat, view.window.source, 4)}刚打出 ${hlKindName(view.window.tile.kind)}，你要不要碰 / 杠？`,
    );
  } else {
    lines.push('轮到你：可以开杠或打出一张牌。');
  }
  lines.push(`当前总分：${view.scores.map((x, i) => `${seatName(seat, i, 4)} ${x}`).join('，')}`);
  return { situation: lines.join('\n'), options: withRecommended(rec, options) };
}
