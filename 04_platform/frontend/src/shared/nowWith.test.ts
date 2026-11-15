import { describe, expect, it } from 'vitest';
import { addEnglish, t } from './i18n';
import { enNowWith } from './i18n/catalogs/en.now-with';
import { nowWithLine, nowWithSince } from './nowWith';

addEnglish(enNowWith);

/*
 * 2026-11-15 — "NOW WITH …" (plan R1): a shop or a hub by name; on the road the company and the kind of vehicle; a load
 * taken but not picked up, said so. Words only from what the server sent — never a phone.
 */
const since = '2026-11-15T10:05:00.000Z';

describe('who has it now, in words', () => {
  it('a shop and a hub by name, and without one', () => {
    expect(nowWithLine({ kind: 'shop', name: 'Mama Sarah Shop', since }, t)).toBe('Now with Mama Sarah Shop, a collection shop');
    expect(nowWithLine({ kind: 'hub', name: 'Ghala Kuu', since }, t)).toBe('Now at Ghala Kuu, a sorting hub');
    expect(nowWithLine({ kind: 'hub', since }, t)).toBe('Now at a sorting hub');
  });

  it('on the road: the company and the vehicle; a load taken and not yet picked up', () => {
    expect(nowWithLine({ kind: 'carrier', name: 'Kilima', vehicle: 'motorcycle', since }, t)).toBe('On the road with Kilima, by motorbike');
    expect(nowWithLine({ kind: 'carrier', name: 'Kilima', since }, t)).toBe('On the road with Kilima');
    expect(nowWithLine({ kind: 'carrier', since }, t)).toBe('On the road');
    expect(nowWithLine({ kind: 'carrier', name: 'Kilima', vehicle: 'van', pickedUp: false, since }, t)).toBe('Taken by Kilima, by van: not picked up yet');
    expect(nowWithLine({ kind: 'carrier', name: 'Kilima', vehicle: 'hovercraft', since }, t)).toBe('On the road with Kilima, by vehicle');
  });

  it('still with the sender; since when, on this phone’s clock', () => {
    expect(nowWithLine({ kind: 'sender', since }, t)).toBe('Still with the sender');
    expect(nowWithSince({ kind: 'shop', since }, t, new Date(since))).toMatch(/^since \S/);
    expect(nowWithSince({ kind: 'shop', since: 'not a date' }, t)).toBe('');
  });
});
