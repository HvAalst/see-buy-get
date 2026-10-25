import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { foundPhotos, foundWords } from '../../shared/found';
import { carrierLine, codeOf, dayLabel, dueLine, inboundApi, inboundState, inboundTitle, isStillExpected, sameClockAs, trackingPathOf, type InboundDue } from './inbound';
import { loadGaps, sectionsFor } from './logic';

describe('inbound, reading A, in the Business app', () => {
  it('shows Coming in to a business that receives goods, and to nobody who said it does not', () => {
    expect(sectionsFor(['receiver'])).toContain('inbound');
    expect(sectionsFor(['shipper'])).not.toContain('inbound');
  });

  it('says where a load coming in stands in one word', () => {
    expect(['available', 'scheduled', 'ordered'].map((status) => inboundState({ status }))).toEqual(['booked', 'booked', 'booked']);
    expect(['claimed', 'in_transit', 'delivered', 'cancelled'].map((status) => inboundState({ status }))).toEqual(['carrier', 'on_its_way', 'delivered', 'withdrawn']);
  });

  it('calls it by the receiver’s own order number where the supplier gave one, else by what it is', () => {
    expect(inboundTitle({ reference: 'PO-7781', description: 'Cement, 400 bags' })).toEqual({ kind: 'order', text: 'PO-7781' });
    expect(inboundTitle({ description: 'Cement, 400 bags' })).toEqual({ kind: 'goods', text: 'Cement, 400 bags' });
  });

  it('reads a code however it was written down, and nothing that cannot be one', () => {
    expect(['7kq3-px9m', '7KQ3 PX9M', ' 7KQ3PX9M '].map(codeOf)).toEqual(['7KQ3-PX9M', '7KQ3-PX9M', '7KQ3-PX9M']);
    expect(codeOf('7KQ3')).toBeNull();
    expect(trackingPathOf({ trackingKey: 'T-AB12' })).toBe('/send/?track=T-AB12');
    expect(trackingPathOf({})).toBeNull();
  });

  it('takes a receiving point found by its code as where a load goes, instead of a place of its own', () => {
    const form = { description: 'Cement', fromSiteId: 'site_1', toSiteId: '', weightKg: '200' };
    expect(loadGaps(form)).toEqual(['toSiteId']);
    expect(loadGaps({ ...form, receivingPoint: '7KQ3-PX9M' })).toEqual([]);
  });

  it('D9: keeps a delivered load among what is still expected while something of it is — and not once it is closed', () => {
    expect(isStillExpected({ status: 'delivered', stillExpected: 3 })).toBe(true);
    expect(isStillExpected({ status: 'delivered', stillExpected: 0 })).toBe(false);
    expect(isStillExpected({ status: 'delivered' })).toBe(false);
    expect(isStillExpected({ status: 'in_transit', stillExpected: 3 })).toBe(false);
  });

  it('D9: says what was found one way, a package or packages, with the photographs on the note counted', () => {
    const lines = [
      { kind: 'short' as const, count: 3, photos: 0 },
      { kind: 'over' as const, count: 1, photos: 0 },
      { kind: 'damaged' as const, count: 2, photos: 2 },
      { kind: 'wrong' as const, count: 1, photos: 1 },
    ];
    expect(foundWords(lines, t)).toBe('3 packages short, 1 package more than the note says, 2 packages damaged, 1 package not the goods on the note');
    expect(foundPhotos(lines)).toBe(3);
    expect(foundWords(undefined, t)).toBe('');
    expect(t('business.inbound.stillLine', { n: 1 })).toBe('1 package still expected');
  });

  it('D9: closes what is still expected at its own address, with a note only when one was written', async () => {
    const seen: Array<{ path: string; init: unknown }> = [];
    const sbg = { request: (fn: (c: unknown) => unknown) => Promise.resolve({ data: fn({ POST: (path: string, init: unknown) => seen.push({ path, init }) }) }) };
    const api = inboundApi(sbg as never);
    await api.closeExpected('fr/1', 'came', 'On the Tuesday truck');
    await api.closeExpected('fr_2', 'not_coming');
    expect(seen).toEqual([
      { path: '/v1/sbg/business/me/inbound/fr%2F1/close', init: { body: { how: 'came', note: 'On the Tuesday truck' } } },
      { path: '/v1/sbg/business/me/inbound/fr_2/close', init: { body: { how: 'not_coming' } } },
    ]);
  });

  it('D10: says when on the place’s own clock — late first, then today, then its day, about when where it is said', () => {
    const due = (over: Partial<InboundDue>): InboundDue => ({ zone: 'Africa/Nairobi', zoneName: 'East Africa Time', day: '2026-10-27', today: false, ...over });
    const day = dayLabel('2026-10-27');
    expect(day).toMatch(/Tue/); // the same date wherever it is read: the 27th, a Tuesday
    expect(day).toMatch(/27/);
    const said = (d: InboundDue) => {
      const line = dueLine(d);
      return t(line.key, line.params);
    };
    expect(said(due({ late: 'hour', about: '13:00', today: true }))).toBe('Late: it was expected about 13:00');
    expect(said(due({ late: 'day' }))).toBe(`Late: it was expected ${day}`);
    expect(said(due({ today: true }))).toBe('Expected today');
    expect(said(due({ today: true, about: '13:00' }))).toBe('Expected today, about 13:00');
    expect(said(due({}))).toBe(`Expected ${day}`);
    expect(said(due({ about: '09:30' }))).toBe(`Expected ${day}, about 09:30`);
  });

  it('says who is bringing it once: an owner-driver is the carrier and the driver', () => {
    expect(carrierLine({ name: 'Kamau 54', driverName: 'Kamau 54', plate: 'KDA 954W' })).toBe('Kamau 54 · KDA 954W');
    expect(carrierLine({ name: 'Kilima Logistics', driverName: 'Amos K.' })).toBe('Kilima Logistics · Amos K.');
  });

  it('D10: names the place’s clock only where the reader’s own shows another time', () => {
    const now = Date.parse('2026-10-26T09:00:00Z');
    expect(sameClockAs('Africa/Nairobi', now, 'Africa/Kampala')).toBe(true); // two names, one clock
    expect(sameClockAs('Africa/Nairobi', now, 'Africa/Kigali')).toBe(false); // an hour apart
    expect(sameClockAs('Not/AZone', now, 'Africa/Nairobi')).toBe(true); // nothing it can read is not a reason to say more
  });
});
