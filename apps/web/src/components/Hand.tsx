import type { Card } from '@park/engine';
import type { CSSProperties } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playSound } from '../lib/sound';
import { PlayingCard } from './PlayingCard';

export interface HandProps {
  cards: Card[];
  selected: Set<number>;
  onChange?: (next: Set<number>) => void;
  /** fan：横向展开；stacks：按点数纵向叠放（适合掼蛋这类手牌很多的玩法） */
  layout?: 'fan' | 'stacks';
  /** stacks 布局的分组键（相同值的牌放一列，列顺序按 cards 中首次出现的顺序） */
  groupKey?: (c: Card) => number | string;
  isWild?: (c: Card) => boolean;
  disabled?: boolean;
  /** 单选模式（例如还贡、比大小） */
  single?: boolean;
  /** 新一局时用于触发发牌动画 */
  dealKey?: string | number;
  /** 需要高亮的牌（例如刚拿到的底牌） */
  highlight?: Set<number>;
}

/** 测量容器宽度 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 读取 CSS 变量 --cw 的实际像素值 */
function useCardWidth(el: HTMLElement | null, dep: number): number {
  return useMemo(() => {
    if (!el) return 64;
    const probe = document.createElement('div');
    probe.style.width = 'var(--cw)';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    el.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w || 64;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, dep]);
}

export function Hand({
  cards,
  selected,
  onChange,
  layout = 'fan',
  groupKey,
  isWild,
  disabled,
  single,
  dealKey,
  highlight,
}: HandProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const cw = useCardWidth(ref.current, width);
  const ch = cw * 1.4;
  const drag = useRef<{ mode: boolean; seen: Set<number> } | null>(null);

  const positions = useMemo(() => {
    const pos = new Map<number, { x: number; y: number; z: number }>();
    if (layout === 'stacks' && groupKey) {
      const cols: Card[][] = [];
      const index = new Map<number | string, number>();
      for (const c of cards) {
        const k = groupKey(c);
        if (!index.has(k)) {
          index.set(k, cols.length);
          cols.push([]);
        }
        cols[index.get(k)!].push(c);
      }
      const n = cols.length;
      const maxStep = cw * 0.92;
      const step = n > 1 ? Math.min(maxStep, (width - cw) / (n - 1)) : 0;
      const total = step * (n - 1) + cw;
      const x0 = Math.max(0, (width - total) / 2);
      const vstep = ch * 0.24;
      const tallest = Math.max(1, ...cols.map((c) => c.length));
      cols.forEach((col, ci) => {
        col.forEach((c, j) => {
          pos.set(c.id, {
            x: x0 + ci * step,
            y: (tallest - col.length + j) * vstep,
            z: ci * 20 + j,
          });
        });
      });
      return { pos, height: ch + (tallest - 1) * vstep };
    }
    const n = cards.length;
    const maxStep = cw * 0.6;
    const minStep = cw * 0.22;
    const step = n > 1 ? Math.max(minStep, Math.min(maxStep, (width - cw) / (n - 1))) : 0;
    const total = step * Math.max(0, n - 1) + cw;
    const x0 = Math.max(0, (width - total) / 2);
    cards.forEach((c, i) => pos.set(c.id, { x: x0 + i * step, y: 0, z: i }));
    return { pos, height: ch };
  }, [cards, layout, groupKey, width, cw, ch]);

  const setSel = useCallback(
    (id: number, on: boolean) => {
      if (!onChange) return;
      if (single) {
        onChange(on ? new Set([id]) : new Set());
        return;
      }
      const next = new Set(selected);
      if (on) next.add(id);
      else next.delete(id);
      onChange(next);
      return next;
    },
    [onChange, selected, single],
  );

  const idAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cid]');
    return el ? Number(el.dataset.cid) : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !onChange) return;
    const id = idAt(e.clientX, e.clientY);
    if (id === null) return;
    const mode = !selected.has(id);
    drag.current = { mode, seen: new Set([id]) };
    setSel(id, mode);
    playSound('select');
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || single) return;
    const id = idAt(e.clientX, e.clientY);
    if (id === null || d.seen.has(id)) return;
    d.seen.add(id);
    // 拖动时批量设置，避免闭包里的 selected 过期
    const next = new Set(selected);
    for (const sid of d.seen) {
      if (d.mode) next.add(sid);
      else next.delete(sid);
    }
    onChange?.(next);
  };

  const endDrag = () => {
    drag.current = null;
  };

  const lift = ch * 0.16;
  return (
    <div
      ref={ref}
      className={`hand ${disabled ? 'is-disabled' : ''}`}
      style={{ height: positions.height + lift }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      {cards.map((c, i) => {
        const p = positions.pos.get(c.id);
        if (!p) return null;
        const sel = selected.has(c.id);
        const style: CSSProperties = {
          translate: `${p.x}px ${p.y + lift - (sel ? lift : 0)}px`,
          zIndex: p.z,
          animationDelay: `${Math.min(i * 18, 600)}ms`,
        };
        return (
          <PlayingCard
            key={`${dealKey ?? ''}-${c.id}`}
            data-cid={c.id}
            card={c}
            className="hand__card"
            selected={sel}
            wild={isWild?.(c)}
            highlight={highlight?.has(c.id)}
            style={style}
          />
        );
      })}
    </div>
  );
}

/** 出牌区的一排牌（轻微重叠，居中） */
export function CardRow({
  cards,
  w = 'var(--cw-sm)',
  overlap = 0.42,
  isWild,
  highlight,
  from,
  className = '',
}: {
  cards: Card[];
  w?: string;
  overlap?: number;
  isWild?: (c: Card) => boolean;
  highlight?: Set<number>;
  /** 入场动画方向 */
  from?: 'left' | 'right' | 'top' | 'bottom';
  className?: string;
}) {
  return (
    <div
      className={`cardrow ${from ? `from-${from}` : ''} ${className}`}
      style={{ '--w': w, '--ov': overlap } as CSSProperties}
    >
      {cards.map((c, i) => (
        <PlayingCard
          key={c.id}
          card={c}
          w={w}
          wild={isWild?.(c)}
          highlight={highlight?.has(c.id)}
          style={{ animationDelay: `${i * 25}ms` }}
        />
      ))}
    </div>
  );
}
