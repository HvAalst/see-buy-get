import { describe, expect, it } from 'vitest';
import { couriersToldLine } from './screens/Breakdown';

describe('a courier broken down with bags aboard is told who near them was told', () => {
  const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  it('says one, several, or nobody — and nobody says what that means for the bags', () => {
    expect(couriersToldLine(1, t)).toBe('driver.brk.couriersToldOne');
    expect(couriersToldLine(3, t)).toBe('driver.brk.couriersToldMany:{"n":3}');
    expect(couriersToldLine(0, t)).toBe('driver.brk.couriersNone');
  });
});
