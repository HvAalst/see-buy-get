import { describe, expect, it } from 'vitest';
import { capLine } from './custodyCap';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;

describe('the custody cap, as a capped shop or rider reads it (round 38)', () => {
  it('says what they hold, the most they may now, and how it grows; a full one is told to take nothing more', () => {
    expect(capLine({ capped: true, kind: 'shop', holds: 3, cap: 5, completed: 2, liftedAfter: 20 }, t as never)).toEqual({
      full: false,
      title: 'common.cap.shopTitle {"holds":3,"cap":5}',
      detail: 'common.cap.grows {"completed":2,"lifted":20}',
    });
    const full = capLine({ capped: true, kind: 'rider', holds: 2, cap: 2, completed: 0, liftedAfter: 10 }, t as never)!;
    expect(full.full).toBe(true);
    expect(full.title).toBe('common.cap.riderTitle {"holds":2,"cap":2}');
    expect(full.detail).toBe('common.cap.riderFull common.cap.grows {"completed":0,"lifted":10}');
  });

  it('tells a rider whose ID nobody has seen that it does not grow yet, and what makes it grow (round 39)', () => {
    const line = capLine({ capped: true, kind: 'rider', holds: 1, cap: 2, completed: 4, liftedAfter: 10, idUnseen: true }, t as never)!;
    expect(line.title).toBe('common.cap.riderTitle {"holds":1,"cap":2}');
    expect(line.detail).toBe('common.cap.unseen');
    expect(capLine({ capped: true, kind: 'rider', holds: 2, cap: 2, completed: 4, liftedAfter: 10, idUnseen: true }, t as never)!.detail).toBe('common.cap.riderFull common.cap.unseen');
  });

  it('says nothing where nothing caps them, or before it is read', () => {
    expect(capLine({ capped: false }, t as never)).toBeNull();
    expect(capLine(null, t as never)).toBeNull();
    expect(capLine({ capped: true, kind: 'shop' }, t as never)).toBeNull();
  });
});
