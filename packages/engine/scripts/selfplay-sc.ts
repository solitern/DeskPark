/**
 * 四川麻将导师自对弈验收与调参（算法说明第 8.4 节）。
 *
 *   npx tsx packages/engine/scripts/selfplay-sc.ts [--rounds 20000] [--jobs 16] [--configs bot,v1,v2]
 *   npx tsx packages/engine/scripts/selfplay-sc.ts --grid [--rounds 5000]
 *
 * 一个座位按导师推荐行动（换三张、定缺、出牌、碰杠胡全听导师的），其余三家用 sichuanBot；
 * 导师座位相对庄家轮换（第 i 盘坐在庄家之后第 i % 4 位）。每盘只打一盘，记录导师座位的：
 * 得分、胡牌率、点炮率、胡牌平均番、被查大叫率、被查花猪率。
 * 各组共用同一批牌局（同样的种子），所以组间差值的置信区间比各自的区间窄得多。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/core/rng';
import type { ScAction, ScState, ScView } from '../src/games/sichuan';
import { coachSichuan, sichuan } from '../src/games/sichuan';
import type { DeepPartial, ScCoachParams } from '../src/games/sichuan/coach/params';
import { coachSichuan as coachV1 } from './coach-v1';

type Policy = 'bot' | 'v1' | 'v2';
interface Job {
  policy: Policy;
  params?: DeepPartial<ScCoachParams>;
  from: number;
  count: number;
}
/** 牌局编号的起点：换一批没见过的牌局做验证时用 --offset */
let OFFSET = 0;
interface Row {
  delta: number;
  won: number;
  fan: number;
  dealIn: number;
  chajiao: number;
  huazhu: number;
}

function coachAction(
  policy: Policy,
  v: ScView,
  params?: DeepPartial<ScCoachParams>,
): ScAction | null {
  const L = v.legal;
  if (!L || L.ready) return null;
  const c = policy === 'v1' ? coachV1(v) : coachSichuan(v, { params });
  const a = c.advice.action;
  if (L.exchange) return a === 'exchange' ? { type: 'exchange', tiles: c.advice.tiles } : null;
  if (L.que) return c.advice.suit ? { type: 'que', suit: c.advice.suit } : null;
  if (a === 'hu' && L.hu) return { type: 'hu' };
  if (a === 'discard' && L.discard.includes(c.advice.tiles[0]))
    return { type: 'discard', tile: c.advice.tiles[0] };
  if (a === 'gang' && L.gang.length)
    return v.window ? { type: 'gang' } : { type: 'gang', tile: c.advice.tiles[0] };
  if (a === 'peng' && L.peng) return { type: 'peng' };
  if (a === 'pass' && L.pass) return { type: 'pass' };
  return null;
}

/** 打一盘：第 i 盘、种子 seed；导师坐在庄家之后第 i % 4 位 */
export function playRound(
  seed: number,
  i: number,
  policy: Policy,
  params?: DeepPartial<ScCoachParams>,
): Row {
  let st: ScState = sichuan.setup({
    players: [0, 1, 2, 3].map((s) => ({ name: `p${s}`, isBot: true })),
    options: { ...sichuan.defaultOptions, rounds: 1 },
    seed,
  });
  const me = (st.dealer + i) % 4;
  const rng = new Rng(Math.imul(seed, 7919) + 1);
  for (let step = 0; step < 4000 && st.phase !== 'roundOver' && st.phase !== 'matchOver'; step++) {
    const seat = sichuan.activeSeats(st)[0];
    const v = sichuan.view(st, seat);
    let a: ScAction | null = null;
    if (seat === me && policy !== 'bot') {
      a = coachAction(policy, v, params);
      if (a && sichuan.validate(st, seat, a)) a = null;
    }
    st = sichuan.apply(st, seat, a ?? sichuan.bot(v, seat, rng));
  }
  const r = st.result!;
  const win = r.wins.find((w) => w.seat === me);
  return {
    delta: r.deltas[me],
    won: win ? 1 : 0,
    fan: win ? win.score.fanRaw : 0,
    dealIn: r.wins.filter((w) => !w.selfDrawn && w.from === me).length,
    chajiao: r.ledger.some((e) => e.clause === 'tax.chajiao' && e.from === me) ? 1 : 0,
    huazhu: r.huazhu.includes(me) ? 1 : 0,
  };
}

function runJob(job: Job): Row[] {
  const out: Row[] = [];
  for (let i = job.from; i < job.from + job.count; i++)
    out.push(playRound(100003 + i * 7, i, job.policy, job.params));
  return out;
}

function spawnJob(job: Job): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const self = fileURLToPath(import.meta.url);
    const child = spawn(
      process.execPath,
      [...process.execArgv, self, '--worker', JSON.stringify(job)],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('exit', (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`job ${code}`)),
    );
  });
}

async function runPolicy(
  policy: Policy,
  rounds: number,
  jobs: number,
  params?: DeepPartial<ScCoachParams>,
): Promise<Row[]> {
  const per = Math.ceil(rounds / jobs);
  const parts = await Promise.all(
    Array.from({ length: jobs }, (_, j) =>
      spawnJob({
        policy,
        params,
        from: OFFSET + j * per,
        count: Math.max(0, Math.min(per, rounds - j * per)),
      }),
    ),
  );
  return parts.flat();
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
function ci(a: number[]): [number, number] {
  const m = mean(a);
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
  return [m, (1.96 * sd) / Math.sqrt(a.length)];
}
const f = (x: number, d = 3) => x.toFixed(d);

function summary(name: string, rows: Row[]): string {
  const [m, h] = ci(rows.map((r) => r.delta));
  const won = rows.filter((r) => r.won);
  return [
    name.padEnd(18),
    `每盘 ${f(m)} ± ${f(h)}（${f(m - h)} ~ ${f(m + h)}）`,
    `胡牌 ${f((100 * won.length) / rows.length, 1)}%`,
    `点炮 ${f(mean(rows.map((r) => r.dealIn)))} 次/盘`,
    `胡牌平均 ${f(won.length ? mean(won.map((r) => r.fan)) : 0, 2)} 番`,
    `被查大叫 ${f(100 * mean(rows.map((r) => r.chajiao)), 1)}%`,
    `花猪 ${f(100 * mean(rows.map((r) => r.huazhu)), 2)}%`,
  ].join('  ');
}

function paired(a: Row[], b: Row[]): string {
  const [m, h] = ci(a.map((r, i) => r.delta - b[i].delta));
  return `${f(m)} ± ${f(h)}（${f(m - h)} ~ ${f(m + h)}）`;
}

async function main() {
  const arg = (name: string, def: number) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? Number(process.argv[i + 1]) : def;
  };
  const jobs = arg('--jobs', 16);
  OFFSET = arg('--offset', 0);
  const pi = process.argv.indexOf('--params');
  const custom = pi >= 0 ? (JSON.parse(process.argv[pi + 1]) as DeepPartial<ScCoachParams>) : null;
  if (custom) {
    // 验证一组参数：与默认参数在同一批牌局上配对比较
    const rounds = arg('--rounds', 20000);
    // 对照组默认用默认参数，也可以用 --base '{...}' 指定
    const bi = process.argv.indexOf('--base');
    const baseParams =
      bi >= 0 ? (JSON.parse(process.argv[bi + 1]) as DeepPartial<ScCoachParams>) : undefined;
    const base = await runPolicy('v2', rounds, jobs, baseParams);
    const tuned = await runPolicy('v2', rounds, jobs, custom);
    console.log(summary(`v2 ${baseParams ? JSON.stringify(baseParams) : '默认'}`, base));
    console.log(summary(`v2 ${JSON.stringify(custom)}`, tuned));
    console.log(`调参 − 默认：每盘 ${paired(tuned, base)}`);
    return;
  }
  if (process.argv.includes('--grid')) {
    const rounds = arg('--rounds', 5000);
    const t0 = Date.now();
    const base = await runPolicy('v2', rounds, jobs);
    const results: { p: DeepPartial<ScCoachParams>; rows: Row[] }[] = [];
    // 网格可以用 --grid-values '{"kappa":[...],"waitKinds":[...],"huRate":[...]}' 指定
    const gi = process.argv.indexOf('--grid-values');
    const g = {
      kappa: [0.2, 0.35, 0.5],
      waitKinds: [1.6, 2.2, 3],
      huRate: [0.08, 0.12, 0.18],
      ...(gi >= 0 ? (JSON.parse(process.argv[gi + 1]) as Record<string, number[]>) : {}),
    };
    for (const kappa of g.kappa)
      for (const waitKinds of g.waitKinds)
        for (const huRate of g.huRate) {
          const p = { kappa, waitKinds, huRate };
          results.push({ p, rows: await runPolicy('v2', rounds, jobs, p) });
        }
    results.sort((a, b) => mean(b.rows.map((r) => r.delta)) - mean(a.rows.map((r) => r.delta)));
    console.log(`网格搜索：每组 ${rounds} 盘，共 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
    for (const r of results)
      console.log(
        `κ=${r.p.kappa} W=${r.p.waitKinds} h=${r.p.huRate}`.padEnd(24),
        `每盘 ${f(mean(r.rows.map((x) => x.delta)))}`,
        `比默认 ${paired(r.rows, base)}`,
      );
    return;
  }
  const rounds = arg('--rounds', 20000);
  const configs = (process.argv[process.argv.indexOf('--configs') + 1] ?? '').includes(',')
    ? (process.argv[process.argv.indexOf('--configs') + 1].split(',') as Policy[])
    : (['bot', 'v1', 'v2'] as Policy[]);
  const res: Partial<Record<Policy, Row[]>> = {};
  for (const p of configs) {
    const t0 = Date.now();
    res[p] = await runPolicy(p, rounds, jobs);
    console.log(summary(`${p}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`, res[p]!));
  }
  if (res.v2 && res.v1) console.log(`v2 − v1：每盘 ${paired(res.v2, res.v1)}`);
  if (res.v2 && res.bot) console.log(`v2 − bot：每盘 ${paired(res.v2, res.bot)}`);
  if (res.v1 && res.bot) console.log(`v1 − bot：每盘 ${paired(res.v1, res.bot)}`);
}

if (process.argv[2] === '--worker') {
  process.stdout.write(JSON.stringify(runJob(JSON.parse(process.argv[3]) as Job)));
} else {
  void main();
}
