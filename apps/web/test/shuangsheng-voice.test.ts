import type { Card } from '@park/engine';
import { describe, expect, it } from 'vitest';
import { followText, leadText } from '../src/games/shuangsheng/voice';

let id = 0;
const c = (suit: Card['suit'], rank: number): Card => ({ id: id++, suit, rank });
const ctx = { level: 2, trump: 'H' as const };

describe('双升语音报牌', () => {
  it('首家：单张、对子、拖拉机、王', () => {
    expect(leadText([c('S', 13)], ctx)).toBe('黑桃K');
    expect(leadText([c('S', 13), c('S', 13)], ctx)).toBe('对K');
    expect(leadText([c('S', 13), c('S', 13), c('S', 12), c('S', 12)], ctx)).toBe('拖拉机');
    expect(leadText([c('J', 17)], ctx)).toBe('大王');
  });
  it('首家甩牌', () => {
    expect(leadText([c('S', 14), c('S', 13)], ctx)).toBe('甩牌');
  });
  it('跟牌：毙、盖毙、垫牌、大你、普通跟不报', () => {
    const lead = { seat: 0, cards: [c('S', 10)] };
    expect(followText([lead, { seat: 1, cards: [c('H', 5)] }], ctx)).toBe('毙了');
    expect(
      followText([lead, { seat: 1, cards: [c('H', 5)] }, { seat: 2, cards: [c('J', 16)] }], ctx),
    ).toBe('盖毙');
    expect(followText([lead, { seat: 1, cards: [c('C', 9)] }], ctx)).toBe('垫牌');
    expect(followText([lead, { seat: 1, cards: [c('S', 14)] }], ctx)).toBe('大你');
    expect(followText([lead, { seat: 1, cards: [c('S', 3)] }], ctx)).toBe('');
  });
});
