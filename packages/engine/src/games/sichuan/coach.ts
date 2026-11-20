import { shanten } from '../../mahjong/analysis';
import type { MjSuit, Tile } from '../../mahjong/tiles';
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
  tileOf,
} from '../../mahjong/tiles';
import { Rng } from '../../core/rng';
import { chooseExchange, chooseQue, connectivity } from './bot';
import type { ScView } from './index';
import type { MeldShape } from './scoring';
import { FAN_CAP, evaluateHand, scoreOf } from './scoring';
import type { Env, ScWait, StateEval } from './coach/ev';
import { buildEnv, evFold, evalState, plainEfficiency, tingOfView, valueLabel } from './coach/ev';
import type { DeepPartial, ScCoachParams } from './coach/params';
import { withParams } from './coach/params';

export type { ScWait } from './coach/ev';
export { tingOfView } from './coach/ev';
export { SC_COACH_PARAMS } from './coach/params';
export type { ScCoachParams } from './coach/params';

/**
 * 四川麻将导师：只看玩家自己能看到的信息（view），给当前这一步出主意并讲清楚为什么。
 *
 * v2：所有选择都按「本盘期望得分（分）」比较（算法说明见 DeskPark 麻将导师 v2）：
 * - 进攻：每个候选按各条牌型路线估胡牌率（离线概率表）与胡牌价值，取最好的路线；
 * - 防守：对手模型给出每张牌的放炮期望损失，和进攻收益直接相减；弃和单独估期望；
 * - 碰、杠、胡与过、换三张、定缺都用同一套「局面 → 期望」比较。
 *
 * 导师只给建议，不替玩家做决定。
 */

export type ScCoachStage = 'exchange' | 'que' | 'discard' | 'claim' | 'wait' | 'won' | 'none';
export type ScCoachTone = 'best' | 'good' | 'warn' | 'bad';
/** 放炮风险：0 较安全、1 要小心、2 危险 */
export type ScDanger = 0 | 1 | 2;
export const DANGER_NAME = ['较安全', '要小心', '危险'] as const;

/** 精算（蒙特卡洛）的结果 */
export interface ScMcStat {
  /** 平均得分（分） */
  mean: number;
  /** 标准误 */
  se: number;
  pWin: number;
  pDealIn: number;
  /** 被查大叫的比例 */
  pChajiao: number;
  /** 模拟局数 */
  n: number;
  /** 没被淘汰：和最好的那张统计上分不出高下 */
  kept: boolean;
}

export interface ScDiscardOption {
  kind: number;
  /** 打这一种牌时用哪一张（有摸到的那张就用它） */
  tile: number;
  /** 所走路线的向听数与有效进张 */
  shanten: number;
  ukeire: number;
  ukeireKinds: number;
  waits: ScWait[];
  danger: ScDanger;
  /** 简短说明：「缺门」，或不是平胡时的路线名 */
  note: string;
  /** 排序用：−ev，小的在前 */
  score: number;
  /** 期望得分（分） */
  ev: number;
  /** 打这张以后本盘胡牌的概率 */
  pWin: number;
  /** 胡了平均收多少分 */
  value: number;
  /** 这张牌的放炮期望损失（分） */
  risk: number;
  /** 路线：平胡、清一色·万、对对胡……；听牌时为番型 */
  route: string;
  /** 这一项的期望来自弃和（先打安全牌） */
  fold?: boolean;
  mc?: ScMcStat;
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
  /** 防守：弃和的期望比任何进攻都高，先打安全牌 */
  defense: boolean;
  /** 快速估算还是精算（蒙特卡洛）的结果 */
  mode: 'fast' | 'mc';
  /** 弃和的期望得分（只在出牌时有） */
  evFold: number | null;
  /** 交给大模型的事实摘要 */
  facts: string;
}

export interface ScCoachOptions {
  /** 覆盖默认参数（调参脚本用） */
  params?: DeepPartial<ScCoachParams>;
  /** 精算结果：按牌种 → 统计 */
  mc?: { stats: Record<number, ScMcStat> } | null;
}

const SHANTEN_CN = ['听牌', '一向听', '两向听', '三向听', '四向听', '五向听', '六向听', '七向听'];
export const shantenName = (s: number) => (s < 0 ? '和牌' : (SHANTEN_CN[s] ?? `${s} 向听`));
const POS = ['你', '下家', '对家', '上家'];
const suitCn = (s: MjSuit) => MJ_SUIT_LABEL[s];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => (Math.abs(x) < 0.05 ? '0' : x.toFixed(1));

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
  mode: 'fast',
  evFold: null,
  facts: '',
};

const handText = (tiles: readonly Tile[]) =>
  [...tiles]
    .sort((a, b) => kindOf(a) - kindOf(b))
    .map(tileName)
    .join(' ');

const queCount = (tiles: readonly Tile[], que: MjSuit | null) =>
  que ? tiles.filter((t) => t.suit === que).length : 0;

const waitsText = (ws: readonly ScWait[]) =>
  ws.map((w) => `${kindName(w.kind)}（剩 ${w.left} 张，${w.label} ${w.fan} 番）`).join('、');

function dangerOf(env: Env, risk: number): ScDanger {
  const [a, b] = env.params.dangerBands;
  const r = risk / env.base;
  return r < a ? 0 : r < b ? 1 : 2;
}

/* ------------------------------------------------------------------ */
/* 对手动向（文案）                                                       */

function readTips(env: Env): string[] {
  const tips: string[] = [];
  for (const o of env.opps) {
    if (o.flush) {
      const how = o.melds.length
        ? `碰杠的都是${suitCn(o.flush)}子`
        : `一直在打别的牌、一张${suitCn(o.flush)}都没打`;
      tips.push(
        `${o.pos}${how}，可能在做清一色${suitCn(o.flush)}（胡了约 ${pts(o.pts)} 分），${suitCn(o.flush)}子要小心`,
      );
    } else if (o.ready >= 0.65) {
      tips.push(
        `${o.pos}已经打了 ${o.river.length} 张${o.melds.length ? `、碰杠 ${o.melds.length} 组` : ''}，很可能听牌了`,
      );
    }
  }
  return tips.slice(0, 2);
}

/** 某张牌为什么相对安全（找一条最有说服力的理由） */
function safeReason(env: Env, k: number): string | null {
  const suit = kindSuit(k);
  const live = env.opps.filter((o) => o.ready >= 0.3);
  if (live.length && live.every((o) => o.que === suit))
    return `${live.map((o) => o.pos).join('、')}都缺${suitCn(suit)}，${suitCn(suit)}子对他们绝对安全`;
  const q = live.find((o) => o.que === suit);
  if (q) return `${q.pos}缺${suitCn(suit)}，这张对他绝对安全`;
  if (env.v.visible[k] >= 3)
    return `${kindName(k)} 已经出现了 ${env.v.visible[k]} 张，别人很难用它胡`;
  return null;
}

/* ------------------------------------------------------------------ */
/* 牌效（平手时的次要比较）                                               */

function ukeireOf(c: number[], m: number, s: number, left: readonly number[], que: MjSuit | null) {
  let n = 0;
  for (let k = 0; k < KINDS; k++) {
    if ((que && kindSuit(k) === que) || left[k] <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, m) < s) n += left[k];
    c[k]--;
  }
  return n;
}

/** 摸到有效牌之后，平均还能有多少进张（越大说明后面越好改、听牌越宽） */
function afterDraw(c: number[], m: number, left: readonly number[], que: MjSuit | null): number {
  const s = shanten(c, m);
  let total = 0;
  let weight = 0;
  for (let k = 0; k < KINDS; k++) {
    if ((que && kindSuit(k) === que) || left[k] <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, m) < s) {
      const l2 = [...left];
      l2[k]--;
      let best = 0;
      for (let j = 0; j < KINDS; j++) {
        if (c[j] === 0) continue;
        c[j]--;
        const s2 = shanten(c, m);
        if (s2 < s) best = Math.max(best, ukeireOf(c, m, s2, l2, que));
        c[j]++;
      }
      total += left[k] * best;
      weight += left[k];
    }
    c[k]--;
  }
  return weight ? total / weight : 0;
}

/* ------------------------------------------------------------------ */
/* 状态                                                                 */

function statusOf(env: Env): { text: string; shanten: number; waits: ScWait[] } {
  const v = env.v;
  const q = queCount(v.hand, env.que);
  const c = countKinds(v.hand.filter((t) => t.suit !== env.que));
  if (q > 0) {
    const s = Math.max(shanten(c, env.melds.length), q);
    return { text: `还有 ${q} 张缺门要打 · ${shantenName(s)}`, shanten: s, waits: [] };
  }
  const s = shanten(c, env.melds.length);
  if (s === 0) {
    const st = evalState(env, c, env.melds);
    const live = st.waits.reduce((a, w) => a + w.left, 0);
    const ting = tingOfView(v.hand, env.meldsFull, env.que, v.visible, v.options);
    return {
      text: ting
        ? `听牌：${st.waits.map((w) => kindName(w.kind)).join(' ')}（还剩 ${live} 张）`
        : `听牌但叫已经出完（死叫）`,
      shanten: 0,
      waits: st.waits,
    };
  }
  return { text: shantenName(s), shanten: s, waits: [] };
}

/* ------------------------------------------------------------------ */
/* 出牌                                                                 */

interface Cand {
  kind: number;
  tile: number;
  st: StateEval;
  push: number;
  foldEv: number;
  ev: number;
  risk: number;
  que: boolean;
  plain: { shanten: number; ukeire: number; ukeireKinds: number };
  after: number[];
}

function optionOf(env: Env, c: Cand): ScDiscardOption {
  const tenpai = c.st.shanten === 0 && c.st.waits.length > 0;
  return {
    kind: c.kind,
    tile: c.tile,
    shanten: c.st.shanten,
    ukeire: c.st.ukeire,
    ukeireKinds: c.st.ukeireKinds,
    waits: c.st.waits,
    danger: dangerOf(env, c.risk),
    note: c.que ? '缺门' : !tenpai && c.st.routeName !== '平胡' ? c.st.routeName : '',
    score: -c.ev,
    ev: c.ev,
    pWin: c.st.pWin,
    value: c.st.value,
    risk: c.risk,
    route: c.st.routeName,
    ...(c.foldEv > c.push ? { fold: true } : {}),
  };
}

/** 第一条理由：打 X 走什么路线、胡牌率、胡了多少分、这张放炮风险 */
function firstPoint(o: ScDiscardOption): string {
  if (o.shanten === 0 && o.waits.length) {
    const live = o.waits.reduce((a, w) => a + w.left, 0);
    return `打 ${kindName(o.kind)} 就听牌了：听 ${waitsText(o.waits)}，一共还剩 ${live} 张；胡牌率约 ${pct(o.pWin)}，胡了平均 ${pts(o.value)} 分；这张放炮风险约 ${pts(o.risk)} 分`;
  }
  return `打 ${kindName(o.kind)}：走「${o.route}」路线，胡牌率约 ${pct(o.pWin)}，胡了平均 ${pts(o.value)} 分；这张放炮风险约 ${pts(o.risk)} 分`;
}

/** 两个候选差在哪：更快、更大、还是更安全（取期望差贡献最大的一项） */
function diffReason(a: ScDiscardOption, b: ScDiscardOption, lRest: number) {
  const speed = (a.pWin - b.pWin) * (a.value + lRest);
  const size = b.pWin * (a.value - b.value);
  const safe = b.risk - a.risk;
  const max = Math.max(speed, size, safe);
  if (max <= 0) return null;
  return max === speed ? 'speed' : max === size ? 'size' : 'safe';
}

function secondPoint(best: ScDiscardOption, second: ScDiscardOption, lRest: number): string | null {
  const why = diffReason(best, second, lRest);
  const z = kindName(second.kind);
  if (why === 'speed') {
    if (second.shanten > best.shanten)
      return second.route === best.route
        ? `比打 ${z} 更快：打 ${z} 会变成${shantenName(second.shanten)}，胡牌率只有约 ${pct(second.pWin)}`
        : `比打 ${z} 更快：打 ${z} 要走「${second.route}」，还差 ${second.shanten} 张才听牌，胡牌率只有约 ${pct(second.pWin)}`;
    return `比打 ${z} 更快：胡牌率约 ${pct(best.pWin)}，打 ${z} 约 ${pct(second.pWin)}`;
  }
  if (why === 'size')
    return `比打 ${z} 更大：胡了平均 ${pts(best.value)} 分，打 ${z} 走「${second.route}」只有 ${pts(second.value)} 分`;
  if (why === 'safe')
    return `比打 ${z} 更安全：放炮风险约 ${pts(best.risk)} 分，打 ${z} 约 ${pts(second.risk)} 分`;
  return best.ev - second.ev < 0.05
    ? `打 ${z} 也几乎一样`
    : `打 ${z} 也差不多（期望只差约 ${pts(best.ev - second.ev)} 分）`;
}

function coachDiscard(env: Env, mc?: ScCoachOptions['mc']): ScCoach {
  const v = env.v;
  const L = v.legal!;
  const hand = v.hand;
  const base = env.base;
  const points: string[] = [];
  const tips: string[] = readTips(env);
  const q = queCount(hand, env.que);
  const c14 = countKinds(hand);

  // 候选：每种牌只算一次
  const byKind = new Map<number, number>();
  for (const id of L.discard) {
    const k = kindOf(tileOf(id));
    if (!byKind.has(k) || id === v.drawn) byKind.set(k, id);
  }
  const fold = evFold(env, hand);
  const cands: Cand[] = [...byKind.entries()].map(([k, id]) => {
    const after = [...c14];
    after[k]--;
    const st = evalState(env, after, env.melds);
    const risk = env.risk[k];
    const push = st.ev - risk;
    const foldEv = fold.ev + fold.minRisk - risk;
    return {
      kind: k,
      tile: id,
      st,
      push,
      foldEv,
      ev: Math.max(push, foldEv),
      risk,
      que: kindSuit(k) === env.que,
      plain: plainEfficiency(env, after, env.melds),
      after,
    };
  });

  // 自摸
  if (L.hu) return coachSelfHu(env, cands);
  if (!cands.length) return { ...EMPTY, stage: 'discard', status: statusOf(env).text };

  const maxPush = Math.max(...cands.map((c) => c.push));
  const defense = q === 0 && fold.ev > maxPush;

  // 排序：期望高的在前；几乎一样时，缺门先打中张（越往后越危险），其余比进张后的听牌质量，再先打幺九
  const eps = 0.02 * base;
  const later = (k: number) => {
    const r = kindRank(k);
    return (
      (r === 1 || r === 9 ? 0.6 : r === 2 || r === 8 ? 0.8 : 1) * (v.visible[k] >= 3 ? 0.5 : 1)
    );
  };
  cands.sort((a, b) => b.ev - a.ev);
  const top = cands.filter((c) => cands[0].ev - c.ev <= eps);
  if (top.length > 1) {
    const next = new Map<number, number>();
    for (const c of top)
      if (!c.que && c.plain.shanten >= 1)
        next.set(
          c.kind,
          afterDraw(
            c.after.map((n, k) => (kindSuit(k) === env.que ? 0 : n)),
            env.melds.length,
            env.left,
            env.que,
          ),
        );
    const tie = (c: Cand) =>
      (c.que ? later(c.kind) * 10 : 0) +
      (next.get(c.kind) ?? 0) / 100 +
      (kindRank(c.kind) === 1 || kindRank(c.kind) === 9 ? 0.001 : 0);
    top.sort((a, b) => tie(b) - tie(a));
    cands.splice(0, top.length, ...top);
  }

  let options = cands.map((c) => optionOf(env, c));
  // 精算结果：模拟后没被淘汰的（和最好的一张统计上分不出高下）保持快速估算的顺序排在前面；
  // 被淘汰的（明显更差）按模拟平均分排到后面。这样只有快速估算的首选被证明更差时，推荐才会变
  const stats = mc?.stats;
  const fastTop = options[0]?.kind;
  if (stats && Object.keys(stats).length) {
    const order = new Map(options.map((o, i) => [o.kind, i]));
    options = options.map((o) => (stats[o.kind] ? { ...o, mc: stats[o.kind] } : o));
    const rank = (o: ScDiscardOption) => (o.mc ? (o.mc.kept ? 0 : 1) : 2);
    options.sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r) return r;
      if (rank(a) === 1) return b.mc!.mean - a.mc!.mean;
      return order.get(a.kind)! - order.get(b.kind)!;
    });
  }
  const best = options[0];
  const second = options.find((o) => o.kind !== best.kind);
  const showDanger = env.opps.some((o) => o.ready >= 0.45) || options.some((o) => o.danger > 0);

  // 杠：和最好的出牌比期望
  let gang: { tile: number; name: string; text: string; ev: number } | null = null;
  for (const g of L.gang) {
    const k = kindOf(tileOf(g.tile));
    const r = evalKong(env, c14, g.type === 'an' ? 'an' : 'ba', k, g.tile);
    if (r.ev > (gang?.ev ?? best.ev)) gang = { tile: g.tile, ...r };
    else if (r.warn) tips.push(r.warn);
  }

  let title: string;
  if (gang) {
    title = `建议${gang.name}`;
    points.push(gang.text, '杠完会从牌墙补一张，再决定打哪张');
  } else if (best.note === '缺门') {
    title = `先打缺门：${kindName(best.kind)}`;
    points.push(
      `手里还有 ${q} 张缺门（${suitCn(env.que!)}）：缺门打完才能胡；流局时还拿着缺门会被查花猪，要赔给每家最高番`,
    );
    if (q > 1)
      points.push(
        best.risk > 0.1 * base
          ? `缺门里先打放炮风险最小的这张（约 ${pts(best.risk)} 分）`
          : `缺门里先打中间的牌：越往后别人越可能要它，越不好打`,
      );
    points.push(
      `打完缺门后走「${best.route}」路线：胡牌率约 ${pct(best.pWin)}，胡了平均 ${pts(best.value)} 分`,
    );
  } else if (defense) {
    title = `建议打 ${kindName(best.kind)}（先保守）`;
    const why = safeReason(env, best.kind);
    const attack = [...options].sort((a, b) => b.ev - a.ev).find((o) => !o.fold);
    points.push(
      `你离听牌还远，对手可能已经听了：继续硬攻的期望约 ${pts(maxPush)} 分，先打安全牌约 ${pts(fold.ev)} 分`,
      `打 ${kindName(best.kind)} 放炮风险只有约 ${pts(best.risk)} 分${why ? `——${why}` : ''}`,
    );
    if (attack && attack.kind !== best.kind)
      points.push(
        `如果硬攻，最好打 ${kindName(attack.kind)}：胡牌率约 ${pct(attack.pWin)}，但放炮风险约 ${pts(attack.risk)} 分`,
      );
  } else {
    title = `建议打 ${kindName(best.kind)}`;
    points.push(firstPoint(best));
    if (second) {
      const p2 = secondPoint(best, second, env.lRest);
      if (p2) points.push(p2);
    }
    if (best.shanten > 0) {
      const c = cands.find((x) => x.kind === best.kind)!;
      if (best.route === '平胡')
        points.push(
          `打 ${kindName(best.kind)} 后${shantenName(c.plain.shanten)}（还差 ${c.plain.shanten} 张有用的牌就听牌），能进 ${c.plain.ukeireKinds} 种、共 ${c.plain.ukeire} 张牌`,
        );
      else
        points.push(
          `按「${best.route}」做：还差 ${best.shanten} 张有用的牌就听牌，能进 ${best.ukeireKinds} 种、共 ${best.ukeire} 张；不做的话是${shantenName(c.plain.shanten)}、进 ${c.plain.ukeire} 张，快一点但胡了分数小`,
        );
    }
    if (best.mc) {
      const dropped = fastTop !== undefined && fastTop !== best.kind;
      const higher = options.find(
        (o) => o.kind !== best.kind && o.mc?.kept && o.mc.mean > best.mc!.mean,
      );
      points.push(
        `精算：打 ${kindName(best.kind)} 后接着模拟 ${best.mc.n} 局（之后的牌按电脑的打法），平均得 ${pts(best.mc.mean)} 分（±${pts(2 * best.mc.se)}），${pct(best.mc.pWin)} 的局能胡（不论牌型），${pct(best.mc.pDealIn)} 的局点过炮` +
          (dropped
            ? `；快速估算原本推荐打 ${kindName(fastTop)}，模拟下来明显更差`
            : higher
              ? `；打 ${kindName(higher.kind)} 模拟平均 ${pts(higher.mc!.mean)} 分，差别在误差范围内`
              : ''),
      );
    }
  }

  // 查大叫 / 查花猪
  const minS = Math.min(...cands.map((c) => c.plain.shanten));
  if (v.wallCount <= 12) {
    if (q > 0) tips.unshift(`牌墙只剩 ${v.wallCount} 张，手里还有缺门：流局时会被查花猪`);
    else if (minS > 0)
      tips.unshift(
        `牌墙只剩 ${v.wallCount} 张，你还没听牌：流局时没听牌要赔给听牌的人（查大叫）${env.kongIncome ? '，还要退杠钱' : ''}，尽快听牌`,
      );
  }

  const st14 =
    q > 0
      ? `还有 ${q} 张缺门要打`
      : minS === 0
        ? '打一张就能听牌'
        : `打完一张：${shantenName(minS)}`;
  return {
    stage: 'discard',
    title,
    status: st14,
    points,
    tips: tips.slice(0, 3),
    advice: gang
      ? { tiles: [gang.tile], action: 'gang' }
      : { tiles: [best.tile], action: 'discard' },
    options,
    showDanger,
    defense,
    mode: stats && Object.keys(stats).length ? 'mc' : 'fast',
    evFold: fold.ev,
    facts: [
      `阶段：轮到学生出牌。手牌：${handText(hand)}${env.que ? `，定缺${suitCn(env.que)}` : ''}${env.meldsFull.length ? `，碰杠：${env.meldsFull.map((m) => `${m.type === 'kong' ? '杠' : '碰'}${kindName(m.kind)}`).join(' ')}` : ''}。牌墙剩 ${v.wallCount} 张，底分 ${base}。`,
      `导师建议：${title}。理由：${points.join('；')}。`,
      `各候选（期望得分、胡牌率、胡了平均分、放炮风险）：${options
        .slice(0, 4)
        .map(
          (o) =>
            `打 ${kindName(o.kind)}：${o.route}，期望 ${pts(o.ev)} 分，胡牌率 ${pct(o.pWin)}，平均 ${pts(o.value)} 分，风险 ${pts(o.risk)} 分${o.mc ? `，精算平均 ${pts(o.mc.mean)} 分` : ''}`,
        )
        .join('；')}。`,
      `先打安全牌（弃和）的期望：${pts(fold.ev)} 分。`,
      tips.length ? `提醒：${tips.join('；')}。` : '',
    ].join(''),
  };
}

/** 杠的期望（第 6.2 节）：即时收入（可能被退税、呼叫转移）+ 杠后局面 + 杠上花 − 被抢杠 */
function evalKong(
  env: Env,
  concealed: readonly number[],
  type: 'an' | 'ba' | 'zhi',
  k: number,
  tile: number | null,
): { ev: number; name: string; text: string; warn: string | null; st: StateEval; income: number } {
  const v = env.v;
  const after = [...concealed];
  let melds: MeldShape[];
  let income: number;
  if (type === 'an') {
    after[k] -= 4;
    melds = [...env.melds, { type: 'kong', kind: k }];
    income = 2 * env.nOpp;
  } else if (type === 'ba') {
    after[k] -= 1;
    melds = env.melds.map((m) => (m.kind === k ? { type: 'kong', kind: k } : m));
    // 巴杠只有第四张是这回合刚摸到的（及时雨）才收钱
    income = tile !== null && v.drawn === tile ? env.nOpp : 0;
  } else {
    after[k] -= 3;
    melds = [...env.melds, { type: 'kong', kind: k }];
    income = 2;
  }
  const st = evalState(env, after, melds);
  // 杠完补牌后要打一张：最安全那张的点炮概率，就是杠上炮（钱被转走）的概率
  let pGsp = 1;
  for (let j = 0; j < KINDS; j++) if (after[j] > 0) pGsp = Math.min(pGsp, env.dealIn[j]);
  if (pGsp === 1) pGsp = 0;
  const g = income * (1 - st.pNoten) * (1 - pGsp);
  // 杠上花：听牌时补到的那张刚好自摸，多 1 番
  let gsh = 0;
  for (const w of st.waits)
    gsh +=
      (w.left / env.unseen) *
      (scoreOf(Math.min(FAN_CAP, w.fan + 1), env.base) - scoreOf(w.fan, env.base)) *
      env.nOpp;
  // 巴杠可能被抢杠
  let rob = 0;
  if (type === 'ba')
    for (const o of env.opps)
      rob +=
        o.ready *
        o.wait[k] *
        scoreOf(
          Math.min(FAN_CAP, (o.flush && kindSuit(k) === o.flush ? o.fan : o.fanPlain) + 1),
          env.base,
        ) *
        env.params.lambda;
  const ev = g + st.ev + gsh - rob;
  const name = `${type === 'an' ? '暗杠' : type === 'ba' ? '补杠' : '杠'} ${kindName(k)}`;
  const pay =
    type === 'an'
      ? `下雨：还没胡的每家付你 2 分`
      : type === 'zhi'
        ? `刮风：打出这张的人付你 2 分`
        : income > 0
          ? `刮风：第四张是刚摸到的，还没胡的每家付你 1 分`
          : `第四张不是这回合刚摸到的，补杠不收钱`;
  const text = `${name}（${pay}${income > 0 ? '；流局没听牌要退、杠完点炮会被呼叫转移' : ''}），胡牌时多一个根（+1 番）；杠后走「${st.routeName}」，胡牌率约 ${pct(st.pWin)}${rob > 0.05 ? `；被抢杠的风险约 ${pts(rob)} 分` : ''}`;
  const warn =
    rob > 0.5 * env.base
      ? `补杠 ${kindName(k)} 可能被听这张的人抢杠胡（风险约 ${pts(rob)} 分），先别杠`
      : null;
  return { ev, name, text, warn, st, income };
}

function coachSelfHu(env: Env, cands: Cand[]): ScCoach {
  const v = env.v;
  const L = v.legal!;
  const hand = v.hand;
  const c = countKinds(hand);
  const val = evaluateHand(c, env.melds, { jingoudiao: v.options.jingoudiao });
  const extra = (v.myAfterKong !== null ? 1 : 0) + (v.wallCount === 0 ? 1 : 0);
  const fan = Math.min(FAN_CAP, (val?.base ?? 1) + extra);
  const each = scoreOf(fan, env.base);
  const evHu = each * env.nOpp;
  const bestPush = cands.length ? Math.max(...cands.map((x) => x.ev)) : -Infinity;
  const evPass = bestPush - env.lRest;
  const { abs, rel } = env.params.passMargin;
  const pass =
    !L.mustHu && cands.length > 0 && evPass - evHu > Math.max(abs * env.base, rel * evHu);
  const points = [
    `自摸：${val ? valueLabel(val) : '平胡'}${extra ? `${v.myAfterKong !== null ? ' · 杠上花' : ''}${v.wallCount === 0 ? ' · 海底捞月' : ''}` : ''}，${fan} 番，还没胡的 ${env.nOpp} 家每家付你 ${each} 分`,
    '血战到底先胡先走：胡了以后这一盘就不用再担心点炮',
  ];
  if (L.mustHu) points.push('牌墙只剩 4 张，按规则能胡必须胡');
  else if (pass)
    points.push(`不过这手牌继续做期望更高：现在胡收 ${pts(evHu)} 分，继续打约 ${pts(evPass)} 分`);
  return {
    ...EMPTY,
    stage: 'discard',
    title: pass ? '可以自摸，但导师建议继续做大' : '可以自摸，胡！',
    status: '已经可以胡牌',
    points,
    advice: pass
      ? { tiles: [cands.sort((a, b) => b.ev - a.ev)[0].tile], action: 'discard' }
      : { tiles: [], action: 'hu' },
    facts: `阶段：自己摸牌后可以自摸胡。手牌：${handText(hand)}。${points.join('；')}。胡的期望 ${pts(evHu)} 分，不胡继续打的期望 ${pts(evPass)} 分。`,
  };
}

/* ------------------------------------------------------------------ */
/* 别人打出的牌：胡 / 杠 / 碰 / 过                                        */

function coachClaim(env: Env): ScCoach {
  const v = env.v;
  const L = v.legal!;
  const tile = v.window!.tile!;
  const k = kindOf(tile);
  const src = v.window!.source;
  const who = src !== null ? POS[(src - env.me + 4) % 4] : '对手';
  const hand = v.hand;
  const c13 = countKinds(hand);
  const q = queCount(hand, env.que);
  const points: string[] = [];
  const tips = readTips(env);
  const rob = v.window!.kind === 'rob';
  let action: 'hu' | 'gang' | 'peng' | 'pass';
  let title: string;

  if (L.hu) {
    const c = [...c13];
    c[k]++;
    const val = evaluateHand(c, env.melds, { jingoudiao: v.options.jingoudiao });
    const fan = Math.min(FAN_CAP, (val?.base ?? 1) + (rob ? 1 : 0));
    const evHu = scoreOf(fan, env.base);
    // 过：过水以后到下次摸牌前不能点炮胡，少一轮点炮机会
    const st = evalState(env, c13, env.melds, { tEffDelta: -env.params.kappa * env.nOpp });
    const evPass = st.ev - env.lRest;
    const { abs, rel } = env.params.passMargin;
    const pass = !L.mustHu && evPass - evHu > Math.max(abs * env.base, rel * evHu);
    action = pass ? 'pass' : 'hu';
    title = pass
      ? `可以胡 ${kindName(k)}，但导师建议过`
      : rob
        ? `可以抢杠胡 ${kindName(k)}！`
        : `可以胡 ${kindName(k)}！`;
    points.push(
      `胡 ${kindName(k)}：${val ? valueLabel(val) : '平胡'}${rob ? ' · 抢杠' : ''}，${fan} 番，${who}付你 ${evHu} 分`,
      '血战到底先胡先走：胡了以后这一盘就不用再担心点炮',
      '如果选「过」，在你下次摸牌之前都不能再胡别人打的牌（过水）',
    );
    if (L.mustHu) points.push('牌墙只剩 4 张，按规则能胡必须胡');
    else if (pass)
      points.push(
        `这手牌等更大的胡期望更高：现在胡收 ${pts(evHu)} 分，过了以后约 ${pts(evPass)} 分（胡牌率约 ${pct(st.pWin)}，胡了平均 ${pts(st.value)} 分）`,
      );
  } else {
    const pass = evalState(env, c13, env.melds);
    let peng: { ev: number; j: number; st: StateEval } | null = null;
    if (L.peng) {
      const after = [...c13];
      after[k] -= 2;
      const melds: MeldShape[] = [...env.melds, { type: 'pung', kind: k }];
      // 碰完要打一张：手里还有缺门就只能打缺门
      for (let j = 0; j < KINDS; j++) {
        if (after[j] === 0 || (q > 0 && kindSuit(j) !== env.que)) continue;
        after[j]--;
        const st = evalState(env, after, melds);
        after[j]++;
        const ev = st.ev - env.risk[j];
        if (!peng || ev > peng.ev) peng = { ev, j, st };
      }
    }
    const gang = L.gang.length ? evalKong(env, c13, 'zhi', k, null) : null;
    const best = Math.max(pass.ev, peng?.ev ?? -Infinity, gang?.ev ?? -Infinity);
    const passLine = `不${L.peng ? '碰' : '杠'}：继续走「${pass.routeName}」，胡牌率约 ${pct(pass.pWin)}，胡了平均 ${pts(pass.value)} 分`;
    if (gang && gang.ev === best) {
      action = 'gang';
      title = `建议杠 ${kindName(k)}`;
      points.push(
        gang.text,
        `杠的期望约 ${pts(gang.ev)} 分，${passLine}（期望约 ${pts(pass.ev)} 分）`,
      );
    } else if (peng && peng.ev === best) {
      action = 'peng';
      title = `建议碰 ${kindName(k)}`;
      const faster = peng.st.shanten < pass.shanten;
      points.push(
        `碰了以后打 ${kindName(peng.j)}：走「${peng.st.routeName}」，${faster ? `直接从${shantenName(pass.shanten)}变成${shantenName(peng.st.shanten)}，` : ''}胡牌率约 ${pct(peng.st.pWin)}，胡了平均 ${pts(peng.st.value)} 分`,
        `${passLine}；碰的期望约 ${pts(peng.ev)} 分，不碰约 ${pts(pass.ev)} 分`,
      );
    } else {
      action = 'pass';
      title = '建议过';
      points.push(`${passLine}${pass.routeName.includes('七对') ? '（碰了就做不成七对）' : ''}`);
      if (peng)
        points.push(
          `碰了以后最好打 ${kindName(peng.j)}，走「${peng.st.routeName}」，胡牌率约 ${pct(peng.st.pWin)}，胡了平均 ${pts(peng.st.value)} 分，期望少约 ${pts(pass.ev - peng.ev)} 分`,
        );
      if (gang)
        points.push(`杠了以后走「${gang.st.routeName}」，期望少约 ${pts(pass.ev - gang.ev)} 分`);
    }
    if (q > 0) tips.push(`手里还有 ${q} 张缺门，碰了以后也要先打缺门`);
  }
  return {
    ...EMPTY,
    stage: 'claim',
    title,
    status: statusOf(env).text,
    points,
    tips: tips.slice(0, 2),
    advice: { tiles: [], action },
    facts: `阶段：${who}打出 ${kindName(k)}，学生可以${[L.hu && '胡', L.gang.length && '杠', L.peng && '碰'].filter(Boolean).join('、')}或过。手牌：${handText(hand)}。导师建议：${title}。理由：${points.join('；')}。`,
  };
}

/* ------------------------------------------------------------------ */
/* 换三张、定缺                                                          */

function suitSummary(hand: readonly Tile[], s: MjSuit): string {
  const ts = hand.filter((t) => t.suit === s);
  const c = countKinds(ts);
  const pairs = c.filter((n) => n >= 2).length;
  const links = ts.filter((t) => connectivity(ts, t) > 0).length;
  const shape = pairs ? `${pairs} 对` : links ? '有连张' : '很散';
  return `${suitCn(s)} ${ts.length} 张（${ts.length ? shape : '没有'}）`;
}

/** 开局的进攻期望：假设定缺 que，整盘还能摸 T 次 */
function openingEv(env: Env, tiles: readonly Tile[], que: MjSuit): StateEval {
  const c = countKinds(tiles);
  if (tiles.length % 3 === 2) {
    // 庄家 14 张：先打一张（有缺门打缺门，否则打掉对牌型最没用的一张）
    let pick = -1;
    const qk = c.findIndex((n, k) => n > 0 && kindSuit(k) === que);
    if (qk >= 0) pick = qk;
    else {
      let bestS = Infinity;
      for (let j = 0; j < KINDS; j++) {
        if (!c[j]) continue;
        c[j]--;
        const s = shanten(c, 0);
        c[j]++;
        if (s < bestS) {
          bestS = s;
          pick = j;
        }
      }
    }
    c[pick]--;
  }
  return evalState(env, c, [], { que });
}

function worstThree(hand: readonly Tile[], suit: MjSuit): number[] {
  const ts = hand.filter((t) => t.suit === suit);
  return [...ts]
    .sort((a, b) => connectivity(ts, a) - connectivity(ts, b) || a.id - b.id)
    .slice(0, 3)
    .map((t) => t.id);
}

function hashIds(ids: readonly number[]): number {
  let h = 2166136261;
  for (const x of ids) h = Math.imul(h ^ (x + 1), 16777619);
  return h >>> 0;
}

function coachExchange(env: Env): ScCoach {
  const v = env.v;
  const hand = v.hand;
  const suits = MJ_SUITS.filter((s) => hand.filter((t) => t.suit === s).length >= 3);
  // 换回来的三张未知：用确定的随机数抽若干组「同一门的三张」，各种换法共用同一批样本
  const rng = new Rng(hashIds(hand.map((t) => t.id)));
  const mine = new Set(hand.map((t) => t.id));
  const samples: Tile[][] = [];
  for (let i = 0; i < env.params.exchangeSamples; i++) {
    const s = MJ_SUITS[rng.int(3)];
    const pool: Tile[] = [];
    for (let id = 0; id < 108; id++) {
      const t = tileOf(id);
      if (t.suit === s && !mine.has(id)) pool.push(t);
    }
    samples.push(rng.shuffle(pool).slice(0, 3));
  }
  const evals = suits.map((s) => {
    const give = worstThree(hand, s);
    const keep = hand.filter((t) => !give.includes(t.id));
    let sum = 0;
    for (const recv of samples) {
      const h = [...keep, ...recv];
      // 换完以后再定缺：取最好的一门（只看张数接近最少的几门，张数多的一门不会去缺）
      const n = MJ_SUITS.map((x) => h.filter((t) => t.suit === x).length);
      const fewest = Math.min(...n);
      let best = -Infinity;
      MJ_SUITS.forEach((que, i) => {
        if (n[i] <= fewest + 1) best = Math.max(best, openingEv(env, h, que).ev);
      });
      sum += best;
    }
    return { suit: s, give, ev: sum / samples.length };
  });
  evals.sort((a, b) => b.ev - a.ev);
  const rec = evals[0]?.give ?? chooseExchange(hand);
  const recTiles = rec.map((id) => hand.find((t) => t.id === id)!);
  const suit = recTiles[0].suit;
  const n = hand.filter((t) => t.suit === suit).length;
  const dir = v.exchangeDir;
  const dirText = dir === 'next' ? '换给下家' : dir === 'prev' ? '换给上家' : '换给对家';
  const points = [
    `三门的情况：${MJ_SUITS.map((s) => suitSummary(hand, s)).join('，')}`,
    n === 3
      ? `${suitCn(suit)}子正好 3 张，换走以后这门一张不剩，定缺${suitCn(suit)}最轻松`
      : `${suitCn(suit)}子最弱，换走最散的三张；剩下的 ${n - 3} 张以后定缺${suitCn(suit)}时再打掉`,
    `这次是${dirText}：你也会从另一家收到三张同一门的牌，换进来的牌不一定好，先别急着定缺`,
  ];
  if (evals.length > 1)
    points.push(
      `模拟 ${samples.length} 种换回来的牌：换${evals.map((e) => `${suitCn(e.suit)}子平均 ${pts(e.ev)} 分`).join('、换')}`,
    );
  const title = `建议换出 ${recTiles.map(tileName).join(' ')}`;
  return {
    ...EMPTY,
    stage: 'exchange',
    title,
    points,
    advice: { tiles: rec, action: 'exchange' },
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

function coachQue(env: Env): ScCoach {
  const v = env.v;
  const hand = v.hand;
  const evs = MJ_SUITS.map((s) => ({ suit: s, st: openingEv(env, hand, s) })).sort(
    (a, b) => b.st.ev - a.st.ev,
  );
  const [a, b] = evs;
  const close = Math.abs(a.st.ev - b.st.ev) < env.params.queTie * Math.max(Math.abs(a.st.ev), 1e-9);
  const rec = close ? chooseQue(hand) : a.suit;
  const n = hand.filter((t) => t.suit === rec).length;
  const top = evs.find((e) => e.suit === rec)!;
  const points = [
    `三门的情况：${MJ_SUITS.map((s) => suitSummary(hand, s)).join('，')}`,
    n === 0
      ? `你手里一张${suitCn(rec)}都没有，缺${suitCn(rec)}不用打掉任何牌`
      : `缺${suitCn(rec)}：只需要打掉 ${n} 张`,
    `缺${suitCn(rec)}以后走「${top.st.routeName}」：整盘胡牌率约 ${pct(top.st.pWin)}，胡了平均 ${pts(top.st.value)} 分；${evs
      .filter((e) => e.suit !== rec)
      .map((e) => `缺${suitCn(e.suit)}约 ${pct(e.st.pWin)}、${pts(e.st.value)} 分`)
      .join('，')}`,
    '定缺之后，这门的牌要先打完才能胡；流局时手里还有缺门会被查花猪（赔给每家最高番）',
  ];
  const recv = v.exchange?.received;
  if (recv?.length) points.push(`刚换进来的是 ${recv.map(tileName).join(' ')}`);
  const title = `建议定缺${suitCn(rec)}`;
  return {
    ...EMPTY,
    stage: 'que',
    title,
    points,
    advice: {
      tiles: hand.filter((t) => t.suit === rec).map((t) => t.id),
      suit: rec,
      action: 'que',
    },
    facts: `阶段：定缺。手牌：${handText(hand)}。导师建议：${title}。理由：${points.join('；')}。`,
  };
}

function coachWait(env: Env): ScCoach {
  const st = statusOf(env);
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
  const tips = readTips(env);
  return {
    ...EMPTY,
    stage: 'wait',
    title,
    status: st.text,
    points,
    tips,
    facts: `阶段：等待其他玩家。手牌：${handText(env.v.hand)}。${points.join('；')}。${tips.join('；')}`,
  };
}

/** 导师对当前局面的建议（只用 view 里的信息） */
export function coachSichuan(view: ScView, opts: ScCoachOptions = {}): ScCoach {
  if (view.seat === null) return EMPTY;
  const me = view.players[view.seat];
  const L = view.legal;
  if (me.won)
    return {
      ...EMPTY,
      stage: 'won',
      title: `你已经${me.won.selfDrawn ? '自摸' : '胡牌'}了（${me.won.score.fanRaw} 番）`,
      points: ['可以看看其他人怎么打，等这一盘结束'],
    };
  const env = buildEnv(view, withParams(opts.params));
  if (L?.exchange) return coachExchange(env);
  if (L?.que) return coachQue(env);
  if (view.phase !== 'play') return EMPTY;
  if (L && view.window && view.window.tile) return coachClaim(env);
  if (L && (L.discard.length || L.hu || L.gang.length)) return coachDiscard(env, opts.mc);
  return coachWait(env);
}

/** 在当前局面下评估一手暗牌（打完牌、等摸牌的状态；副露、定缺用自己的）。测试与调参用 */
export function coachEvalHand(
  view: ScView,
  hand: readonly Tile[],
  params?: DeepPartial<ScCoachParams>,
): { ev: number; pWin: number; value: number; route: string; shanten: number; ukeire: number } {
  const env = buildEnv(view, withParams(params));
  const st = evalState(env, countKinds(hand), env.melds);
  return {
    ev: st.ev,
    pWin: st.pWin,
    value: st.value,
    route: st.routeName,
    shanten: st.shanten,
    ukeire: st.ukeire,
  };
}

/** 评估自己回合的一次暗杠 / 补杠（tile 为要杠的那张）。测试与调参用 */
export function coachKong(
  view: ScView,
  tile: number,
  params?: DeepPartial<ScCoachParams>,
): { income: number; ev: number; text: string } {
  const env = buildEnv(view, withParams(params));
  const c = countKinds(view.hand);
  const k = kindOf(tileOf(tile));
  const type = env.melds.some((m) => m.kind === k && m.type === 'pung') ? 'ba' : 'an';
  const r = evalKong(env, c, type, k, tile);
  return { income: r.income, ev: r.ev, text: r.text };
}

/** 玩家选中的牌（换三张选的三张、准备打出的一张），导师怎么看 */
export function coachSelected(
  view: ScView,
  coach: ScCoach,
  selected: readonly number[],
  params?: DeepPartial<ScCoachParams>,
): ScCoachJudge | null {
  if (coach.stage === 'exchange')
    return judgeExchange(view.hand, coach.advice.tiles, [...selected]);
  if (coach.stage !== 'discard' || coach.advice.action !== 'discard' || selected.length !== 1)
    return null;
  const t = view.hand.find((x) => x.id === selected[0]);
  const o = t && coach.options.find((x) => x.kind === kindOf(t));
  return o ? judge(o, coach.options[0], view.options.baseScore, withParams(params)) : null;
}

/** 按期望差分档（第 8.1 节）；理由取差得最多的一项 */
function judge(
  o: ScDiscardOption,
  best: ScDiscardOption,
  base: number,
  params: ScCoachParams,
): ScCoachJudge {
  const name = kindName(o.kind);
  const bn = kindName(best.kind);
  if (o.kind === best.kind) return { tone: 'best', text: `你选的 ${name} 正是导师推荐的这张` };
  if (best.note === '缺门' && o.note === '缺门')
    return { tone: 'good', text: `${name} 也是缺门，先打哪张差别不大` };
  const useMc = !!(o.mc && best.mc);
  const delta = (useMc ? best.mc!.mean - o.mc!.mean : best.ev - o.ev) / base;
  const [b1, b2, b3] = params.judgeBands;
  const tone: ScCoachTone =
    delta <= b1 ? 'best' : delta <= b2 ? 'good' : delta <= b3 ? 'warn' : 'bad';
  if (tone === 'best') return { tone, text: `打 ${name} 和推荐的 ${bn} 几乎一样，放心打` };
  const less = `期望少约 ${pts(delta * base)} 分`;
  const why = diffReason(best, o, 0);
  let reason: string;
  if (why === 'speed') {
    reason =
      o.shanten > best.shanten && o.route !== best.route && !(o.shanten === 0 || best.shanten === 0)
        ? `打 ${name} 要走「${o.route}」，还差 ${o.shanten} 张才听牌，胡牌率约 ${pct(o.pWin)}，比打 ${bn}（${pct(best.pWin)}）低`
        : o.shanten > best.shanten
          ? `打 ${name} 会退成${shantenName(o.shanten)}，比打 ${bn} 离胡牌多一步`
          : o.ukeire < best.ukeire
            ? `打 ${name} 也是${shantenName(o.shanten)}，但只能进 ${o.ukeire} 张，比打 ${bn} 少 ${best.ukeire - o.ukeire} 张`
            : `打 ${name} 胡牌率约 ${pct(o.pWin)}，比打 ${bn}（${pct(best.pWin)}）低`;
  } else if (why === 'size') {
    reason = `打 ${name} 走「${o.route}」，胡了平均 ${pts(o.value)} 分，打 ${bn} 走「${best.route}」有 ${pts(best.value)} 分`;
  } else if (why === 'safe') {
    reason = `${name} ${DANGER_NAME[o.danger]}：放炮风险约 ${pts(o.risk)} 分，打 ${bn} 只有约 ${pts(best.risk)} 分`;
  } else reason = `打 ${name} 不如打 ${bn}`;
  return { tone, text: `${reason}（${less}）` };
}
