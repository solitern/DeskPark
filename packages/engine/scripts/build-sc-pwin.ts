/**
 * 生成四川麻将导师的胡牌概率表（算法说明第 4.2 节）。
 *
 *   npx tsx packages/engine/scripts/build-sc-pwin.ts [--trials 160000] [--jobs 16]
 *
 * 随机发一手「缺一门」的 13 张，从剩下的牌里一张张摸：先打缺门，否则按「路线内有效进张最大」打牌；
 * 记录每个 (向听 s, 有效进张 u) 状态之后 T 次摸牌内能否胡牌，统计成表。
 * 「标准」表走普通路线（标准型与七对取小），「七对」表只做七对。
 * 每格至少 MIN_SAMPLES 个样本；不足的格子用同一行相邻格插值，再保证对 u、T 单调不减。
 * 结果写到 src/games/sichuan/coach/pwin-table.ts，需要提交进仓库。
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/core/rng';
import { isSevenPairs, isStandardWin, shanten, shantenSevenPairs } from '../src/mahjong/analysis';
import { KINDS, MJ_SUITS, createTiles, kindOf } from '../src/mahjong/tiles';
import { MAX_SHANTEN, T_GRID, U_EDGES, uBucket } from '../src/games/sichuan/coach/pwin';
import type { PwinType } from '../src/games/sichuan/coach/pwin';

const MIN_SAMPLES = 2000;
/** 只记录前 RECORD_UPTO 次摸牌时的状态，一直模拟到 MAX_DRAWS 次，保证每个状态都能看满 40 次摸牌 */
const RECORD_UPTO = 20;
const MAX_DRAWS = RECORD_UPTO + T_GRID[T_GRID.length - 1];
const NS = MAX_SHANTEN + 1;
const NU = U_EDGES.length;
const NT = T_GRID.length;

type Acc = { n: number[]; w: number[] };
const idx = (s: number, u: number, t: number) => (s * NU + u) * NT + t;
const newAcc = (): Acc => ({
  n: new Array(NS * NU * NT).fill(0),
  w: new Array(NS * NU * NT).fill(0),
});

function shapeOf(type: PwinType) {
  return type === 'std' ? (c: number[]) => shanten(c, 0) : (c: number[]) => shantenSevenPairs(c);
}

/** 路线向听与有效进张（c 为去掉缺门的计数，q 为缺门张数） */
function evalState(type: PwinType, c: number[], q: number, left: number[], que: number) {
  const shape = shapeOf(type);
  const s = Math.max(shape(c), q);
  // 有缺门时摸到的牌顶替一张缺门；没有缺门时可以一直降到 -1（和牌）
  const floor = q > 0 ? q - 1 : -Infinity;
  let u = 0;
  for (let k = 0; k < KINDS; k++) {
    if (Math.floor(k / 9) === que || left[k] <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (Math.max(shape(c), floor) < s) u += left[k];
    c[k]--;
  }
  return { s, u };
}

function simulate(type: PwinType, rng: Rng, acc: Acc) {
  const tiles = rng.shuffle(createTiles());
  const hand = tiles.slice(0, 13);
  const wall = tiles.slice(13);
  // 定缺：手里最少的一门
  const bySuit = MJ_SUITS.map((s) => hand.filter((t) => t.suit === s).length);
  const min = Math.min(...bySuit);
  const ques = [0, 1, 2].filter((i) => bySuit[i] === min);
  const que = ques[rng.int(ques.length)];
  const c = new Array<number>(KINDS).fill(0);
  const left = new Array<number>(KINDS).fill(4);
  let q = 0;
  for (const t of hand) {
    const k = kindOf(t);
    left[k]--;
    if (Math.floor(k / 9) === que) q++;
    else c[k]++;
  }
  const shape = shapeOf(type);
  const records: { i: number; s: number; u: number }[] = [];
  let winAt: number | null = null;
  for (let i = 0; i < MAX_DRAWS; i++) {
    if (i <= RECORD_UPTO) {
      const st = evalState(type, c, q, left, que);
      records.push({ i, s: st.s, u: st.u });
    }
    const t = wall[i];
    const k = kindOf(t);
    left[k]--;
    if (Math.floor(k / 9) === que) {
      // 摸到缺门：直接打掉（规则强制先打缺门）
      continue;
    }
    c[k]++;
    if (q === 0) {
      const win = type === 'std' ? isStandardWin(c, 4) || isSevenPairs(c, 0) : isSevenPairs(c, 0);
      if (win) {
        winAt = i + 1;
        break;
      }
    }
    if (q > 0) {
      // 手里还有缺门：打一张缺门，摸到的牌留下
      q--;
      continue;
    }
    // 选打哪张：路线向听最小，其次有效进张最多
    let bestS = Infinity;
    const cands: number[] = [];
    for (let j = 0; j < KINDS; j++) {
      if (c[j] === 0) continue;
      c[j]--;
      const s = shape(c);
      c[j]++;
      if (s < bestS) {
        bestS = s;
        cands.length = 0;
      }
      if (s === bestS) cands.push(j);
    }
    let pick = cands[0];
    if (cands.length > 1) {
      let bestU = -1;
      for (const j of cands) {
        c[j]--;
        const { u } = evalState(type, c, 0, left, que);
        c[j]++;
        if (u > bestU || (u === bestU && rng.next() < 0.5)) {
          bestU = u;
          pick = j;
        }
      }
    }
    c[pick]--;
  }
  for (const r of records) {
    const s = Math.min(MAX_SHANTEN, r.s);
    const ub = uBucket(r.u);
    for (let ti = 0; ti < NT; ti++) {
      const T = T_GRID[ti];
      if (r.i + T > MAX_DRAWS) continue;
      const j = idx(s, ub, ti);
      acc.n[j]++;
      if (winAt !== null && winAt - r.i <= T) acc.w[j]++;
    }
  }
}

function runWorker(type: PwinType, seed: number, trials: number) {
  const rng = new Rng(seed);
  const acc = newAcc();
  for (let i = 0; i < trials; i++) simulate(type, rng, acc);
  process.stdout.write(JSON.stringify(acc));
}

function spawnWorker(type: PwinType, seed: number, trials: number): Promise<Acc> {
  return new Promise((resolve, reject) => {
    const self = fileURLToPath(import.meta.url);
    const child = spawn(
      process.execPath,
      [...process.execArgv, self, '--worker', type, String(seed), String(trials)],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('exit', (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker ${code}`)),
    );
  });
}

/** 合并、插值、单调化 */
function buildTable(acc: Acc): { table: number[][][]; thin: number } {
  let thin = 0;
  const table: number[][][] = [];
  for (let s = 0; s < NS; s++) {
    const rows: number[][] = Array.from({ length: NU }, () => new Array(NT).fill(NaN));
    for (let ti = 0; ti < NT; ti++) {
      const col: (number | null)[] = [];
      for (let u = 0; u < NU; u++) {
        const j = idx(s, u, ti);
        if (acc.n[j] >= MIN_SAMPLES) col.push(acc.w[j] / acc.n[j]);
        // 没有有效进张就胡不了：u = 0 的格子样本不足时取 0，作为插值的下端
        else col.push(u === 0 ? 0 : null);
        if (acc.n[j] < MIN_SAMPLES) thin++;
      }
      // 样本不足：用同一行（同 s、同 T）相邻的有效格线性插值；只有一边就沿用那一边
      const known = col.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0);
      for (let u = 0; u < NU; u++) {
        if (col[u] !== null) {
          rows[u][ti] = col[u]!;
          continue;
        }
        const lo = [...known].reverse().find((i) => i < u);
        const hi = known.find((i) => i > u);
        if (lo !== undefined && hi !== undefined)
          rows[u][ti] = col[lo]! + ((col[hi]! - col[lo]!) * (u - lo)) / (hi - lo);
        else if (lo !== undefined) rows[u][ti] = col[lo]!;
        else if (hi !== undefined) rows[u][ti] = col[hi]!;
        else rows[u][ti] = 0;
      }
    }
    // 单调：u 越多、T 越多，胡牌概率不会更低
    for (let u = 0; u < NU; u++)
      for (let ti = 0; ti < NT; ti++) {
        let v = rows[u][ti];
        if (u > 0) v = Math.max(v, rows[u - 1][ti]);
        if (ti > 0) v = Math.max(v, rows[u][ti - 1]);
        rows[u][ti] = Math.min(1, v);
      }
    table.push(rows);
  }
  // 向听越少越容易胡
  for (let s = 1; s < NS; s++)
    for (let u = 0; u < NU; u++)
      for (let ti = 0; ti < NT; ti++)
        table[s][u][ti] = Math.min(table[s][u][ti], table[s - 1][u][ti]);
  return { table, thin };
}

async function main() {
  const arg = (name: string, def: number) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? Number(process.argv[i + 1]) : def;
  };
  const trials = arg('--trials', 160000);
  const jobs = arg('--jobs', 16);
  const out: Record<PwinType, number[][][]> = { std: [], qidui: [] };
  const report: string[] = [];
  for (const type of ['std', 'qidui'] as PwinType[]) {
    const t0 = Date.now();
    const per = Math.ceil(trials / jobs);
    const parts = await Promise.all(
      Array.from({ length: jobs }, (_, i) =>
        spawnWorker(type, 1000 * (type === 'std' ? 1 : 2) + i, per),
      ),
    );
    const acc = newAcc();
    for (const p of parts)
      for (let j = 0; j < acc.n.length; j++) {
        acc.n[j] += p.n[j];
        acc.w[j] += p.w[j];
      }
    const { table, thin } = buildTable(acc);
    out[type] = table;
    report.push(
      `${type}: ${per * jobs} 局，${((Date.now() - t0) / 1000).toFixed(0)} 秒，样本不足 ${MIN_SAMPLES} 的格子 ${thin}/${acc.n.length}`,
    );
    // 每个向听的样本量概况
    for (let s = 0; s < NS; s++) {
      const n = U_EDGES.map((_, u) => acc.n[idx(s, u, 0)]);
      report.push(`  s=${s} 各桶样本：${n.join(' ')}`);
    }
  }
  const fmt = (t: number[][][]) =>
    '[\n' +
    t
      .map(
        (rows, s) =>
          `    // s = ${s}\n    [\n` +
          rows.map((r) => `      [${r.map((x) => +x.toFixed(4)).join(', ')}],`).join('\n') +
          '\n    ],',
      )
      .join('\n') +
    '\n  ]';
  const file = fileURLToPath(new URL('../src/games/sichuan/coach/pwin-table.ts', import.meta.url));
  writeFileSync(
    file,
    `// 由 scripts/build-sc-pwin.ts 生成（${trials} 局 × 2 张表），请勿手改。\n` +
      `// 维度：[向听 0–5][有效进张分桶 U_EDGES][摸牌次数 T_GRID]，见 pwin.ts。\n` +
      `export const PWIN_TABLE: Record<'std' | 'qidui', number[][][]> = {\n` +
      `  std: ${fmt(out.std)},\n  qidui: ${fmt(out.qidui)},\n};\n`,
  );
  console.log(report.join('\n'));
  console.log(`写入 ${file}`);
}

if (process.argv[2] === '--worker') {
  runWorker(process.argv[3] as PwinType, Number(process.argv[4]), Number(process.argv[5]));
} else {
  void main();
}
