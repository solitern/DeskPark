/* eslint-disable */
// 导师 v1（bf23244）的原样副本，只供 selfplay-sc.ts 做对照，不参与产品代码。
import { shanten, shantenSevenPairs, shantenStandard, waitingKinds } from '../src/mahjong/analysis';
import type { MjSuit, Tile } from '../src/mahjong/tiles';
import {
  KINDS,
  MJ_SUITS,
  MJ_SUIT_LABEL,
  countKinds,
  kindName,
  kindOf,
  kindRank,
  kindSuit,
  tileName,
} from '../src/mahjong/tiles';
import { chooseExchange, chooseQue, connectivity } from '../src/games/sichuan/bot';
import type { ScMeld, ScView } from '../src/games/sichuan/index';
import type { HandValue, MeldShape } from '../src/games/sichuan/scoring';
import { FAN_CAP, FAN_NAME, evaluateHand, scoreOf } from '../src/games/sichuan/scoring';

/**
 * 四川麻将导师：只看玩家自己能看到的信息（view），给当前这一步出主意并讲清楚为什么。
 *
 * - 牌效（精确计算）：向听数、有效进张（扣掉已经看得见的牌）、进张后的听牌质量；
 * - 价值：听牌时每种叫的剩余张数与番数，清一色、七对、对对胡的方向；
 * - 防守（经验估计）：对手可能听牌的程度、清一色迹象、对手缺门的牌对他绝对安全；
 * - 川麻特有：换三张、定缺、先打缺门、碰 / 杠 / 胡、查花猪与查大叫。
 *
 * 导师只给建议，不替玩家做决定。
 */

export type ScCoachStage = 'exchange' | 'que' | 'discard' | 'claim' | 'wait' | 'won' | 'none';
export type ScCoachTone = 'best' | 'good' | 'warn' | 'bad';
/** 放炮风险：0 较安全、1 一般、2 危险 */
export type ScDanger = 0 | 1 | 2;
export const DANGER_NAME = ['较安全', '要小心', '危险'] as const;

export interface ScWait {
  kind: number;
  /** 还没出现的张数 */
  left: number;
  fan: number;
  /** 番型说明，例如「清一色 · 根×1」 */
  label: string;
}

export interface ScDiscardOption {
  kind: number;
  /** 打这一种牌时用哪一张（有摸到的那张就用它） */
  tile: number;
  shanten: number;
  /** 有效进张：张数与种数 */
  ukeire: number;
  ukeireKinds: number;
  waits: ScWait[];
  danger: ScDanger;
  /** 简短说明，如「缺门」「做清一色」 */
  note: string;
  score: number;
}

export interface ScCoachJudge {
  tone: ScCoachTone;
  text: string;
}

export interface ScCoach {
  stage: ScCoachStage;
  /** 一句话建议 */
  title: string;
  /** 自己的牌现在离胡牌多远 */
  status: string;
  points: string[];
  /** 提醒：对手动向、查花猪 / 查大叫等 */
  tips: string[];
  advice: {
    tiles: number[];
    suit?: MjSuit;
    action?: 'hu' | 'gang' | 'peng' | 'pass' | 'discard' | 'exchange' | 'que';
  };
  /** 出牌时的候选（好的在前） */
  options: ScDiscardOption[];
  /** 是否值得显示放炮风险 */
  showDanger: boolean;
  /** 防守模式：离听牌还远、对手可能已听，先打安全牌 */
  defense: boolean;
  /** 交给大模型的事实摘要 */
  facts: string;
}

const SHANTEN_CN = ['听牌', '一向听', '两向听', '三向听', '四向听', '五向听', '六向听', '七向听'];
export const shantenName = (s: number) => (s < 0 ? '和牌' : (SHANTEN_CN[s] ?? `${s} 向听`));
const POS = ['你', '下家', '对家', '上家'];
const suitCn = (s: MjSuit) => MJ_SUIT_LABEL[s];

/* ------------------------------------------------------------------ */
/* 局面信息                                                             */

interface Opp {
  seat: number;
  pos: string;
  que: MjSuit | null;
  /** 估计已经听牌的可能性 0–1 */
  ready: number;
  /** 疑似在做清一色的花色 */
  flush: MjSuit | null;
  turns: number;
  melds: ScMeld[];
  river: Tile[];
}

interface Ctx {
  v: ScView;
  me: number;
  hand: Tile[];
  que: MjSuit | null;
  melds: ScMeld[];
  m: number;
  shapes: MeldShape[];
  /** 每种牌还没出现的张数 */
  left: number[];
  opps: Opp[];
  /** 对手中最可能听牌的程度 */
  threat: number;
}

function opponents(v: ScView, me: number): Opp[] {
  const out: Opp[] = [];
  for (const d of [1, 2, 3]) {
    const s = (me + d) % 4;
    const p = v.players[s];
    if (p.won) continue;
    const river = p.river.map((r) => r.tile);
    const turns = river.length + p.melds.length;
    // 经验估计：打到七八巡以后越来越可能听牌，碰杠多也更快
    let ready = 1 / (1 + Math.exp(-(turns - 9) / 2.2)) + 0.1 * p.melds.length;
    if (v.wallCount < 16) ready += 0.1;
    ready = Math.max(0, Math.min(0.95, ready));
    // 清一色迹象：碰杠都是一门，牌河里几乎没有这一门
    let flush: MjSuit | null = null;
    const live = MJ_SUITS.filter((x) => x !== p.que);
    const inRiver = (x: MjSuit) => river.filter((t) => t.suit === x).length;
    const meldSuits = new Set(p.melds.map((x) => kindSuit(x.kind)));
    if (live.length === 2) {
      if (meldSuits.size === 1) {
        const x = [...meldSuits][0];
        const o = live.find((y) => y !== x)!;
        if (live.includes(x) && inRiver(x) <= 1 && inRiver(o) >= 2) flush = x;
      } else if (meldSuits.size === 0) {
        for (const x of live) {
          const o = live.find((y) => y !== x)!;
          if (inRiver(x) === 0 && inRiver(o) >= 5) flush = x;
        }
      }
    }
    out.push({ seat: s, pos: POS[d], que: p.que, ready, flush, turns, melds: p.melds, river });
  }
  return out;
}

function contextOf(v: ScView): Ctx {
  const me = v.seat ?? 0;
  const p = v.players[me];
  const opps = opponents(v, me);
  return {
    v,
    me,
    hand: v.hand,
    que: p.que,
    melds: p.melds,
    m: p.melds.length,
    shapes: p.melds.map((x) => ({ type: x.type, kind: x.kind })),
    left: v.visible.map((n) => Math.max(0, 4 - n)),
    opps,
    threat: opps.reduce((a, o) => Math.max(a, o.ready), 0),
  };
}

/* ------------------------------------------------------------------ */
/* 牌效                                                                 */

const usefulCounts = (tiles: readonly Tile[], que: MjSuit | null) =>
  countKinds(que ? tiles.filter((t) => t.suit !== que) : tiles);

/** 向听数：手里还有缺门时，每张缺门都要先换掉，至少要这么多步 */
const sh = (c: number[], m: number, queLeft: number) => Math.max(shanten(c, m), queLeft);

function ukeire(c: number[], m: number, s: number, left: readonly number[], que: MjSuit | null) {
  let n = 0;
  const kinds: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if ((que && kindSuit(k) === que) || left[k] <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, m) < s) {
      n += left[k];
      kinds.push(k);
    }
    c[k]--;
  }
  return { n, kinds };
}

/** 摸到有效牌之后，平均还能有多少进张（越大说明后面越好改、听牌越宽） */
function afterDraw(
  c: number[],
  m: number,
  s: number,
  left: readonly number[],
  que: MjSuit | null,
): number {
  const { kinds } = ukeire(c, m, s, left, que);
  let total = 0;
  let weight = 0;
  for (const k of kinds) {
    const l2 = [...left];
    l2[k]--;
    c[k]++;
    let best = 0;
    for (let j = 0; j < KINDS; j++) {
      if (c[j] === 0) continue;
      c[j]--;
      const s2 = shanten(c, m);
      if (s2 < s) best = Math.max(best, ukeire(c, m, s2, l2, que).n);
      c[j]++;
    }
    c[k]--;
    total += left[k] * best;
    weight += left[k];
  }
  return weight ? total / weight : 0;
}

function valueLabel(v: HandValue): string {
  const parts = v.patterns.map((p) => FAN_NAME[p]);
  if (v.roots) parts.push(`根×${v.roots}`);
  if (v.jingoudiao) parts.push('金钩钓');
  return parts.join(' · ');
}

function waitsOf(ctx: Ctx, c: number[]): ScWait[] {
  const out: ScWait[] = [];
  for (const k of waitingKinds(c, ctx.m, (x) => kindSuit(x) !== ctx.que)) {
    c[k]++;
    const v = evaluateHand(c, ctx.shapes, { jingoudiao: ctx.v.options.jingoudiao });
    c[k]--;
    if (v) out.push({ kind: k, left: ctx.left[k], fan: v.base, label: valueLabel(v) });
  }
  return out;
}

const waitsText = (ws: ScWait[]) =>
  ws.map((w) => `${kindName(w.kind)}（剩 ${w.left} 张，${w.label} ${w.fan} 番）`).join('、');

/** 清一色方向：一门（含碰杠）已经很多、另一门很少 */
function flushPlan(ctx: Ctx): { main: MjSuit; minor: MjSuit; total: number } | null {
  const live = MJ_SUITS.filter((s) => s !== ctx.que);
  if (live.length !== 2) return null;
  const all = [...ctx.hand, ...ctx.melds.flatMap((m) => m.tiles)].filter((t) => t.suit !== ctx.que);
  const n = (s: MjSuit) => all.filter((t) => t.suit === s).length;
  const [main, minor] = [...live].sort((a, b) => n(b) - n(a));
  const meldSuits = new Set(ctx.melds.map((m) => kindSuit(m.kind)));
  if (meldSuits.has(minor)) return null;
  if (n(main) >= 9 && n(minor) <= 5) return { main, minor, total: n(main) };
  return null;
}

/* ------------------------------------------------------------------ */
/* 防守                                                                 */

function dangerScore(ctx: Ctx, k: number): number {
  const suit = kindSuit(k);
  const r = kindRank(k);
  let d = 0;
  for (const o of ctx.opps) {
    if (suit === o.que) continue; // 对手缺这一门：他不可能胡这张
    let f = o.ready;
    if (o.flush) f *= suit === o.flush ? 1.6 : 0.25;
    f *= r === 1 || r === 9 ? 0.6 : r === 2 || r === 8 ? 0.8 : 1;
    if (ctx.v.visible[k] >= 3) f *= 0.55; // 这张已经见了三张：对碰、单钓都不太可能
    if (o.river.some((t) => kindOf(t) === k)) f *= 0.75;
    d += f;
  }
  return d;
}
const dangerLevel = (d: number): ScDanger => (d < 0.5 ? 0 : d < 1.2 ? 1 : 2);

/** 某张牌为什么相对安全（找一条最有说服力的理由） */
function safeReason(ctx: Ctx, k: number): string | null {
  const suit = kindSuit(k);
  const live = ctx.opps.filter((o) => o.ready >= 0.3);
  if (live.length && live.every((o) => o.que === suit))
    return `${live.map((o) => o.pos).join('、')}都缺${suitCn(suit)}，${suitCn(suit)}子对他们绝对安全`;
  const q = live.find((o) => o.que === suit);
  if (q) return `${q.pos}缺${suitCn(suit)}，这张对他绝对安全`;
  if (ctx.v.visible[k] >= 3)
    return `${kindName(k)} 已经出现了 ${ctx.v.visible[k]} 张，别人很难用它胡`;
  return null;
}

function readTips(ctx: Ctx): string[] {
  const tips: string[] = [];
  for (const o of ctx.opps) {
    if (o.flush) {
      const how = o.melds.length
        ? `碰杠的都是${suitCn(o.flush)}子`
        : `一直在打别的牌、一张${suitCn(o.flush)}都没打`;
      tips.push(`${o.pos}${how}，可能在做清一色${suitCn(o.flush)}，${suitCn(o.flush)}子要小心`);
    } else if (o.ready >= 0.65) {
      tips.push(
        `${o.pos}已经打了 ${o.river.length} 张${o.melds.length ? `、碰杠 ${o.melds.length} 组` : ''}，很可能听牌了`,
      );
    }
  }
  return tips.slice(0, 2);
}

const EMPTY: ScCoach = {
  stage: 'none',
  title: '',
  status: '',
  points: [],
  tips: [],
  advice: { tiles: [] },
  options: [],
  showDanger: false,
  defense: false,
  facts: '',
};

/* ------------------------------------------------------------------ */
/* 各阶段                                                               */

function suitSummary(hand: readonly Tile[], s: MjSuit): string {
  const ts = hand.filter((t) => t.suit === s);
  const c = countKinds(ts);
  const pairs = c.filter((n) => n >= 2).length;
  const links = ts.filter((t) => connectivity(ts, t) > 0).length;
  const shape = pairs ? `${pairs} 对` : links ? '有连张' : '很散';
  return `${suitCn(s)} ${ts.length} 张（${ts.length ? shape : '没有'}）`;
}

function coachExchange(ctx: Ctx): ScCoach {
  const hand = ctx.hand;
  const rec = chooseExchange(hand);
  const recTiles = rec.map((id) => hand.find((t) => t.id === id)!);
  const suit = recTiles[0].suit;
  const n = hand.filter((t) => t.suit === suit).length;
  const dir = ctx.v.exchangeDir;
  const dirText = dir === 'next' ? '换给下家' : dir === 'prev' ? '换给上家' : '换给对家';
  const points = [
    `三门的情况：${MJ_SUITS.map((s) => suitSummary(hand, s)).join('，')}`,
    n === 3
      ? `${suitCn(suit)}子正好 3 张，换走以后这门一张不剩，定缺${suitCn(suit)}最轻松`
      : `${suitCn(suit)}子最弱，换走最散的三张；剩下的 ${n - 3} 张以后定缺${suitCn(suit)}时再打掉`,
    `这次是${dirText}：你也会从另一家收到三张同一门的牌，换进来的牌不一定好，先别急着定缺`,
  ];
  const title = `建议换出 ${recTiles.map(tileName).join(' ')}`;
  return {
    stage: 'exchange',
    title,
    status: '',
    points,
    tips: [],
    advice: { tiles: rec, action: 'exchange' },
    options: [],
    showDanger: false,
    defense: false,
    facts: `阶段：换三张（${dirText}）。手牌：${handText(hand)}。导师建议：${title}。理由：${points.join('；')}。`,
  };
}

function judgeExchange(
  hand: readonly Tile[],
  rec: readonly number[],
  selected: readonly number[],
): ScCoachJudge | null {
  if (selected.length !== 3) return null;
  const ts = selected.map((id) => hand.find((t) => t.id === id)).filter((t): t is Tile => !!t);
  if (!ts.every((t) => t.suit === ts[0].suit))
    return { tone: 'bad', text: '换三张必须是同一门的三张' };
  if (ts.every((t) => rec.includes(t.id)))
    return { tone: 'best', text: '你选的正是导师推荐的三张' };
  const suit = hand.find((t) => t.id === rec[0])!.suit;
  const n = hand.filter((t) => t.suit === suit).length;
  const s2 = ts[0].suit;
  const all = hand.filter((t) => t.suit === s2);
  const c = countKinds(all);
  const broken = ts.filter((t) => c[kindOf(t)] >= 2 && c[kindOf(t)] < 4);
  if (s2 !== suit && all.length > n + 1)
    return {
      tone: 'warn',
      text: `你选的是${suitCn(s2)}子（${all.length} 张）。这门比${suitCn(suit)}子（${n} 张）多，换走三张有点可惜`,
    };
  if (broken.length)
    return {
      tone: 'warn',
      text: `你选的三张拆掉了对子 ${tileName(broken[0])}，对子留着可以碰，换别的散牌更好`,
    };
  return { tone: 'good', text: `换${suitCn(s2)}子也可以，和推荐的差不多` };
}

function coachQue(ctx: Ctx): ScCoach {
  const hand = ctx.hand;
  const rec = chooseQue(hand);
  const n = hand.filter((t) => t.suit === rec).length;
  const points = [
    `三门的情况：${MJ_SUITS.map((s) => suitSummary(hand, s)).join('，')}`,
    n === 0
      ? `你手里一张${suitCn(rec)}都没有，缺${suitCn(rec)}不用打掉任何牌`
      : `缺${suitCn(rec)}：只需要打掉 ${n} 张，而且这门最弱`,
    '定缺之后，这门的牌要先打完才能胡；流局时手里还有缺门会被查花猪（赔给每家最高番）',
  ];
  const others = MJ_SUITS.filter((s) => s !== rec);
  const big = others.find((s) => hand.filter((t) => t.suit === s).length >= 8);
  if (big)
    points.push(
      `${suitCn(big)}子已经有 ${hand.filter((t) => t.suit === big).length} 张，可以考虑往清一色做（3 番起）`,
    );
  const recv = ctx.v.exchange?.received;
  if (recv?.length) points.push(`刚换进来的是 ${recv.map(tileName).join(' ')}`);
  const title = `建议定缺${suitCn(rec)}`;
  return {
    stage: 'que',
    title,
    status: '',
    points,
    tips: [],
    advice: {
      tiles: hand.filter((t) => t.suit === rec).map((t) => t.id),
      suit: rec,
      action: 'que',
    },
    options: [],
    showDanger: false,
    defense: false,
    facts: `阶段：定缺。手牌：${handText(hand)}。导师建议：${title}。理由：${points.join('；')}。`,
  };
}

const handText = (tiles: readonly Tile[]) =>
  [...tiles]
    .sort((a, b) => kindOf(a) - kindOf(b))
    .map(tileName)
    .join(' ');

/** 当前 13 张（或碰后待打）手牌的状态描述 */
function statusOf(ctx: Ctx): { text: string; shanten: number; waits: ScWait[] } {
  const q = ctx.que ? ctx.hand.filter((t) => t.suit === ctx.que).length : 0;
  const c = usefulCounts(ctx.hand, ctx.que);
  if (q > 0) {
    const s = sh(c, ctx.m, q);
    return { text: `还有 ${q} 张缺门要打 · ${shantenName(s)}`, shanten: s, waits: [] };
  }
  const s = shanten(c, ctx.m);
  if (s === 0) {
    const ws = waitsOf(ctx, c);
    const live = ws.reduce((a, w) => a + w.left, 0);
    return {
      text: `听牌：${ws.map((w) => kindName(w.kind)).join(' ')}（还剩 ${live} 张）`,
      shanten: 0,
      waits: ws,
    };
  }
  return { text: shantenName(s), shanten: s, waits: [] };
}

function optionScore(
  o: { shanten: number; ukeire: number; waits: ScWait[]; next: number; kind: number },
  danger: number,
  defense: boolean,
  plan: ReturnType<typeof flushPlan>,
): number {
  const r = kindRank(o.kind);
  const live = o.waits.reduce((a, w) => a + w.left, 0);
  // 听牌但叫已经全出完（死叫）：和一向听差不多
  const s = o.shanten === 0 && live === 0 ? 1 : o.shanten;
  if (defense) return dangerLevel(danger) * 1000 + danger * 60 + s * 100 - o.ukeire;
  if (s === 0) {
    const value = o.waits.reduce(
      (a, w) => a + w.left * (1 + 0.6 * (Math.min(w.fan, FAN_CAP) - 1)),
      0,
    );
    return -value * 10 + danger * 8;
  }
  let score = s * 1000 - o.ukeire * 10 - o.next * 3 + danger * 12;
  if (plan && kindSuit(o.kind) === plan.minor) score -= Math.min(100, 40 + 10 * (plan.total - 9));
  if (r === 1 || r === 9) score -= 3;
  return score;
}

function optionLine(o: ScDiscardOption): string {
  if (o.note === '缺门') return `${kindName(o.kind)}：缺门，必须先打`;
  if (o.shanten === 0 && o.waits.length) return `打 ${kindName(o.kind)} 听 ${waitsText(o.waits)}`;
  return `打 ${kindName(o.kind)}：${shantenName(o.shanten)}，进 ${o.ukeireKinds} 种 ${o.ukeire} 张`;
}

function coachDiscard(ctx: Ctx): ScCoach {
  const v = ctx.v;
  const L = v.legal!;
  const hand = ctx.hand;
  const points: string[] = [];
  const tips: string[] = readTips(ctx);
  const q = ctx.que ? hand.filter((t) => t.suit === ctx.que).length : 0;
  const plan = flushPlan(ctx);

  // 自摸
  if (L.hu) {
    const c = usefulCounts(hand, ctx.que);
    const val = evaluateHand(c, ctx.shapes, { jingoudiao: v.options.jingoudiao });
    const fan = val?.base ?? 1;
    const pts = scoreOf(fan, v.options.baseScore);
    const payers = ctx.opps.length;
    points.push(
      `自摸：${val ? valueLabel(val) : '平胡'}，至少 ${fan} 番，还没胡的 ${payers} 家每家付你 ${pts} 分（杠上花、海底等另外加番）`,
    );
    points.push('血战到底先胡先走：胡了以后这一盘就不用再担心点炮');
    if (L.mustHu) points.push('牌墙只剩 4 张，按规则能胡必须胡');
    return {
      stage: 'discard',
      title: '可以自摸，胡！',
      status: '已经可以胡牌',
      points,
      tips: [],
      advice: { tiles: [], action: 'hu' },
      options: [],
      showDanger: false,
      defense: false,
      facts: `阶段：自己摸牌后可以自摸胡。手牌：${handText(hand)}。${points.join('；')}。`,
    };
  }

  // 候选：每种牌只算一次
  const byKind = new Map<number, number>();
  for (const id of L.discard) {
    const t = hand.find((x) => x.id === id)!;
    const k = kindOf(t);
    if (!byKind.has(k) || id === v.drawn) byKind.set(k, id);
  }

  const raw = [...byKind.entries()].map(([k, id]) => {
    const t = hand.find((x) => x.id === id)!;
    const rest = hand.filter((x) => x.id !== id);
    const qLeft = q - (t.suit === ctx.que ? 1 : 0);
    const c = usefulCounts(rest, ctx.que);
    const s = sh(c, ctx.m, qLeft);
    const uk = qLeft === 0 ? ukeire(c, ctx.m, s, ctx.left, ctx.que) : { n: 0, kinds: [] };
    const waits = qLeft === 0 && s === 0 ? waitsOf(ctx, c) : [];
    return {
      kind: k,
      tile: id,
      c,
      shanten: s,
      ukeire: uk.n,
      ukeireKinds: uk.kinds.length,
      waits,
      next: 0,
      que: t.suit === ctx.que,
    };
  });
  const minS = Math.min(...raw.map((o) => o.shanten));
  // 只对最快的几种再往后看一步
  if (minS >= 1 && q === 0)
    for (const o of raw)
      if (o.shanten === minS) o.next = afterDraw(o.c, ctx.m, o.shanten, ctx.left, ctx.que);

  const defense =
    q === 0 &&
    ((minS >= 2 && ctx.threat >= 0.55) || (minS >= 1 && v.wallCount <= 16 && ctx.threat >= 0.6));
  const showDanger = ctx.threat >= 0.45;

  const options: ScDiscardOption[] = raw
    .map((o) => {
      const d = dangerScore(ctx, o.kind);
      let score: number;
      if (o.que) {
        // 缺门：平时先打中张（越往后越危险），危险时先打最安全的
        const r = kindRank(o.kind);
        const later =
          (r === 1 || r === 9 ? 0.6 : r === 2 || r === 8 ? 0.8 : 1) *
          (v.visible[o.kind] >= 3 ? 0.5 : 1);
        score = ctx.threat >= 0.5 ? d * 100 : -later * 100 + d * 20;
      } else score = optionScore(o, d, defense, plan);
      return {
        kind: o.kind,
        tile: o.tile,
        shanten: o.shanten,
        ukeire: o.ukeire,
        ukeireKinds: o.ukeireKinds,
        waits: o.waits,
        danger: dangerLevel(d),
        note: o.que
          ? '缺门'
          : plan && kindSuit(o.kind) === plan.minor
            ? `清一色${suitCn(plan.main)}`
            : '',
        score,
      };
    })
    .sort((a, b) => a.score - b.score);

  if (!options.length) return { ...EMPTY, stage: 'discard', status: statusOf(ctx).text };
  const best = options[0];
  const second = options.find((o) => o.kind !== best.kind);

  // 杠
  let gangAdvice: { tile: number; name: string; text: string } | null = null;
  const c14 = usefulCounts(hand, ctx.que);
  for (const g of L.gang) {
    const t = hand.find((x) => x.id === g.tile)!;
    const k = kindOf(t);
    const c = [...c14];
    if (g.type === 'an') {
      c[k] = 0;
      const s = shanten(c, ctx.m + 1);
      if (s <= minS)
        gangAdvice = {
          tile: g.tile,
          name: `暗杠 ${kindName(k)}`,
          text: `暗杠 ${kindName(k)}（下雨）：还没胡的每家付你 2 分，胡牌时多一个根（+1 番），而且不影响你的牌型`,
        };
      else tips.push(`暗杠 ${kindName(k)} 会拆坏牌型（变成${shantenName(s)}），先不杠`);
    } else {
      c[k]--;
      const s = shanten(c, ctx.m);
      const d = dangerLevel(dangerScore(ctx, k));
      if (s <= minS && d < 2)
        gangAdvice = {
          tile: g.tile,
          name: `补杠 ${kindName(k)}`,
          text: `补杠 ${kindName(k)}（刮风）：还没胡的每家付你 1 分，多一个根，牌型不受影响`,
        };
      else if (d === 2) tips.push(`补杠 ${kindName(k)} 可能被听这张的人抢杠胡，先别杠`);
    }
  }

  let title: string;
  if (gangAdvice) {
    title = `建议${gangAdvice.name}`;
    points.push(gangAdvice.text, '杠完会从牌墙补一张，再决定打哪张');
  } else if (best.note === '缺门') {
    title = `先打缺门：${kindName(best.kind)}`;
    points.push(
      `手里还有 ${q} 张缺门（${suitCn(ctx.que!)}）：缺门打完才能胡；流局时还拿着缺门会被查花猪，要赔给每家最高番`,
    );
    if (q > 1)
      points.push(
        ctx.threat >= 0.5
          ? `对手可能快听牌了，缺门里先打最安全的这张`
          : `缺门里先打中间的牌：越往后别人越可能要它，越不好打`,
      );
  } else {
    title = `建议打 ${kindName(best.kind)}`;
    if (best.shanten === 0 && best.waits.length) {
      const live = best.waits.reduce((a, w) => a + w.left, 0);
      points.push(
        `打 ${kindName(best.kind)} 就听牌了：听 ${waitsText(best.waits)}，一共还剩 ${live} 张`,
      );
      if (second && second.shanten === 0 && second.waits.length) {
        const live2 = second.waits.reduce((a, w) => a + w.left, 0);
        points.push(
          `对比：打 ${kindName(second.kind)} 听 ${second.waits.map((w) => kindName(w.kind)).join(' ')}，只剩 ${live2} 张${live2 >= live ? '，但番数更小' : ''}`,
        );
      }
    } else {
      points.push(
        `打 ${kindName(best.kind)} 后${shantenName(best.shanten)}（还差 ${best.shanten} 张有用的牌就听牌），能进 ${best.ukeireKinds} 种、共 ${best.ukeire} 张牌`,
      );
      if (second && !defense) {
        if (second.shanten > best.shanten)
          points.push(`其他牌大多会退成${shantenName(second.shanten)}，离胡牌更远`);
        else if (best.note && second.ukeire >= best.ukeire)
          points.push(
            `打 ${kindName(second.kind)} 进张也差不多（${second.ukeire} 张），但你的${suitCn(plan!.main)}子已经有 ${plan!.total} 张，先打掉${suitCn(plan!.minor)}子往清一色做（3 番起）`,
          );
        else if (second.ukeire < best.ukeire)
          points.push(
            `打 ${kindName(second.kind)} 只能进 ${second.ukeire} 张，比这张少 ${best.ukeire - second.ukeire} 张`,
          );
        else
          points.push(`打 ${kindName(second.kind)} 也差不多，这张摸到有效牌后更容易形成好听的叫`);
      }
    }
    if (defense) {
      const why = safeReason(ctx, best.kind);
      points.push(
        `你离听牌还远（${shantenName(minS)}），对手可能已经听了：先打相对安全的牌，少点炮${why ? `——${why}` : ''}`,
      );
    } else if (showDanger && best.danger === 2) {
      tips.push(`${kindName(best.kind)} 有点危险，但它对你没用、留着更难打，现在打还算合算`);
    }
    if (ctx.m === 0) {
      const c = usefulCounts(
        hand.filter((x) => x.id !== best.tile),
        ctx.que,
      );
      const s7 = shantenSevenPairs(c);
      if (s7 <= shantenStandard(c, 0) && s7 <= 2) {
        const pairs = c.reduce((a, n) => a + Math.floor(n / 2), 0);
        points.push(
          `这手也可以做七对（暗七对 3 番）：已经有 ${pairs} 对，再凑 ${7 - pairs} 对就能胡`,
        );
      }
    }
  }

  // 查大叫 / 查花猪
  if (v.wallCount <= 12) {
    if (q > 0) tips.unshift(`牌墙只剩 ${v.wallCount} 张，手里还有缺门：流局时会被查花猪`);
    else if (minS > 0)
      tips.unshift(
        `牌墙只剩 ${v.wallCount} 张，你还没听牌：流局时没听牌要赔给听牌的人（查大叫），尽快听牌`,
      );
  }

  const status = statusOf(ctx);
  const st14 =
    q > 0
      ? `还有 ${q} 张缺门要打`
      : minS === 0
        ? '打一张就能听牌'
        : `打完一张：${shantenName(minS)}`;
  return {
    stage: 'discard',
    title,
    status: L.discard.length ? st14 : status.text,
    points,
    tips: tips.slice(0, 3),
    advice: gangAdvice
      ? { tiles: [gangAdvice.tile], action: 'gang' }
      : { tiles: [best.tile], action: 'discard' },
    options,
    showDanger,
    defense,
    facts: [
      `阶段：轮到学生出牌。手牌：${handText(hand)}${ctx.que ? `，定缺${suitCn(ctx.que)}` : ''}${ctx.melds.length ? `，碰杠：${ctx.melds.map((m) => `${m.type === 'kong' ? '杠' : '碰'}${kindName(m.kind)}`).join(' ')}` : ''}。牌墙剩 ${v.wallCount} 张。`,
      `导师建议：${title}。理由：${points.join('；')}。`,
      `各候选：${options.slice(0, 4).map(optionLine).join('；')}。`,
      tips.length ? `提醒：${tips.join('；')}。` : '',
    ].join(''),
  };
}

function judge(o: ScDiscardOption, best: ScDiscardOption, defense: boolean): ScCoachJudge {
  if (o.kind === best.kind)
    return { tone: 'best', text: `你选的 ${kindName(o.kind)} 正是导师推荐的这张` };
  if (best.note === '缺门' && o.note === '缺门')
    return { tone: 'good', text: `${kindName(o.kind)} 也是缺门，先打哪张差别不大` };
  if (defense && o.danger > best.danger)
    return {
      tone: o.danger === 2 ? 'bad' : 'warn',
      text: `${kindName(o.kind)} ${DANGER_NAME[o.danger]}：对手可能已经听牌，这时候点炮不划算`,
    };
  if (o.shanten > best.shanten)
    return {
      tone: 'bad',
      text: `打 ${kindName(o.kind)} 会退成${shantenName(o.shanten)}，比打 ${kindName(best.kind)} 离胡牌多一步`,
    };
  if (o.shanten === 0 && best.shanten === 0) {
    const a = o.waits.reduce((x, w) => x + w.left, 0);
    const b = best.waits.reduce((x, w) => x + w.left, 0);
    const fa = Math.max(0, ...o.waits.map((w) => w.fan));
    const fb = Math.max(0, ...best.waits.map((w) => w.fan));
    if (a < b && fa <= fb)
      return {
        tone: 'warn',
        text: `打 ${kindName(o.kind)} 也能听，但只剩 ${a} 张可以胡，打 ${kindName(best.kind)} 剩 ${b} 张`,
      };
    return {
      tone: 'good',
      text: `打 ${kindName(o.kind)} 也能听：剩 ${a} 张、最多 ${fa} 番，和推荐的各有好处`,
    };
  }
  if (o.ukeire < best.ukeire * 0.75)
    return {
      tone: 'warn',
      text: `打 ${kindName(o.kind)} 也是${shantenName(o.shanten)}，但只能进 ${o.ukeire} 张，比打 ${kindName(best.kind)} 少 ${best.ukeire - o.ukeire} 张`,
    };
  if (best.note && !o.note)
    return { tone: 'good', text: `打 ${kindName(o.kind)} 进张也不错；不过导师更想让你往清一色做` };
  return { tone: 'good', text: `打 ${kindName(o.kind)} 也可以，和推荐的差不多` };
}

function coachClaim(ctx: Ctx): ScCoach {
  const v = ctx.v;
  const L = v.legal!;
  const tile = v.window!.tile!;
  const k = kindOf(tile);
  const src = v.window!.source;
  const who = src !== null ? POS[(src - ctx.me + 4) % 4] : '对手';
  const q = ctx.que ? ctx.hand.filter((t) => t.suit === ctx.que).length : 0;
  const c13 = usefulCounts(ctx.hand, ctx.que);
  const s0 = sh(c13, ctx.m, q);
  const uk0 = q === 0 ? ukeire([...c13], ctx.m, s0, ctx.left, ctx.que).n : 0;
  const points: string[] = [];
  const tips = readTips(ctx);
  const rob = v.window!.kind === 'rob';
  let action: 'hu' | 'gang' | 'peng' | 'pass';
  let title: string;

  if (L.hu) {
    const c = [...c13];
    c[k]++;
    const val = evaluateHand(c, ctx.shapes, { jingoudiao: v.options.jingoudiao });
    const fan = (val?.base ?? 1) + (rob ? 1 : 0);
    action = 'hu';
    title = rob ? `可以抢杠胡 ${kindName(k)}！` : `可以胡 ${kindName(k)}！`;
    points.push(
      `胡 ${kindName(k)}：${val ? valueLabel(val) : '平胡'}${rob ? ' · 抢杠' : ''}，${fan} 番，${who}付你 ${scoreOf(fan, v.options.baseScore)} 分`,
      '血战到底先胡先走：胡了以后这一盘就不用再担心点炮',
      '如果选「过」，在你下次摸牌之前都不能再胡别人打的牌（过水）',
    );
    if (L.mustHu) points.push('牌墙只剩 4 张，按规则能胡必须胡');
  } else {
    let sg: number | null = null;
    if (L.gang.length) {
      const c = [...c13];
      c[k] -= 3;
      sg = sh(c, ctx.m + 1, q);
    }
    let sp: number | null = null;
    let ukp = 0;
    if (L.peng) {
      const c = [...c13];
      c[k] -= 2;
      if (q > 0) sp = sh(c, ctx.m + 1, q - 1);
      else {
        sp = 99;
        for (let j = 0; j < KINDS; j++) {
          if (c[j] === 0) continue;
          c[j]--;
          const s = shanten(c, ctx.m + 1);
          const u = ukeire(c, ctx.m + 1, s, ctx.left, ctx.que).n;
          if (s < sp || (s === sp && u > ukp)) {
            sp = s;
            ukp = u;
          }
          c[j]++;
        }
      }
    }
    const plan = flushPlan(ctx);
    const qidui =
      ctx.m === 0 &&
      q === 0 &&
      shantenSevenPairs(c13) <= shantenStandard(c13, 0) &&
      shantenSevenPairs(c13) <= 2;
    const pairs = c13.filter((n) => n >= 2).length + ctx.melds.length;
    const offPlan = plan && kindSuit(k) === plan.minor;

    if (sg !== null && sg <= s0 && !offPlan) {
      action = 'gang';
      title = `建议杠 ${kindName(k)}`;
      points.push(
        `杠（刮风）：${who}付你 2 分，胡牌时多一个根（+1 番），杠完还能从牌墙补一张`,
        `杠完${shantenName(sg)}，牌型不受影响`,
      );
    } else if (
      sp !== null &&
      !offPlan &&
      (sp < s0 || (sp === s0 && pairs >= 4 && q === 0 && !qidui))
    ) {
      action = 'peng';
      title = `建议碰 ${kindName(k)}`;
      if (sp < s0) points.push(`碰了直接从${shantenName(s0)}变成${shantenName(sp)}，少摸一轮牌`);
      else
        points.push(
          `碰了还是${shantenName(sp)}，但你对子多（${pairs} 组），可以往对对胡做（2 番）`,
        );
      if (q === 0) points.push(`碰后打一张，还能进 ${ukp} 张`);
    } else {
      action = 'pass';
      title = '建议过';
      if (qidui)
        points.push(`你对子多，这手也能做七对（暗七对 3 番）；碰了就做不成七对，又不会更快`);
      else if (offPlan)
        points.push(
          `你的${suitCn(plan!.main)}子已经有 ${plan!.total} 张，在往清一色做；碰${suitCn(plan!.minor)}子就做不成清一色了`,
        );
      else if (sp !== null)
        points.push(
          sp > s0
            ? `碰了反而退成${shantenName(sp)}`
            : `碰了也还是${shantenName(sp)}，不会更快，还会少一种变化（现在能进 ${uk0} 张）`,
        );
      if (sg !== null && sg > s0) points.push(`杠了会拆坏牌型（变成${shantenName(sg)}）`);
    }
  }
  return {
    stage: 'claim',
    title,
    status: statusOf(ctx).text,
    points,
    tips: tips.slice(0, 2),
    advice: { tiles: [], action },
    options: [],
    showDanger: false,
    defense: false,
    facts: `阶段：${who}打出 ${kindName(k)}，学生可以${[L.hu && '胡', L.gang.length && '杠', L.peng && '碰'].filter(Boolean).join('、')}或过。手牌：${handText(ctx.hand)}。导师建议：${title}。理由：${points.join('；')}。`,
  };
}

function coachWait(ctx: Ctx): ScCoach {
  const st = statusOf(ctx);
  const points: string[] = [];
  let title: string;
  if (st.shanten === 0 && st.waits.length) {
    title = '你在听牌，等别人出牌';
    points.push(`你在听 ${waitsText(st.waits)}`);
    if (st.waits.every((w) => w.left === 0))
      points.push('你听的牌已经全部出现了（死叫），下次摸牌时换一种听法');
    else points.push('别人打出这几张时可以胡，自己摸到就是自摸');
  } else {
    title = `你现在${shantenName(st.shanten)}`;
    if (st.shanten > 0)
      points.push(`还差 ${st.shanten} 张有用的牌就听牌；轮到你出牌时我再帮你看打哪张`);
  }
  const tips = readTips(ctx);
  return {
    stage: 'wait',
    title,
    status: st.text,
    points,
    tips,
    advice: { tiles: [] },
    options: [],
    showDanger: false,
    defense: false,
    facts: `阶段：等待其他玩家。手牌：${handText(ctx.hand)}。${points.join('；')}。${tips.join('；')}`,
  };
}

/** 导师对当前局面的建议（只用 view 里的信息） */
export function coachSichuan(view: ScView): ScCoach {
  if (view.seat === null) return EMPTY;
  const ctx = contextOf(view);
  const me = view.players[ctx.me];
  const L = view.legal;
  if (me.won)
    return {
      ...EMPTY,
      stage: 'won',
      title: `你已经${me.won.selfDrawn ? '自摸' : '胡牌'}了（${me.won.score.fanRaw} 番）`,
      points: ['可以看看其他人怎么打，等这一盘结束'],
    };
  if (L?.exchange) return coachExchange(ctx);
  if (L?.que) return coachQue(ctx);
  if (view.phase !== 'play') return EMPTY;
  if (L && view.window && view.window.tile) return coachClaim(ctx);
  if (L && (L.discard.length || L.hu || L.gang.length)) return coachDiscard(ctx);
  return coachWait(ctx);
}

/** 玩家选中的牌（换三张选的三张、准备打出的一张），导师怎么看 */
export function coachSelected(
  view: ScView,
  coach: ScCoach,
  selected: readonly number[],
): ScCoachJudge | null {
  if (coach.stage === 'exchange')
    return judgeExchange(view.hand, coach.advice.tiles, [...selected]);
  if (coach.stage !== 'discard' || coach.advice.action !== 'discard' || selected.length !== 1)
    return null;
  const t = view.hand.find((x) => x.id === selected[0]);
  const o = t && coach.options.find((x) => x.kind === kindOf(t));
  return o ? judge(o, coach.options[0], coach.defense) : null;
}
