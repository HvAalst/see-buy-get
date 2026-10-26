import { HubContactService, openNowOf, outsideOf } from './hub-contact.service';
import type { MdpService } from './mdp.service';

/**
 * A HUB'S OPENING HOURS AND HOW TO REACH IT (the user, 2026-10-26). Open now is read on the hub's own clock — Nairobi
 * keeps East Africa Time — and a week runs Sunday to Saturday. What goes on its public page is its hours always, and its
 * number and gate only where it ticked that they go there.
 */
describe('a hub’s opening hours and how to reach it', () => {
  const day = { open: '07:00', close: '18:00' };
  // Mon–Fri 07:00–18:00, Sat 08:00–12:00, Sun closed.
  const week = { sun: null, mon: day, tue: day, wed: day, thu: day, fri: day, sat: { open: '08:00', close: '12:00' } };
  const at = (iso: string) => Date.parse(iso);

  it('says open, and until when, on the hub’s own clock — not the server’s', () => {
    // Mon 26 Oct 2026, 05:30 UTC is 08:30 in Nairobi: open.
    expect(openNowOf(week, 'Africa/Nairobi', at('2026-10-26T05:30:00Z'))).toEqual({ open: true, until: '18:00' });
    // 15:30 UTC is 18:30 there: closed, and opens tomorrow (Tuesday) at 07:00.
    expect(openNowOf(week, 'Africa/Nairobi', at('2026-10-26T15:30:00Z'))).toEqual({ open: false, opensDay: 'tue', opensAt: '07:00', opensToday: false });
    // 03:00 UTC is 06:00 there: not yet, and opens later today.
    expect(openNowOf(week, 'Africa/Nairobi', at('2026-10-26T03:00:00Z'))).toEqual({ open: false, opensDay: 'mon', opensAt: '07:00', opensToday: true });
    // Sat 31 Oct, 10:00 UTC is 13:00 there: closed since noon, and Sunday is closed, so Monday 07:00.
    expect(openNowOf(week, 'Africa/Nairobi', at('2026-10-31T10:00:00Z'))).toEqual({ open: false, opensDay: 'mon', opensAt: '07:00', opensToday: false });
  });

  it('says nothing it cannot know: no hours kept, or no single clock — and never open on a week with no open day', () => {
    expect(openNowOf(undefined, 'Africa/Nairobi', at('2026-10-26T05:30:00Z'))).toBeUndefined();
    expect(openNowOf(week, undefined, at('2026-10-26T05:30:00Z'))).toBeUndefined();
    expect(openNowOf({ sun: null }, 'Africa/Nairobi', at('2026-10-26T05:30:00Z'))).toEqual({ open: false });
  });

  it('finds hours for taking parcels in bulk that go outside the hours the hub is open — a closed day, before it opens, after it closes', () => {
    expect(outsideOf({ mon: { open: '08:00', close: '17:00' } }, week)).toBeNull();
    expect(outsideOf({ sun: { open: '09:00', close: '12:00' } }, week)).toMatch(/Sunday — the hub is closed then/);
    expect(outsideOf({ mon: { open: '06:00', close: '12:00' } }, week)).toMatch(/Monday 06:00–12:00 — the hub is open 07:00–18:00/);
    expect(outsideOf({ sat: { open: '08:00', close: '13:00' } }, week)).toMatch(/Saturday 08:00–13:00/);
  });

  describe('the hub’s own entry', () => {
    const hub = { mdpId: 'mdp_1', did: 'did:hub:1', name: 'Ghala Hub', zones: ['North'], location: { lat: -1.3, lng: 36.88 }, address: 'Mombasa Road' };
    const service = () => new HubContactService({ require: () => hub, countryOf: () => 'KE' } as unknown as MdpService);

    it('keeps what it wrote, takes away what it emptied, and checks each shape before writing anything', () => {
      const svc = service();
      const NOW = at('2026-10-26T05:30:00Z');
      const v = svc.set('mdp_1', { openingHours: week, phone: '+254 700 000 001', askFor: '  the floor   lead ', gate: 'Gate 2, behind the market' }, 'Owner', NOW);
      expect(v).toMatchObject({ name: 'Ghala Hub', phone: '+254 700 000 001', askFor: 'the floor lead', gate: 'Gate 2, behind the market', openNow: { open: true, until: '18:00' }, zone: 'Africa/Nairobi', address: 'Mombasa Road', saidBy: 'Owner' });
      expect(v.publish).toBeUndefined();
      // A merge: the gate taken away, the rest kept.
      expect(svc.set('mdp_1', { gate: '' }, 'Owner', NOW)).toMatchObject({ phone: '+254 700 000 001', askFor: 'the floor lead' });
      expect(svc.of('mdp_1')?.gate).toBeUndefined();
      // Refused whole, and nothing written.
      expect(() => svc.set('mdp_1', { phone: 'call me maybe', askFor: 'someone else' }, 'Owner', NOW)).toThrow(/A telephone number is digits/);
      expect(svc.of('mdp_1')?.askFor).toBe('the floor lead');
      expect(() => svc.set('mdp_1', { openingHours: { mon: { open: '18:00', close: '07:00' } } }, 'Owner', NOW)).toThrow(/closes before it opens/);
      expect(() => svc.set('mdp_1', { openingHours: { sun: null } }, 'Owner', NOW)).toThrow(/at least one day the hub is open/);
      expect(() => svc.set('mdp_1', { email: 'not-an-address' }, 'Owner', NOW)).toThrow(/an @ and a domain/);
      // Hours sent as null are taken away.
      svc.set('mdp_1', { openingHours: null }, 'Owner', NOW);
      expect(svc.openingHoursOf('mdp_1')).toBeUndefined();
    });

    it('puts its hours on its public page always, and its number and gate only once it ticks that they go there', () => {
      const svc = service();
      const NOW = at('2026-10-26T05:30:00Z');
      expect(svc.onPage('mdp_1', NOW)).toBeUndefined();
      svc.set('mdp_1', { openingHours: week, phone: '+254700000001', gate: 'Gate 2' }, 'Owner', NOW);
      const page = svc.onPage('mdp_1', NOW)!;
      expect(page).toMatchObject({ openingHours: week, openNow: { open: true, until: '18:00' }, zoneName: expect.stringMatching(/East Africa/) });
      expect(page.phone).toBeUndefined();
      expect(page.gate).toBeUndefined();
      svc.set('mdp_1', { publish: true }, 'Owner', NOW);
      expect(svc.onPage('mdp_1', NOW)).toMatchObject({ phone: '+254700000001', gate: 'Gate 2' });
      svc.set('mdp_1', { publish: false }, 'Owner', NOW);
      expect(svc.onPage('mdp_1', NOW)?.phone).toBeUndefined();
      // To those working with the hub it shows either way.
      expect(svc.atStop('mdp_1', NOW)).toMatchObject({ name: 'Ghala Hub', phone: '+254700000001', gate: 'Gate 2', openNow: { open: true } });
    });
  });
});
