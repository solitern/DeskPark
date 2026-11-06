import type { Card, Suit } from '../../core/cards';
import { BIG_JOKER, SMALL_JOKER } from '../../core/cards';

/**
 * 双升（升级 / 拖拉机）的牌面大小。
 *
 * 每张牌有一个「门」（effective suit）：主牌统一归为 'T'，副牌是自己的花色。
 * 同一门内用 seq 表示大小与相邻关系（拖拉机要求 seq 连续）：
 * - 副牌：2..A 去掉级牌后依次为 0..11；
 * - 有主花色时的主牌：主花色 2..A（去掉级牌）0..11，副级牌 12，主级牌 13，小王 14，大王 15；
 * - 无主时的主牌：级牌 0，小王 1，大王 2。
 * 不同花色的副级牌 seq 相同（一样大，先出者大），但它们不是对子，也不能连成拖拉机。
 */

export type ESuit = Suit | 'T';

export interface SsCtx {
  /** 本局级牌点数（2..14） */
  level: number;
  /** 主花色；null 表示无主（或尚未定主） */
  trump: Suit | null;
}

export const isTrump = (c: Card, ctx: SsCtx): boolean =>
  c.suit === 'J' || c.rank === ctx.level || (ctx.trump !== null && c.suit === ctx.trump);

export const esuit = (c: Card, ctx: SsCtx): ESuit => (isTrump(c, ctx) ? 'T' : c.suit);

const rankIndex = (rank: number, level: number) => rank - 2 - (rank > level ? 1 : 0);

export function seq(c: Card, ctx: SsCtx): number {
  if (ctx.trump === null) {
    if (c.rank === BIG_JOKER) return 2;
    if (c.rank === SMALL_JOKER) return 1;
    if (c.rank === ctx.level) return 0;
    return rankIndex(c.rank, ctx.level);
  }
  if (c.rank === BIG_JOKER) return 15;
  if (c.rank === SMALL_JOKER) return 14;
  if (c.rank === ctx.level) return c.suit === ctx.trump ? 13 : 12;
  return rankIndex(c.rank, ctx.level);
}

/** 全局排序值：主牌在上，副牌按花色分组（便于手牌排序） */
const SUIT_RANK: Record<Suit, number> = { S: 4, H: 3, C: 2, D: 1, J: 0 };
export function sortValue(c: Card, ctx: SsCtx): number {
  if (isTrump(c, ctx)) {
    // 级牌（无主或副级）按花色细分，便于看清
    return 1000 + seq(c, ctx) * 10 + (c.rank === ctx.level ? SUIT_RANK[c.suit] : 0);
  }
  return SUIT_RANK[c.suit] * 100 + seq(c, ctx);
}

export function sortSs(cards: readonly Card[], ctx: SsCtx): Card[] {
  return [...cards].sort((a, b) => sortValue(b, ctx) - sortValue(a, ctx) || a.id - b.id);
}

export const cardPoints = (c: Card): number =>
  c.rank === 5 ? 5 : c.rank === 10 || c.rank === 13 ? 10 : 0;
export const sumPoints = (cards: readonly Card[]): number =>
  cards.reduce((n, c) => n + cardPoints(c), 0);

const faceKey = (c: Card) => `${c.suit}${c.rank}`;

/** 同一门里的对子（两张完全相同的牌）：返回每个对子的两张牌 */
export function findPairs(cards: readonly Card[]): [Card, Card][] {
  const m = new Map<string, Card[]>();
  for (const c of cards) {
    const k = faceKey(c);
    const list = m.get(k) ?? [];
    list.push(c);
    m.set(k, list);
  }
  const out: [Card, Card][] = [];
  for (const list of m.values()) if (list.length >= 2) out.push([list[0], list[1]]);
  return out;
}

export type CompKind = 'single' | 'pair' | 'tractor';

/** 一手牌拆出的组件：单张、对子或拖拉机 */
export interface Comp {
  kind: CompKind;
  /** 对子数：单张 0、对子 1、拖拉机 ≥2 */
  pairs: number;
  /** 最大一张（或最大一对）的 seq */
  top: number;
  cards: Card[];
}

export interface PairItem {
  seq: number;
  cards: [Card, Card];
}

/** 在若干对子中找最长的连续段（长度相同取最大），返回 seq 从大到小的对子 */
export function longestRun(pool: PairItem[]): PairItem[] {
  const bySeq = new Map<number, PairItem>();
  for (const p of pool) if (!bySeq.has(p.seq)) bySeq.set(p.seq, p);
  const seqs = [...bySeq.keys()].sort((a, b) => b - a);
  let best: PairItem[] = [];
  let cur: PairItem[] = [];
  for (const s of seqs) {
    if (cur.length && cur[cur.length - 1].seq === s + 1) cur.push(bySeq.get(s)!);
    else cur = [bySeq.get(s)!];
    if (cur.length > best.length) best = [...cur];
  }
  return best;
}

export const removeItems = (pool: PairItem[], items: PairItem[]) => {
  const s = new Set(items);
  return pool.filter((p) => !s.has(p));
};

export function pairPool(cards: readonly Card[], ctx: SsCtx): PairItem[] {
  return findPairs(cards).map((cards) => ({ seq: seq(cards[0], ctx), cards }));
}

/**
 * 把同一门的牌拆成组件：先反复取最长的拖拉机，剩余对子为对子，其余为单张。
 * 结果按「拖拉机（长的在前）→ 对子 → 单张」、同类按大小从大到小排序。
 */
export function decompose(cards: readonly Card[], ctx: SsCtx): Comp[] {
  let pool = pairPool(cards, ctx);
  const comps: Comp[] = [];
  const used = new Set<number>();
  for (;;) {
    const run = longestRun(pool);
    if (run.length === 0) break;
    pool = removeItems(pool, run);
    for (const p of run) for (const c of p.cards) used.add(c.id);
    comps.push({
      kind: run.length >= 2 ? 'tractor' : 'pair',
      pairs: run.length,
      top: run[0].seq,
      cards: run.flatMap((p) => p.cards),
    });
  }
  for (const c of cards) {
    if (used.has(c.id)) continue;
    comps.push({ kind: 'single', pairs: 0, top: seq(c, ctx), cards: [c] });
  }
  return sortComps(comps);
}

export function sortComps(comps: Comp[]): Comp[] {
  return [...comps].sort((a, b) => b.pairs - a.pairs || b.top - a.top);
}

/** 同一门里是否有 k 连对且顶端大于 above */
export function hasRunAbove(cards: readonly Card[], ctx: SsCtx, k: number, above: number): boolean {
  const seqs = new Set(pairPool(cards, ctx).map((p) => p.seq));
  for (const top of seqs) {
    if (top <= above) continue;
    let ok = true;
    for (let i = 1; i < k; i++) if (!seqs.has(top - i)) ok = false;
    if (ok) return true;
  }
  return false;
}

/** 某个组件能否被 holder（同一门的牌）压过 */
export function compBeatenBy(comp: Comp, holder: readonly Card[], ctx: SsCtx): boolean {
  if (comp.kind === 'single') return holder.some((c) => seq(c, ctx) > comp.top);
  return hasRunAbove(holder, ctx, comp.pairs, comp.top);
}

/**
 * 跟牌的牌型满足度：[拖拉机里的对子数, 对子数]，只计入领出牌型需要的部分。
 * 拖拉机按领出的拖拉机从长到短依次匹配手里最长的连对（不足则取较短的连对，至少 2 对）。
 */
export function followScore(cards: readonly Card[], lead: Comp[], ctx: SsCtx): [number, number] {
  let pool = pairPool(cards, ctx);
  const totalPairs = pool.length;
  const needPairs = lead.reduce((n, c) => n + c.pairs, 0);
  let t = 0;
  for (const comp of lead) {
    if (comp.kind !== 'tractor') continue;
    const run = longestRun(pool);
    const r = Math.min(comp.pairs, run.length);
    if (r < 2) break;
    const take = run.slice(0, r);
    pool = removeItems(pool, take);
    t += r;
  }
  return [t, Math.min(needPairs, totalPairs)];
}

/**
 * 按领出的牌型拆解 cards（与领出牌同门或全是主牌）：能完全对上牌型时，
 * 返回最大组件对应的大小，否则返回 null。用于判断跟牌 / 毙牌能否大过。
 */
export function shapeValue(cards: readonly Card[], lead: Comp[], ctx: SsCtx): number | null {
  const n = lead.reduce((s, c) => s + c.cards.length, 0);
  if (cards.length !== n) return null;
  let pool = pairPool(cards, ctx);
  let value: number | null = null;
  for (const comp of lead) {
    if (comp.kind !== 'tractor') continue;
    // 在所有长度足够的连段中选顶端最大的，取其顶端 k 对
    const bySeq = new Map<number, PairItem>();
    for (const p of pool) if (!bySeq.has(p.seq)) bySeq.set(p.seq, p);
    let chosen: PairItem[] | null = null;
    for (const top of [...bySeq.keys()].sort((a, b) => b - a)) {
      const run: PairItem[] = [];
      for (let i = 0; i < comp.pairs; i++) {
        const p = bySeq.get(top - i);
        if (!p) break;
        run.push(p);
      }
      if (run.length === comp.pairs) {
        chosen = run;
        break;
      }
    }
    if (!chosen) return null;
    pool = removeItems(pool, chosen);
    value ??= chosen[0].seq;
  }
  const pairComps = lead.filter((c) => c.kind === 'pair').length;
  if (pool.length < pairComps) return null;
  if (pairComps > 0) value ??= Math.max(...pool.map((p) => p.seq));
  value ??= Math.max(...cards.map((c) => seq(c, ctx)));
  return value;
}

/** 抠底倍数：单张 ×2、对子 ×4、n 连对 ×2^(n+1)；甩牌按其中最大的牌型 */
export function bottomMultiplier(lead: Comp[]): number {
  const largest = sortComps(lead)[0];
  if (!largest) return 2;
  return largest.pairs === 0 ? 2 : 2 ** (largest.pairs + 1);
}

/** 升级表：闲家得分 → 哪方升几级 */
export function upgradeFor(defenderPoints: number): { side: 'dealer' | 'defender'; up: number } {
  if (defenderPoints <= 0) return { side: 'dealer', up: 3 };
  if (defenderPoints < 40) return { side: 'dealer', up: 2 };
  if (defenderPoints < 80) return { side: 'dealer', up: 1 };
  if (defenderPoints < 120) return { side: 'defender', up: 0 };
  return { side: 'defender', up: Math.floor((defenderPoints - 120) / 40) + 1 };
}
