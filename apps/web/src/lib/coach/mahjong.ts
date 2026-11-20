import type { sc } from '@park/engine';

/**
 * 麻将导师精算：在后台线程里对几个候选出牌做蒙特卡洛模拟（约 0.8 秒）。
 * 一次只算一个局面；局面变了又来新请求时，直接结束还在算的旧请求，免得白白占着 CPU。
 */

type Stats = Record<number, sc.ScMcStat>;

let worker: Worker | null = null;
let seq = 0;
let pending: { id: number; resolve: (s: Stats) => void; reject: (e: Error) => void } | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; stats?: Stats; error?: string }>) => {
    if (!pending || e.data.id !== pending.id) return;
    const p = pending;
    pending = null;
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.stats ?? {});
  };
  worker.onerror = () => {
    pending?.reject(new Error('精算失败'));
    pending = null;
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** 丢弃还没算完的精算 */
export function cancelMahjongMc(): void {
  if (!pending) return;
  pending.reject(new Error('stale'));
  pending = null;
  worker?.terminate();
  worker = null;
}

export function mahjongMc(view: sc.ScView, tiles: number[]): Promise<Stats> {
  cancelMahjongMc();
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending = { id, resolve, reject };
    w.postMessage({ id, game: 'sichuan', view, tiles });
  });
}
