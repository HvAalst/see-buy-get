import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { addEnglish, t } from './i18n';
import { enNowWith } from './i18n/catalogs/en.now-with';
import { ArrivedConfirm } from './ArrivedConfirm';
import { arrivedWho } from './nowWith';

addEnglish(enNowWith);

/*
 * 2026-11-15 — "IT ARRIVED", CONFIRMED: the sender is shown who has the load and confirms they spoke to the receiver
 * themselves before it counts — a driver on the phone is not the receiver.
 */
const noop = () => undefined;

describe('saying a load arrived', () => {
  it('asks first, shows who has it, and stays shut until they tick that they spoke to the receiver', () => {
    const html = renderToString(<ArrivedConfirm who="On the road with Kilima, by van — Driver J. · KDH 123E" onConfirm={noop} onCancel={noop} />);
    expect(html).toContain(t('nowWith.arrived.ask').slice(0, 30));
    expect(html).toContain('On the road with Kilima, by van — Driver J. · KDH 123E');
    expect(html).toContain(t('nowWith.arrived.tick'));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Yes, it arrived/s);
  });

  it('the console’s look keeps the same check', () => {
    const html = renderToString(<ArrivedConfirm look="console" onConfirm={noop} onCancel={noop} />);
    expect(html).toMatch(/class="cbtn cbtn--primary" disabled/);
    expect(html).not.toContain(t('nowWith.arrived.who', { who: '' }).trim());
  });

  it('who has it: the company and vehicle, and the driver and plate where named', () => {
    const since = '2026-11-15T10:00:00.000Z';
    expect(arrivedWho({ nowWith: { kind: 'carrier', name: 'Kilima', vehicle: 'van', since }, carrier: { driverName: 'Driver J.', plate: 'KDH 123E' } }, t)).toBe('On the road with Kilima, by van — Driver J. · KDH 123E');
    expect(arrivedWho({ nowWith: { kind: 'carrier', name: 'Kilima', since } }, t)).toBe('On the road with Kilima');
    expect(arrivedWho({}, t)).toBeUndefined();
  });
});
