import { describe, expect, it } from 'vitest';
import { checkStep, checkTone, contractPeriod, digitsReady, isLastOwner, linksTag, noteKept, loadGaps, loadStage, mayAct, mayManage, newBusinessGaps, nextDay, openOnArrival, orderableContracts, phoneReady, planDo, planSays, deliverySays, sectionsFor, spanWords, windowMiss } from './logic';
import { t } from '../../shared/i18n';
import type { CarriageContract } from './api';
import type { Membership } from './api';

const member = (over: Partial<Membership>): Membership => ({
  memberId: 'm', entityId: 'e', name: 'Acme', country: 'ET', role: 'owner', state: 'joined', invitedBy: 'A', checked: 'unverified', ...over,
});

describe('the Business app', () => {
  describe('which sections a business is shown', () => {
    it('shows imports to anybody whose goods or clients cross a border, and a yard only to a yard', () => {
      expect(sectionsFor(['shipper'])).toEqual(['home', 'loads', 'runs', 'parcels', 'contracts', 'exports', 'people', 'details']);
      expect(sectionsFor(['importer'])).toEqual(['home', 'imports', 'people', 'details']);
      expect(sectionsFor(['clearing_agent'])).toContain('imports');
      expect(sectionsFor(['expeditor'])).toEqual(['home', 'loads', 'runs', 'parcels', 'contracts', 'clients', 'exports', 'imports', 'people', 'details']);
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
      expect(planSays({ leftOut: { day, why: 'closed' } }, t)!.row).toBe('the place it is collected from is closed on 2026-10-07 by the loading hours you keep for it');
      // Whatever else an older answer still carries, a load on no vehicle is not also said to be planned.
      expect(planSays({ leftOut: { day, why: 'room' }, plannedAbout: { day, arrive: '10:40' }, outsideWindow: { day, arrive: '12:40', lateMin: 40 } }, t)!.state).toBe('left');
    });
  });

  describe('a load that should have arrived, and one that has', () => {
    const day = '2026-10-07';
    const planned = { plannedAbout: { day, arrive: '10:40', window: '08:00–12:00' }, deliverOn: day };
    it('says a passed hour above a plan in time, and a day that has gone above everything', () => {
      expect(planSays({ ...planned, runningLate: 'hour' }, t)).toEqual({
        state: 'late',
        row: 'it was planned for about 10:40 and has not been delivered',
        full: 'Running late: your carrier’s plan had it at the door about 10:40 on 2026-10-07, and it has not been delivered.',
      });
      expect(planSays({ ...planned, runningLate: 'day' }, t)).toEqual({ state: 'late', row: 'it was ordered for 2026-10-07 and has not been delivered', full: 'Late: it was ordered for 2026-10-07 and has not been delivered.' });
      // On no vehicle, its hour is nobody's: it says it is on no vehicle. Its day going is said all the same.
      expect(planSays({ deliverOn: day, leftOut: { day, why: 'room' }, runningLate: 'hour' }, t)!.state).toBe('left');
      expect(planSays({ deliverOn: day, leftOut: { day, why: 'room' }, runningLate: 'day' }, t)!.state).toBe('late');
      // An hour that has passed outranks a plan that was already outside its window.
      expect(planSays({ ...planned, outsideWindow: { day, arrive: '12:40', lateMin: 40 }, runningLate: 'hour' }, t)!.state).toBe('late');
      // Its day has begun and it is in no plan: said as on no vehicle — below a plan's own reason, where there is one.
      const byClock = planSays({ deliverOn: day, runningLate: 'unplanned' }, t)!;
      expect(byClock).toEqual({ state: 'left', noPlan: true, row: 'it is for today and is on no vehicle yet', full: 'On no vehicle: it was ordered for 2026-10-07, the day’s work has begun, and your carrier has not put it on a vehicle.' });
      const byPlan = planSays({ deliverOn: day, leftOut: { day, why: 'heavy' }, runningLate: 'unplanned' }, t)!;
      expect([byPlan.row, byPlan.noPlan]).toEqual(['it is heavier than your carrier’s largest vehicle carries', undefined]);
      // What to do about it never says a plan said so when none did (found in a real run: the load's own page did).
      expect(planDo(byPlan, 'Kilima Logistics', t)).toBe('This is what your carrier’s plan for the day says, and the day can still be planned again. Speak to Kilima Logistics now.');
      expect(planDo(byClock, 'Kilima Logistics', t)).toBe('No plan says this: it is in none your carrier has accepted for today, or it missed the trip it was planned on. It can still be planned, or put on a driver by hand. Speak to Kilima Logistics now.');
      expect(planDo(planSays({ ...planned, runningLate: 'hour' }, t)!, 'Kilima Logistics', t)).toBe('Speak to Kilima Logistics now.');
      expect(planDo(planSays(planned, t)!, 'Kilima Logistics', t)).toBe('This is what your carrier’s plan for the day says. Its time is an estimate, and the day can still be planned again.');
      expect(planDo(planSays({ ...planned, outsideWindow: { day, arrive: '12:40', lateMin: 40 } }, t)!, 'Kilima Logistics', t)).toMatch(/If this cannot work, speak to Kilima Logistics now\.$/);
      // No hour on record: there is nothing to say has passed.
      expect(planSays({ deliverOn: day, runningLate: 'hour' }, t)).toBeNull();
    });

    it('says when a load was handed over, and where that fell against what was asked — in colour only where it missed', () => {
      const at = { timeZone: 'Africa/Nairobi', day, at: '10:52' };
      expect(deliverySays({}, t)).toBeNull();
      expect(deliverySays({ deliverOn: day, deliveryTiming: at }, t)).toEqual({ tone: 'quiet', row: 'handed over at 10:52', full: 'Handed over at 10:52.' });
      expect(deliverySays({ deliverOn: day, deliveryTiming: { ...at, window: '08:00–12:00' } }, t)).toEqual({ tone: 'quiet', row: 'handed over at 10:52, inside your window', full: 'Handed over at 10:52, inside the window you asked for (08:00–12:00).' });
      expect(deliverySays({ deliverOn: day, deliveryTiming: { ...at, at: '13:10', window: '08:00–12:00', lateMin: 70 } }, t)).toEqual({
        tone: 'warn',
        tag: 'After your window',
        row: 'handed over at 13:10, 1 hour 10 minutes after your window',
        full: 'Handed over at 13:10, 1 hour 10 minutes after the window you asked for (08:00–12:00).',
      });
      expect(deliverySays({ deliverOn: day, deliveryTiming: { ...at, at: '07:10', window: '08:00–12:00', earlyMin: 50 } }, t)).toMatchObject({ tone: 'warn', tag: 'Before your window', row: 'handed over at 07:10, 50 minutes before your window' });
      // Another day than it was ordered for: the day is what is said, not the hour against a window.
      expect(deliverySays({ deliverOn: day, deliveryTiming: { ...at, day: '2026-10-08', otherDay: 'late', window: '08:00–12:00' } }, t)).toEqual({
        tone: 'warn',
        tag: 'After its day',
        row: 'handed over on 2026-10-08; it was ordered for 2026-10-07',
        full: 'Handed over at 10:52 on 2026-10-08. It was ordered for 2026-10-07.',
      });
      expect(deliverySays({ deliverOn: day, deliveryTiming: { ...at, day: '2026-10-06', otherDay: 'early' } }, t)).toEqual({ tone: 'quiet', row: 'handed over early, on 2026-10-06', full: 'Handed over at 10:52 on 2026-10-06, before the day it was ordered for (2026-10-07).' });
    });
  });

  describe('a load’s kept note', () => {
    it('is shown once the server says a copy is kept — whatever stage this screen reads the load as', () => {
      for (const stage of ['posted', 'offers', 'ordered', 'taken', 'moving', 'delivered', 'cancelled'] as const) expect(noteKept({ noteId: 'freight~fr_1' }, stage)).toBe('kept');
    });
    it('says “not yet” only while a carrier has the load and has not taken the goods over; before that, and after it ended, nothing', () => {
      expect(noteKept({}, 'taken')).toBe('not_yet');
      for (const stage of ['posted', 'offers', 'ordered', 'cancelled'] as const) expect(noteKept({}, stage)).toBe('none');
      // Moving or delivered with no copy kept is not this screen's to explain away: it promises nothing.
      for (const stage of ['moving', 'delivered'] as const) expect(noteKept({}, stage)).toBe('none');
      expect(noteKept({ noteId: '' }, 'delivered')).toBe('none');
    });
    it('counts the links that work beside the heading, in words that need no plural — and is quiet when none does', () => {
      expect(linksTag(0, t)).toEqual({ tone: 'quiet', label: t('business.note.liveNone') });
      expect(linksTag(0, t).label).not.toContain('0');
      expect(linksTag(1, t)).toEqual({ tone: 'info', label: '1 working' });
      expect(linksTag(3, t)).toEqual({ tone: 'info', label: '3 working' });
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

describe('a load that crosses a border, as its consignment note needs it (the CMR check, 2026-10-28)', () => {
  const load = { description: 'Paint, 40 drums', fromSiteId: 's1', toSiteId: 's2', weightKg: '900' };
  it('asks who receives the goods and how many packages, across a border only', () => {
    expect(loadGaps(load)).toEqual([]);
    expect(loadGaps({ ...load, crossing: true })).toEqual(['consigneeName', 'consigneeAddress', 'packages']);
    expect(loadGaps({ ...load, crossing: true, consigneeName: 'Kampala Build Co', consigneeAddress: 'Plot 4', packages: '40' })).toEqual([]);
    // Loose goods are in bulk: no count. A receiving point is its own consignee.
    expect(loadGaps({ ...load, crossing: true, packaging: 'loose', consigneeName: 'K', consigneeAddress: 'P' })).toEqual([]);
    expect(loadGaps({ ...load, crossing: true, receivingPoint: '7KQ3-PX9M', packages: '2' })).toEqual([]);
  });
  it('asks dangerous goods for their UN number, name and class, wherever they go', () => {
    expect(loadGaps({ ...load, natureCode: 'HAZ-CHEM' })).toEqual(['unNumber', 'properShippingName', 'hazardClass']);
    expect(loadGaps({ ...load, natureCode: 'HAZ-FLAM', unNumber: '12', properShippingName: 'Paint', hazardClass: '3' })).toEqual(['unNumber']);
    expect(loadGaps({ ...load, natureCode: 'HAZ-FLAM', unNumber: 'UN1263', properShippingName: 'Paint', hazardClass: '3' })).toEqual([]);
    // A declared value is in a money (CMR Art. 6(2)(d)).
    expect(loadGaps({ ...load, declaredValue: '12500' })).toEqual(['valueCurrency']);
    expect(loadGaps({ ...load, declaredValue: '12500', valueCurrency: 'USD' })).toEqual([]);
    // Cement dust is not dangerous goods by its description: no UN number asked.
    expect(loadGaps({ ...load, natureCode: 'HAZ-DUST' })).toEqual([]);
    for (const k of ['consigneeName', 'consigneeAddress', 'packages', 'unNumber', 'properShippingName', 'hazardClass'] as const) expect(t(`business.loads.need.${k}`)).not.toBe(`business.loads.need.${k}`);
  });
});
