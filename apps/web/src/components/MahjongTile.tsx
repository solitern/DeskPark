import type { mj } from '@park/engine';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { memo } from 'react';

/**
 * 麻将牌面（矢量绘制，跨平台一致）：
 * 万：上为汉字数字、下为红色「萬」；筒：经典配色的圆饼排布；条：竹节排布，一条为小鸟。
 */

const INK = '#1d2a3a';
const RED = '#c0392b';
const GREEN = '#2e7a4f';
const BLUE = '#2a5b8c';

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

type Dot = [x: number, y: number, color: string];

// 筒子圆饼位置（画布 60×80）
const DOTS: Record<number, Dot[]> = {
  2: [
    [30, 24, GREEN],
    [30, 56, BLUE],
  ],
  3: [
    [16, 18, BLUE],
    [30, 40, RED],
    [44, 62, GREEN],
  ],
  4: [
    [18, 24, BLUE],
    [42, 24, GREEN],
    [18, 56, GREEN],
    [42, 56, BLUE],
  ],
  5: [
    [17, 19, BLUE],
    [43, 19, GREEN],
    [30, 40, RED],
    [17, 61, GREEN],
    [43, 61, BLUE],
  ],
  6: [
    [19, 16, GREEN],
    [41, 16, GREEN],
    [19, 42, RED],
    [41, 42, RED],
    [19, 64, RED],
    [41, 64, RED],
  ],
  7: [
    [14, 12, GREEN],
    [30, 21, GREEN],
    [46, 30, GREEN],
    [19, 50, RED],
    [41, 50, RED],
    [19, 67, RED],
    [41, 67, RED],
  ],
  8: [
    [19, 12, BLUE],
    [41, 12, BLUE],
    [19, 30, BLUE],
    [41, 30, BLUE],
    [19, 49, BLUE],
    [41, 49, BLUE],
    [19, 67, BLUE],
    [41, 67, BLUE],
  ],
  9: [
    [13, 15, BLUE],
    [30, 15, BLUE],
    [47, 15, BLUE],
    [13, 40, RED],
    [30, 40, RED],
    [47, 40, RED],
    [13, 65, GREEN],
    [30, 65, GREEN],
    [47, 65, GREEN],
  ],
};

function DotShape({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x} cy={y} r={r * 0.72} fill="#fbf7ee" />
      <circle cx={x} cy={y} r={r * 0.48} fill={color} />
      <circle cx={x} cy={y} r={r * 0.16} fill="#fbf7ee" />
    </g>
  );
}

function TongFace({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <g>
        <circle cx={30} cy={40} r={24} fill={GREEN} />
        <circle cx={30} cy={40} r={20} fill="#fbf7ee" />
        <circle cx={30} cy={40} r={17} fill={RED} />
        <circle cx={30} cy={40} r={12} fill="#fbf7ee" />
        <circle cx={30} cy={40} r={9} fill={BLUE} />
        <circle cx={30} cy={40} r={3.5} fill="#fbf7ee" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return (
            <circle
              key={i}
              cx={30 + Math.cos(a) * 14.5}
              cy={40 + Math.sin(a) * 14.5}
              r={1.2}
              fill="#fbf7ee"
            />
          );
        })}
      </g>
    );
  }
  const r =
    rank <= 2 ? 11 : rank <= 4 ? 10 : rank <= 6 ? 8.5 : rank === 7 ? 7.2 : rank === 8 ? 7.6 : 7.6;
  return (
    <g>
      {DOTS[rank].map(([x, y, c], i) => (
        <DotShape key={i} x={x} y={y} r={r} color={c} />
      ))}
    </g>
  );
}

// 条子竹节位置（中心点 + 颜色）
type Stick = [x: number, y: number, color: string, rot?: number];
const STICKS: Record<number, Stick[]> = {
  2: [
    [30, 21, GREEN],
    [30, 59, GREEN],
  ],
  3: [
    [30, 21, GREEN],
    [18, 59, GREEN],
    [42, 59, GREEN],
  ],
  4: [
    [18, 21, GREEN],
    [42, 21, GREEN],
    [18, 59, GREEN],
    [42, 59, GREEN],
  ],
  5: [
    [14, 21, GREEN],
    [46, 21, GREEN],
    [30, 40, RED],
    [14, 59, GREEN],
    [46, 59, GREEN],
  ],
  6: [
    [14, 21, GREEN],
    [30, 21, GREEN],
    [46, 21, GREEN],
    [14, 59, GREEN],
    [30, 59, GREEN],
    [46, 59, GREEN],
  ],
  7: [
    [30, 13, RED],
    [14, 40, GREEN],
    [30, 40, GREEN],
    [46, 40, GREEN],
    [14, 66, GREEN],
    [30, 66, GREEN],
    [46, 66, GREEN],
  ],
  8: [
    [11, 21, GREEN],
    [22, 21, GREEN, 28],
    [38, 21, GREEN, -28],
    [49, 21, GREEN],
    [11, 59, GREEN],
    [22, 59, GREEN, -28],
    [38, 59, GREEN, 28],
    [49, 59, GREEN],
  ],
  9: [
    [14, 13, GREEN],
    [30, 13, RED],
    [46, 13, GREEN],
    [14, 40, GREEN],
    [30, 40, RED],
    [46, 40, GREEN],
    [14, 66, GREEN],
    [30, 66, RED],
    [46, 66, GREEN],
  ],
};

function StickShape({
  x,
  y,
  color,
  h,
  rot = 0,
}: {
  x: number;
  y: number;
  color: string;
  h: number;
  rot?: number;
}) {
  const w = 6.4;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w / 2} fill={color} />
      <rect
        x={-w / 2 + 1.4}
        y={-h / 2 + 2}
        width={1.3}
        height={h - 4}
        rx={0.65}
        fill="#fbf7ee"
        opacity={0.45}
      />
      <rect x={-w / 2 - 0.6} y={-1} width={w + 1.2} height={2} rx={1} fill={color} />
      <rect x={-w / 2} y={-0.4} width={w} height={0.8} fill="#fbf7ee" opacity={0.6} />
    </g>
  );
}

function TiaoFace({ rank }: { rank: number }) {
  if (rank === 1) {
    // 一条：小鸟
    return (
      <g>
        <path
          d="M14 50c0-14 10-24 22-24 7 0 12 4 12 10 0 9-8 18-20 20l-9 12-2-9c-2-2-3-5-3-9z"
          fill={GREEN}
        />
        <path d="M25 40c6 1 11 5 12 11-6 1-12-1-15-6z" fill={RED} />
        <circle cx={43} cy={31} r={2} fill="#fbf7ee" />
        <circle cx={43.4} cy={31} r={1} fill={INK} />
        <path d="M48 33l7 2-7 3z" fill="#d68a2e" />
        <path d="M17 58c-5 4-8 10-8 16 4-4 9-6 13-7z" fill={BLUE} />
        <path d="M21 60c-2 5-2 10 0 15 2-5 5-8 9-10z" fill={RED} />
      </g>
    );
  }
  const h = rank === 7 || rank === 9 ? 20 : 26;
  return (
    <g>
      {STICKS[rank].map(([x, y, c, rot], i) => (
        <StickShape key={i} x={x} y={y} color={c} h={rank === 8 ? 26 : h} rot={rot} />
      ))}
    </g>
  );
}

function WanFace({ rank }: { rank: number }) {
  return (
    <g fontFamily="var(--font-display)" textAnchor="middle" fontWeight="700">
      <text x={30} y={34} fontSize={26} fill={INK}>
        {NUM[rank - 1]}
      </text>
      <text x={30} y={70} fontSize={30} fill={RED}>
        萬
      </text>
    </g>
  );
}

const HONOR_FENG = ['東', '南', '西', '北'];
const HONOR_JIAN = ['中', '發', '白'];

function FengFace({ rank }: { rank: number }) {
  return (
    <g fontFamily="var(--font-display)" textAnchor="middle" fontWeight="700">
      <text x={30} y={52} fontSize={34} fill={INK}>
        {HONOR_FENG[rank - 1]}
      </text>
    </g>
  );
}

function JianFace({ rank }: { rank: number }) {
  if (rank === 3) {
    return (
      <g>
        <rect x={12} y={14} width={36} height={52} rx={4} fill="none" stroke={BLUE} strokeWidth={3} />
        <rect x={17} y={19} width={26} height={42} rx={2} fill="none" stroke={GREEN} strokeWidth={1.4} />
      </g>
    );
  }
  const red = rank === 1;
  return (
    <g fontFamily="var(--font-display)" textAnchor="middle" fontWeight="700">
      <text x={30} y={54} fontSize={38} fill={red ? RED : GREEN}>
        {HONOR_JIAN[rank - 1]}
      </text>
    </g>
  );
}

export type FaceTile = { suit: string; rank: number };

export function TileFace({ tile }: { tile: FaceTile }) {
  let body: ReactNode;
  if (tile.suit === 'wan') body = <WanFace rank={tile.rank} />;
  else if (tile.suit === 'tong') body = <TongFace rank={tile.rank} />;
  else if (tile.suit === 'tiao') body = <TiaoFace rank={tile.rank} />;
  else if (tile.suit === 'feng') body = <FengFace rank={tile.rank} />;
  else body = <JianFace rank={tile.rank} />;
  return (
    <svg viewBox="0 0 60 80" className="mjtile__svg" aria-hidden="true">
      {body}
    </svg>
  );
}

export interface TileLike {
  id: number;
  suit: string;
  rank: number;
}

export interface MahjongTileProps extends HTMLAttributes<HTMLDivElement> {
  tile?: TileLike | null;
  w?: string;
  faceDown?: boolean;
  selected?: boolean;
  dim?: boolean;
  highlight?: boolean;
  /** 定缺花色标记 */
  que?: boolean;
  /** 角标文字（例如财神「财」） */
  badge?: string;
  /** 右上角显示的小牌（白板替身用来显示它代替的那张牌） */
  cornerTile?: TileLike | null;
  /** 财神光圈 */
  joker?: boolean;
}

const SUIT_LABEL: Record<string, string> = { wan: '万', tiao: '条', tong: '筒', feng: '风', jian: '箭' };

export const MahjongTile = memo(function MahjongTile({
  tile,
  w = 'var(--tw)',
  faceDown,
  selected,
  dim,
  highlight,
  que,
  badge,
  cornerTile,
  joker,
  className = '',
  style,
  ...rest
}: MahjongTileProps) {
  const cls = [
    'mjtile',
    faceDown || !tile ? 'mjtile--back' : '',
    selected ? 'is-selected' : '',
    dim ? 'is-dim' : '',
    highlight ? 'is-highlight' : '',
    joker ? 'is-joker-glow' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const s = { '--w': w, ...style } as CSSProperties;
  const label = tile && !faceDown ? `${tile.rank}${SUIT_LABEL[tile.suit]}` : '牌背';
  return (
    <div className={cls} style={s} role="img" aria-label={label} {...rest}>
      {tile && !faceDown && <TileFace tile={tile} />}
      {que && <span className="mjtile__que">缺</span>}
      {badge && !faceDown && <span className="mjtile__badge">{badge}</span>}
      {cornerTile && !faceDown && (
        <span className="mjtile__corner">
          <TileFace tile={cornerTile} />
        </span>
      )}
    </div>
  );
});

/** 花色徽标（定缺展示） */
export function SuitBadge({ suit, className = '' }: { suit: mj.MjSuit; className?: string }) {
  return <span className={`suit-badge is-${suit} ${className}`}>{SUIT_LABEL[suit]}</span>;
}
