import { describe, expect, it } from 'vitest';
import { checkStep, checkTone, contractPeriod, digitsReady, isLastOwner, loadGaps, loadStage, mayAct, mayManage, newBusinessGaps, nextDay, openOnArrival, orderableContracts, phoneReady, planSays, sectionsFor, spanWords, windowMiss } from './logic';
import { t } from '../../shared/i18n';
import type { CarriageContract } from './api';
import type { Membership } from './api';

const member = (over: Partial<Membership>): Membership => ({
  memberId: 'm', entityId: 'e', name: 'Acme', country: 'ET', role: 'owner', state: 'joined', invitedBy: 'A', checked: 'unverified', ...over,
});

describe('the Business app', () => {
  describe('which sections a business is shown', () => {
    it('shows imports to anybody whose goods or clients cross a border, and a yard only to a yard', () => {
      expect(sectionsFor(['shipper'])).toEqual(['home', 'loads', 'runs', 'contracts', 'people', 'details']);
      expect(sectionsFor(['importer'])).toEqual(['home', 'imports', 'people', 'details']);
      expect(sectionsFor(['clearing_agent'])).toContain('imports');
      expect(sectionsFor(['expeditor'])).toEqual(['home', 'loads', 'runs', 'contracts', 'clients', 'imports', 'people', 'details']);
      expect(sectionsFor(['depot'])).toEqual(['home', 'yard', 'people', 'details']);
      expect(sectionsFor(['importer', 'depot'])).toEqual(['home', 'imports', 'yard', 'people', 'details']);
    });
  });

  describe('where the check stands', () => {
    const check = (state: Parameters<typeof checkStep>[0]['state'], missing: string[] = []) => ({ state, missing });
    it('asks for the papers before anything else, even after a refusal', () => {
      expect(checkStep(check('unverified', ['representative_id']))).toBe('papers');
      expect(checkStep(check('refused', ['certificate_of_incorporation']))).toBe('papers');
    });
    it('then the asking, then the wait, and says a refusal plainly', () => {
      expect(checkStep(check('unverified'))).toBe('ask');
      expect(checkStep(check('asked'))).toBe('waiting');
      expect(checkStep(check('checking'))).toBe('waiting');
      expect(checkStep(check('refused'))).toBe('refused');
      expect(checkStep(check('verified'))).toBe('done');
    });
    it('wears a tone that matches', () => {
      expect([checkTone('verified'), checkTone('refused'), checkTone('checking'), checkTone('unverified')]).toEqual(['ok', 'warn', 'info', 'quiet']);
    });
  });

  describe('which business opens on its own', () => {
    it('opens the only one', () => {
      expect(openOnArrival([member({ entityId: 'a' })], null)).toBe('a');
    });
    it('opens the last one used, while they are still in it', () => {
      const two = [member({ entityId: 'a' }), member({ entityId: 'b' })];
      expect(openOnArrival(two, 'b')).toBe('b');
      expect(openOnArrival(two, 'gone')).toBeNull();
      expect(openOnArrival(two, null)).toBeNull();
    });
    it('never opens anything over an unanswered invitation', () => {
      expect(openOnArrival([member({ entityId: 'a' }), member({ entityId: 'b', state: 'invited' })], 'a')).toBeNull();
    });
    it('shows the list to somebody who is in nothing yet', () => {
      expect(openOnArrival([], null)).toBeNull();
    });
  });

  describe('the last owner', () => {
    it('is the only joined owner — an invited owner does not count', () => {
      const rows = [
        { memberId: 'a', role: 'owner' as const, state: 'joined' as const },
        { memberId: 'b', role: 'owner' as const, state: 'invited' as const },
        { memberId: 'c', role: 'booker' as const, state: 'joined' as const },
      ];
      expect(isLastOwner(rows, 'a')).toBe(true);
      expect(isLastOwner(rows, 'c')).toBe(false);
      expect(isLastOwner([...rows, { memberId: 'd', role: 'owner', state: 'joined' }], 'a')).toBe(false);
    });
  });

  describe('who may do what', () => {
    it('lets only an owner manage, and everybody but a viewer act', () => {
      expect([mayManage('owner'), mayManage('booker'), mayManage(undefined)]).toEqual([true, false, false]);
      expect([mayAct('finance'), mayAct('booker'), mayAct('viewer'), mayAct(undefined)]).toEqual([true, true, false, false]);
    });
  });

  describe('a load', () => {
    it('names every gap in the form', () => {
      expect(loadGaps({ description: ' ', fromSiteId: '', toSiteId: '', weightKg: '0' })).toEqual(['description', 'fromSiteId', 'toSiteId', 'weightKg']);
      expect(loadGaps({ description: 'Coffee', fromSiteId: 's1', toSiteId: 's2', weightKg: '18000' })).toEqual([]);
    });
    it('says where it has got in one word', () => {
      expect(loadStage({ status: 'available', openProposals: 0 })).toBe('posted');
      expect(loadStage({ status: 'available', openProposals: 2 })).toBe('offers');
      expect(loadStage({ status: 'claimed', openProposals: 0, carrier: { driverName: 'Amos' } })).toBe('taken');
      expect(loadStage({ status: 'in_transit', openProposals: 0, pickedUpAt: 'x' })).toBe('moving');
      expect(loadStage({ status: 'delivered', openProposals: 0, deliveredAt: 'x' })).toBe('delivered');
      expect(loadStage({ status: 'cancelled', openProposals: 1, cancelledAt: 'x' })).toBe('cancelled');
      // P1 — with the contract carrier, waiting for one of its trucks.
      expect(loadStage({ status: 'ordered', openProposals: 0 })).toBe('ordered');
      expect(loadStage({ status: 'claimed', openProposals: 0, carrier: { driverName: 'Amos' } })).toBe('taken');
    });
  });

  describe('P1 — ordering under a contract', () => {
    const contract = (over: Partial<CarriageContract> = {}): CarriageContract => ({ contractId: 'c1', fleetDid: 'did:f', fleetName: 'Kilima', shipper: { name: 'Jenga' }, status: 'active', createdAt: 'x', createdBy: 'A', ...over });
    it('offers only the contracts standing on the day it must arrive', () => {
      const items = [contract(), contract({ contractId: 'c2', status: 'ended' }), contract({ contractId: 'c3', startsOn: '2026-11-01' }), contract({ contractId: 'c4', endsOn: '2026-10-01' })];
      expect(orderableContracts(items, '2026-10-06').map((c) => c.contractId)).toEqual(['c1']);
      expect(orderableContracts(items, '2026-11-02').map((c) => c.contractId)).toEqual(['c1', 'c3']);
    });
    it('defaults the delivery day to tomorrow, across a month end', () => {
      expect(nextDay(new Date(2026, 9, 31, 15))).toBe('2026-11-01');
    });
    it('says a contract’s period in words', () => {
      expect(contractPeriod({ startsOn: '2026-10-01', endsOn: '2026-12-31' }, t)).toBe('2026-10-01 to 2026-12-31');
      expect(contractPeriod({}, t)).toBe('No end date');
    });
  });

  describe('a plan that misses the window a load was to arrive in', () => {
    const day = '2026-10-07';
    it('says a span the way the notice of it does', () => {
      expect([spanWords(1), spanWords(40), spanWords(60), spanWords(65), spanWords(120), spanWords(185)]).toEqual(['1 minute', '40 minutes', '1 hour', '1 hour 05 minutes', '2 hours', '3 hours 05 minutes']);
      // Never "0 minutes": a plan that is outside its window is outside it by something.
      expect(spanWords(0.2)).toBe('1 minute');
    });
    it('says late and early apart, about when, and against the window as the plan read it', () => {
      expect(windowMiss({ day, arrive: '12:40', window: '08:00 to 12:00', lateMin: 40 }, t)).toEqual({
        row: 'planned about 12:40, 40 minutes after your window',
        full: 'At the door about 12:40 on 2026-10-07 — 40 minutes after the window you asked for (08:00 to 12:00).',
      });
      expect(windowMiss({ day, arrive: '06:50', window: 'from 08:00', earlyMin: 70 }, t)).toEqual({
        row: 'planned about 06:50, 1 hour 10 minutes before your window',
        full: 'At the door about 06:50 on 2026-10-07 — 1 hour 10 minutes before the window you asked for (from 08:00): the day does not leave the vehicle room to wait.',
      });
    });
    it('says nothing of a plan inside the window, or of no plan — and does without the window’s words where an older plan kept none', () => {
      expect(windowMiss(undefined, t)).toBeNull();
      expect(windowMiss({ day, arrive: '10:00' }, t)).toBeNull();
      expect(windowMiss({ day, arrive: '12:40', lateMin: 40 }, t)!.full).toBe('At the door about 12:40 on 2026-10-07 — 40 minutes after the window you asked for.');
    });
  });

  describe('what a carrier’s plan says of a load', () => {
    const day = '2026-10-07';
    it('says nothing while no accepted plan has anything to say of it', () => {
      expect(planSays({}, t)).toBeNull();
    });
    it('says quietly about when a planned load is at the door — inside its window where it asked for one', () => {
      expect(planSays({ plannedAbout: { day, arrive: '10:40', window: '08:00 to 12:00' } }, t)).toEqual({
        state: 'planned',
        row: 'planned for about 10:40, inside your window',
        full: 'At the door about 10:40 on 2026-10-07, inside the window you asked for (08:00 to 12:00).',
      });
      // No window asked for: no window is claimed to have been kept.
      expect(planSays({ plannedAbout: { day, arrive: '10:40' } }, t)).toEqual({ state: 'planned', row: 'planned for about 10:40', full: 'At the door about 10:40 on 2026-10-07.' });
    });
    it('says a plan outside the window as that, not as planned in time', () => {
      const says = planSays({ plannedAbout: { day, arrive: '12:40', window: '08:00 to 12:00' }, outsideWindow: { day, arrive: '12:40', window: '08:00 to 12:00', lateMin: 40 } }, t)!;
      expect(says.state).toBe('outside');
      expect(says.row).toBe('planned about 12:40, 40 minutes after your window');
      expect(says.row).not.toContain('inside');
    });
    it('says an order on no vehicle first and above everything, with why as a shipper is told it', () => {
      expect(planSays({ leftOut: { day, why: 'room' } }, t)).toEqual({
        state: 'left',
        row: 'your carrier’s plan for 2026-10-07 has no room for it',
        full: 'On no vehicle: your carrier’s plan for 2026-10-07 has no room for it.',
      });
      expect(planSays({ leftOut: { day, why: 'fit' } }, t)!.row).toBe('no vehicle in your carrier’s plan for 2026-10-07 can carry it as ordered');
      expect(planSays({ leftOut: { day, why: 'heavy' } }, t)!.row).toBe('it is heavier than your carrier’s largest vehicle carries');
      expect(planSays({ leftOut: { day, why: 'place' } }, t)!.row).toBe('the place it goes to has no point on the map, so it could not be planned');
      // Whatever else an older answer still carries, a load on no vehicle is not also said to be planned.
      expect(planSays({ leftOut: { day, why: 'room' }, plannedAbout: { day, arrive: '10:40' }, outsideWindow: { day, arrive: '12:40', lateMin: 40 } }, t)!.state).toBe('left');
    });
  });

  describe('the forms', () => {
    it('names every gap in a new business', () => {
      expect(newBusinessGaps({ name: ' ', country: 'Ethiopia', registrationNo: '', activities: [], yourName: '' })).toEqual(['name', 'country', 'registrationNo', 'activities', 'yourName']);
      expect(newBusinessGaps({ name: 'Acme', country: 'et', registrationNo: 'R1', activities: ['shipper'], yourName: 'Abebe' })).toEqual([]);
    });
    it('reads a phone and a code the way the server does', () => {
      expect(phoneReady('+251 911 000 001')).toBe(true);
      expect(phoneReady('0911')).toBe(false);
      expect(digitsReady('4826', 4)).toBe(true);
      expect(digitsReady('482', 4)).toBe(false);
      expect(digitsReady('48a6', 4)).toBe(false);
    });
  });
});
