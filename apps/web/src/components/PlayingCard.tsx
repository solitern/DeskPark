import type { Card } from '@park/engine';
import type { CSSProperties, HTMLAttributes } from 'react';
import { memo } from 'react';
import { CourtIcon, JesterIcon, SuitIcon } from './Suit';

const FACE: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankText(rank: number): string {
  return FACE[rank] ?? String(rank);
}

export interface PlayingCardProps extends HTMLAttributes<HTMLDivElement> {
  card?: Card | null;
  /** 牌宽（CSS 长度），高度自动按 1.4 倍 */
  w?: string;
  faceDown?: boolean;
  selected?: boolean;
  dim?: boolean;
  highlight?: boolean;
  /** 掼蛋万能牌标记 */
  wild?: boolean;
}

export const PlayingCard = memo(function PlayingCard({
  card,
  w = 'var(--cw)',
  faceDown,
  selected,
  dim,
  highlight,
  wild,
  className = '',
  style,
  ...rest
}: PlayingCardProps) {
  const cls = [
    'pcard',
    faceDown || !card ? 'pcard--back' : '',
    selected ? 'is-selected' : '',
    dim ? 'is-dim' : '',
    highlight ? 'is-highlight' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const s = { '--w': w, ...style } as CSSProperties;

  if (faceDown || !card) {
    return (
      <div className={cls} style={s} {...rest}>
        <div className="pcard__back">
          <span className="pcard__emblem">亭</span>
        </div>
      </div>
    );
  }

  if (card.suit === 'J') {
    const big = card.rank === 17;
    return (
      <div className={`${cls} pcard--joker ${big ? 'is-big' : ''}`} style={s} {...rest}>
        <div className="pcard__jindex">{big ? '大王' : '小王'}</div>
        <JesterIcon className="pcard__jcenter" />
      </div>
    );
  }

  const face = card.rank >= 11 && card.rank <= 13;
  return (
    <div className={cls} style={s} data-suit={card.suit} data-rank={card.rank} {...rest}>
      <div className="pcard__index">
        <span className={`pcard__rank ${card.rank === 10 ? 'is-ten' : ''}`}>
          {rankText(card.rank)}
        </span>
        <SuitIcon suit={card.suit} className="pcard__suit" />
      </div>
      {face ? (
        <CourtIcon rank={card.rank} className="pcard__court" />
      ) : (
        <SuitIcon suit={card.suit} className={`pcard__pip ${card.rank === 14 ? 'is-ace' : ''}`} />
      )}
      {wild && <span className="pcard__wild">配</span>}
    </div>
  );
});
