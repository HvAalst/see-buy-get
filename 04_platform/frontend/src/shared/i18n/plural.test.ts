import { describe, expect, it } from 'vitest';
import { interpolate, setLocale, t } from './index';
import { en as shared } from './catalogs/en';
import { enTowerAll } from './catalogs/en.tower';

/** Every English word there is: the catalog every app carries, and the console's own. */
const en = { ...shared, ...enTowerAll };

/**
 * A COUNTED WORD IN THE FORM ITS LANGUAGE GIVES THAT NUMBER.
 *
 * The translation layer put a value into a string and stopped there, so a counted string had to read at one and at
 * five alike — and came out as "3 parcel(s)". The layer now chooses a form by the language's own rule.
 */
describe('a counted word', () => {
  const parcels = '{count, plural, one {# parcel} other {# parcels}} on the bus';

  it('takes the form English gives one and many', () => {
    expect(interpolate(parcels, { count: 1 })).toBe('1 parcel on the bus');
    expect(interpolate(parcels, { count: 3 })).toBe('3 parcels on the bus');
    expect(interpolate(parcels, { count: 0 })).toBe('0 parcels on the bus');
  });

  it('answers an exact number before the rule, and keeps the other placeholders around and inside it', () => {
    const s = 'Room for {free, plural, =0 {no more bags} one {# more bag} other {# more bags}} — {capacity} at once, {who}.';
    expect(interpolate(s, { free: 0, capacity: 4, who: 'Ada' })).toBe('Room for no more bags — 4 at once, Ada.');
    expect(interpolate(s, { free: 1, capacity: 4, who: 'Ada' })).toBe('Room for 1 more bag — 4 at once, Ada.');
    expect(interpolate('{n, plural, one {# load, worth {amount}} other {# loads, worth {amount}}}', { n: 2, amount: 'KES 5.00' })).toBe('2 loads, worth KES 5.00');
  });

  it('asks the language the words are in: Arabic has a form for two, and for a few', () => {
    const ar = '{n, plural, zero {لا طرود} one {طرد واحد} two {طردان} few {# طرود} many {# طردًا} other {# طرد}}';
    expect(interpolate(ar, { n: 0 }, 'ar')).toBe('لا طرود');
    expect(interpolate(ar, { n: 2 }, 'ar')).toBe('طردان');
    expect(interpolate(ar, { n: 5 }, 'ar')).toBe('5 طرود');
    expect(interpolate(ar, { n: 11 }, 'ar')).toBe('11 طردًا');
  });

  it('chooses by the rule of the language the WORDS are in: English words shown in French keep English plurals', () => {
    // French counts nought as one ("0 colis"); an English string not yet translated must still say "0 parcels".
    setLocale('fr');
    expect(t('agent.toast.onBusTitle', { count: 0 })).toBe('0 parcels on the bus');
    expect(t('agent.toast.onBusTitle', { count: 1 })).toBe('1 parcel on the bus');
    setLocale('en');
  });

  it('falls back to `other` for a form a translator did not write, and leaves a plural with no number as it was', () => {
    expect(interpolate('{n, plural, other {# items}}', { n: 1 })).toBe('1 items');
    expect(interpolate(parcels, {})).toBe(parcels);
    expect(interpolate('Hi, {name} {x y}', { name: 'Ada' })).toBe('Hi, Ada {x y}');
  });

  it('is never needed as "(s)" again: no English string says a counted word that way', () => {
    // A guard that read nothing passes for ever: it must have read the whole catalog.
    const all = Object.entries(en as Record<string, string>);
    expect(all.length).toBeGreaterThan(1000);
    expect(all.filter(([, text]) => /\w\(s\)/.test(text)).map(([key]) => key)).toEqual([]);
  });

  it('reads right at exactly one: a number before a counted noun is a plural, outside the “many” half of a pair', () => {
    // "1 bags on the road" was on the console's front screen. A string named …Many is only ever shown for many.
    const COUNTED = /\{\w+\} (days|hours|minutes|loads|orders|parcels|shops|vehicles|drivers|papers|slots|bags|jobs|fleets|kilograms|kilometres|ratings|lanes|hubs|stores|shipments|consignments|buyers|deliveries)\b/;
    const all = Object.entries(en as Record<string, string>);
    expect(all.filter(([key, text]) => !/Many$|many$|N$/.test(key) && COUNTED.test(text)).map(([key]) => key)).toEqual([]);
    expect(t('driver.board.countAll', { n: 1 })).toBe('1 load');
    expect(t('driver.board.countAll', { n: 4 })).toBe('4 loads');
    expect(t('fleet.orders.planNew', { n: 1 })).toBe('1 order has come in since — plan again.');
    expect(t('fleet.orders.planNew', { n: 2 })).toBe('2 orders have come in since — plan again.');
    expect(t('driver.road.agreeCount', { count: 1 })).toBe('1 driver agrees');
    // The verb after the noun goes with it.
    expect(t('home.town.lede', { n: 1, town: 'Nairobi', open: 1 })).toMatch(/^1 shop takes parcels in Nairobi today/);
    expect(t('home.town.lede', { n: 3, town: 'Nairobi', open: 2 })).toMatch(/^3 shops take parcels in Nairobi today/);
    expect(t('tower.network.bagsOnRoad', { n: 1 })).toBe('1 bag on the road');
  });
});
