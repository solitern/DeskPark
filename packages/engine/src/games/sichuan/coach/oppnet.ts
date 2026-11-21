import { OPP_FEATURES, OPP_FEATURE_VERSION } from './oppfeatures';
import { OPP_NET } from './oppnet-weights';

/**
 * 对手模型（小型神经网络）的推理：两层 128 维全连接 + 三个输出头。
 * 权重由 ml/sc-opponent/train.py 训练、int8 量化后写进 oppnet-weights.ts；第一次用到时解码。
 * 纯 TypeScript 实现，不依赖 DOM / Node，浏览器、服务器、App 都能跑。
 */

interface Dense {
  out: number;
  in: number;
  w: Float32Array;
  b: Float32Array;
}

export interface OppPrediction {
  /** 打出每种牌（规范顺序）时，他能胡的概率 */
  win: Float32Array;
  /** 已经听牌的概率 */
  tenpai: number;
  /** 胡每种牌时的番数分布：fan[k * C + c] 为 c + 1 番的概率（C = fanClasses） */
  fan: Float32Array;
  fanClasses: number;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(s: string): Uint8Array {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | lookup[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

let layers: Record<string, Dense> | null = null;

function load(): Record<string, Dense> {
  if (layers) return layers;
  const bytes = decodeBase64(OPP_NET.data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  const out: Record<string, Dense> = {};
  for (const L of OPP_NET.layers) {
    const n = L.out * L.in;
    const q = new Int8Array(bytes.buffer, bytes.byteOffset + off, n);
    off += n;
    const scale = new Float32Array(L.out);
    for (let r = 0; r < L.out; r++, off += 4) scale[r] = view.getFloat32(off, true);
    const b = new Float32Array(L.out);
    for (let r = 0; r < L.out; r++, off += 4) b[r] = view.getFloat32(off, true);
    const w = new Float32Array(n);
    for (let r = 0; r < L.out; r++)
      for (let c = 0; c < L.in; c++) w[r * L.in + c] = q[r * L.in + c] * scale[r];
    out[L.name] = { out: L.out, in: L.in, w, b };
  }
  layers = out;
  return out;
}

/** 有没有可用的、与当前特征版本一致的模型 */
export function oppNetAvailable(): boolean {
  return (
    OPP_NET.layers.length > 0 &&
    OPP_NET.version === OPP_FEATURE_VERSION &&
    OPP_NET.features === OPP_FEATURES
  );
}

function dense(L: Dense, x: Float32Array, relu: boolean): Float32Array {
  const y = new Float32Array(L.out);
  for (let r = 0; r < L.out; r++) {
    let s = L.b[r];
    const row = r * L.in;
    for (let c = 0; c < L.in; c++) s += L.w[row + c] * x[c];
    y[r] = relu && s < 0 ? 0 : s;
  }
  return y;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function predictOpp(x: Float32Array): OppPrediction {
  const L = load();
  const h = dense(L.l2, dense(L.l1, x, true), true);
  const win = dense(L.win, h, false).map(sigmoid);
  const tenpai = sigmoid(dense(L.tenpai, h, false)[0]);
  const C = OPP_NET.fanClasses;
  const fan = dense(L.fan, h, false);
  for (let k = 0; k < fan.length / C; k++) {
    let max = -Infinity;
    for (let c = 0; c < C; c++) max = Math.max(max, fan[k * C + c]);
    let sum = 0;
    for (let c = 0; c < C; c++) sum += fan[k * C + c] = Math.exp(fan[k * C + c] - max);
    for (let c = 0; c < C; c++) fan[k * C + c] /= sum;
  }
  return { win, tenpai, fan, fanClasses: C };
}
