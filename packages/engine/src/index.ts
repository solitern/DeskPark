export * from './core/cards';
export * from './core/rng';
export * from './core/types';
export * from './core/table';
export * from './core/registry';
export * from './core/ai';
export * from './core/coach';

import { registerGame } from './core/registry';
import { chess } from './games/chess';
import { doudizhu } from './games/doudizhu';
import { gemguild } from './games/gemguild';
import { guandan } from './games/guandan';
import { hexisle } from './games/hexisle';
import { heluogangci } from './games/heluo';
import { highcard } from './games/highcard';
import { onecard } from './games/onecard';
import { shuangsheng } from './games/shuangsheng';
import { sichuan } from './games/sichuan';
import { spellstones } from './games/spellstones';
import { texas } from './games/texas';
import { xiangqi } from './games/xiangqi';

export * as ddz from './games/doudizhu';
export * as gd from './games/guandan';
export * as sh from './games/shuangsheng';
export * as tx from './games/texas';
export * as hc from './games/highcard';
export * as sc from './games/sichuan';
export * as hl from './games/heluo';
export * as ss from './games/spellstones';
export * as oc from './games/onecard';
export * as hi from './games/hexisle';
export * as gg from './games/gemguild';
export * as ch from './games/chess';
export * as xq from './games/xiangqi';
export * as mj from './mahjong';

export {
  doudizhu,
  guandan,
  shuangsheng,
  texas,
  sichuan,
  heluogangci,
  xiangqi,
  chess,
  spellstones,
  onecard,
  hexisle,
  gemguild,
  highcard,
};

// 内置玩法（顺序即大厅展示顺序）
for (const g of [
  doudizhu,
  guandan,
  shuangsheng,
  texas,
  sichuan,
  heluogangci,
  xiangqi,
  chess,
  spellstones,
  onecard,
  hexisle,
  gemguild,
  highcard,
])
  registerGame(g);
