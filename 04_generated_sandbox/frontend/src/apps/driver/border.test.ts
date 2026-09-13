import { describe, expect, it } from 'vitest';
import { borderLines } from './border';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;

describe('CA6 — a load that crosses a border, as the driver is told it', () => {
  it('names the crossing, what to carry, and the limit', () => {
    const lines = borderLines({ from: 'KE', to: 'TZ', recorded: true, crossings: [{ name: 'Namanga', hours: '06:00–22:00' }], permits: [], regionalInsurance: ['COMESA Yellow Card'], maxWeightKg: 30000 }, t as never);
    expect(lines[0]).toContain('driver.offers.border');
    expect(lines[0]).toContain('Kenya');
    expect(lines.some((l) => l.includes('Namanga 06:00–22:00'))).toBe(true);
    expect(lines.some((l) => l.includes('COMESA Yellow Card'))).toBe(true);
    expect(lines.some((l) => l.startsWith('driver.offers.borderMax'))).toBe(true);
  });

  it('says plainly when nobody has recorded the crossing, rather than saying nothing', () => {
    const lines = borderLines({ from: 'KE', to: 'TZ', recorded: false, crossings: [], permits: [], regionalInsurance: [] }, t as never);
    expect(lines.map((l) => l.split(' ')[0])).toEqual(['driver.offers.border', 'driver.offers.borderUnknown']);
    expect(borderLines(undefined, t as never)).toEqual([]);
  });
});
