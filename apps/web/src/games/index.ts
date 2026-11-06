import type { Card } from '@park/engine';
import type { ComponentType } from 'react';
import { lazy } from 'react';
import type { GameController } from '../lib/controller';
import { ChessArt } from './chess/pieces';
import { GemGuildArt } from './gemguild/art';
import { HexArt } from './hexisle/art';
import { OneCardArt } from './onecard/cards';
import { SpellArt } from './spellstones/spells';
import { XiangqiArt } from './xiangqi/pieces';

/**
 * 前端玩法注册表：每个玩法 = 引擎中的规则定义（按 id 关联）+ 一个牌桌界面组件 + 大厅展示信息。
 * 新增玩法时，在引擎注册 GameDefinition，并在这里添加对应的界面即可。
 */
export interface GameUI {
  id: string;
  Board: ComponentType<{ ctl: GameController }>;
  /** 大厅卡片的配色（渐变起止色） */
  tint: [string, string];
  /** 大厅卡片上展示的几张牌 */
  showcase: Card[];
  /** 麻将类玩法：大厅卡片上展示的麻将牌 */
  tiles?: { id: number; suit: 'wan' | 'tiao' | 'tong'; rank: number }[];
  /** 人数说明 */
  people: string;
  /** 额外标签 */
  badge?: string;
  /** showcase 中哪些牌显示为万能牌 */
  wildIds?: number[];
  /** 自定义大厅卡片插画（桌游等非牌类玩法） */
  Art?: ComponentType;
}

const c = (id: number, suit: Card['suit'], rank: number): Card => ({ id, suit, rank });

export const GAME_UIS: GameUI[] = [
  {
    id: 'doudizhu',
    Board: lazy(() => import('./doudizhu/DoudizhuBoard')),
    tint: ['#b8553f', '#7c2f25'],
    showcase: [c(1, 'S', 2), c(2, 'J', 16), c(3, 'J', 17)],
    people: '3 人',
  },
  {
    id: 'guandan',
    Board: lazy(() => import('./guandan/GuandanBoard')),
    tint: ['#3f6f8f', '#22415a'],
    showcase: [c(1, 'S', 14), c(2, 'C', 14), c(3, 'H', 2)],
    wildIds: [3],
    people: '4 人 · 2v2',
  },
  {
    id: 'shuangsheng',
    Board: lazy(() => import('./shuangsheng/ShuangshengBoard')),
    tint: ['#9a4a3a', '#5a2620'],
    showcase: [c(1, 'J', 17), c(2, 'H', 2), c(3, 'H', 2)],
    people: '4 人 · 2v2',
  },
  {
    id: 'texas',
    Board: lazy(() => import('./texas/TexasBoard')),
    tint: ['#2f6b55', '#163c30'],
    showcase: [c(1, 'S', 14), c(2, 'H', 14), c(3, 'S', 13)],
    people: '2–8 人',
  },
  {
    id: 'heluogangci',
    Board: lazy(() => import('./heluo/HeluoBoard')),
    tint: ['#8f3d2f', '#4a1f18'],
    showcase: [],
    tiles: [
      { id: 1, suit: 'wan', rank: 5 },
      { id: 2, suit: 'tong', rank: 1 },
      { id: 3, suit: 'tiao', rank: 1 },
    ],
    people: '4 人 · 河洛杠次',
  },
  {
    id: 'sichuan',
    Board: lazy(() => import('./sichuan/SichuanBoard')),
    tint: ['#3d7a6a', '#1f4a40'],
    showcase: [],
    tiles: [
      { id: 1, suit: 'wan', rank: 8 },
      { id: 2, suit: 'tong', rank: 1 },
      { id: 3, suit: 'tiao', rank: 1 },
    ],
    people: '4 人 · 血战到底',
  },
  {
    id: 'xiangqi',
    Board: lazy(() => import('./xiangqi/XiangqiBoard')),
    tint: ['#b0742f', '#5c3612'],
    showcase: [],
    Art: XiangqiArt,
    people: '2 人',
  },
  {
    id: 'chess',
    Board: lazy(() => import('./chess/ChessBoard')),
    tint: ['#5a6a7a', '#262f3a'],
    showcase: [],
    Art: ChessArt,
    people: '2 人',
  },
  {
    id: 'spellstones',
    Board: lazy(() => import('./spellstones/SpellBoard')),
    tint: ['#5b4a9a', '#2c2357'],
    showcase: [],
    Art: SpellArt,
    people: '2–5 人',
  },
  {
    id: 'onecard',
    Board: lazy(() => import('./onecard/OneCardBoard')),
    tint: ['#d4473c', '#6f2140'],
    showcase: [],
    Art: OneCardArt,
    people: '2–8 人',
  },
  {
    id: 'hexisle',
    Board: lazy(() => import('./hexisle/HexisleBoard')),
    tint: ['#3487b8', '#1b4c70'],
    showcase: [],
    Art: HexArt,
    people: '2–4 人',
  },
  {
    id: 'gemguild',
    Board: lazy(() => import('./gemguild/GemBoard')),
    tint: ['#4b3a8c', '#1f1745'],
    showcase: [],
    Art: GemGuildArt,
    people: '2–4 人',
  },
  {
    id: 'highcard',
    Board: lazy(() => import('./highcard/HighcardBoard')),
    tint: ['#6a6158', '#3f3933'],
    showcase: [c(1, 'D', 7), c(2, 'C', 12), c(3, 'H', 10)],
    people: '2–6 人',
    badge: '示例',
  },
];

export function getGameUI(id: string): GameUI | undefined {
  return GAME_UIS.find((g) => g.id === id);
}
