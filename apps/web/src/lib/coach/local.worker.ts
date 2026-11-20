/// <reference lib="webworker" />
import type { CoachMove, sc as SC } from '@park/engine';
import { ch, sc, xq } from '@park/engine';

/** 内置引擎的分析、麻将导师的精算放在后台线程里跑，不卡住页面 */
type Req =
  | { id: number; game: 'chess' | 'xiangqi'; pos: never; user: CoachMove | null }
  | { id: number; game: 'sichuan'; view: SC.ScView; tiles: number[] };

self.onmessage = (e: MessageEvent<Req>) => {
  const req = e.data;
  if (req.game === 'sichuan') {
    try {
      self.postMessage({ id: req.id, stats: sc.mcEvaluate(req.view, req.tiles) });
    } catch (err) {
      self.postMessage({ id: req.id, error: String(err) });
    }
    return;
  }
  const { id, game, pos, user } = req;
  try {
    const analysis =
      game === 'chess'
        ? ch.analyzeChessLocal(ch.toBoard(pos), user)
        : xq.analyzeXiangqiLocal(xq.toBoard(pos), user);
    self.postMessage({ id, analysis });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
