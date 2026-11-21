/**
 * 生成四川麻将对手模型的训练数据。
 *
 *   npx tsx packages/engine/scripts/gen-sc-opp-data.ts [--games 30000] [--jobs 16] [--out ml/sc-opponent/data]
 *
 * 模拟对局（大多数四家都是 sichuanBot，约三成对局里随机一家按导师 v2 打，让数据更多样），
 * 每当有人轮到自己出牌，就以他为观察者，对每个还没胡的对手记一条样本：
 * - 特征：oppFeatures(观察者的 view, 对手)，只含公开信息；
 * - 标签（来自真实局面，观察者看不到）：对手现在能胡哪些牌、胡每张各几番、是否已听牌；
 * - 对照：现有经验公式对同样问题的估计，用来比较模型好坏。
 * 牌种都按 oppFeatures 的规范顺序（缺门放最后）。每个进程写一组二进制文件，Python 端拼起来读。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../src/core/rng';
import type { ScAction, ScState } from '../src/games/sichuan';
import { coachSichuan, sichuan } from '../src/games/sichuan';
import { opponentsOf } from '../src/games/sichuan/coach/opponents';
import {
  OPP_FEATURES,
  OPP_FEATURE_VERSION,
  canonicalSuits,
  oppFeatures,
  toCanon,
} from '../src/games/sichuan/coach/oppfeatures';
import { SC_COACH_PARAMS } from '../src/games/sichuan/coach/params';
import { evaluateHand } from '../src/games/sichuan/scoring';
import { KINDS, countKinds, kindSuit } from '../src/mahjong/tiles';

/** 标签：能胡哪些牌（27）+ 各几番（27，0 表示胡不了）+ 是否听牌（1） */
const LABELS = KINDS * 2 + 1;
/** 经验公式的估计：听牌程度（1）+ 胡每张的概率（27）+ 番数（27） */
const HEUR = 1 + KINDS * 2;

interface Part {
  feat: Float32Array;
  lab: Uint8Array;
  heur: Float32Array;
  gid: Uint32Array;
  n: number;
}

function coachAction(st: ScState, seat: number): ScAction | null {
  const v = sichuan.view(st, seat);
  const L = v.legal;
  if (!L || L.ready) return null;
  const c = coachSichuan(v);
  const a = c.advice.action;
  if (L.exchange) return a === 'exchange' ? { type: 'exchange', tiles: c.advice.tiles } : null;
  if (L.que) return c.advice.suit ? { type: 'que', suit: c.advice.suit } : null;
  if (a === 'hu' && L.hu) return { type: 'hu' };
  if (a === 'discard' && L.discard.includes(c.advice.tiles[0]))
    return { type: 'discard', tile: c.advice.tiles[0] };
  if (a === 'peng' && L.peng) return { type: 'peng' };
  if (a === 'pass' && L.pass) return { type: 'pass' };
  return null;
}

function runJob(from: number, count: number): Part {
  const cap = count * 160;
  const feat = new Float32Array(cap * OPP_FEATURES);
  const lab = new Uint8Array(cap * LABELS);
  const heur = new Float32Array(cap * HEUR);
  const gid = new Uint32Array(cap);
  let n = 0;
  for (let g = from; g < from + count; g++) {
    const seed = 500009 + g * 13;
    const rng = new Rng(seed);
    let st = sichuan.setup({
      players: [0, 1, 2, 3].map((s) => ({ name: `p${s}`, isBot: true })),
      options: { ...sichuan.defaultOptions, rounds: 1 },
      seed,
    });
    const coachSeat = rng.next() < 0.3 ? rng.int(4) : -1;
    for (
      let step = 0;
      step < 4000 && st.phase !== 'roundOver' && st.phase !== 'matchOver';
      step++
    ) {
      const seat = sichuan.activeSeats(st)[0];
      const v = sichuan.view(st, seat);
      // 有人轮到自己出牌：以他为观察者，给每个对手记样本
      if (st.phase === 'play' && !v.window && v.legal?.discard.length && n + 3 <= cap) {
        // 对照组一定要用经验公式（有模型时默认参数会改用模型）
        const heurOpps = opponentsOf(v, seat, { ...SC_COACH_PARAMS, opponentModel: 'heuristic' });
        for (let o = 0; o < 4; o++) {
          if (o === seat) continue;
          const f = oppFeatures(v, o);
          if (!f) continue;
          const p = st.players[o];
          const order = canonicalSuits(p.que!);
          feat.set(f, n * OPP_FEATURES);
          // 真实标签：现在能胡哪些牌、各几番
          const hasQue = p.hand.some((t) => t.suit === p.que);
          const counts = countKinds(p.hand);
          const shapes = p.melds.map((m) => ({ type: m.type, kind: m.kind }));
          let tenpai = 0;
          if (!hasQue)
            for (let k = 0; k < KINDS; k++) {
              if (kindSuit(k) === p.que || counts[k] >= 4) continue;
              counts[k]++;
              const val = evaluateHand(counts, shapes, { jingoudiao: st.options.jingoudiao });
              counts[k]--;
              if (val) {
                const ck = toCanon(k, order);
                lab[n * LABELS + ck] = 1;
                lab[n * LABELS + KINDS + ck] = Math.min(255, val.base);
                tenpai = 1;
              }
            }
          lab[n * LABELS + 2 * KINDS] = tenpai;
          // 经验公式的估计（同样换成规范顺序）
          const h = heurOpps.find((x) => x.seat === o);
          if (h) {
            heur[n * HEUR] = h.ready;
            for (let k = 0; k < KINDS; k++) {
              const ck = toCanon(k, order);
              heur[n * HEUR + 1 + ck] = h.ready * h.wait[k];
              heur[n * HEUR + 1 + KINDS + ck] =
                h.flush && kindSuit(k) === h.flush ? h.fan : h.fanPlain;
            }
          }
          gid[n] = g;
          n++;
        }
      }
      let a: ScAction | null = null;
      if (seat === coachSeat) {
        a = coachAction(st, seat);
        if (a && sichuan.validate(st, seat, a)) a = null;
      }
      st = sichuan.apply(st, seat, a ?? sichuan.bot(v, seat, rng));
    }
  }
  return {
    feat: feat.subarray(0, n * OPP_FEATURES),
    lab: lab.subarray(0, n * LABELS),
    heur: heur.subarray(0, n * HEUR),
    gid: gid.subarray(0, n),
    n,
  };
}

function spawnJob(args: string[]): Promise<number> {
  return new Promise((res, rej) => {
    const self = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [...process.execArgv, self, '--worker', ...args], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? res(Number(out)) : rej(new Error(`job ${code}`))));
  });
}

async function main() {
  const arg = (name: string, def: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : def;
  };
  const games = Number(arg('--games', '30000'));
  const jobs = Number(arg('--jobs', '16'));
  const out = resolve(arg('--out', 'ml/sc-opponent/data'));
  mkdirSync(out, { recursive: true });
  const per = Math.ceil(games / jobs);
  const t0 = Date.now();
  const counts = await Promise.all(
    Array.from({ length: jobs }, (_, j) =>
      spawnJob([
        String(j * per),
        String(Math.max(0, Math.min(per, games - j * per))),
        out,
        String(j),
      ]),
    ),
  );
  const meta = {
    version: OPP_FEATURE_VERSION,
    features: OPP_FEATURES,
    kinds: KINDS,
    labels: LABELS,
    heur: HEUR,
    games,
    parts: counts.map((n, j) => ({ name: `part-${String(j).padStart(2, '0')}`, n })),
    samples: counts.reduce((a, b) => a + b, 0),
  };
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(
    `${games} 局，${meta.samples} 条样本，${((Date.now() - t0) / 1000).toFixed(0)} 秒 → ${out}`,
  );
}

if (process.argv[2] === '--worker') {
  const [from, count, out, j] = process.argv.slice(3);
  const part = runJob(Number(from), Number(count));
  const name = join(out, `part-${String(j).padStart(2, '0')}`);
  writeFileSync(
    `${name}.feat.f32`,
    Buffer.from(part.feat.buffer, part.feat.byteOffset, part.feat.byteLength),
  );
  writeFileSync(
    `${name}.lab.u8`,
    Buffer.from(part.lab.buffer, part.lab.byteOffset, part.lab.byteLength),
  );
  writeFileSync(
    `${name}.heur.f32`,
    Buffer.from(part.heur.buffer, part.heur.byteOffset, part.heur.byteLength),
  );
  writeFileSync(
    `${name}.gid.u32`,
    Buffer.from(part.gid.buffer, part.gid.byteOffset, part.gid.byteLength),
  );
  process.stdout.write(String(part.n));
} else {
  void main();
}
