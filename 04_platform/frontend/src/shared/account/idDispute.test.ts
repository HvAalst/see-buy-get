import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { appointmentDays, bringLines, dayChoices, dayLabel, hoursOn, idActions, idStatusSays, looksLikeIdReference, readyToAppoint, reminderLine, settingsIdSays, ticketLines, visitingWords, type DisputeState, type DisputeStatus, type DisputeTicket } from './idDispute';

const status = (over: Partial<DisputeStatus> = {}): DisputeStatus => ({ reference: 'ID-ABCD-2345', side: 'claimant', register: 'driver', state: 'opened', openedAt: '2026-10-08T09:00:00.000Z', photos: [], sent: false, ...over });
const ticket = (over: Partial<DisputeTicket> = {}): DisputeTicket => ({ reference: 'ID-WXYZ-6789', date: '2026-10-15', yours: true, bring: ['id_card', 'phone', 'reference', 'second_document'], changesLeft: 2, ...over });
const STATES: DisputeState[] = ['opened', 'answering', 'ready', 'checked', 'decided', 'appointment', 'rechecked', 'final', 'conceded', 'withdrawn', 'lapsed'];
const says = (over: Partial<DisputeStatus>) => idStatusSays(status(over), t as never);
const all = (over: Partial<DisputeStatus>) => {
  const s = says(over);
  return [s.title, ...s.lines].join(' ');
};

describe('a dispute over a national ID, as each of the two is told it', () => {
  it('has words for every state, for both of them — none of them a missing key', () => {
    for (const side of ['claimant', 'holder'] as const) {
      for (const state of STATES) {
        const said = all({ side, state, yours: state === 'decided' || state === 'final' ? false : undefined, photosDueBy: '2026-10-15T09:00:00.000Z', ticket: state === 'appointment' ? ticket() : undefined });
        expect(said).not.toContain('account.id');
        expect(said.length).toBeGreaterThan(20);
      }
    }
  });

  it('tells a reference of this kind from an account move’s, however it was typed', () => {
    expect(looksLikeIdReference('ID-ABCD-2345')).toBe(true);
    expect(looksLikeIdReference(' id abcd 2345 ')).toBe(true);
    expect(looksLikeIdReference('MV-ABCD-2345')).toBe(false);
    expect(looksLikeIdReference('ID-ABCD-234')).toBe(false);
    expect(looksLikeIdReference('ABCD2345')).toBe(false);
  });

  describe('the one who was refused', () => {
    it('is told nothing has gone anywhere until the photographs are sent — and why staff asked for them again', () => {
      const owed = says({ photosDueBy: '2026-10-15T09:00:00.000Z' });
      expect(owed.title).toBe('Send your three photographs');
      expect(owed.lines.join(' ')).toContain('the other person has not been told');
      expect(all({ photosDueBy: '2026-10-15T09:00:00.000Z', retakeWhy: 'The reference is not in the picture.' })).toContain('“The reference is not in the picture.”');
      expect(idActions(status({ photosDueBy: '2026-10-15T09:00:00.000Z' }))).toMatchObject({ photos: true, withdraw: true, appoint: false, ownId: false });
    });

    it('once sent, is told who it waits on — and may still take it back', () => {
      const sent = says({ state: 'answering', sent: true });
      expect(sent.title).toBe('Your photographs are with staff');
      expect(sent.lines[0]).toContain('has a week to answer');
      expect(idActions(status({ state: 'answering', sent: true }))).toMatchObject({ photos: false, withdraw: true });
      expect(idActions(status({ state: 'decided', yours: true })).withdraw).toBe(false);
    });

    it('given the ID, is told to register again with the same phone', () => {
      const won = says({ state: 'decided', yours: true });
      expect(won).toMatchObject({ tone: 'ok', title: 'The national ID is yours' });
      expect(won.lines[0]).toContain('Register again with the same phone number');
      expect(all({ state: 'conceded', yours: true })).toContain('said it was not theirs');
    });

    it('refused it, reads staff’s reason and that an appointment can still be made — until when', () => {
      const lost = status({ state: 'decided', yours: false, reason: 'Your card carries a different number.', contestBy: '2026-10-22T09:00:00.000Z' });
      const said = idStatusSays(lost, t as never);
      expect(said).toMatchObject({ tone: 'warn', title: 'Staff decided the ID is not yours to register with' });
      expect(said.lines[0]).toBe('Staff said: “Your card carries a different number.”');
      expect(said.lines.join(' ')).toContain('you can make an appointment');
      expect(idActions(lost)).toMatchObject({ appoint: true, changeDay: false, photos: false });
      // Past the date the server stops saying so, and so does the screen.
      expect(idActions(status({ state: 'decided', yours: false })).appoint).toBe(false);
    });
  });

  describe('the one who holds the number', () => {
    const holder = (over: Partial<DisputeStatus>) => status({ side: 'holder', reference: 'ID-WXYZ-6789', ...over });

    it('is told what is said of them, by when to answer, and the two things they can do', () => {
      const asked = idStatusSays(holder({ state: 'answering', photosDueBy: '2026-10-15T09:00:00.000Z' }), t as never);
      expect(asked.tone).toBe('warn');
      expect(asked.title).toBe('Somebody says the national ID on your driver registration is theirs');
      expect(asked.lines[0]).toContain('show your own card the same way');
      expect(asked.lines[0]).toContain('put the right one there');
      expect(idStatusSays(holder({ state: 'answering', register: 'shop', photosDueBy: '2026-10-15T09:00:00.000Z' }), t as never).title).toContain('shop registration');
      expect(idActions(holder({ state: 'answering', photosDueBy: '2026-10-15T09:00:00.000Z' }))).toMatchObject({ photos: true, ownId: true, withdraw: false });
    });

    it('whose week is over is told they can still send — until staff decide', () => {
      const late = idStatusSays(holder({ state: 'ready', photosDueBy: '2026-10-15T09:00:00.000Z' }), t as never);
      expect(late.lines[0]).toContain('Your week to answer is over');
      // Having sent, it is simply with staff.
      expect(idStatusSays(holder({ state: 'ready', sent: true }), t as never).title).toBe('With staff');
    });

    it('who lost it is told the registration is held, the one thing that ends that, and that they can still come in', () => {
      const held = holder({ state: 'decided', yours: false, held: true, reason: 'You showed no card.', contestBy: '2026-10-22T09:00:00.000Z' });
      const said = idStatusSays(held, t as never);
      expect(said.title).toBe('The national ID on your driver registration went to the other person');
      expect(said.lines).toHaveLength(3);
      expect(said.lines[1]).toContain('start nothing new until the number of your own ID card is on record');
      expect(idActions(held)).toMatchObject({ ownId: true, appoint: true });
      // Their own card carried another number: nothing is held, and it says so instead.
      const corrected = idStatusSays(holder({ state: 'decided', yours: false }), t as never);
      expect(corrected.lines.join(' ')).toContain('has an ID number of its own on record, so it is not held');
      expect(corrected.lines.join(' ')).not.toContain('is held');
      expect(idActions(holder({ state: 'decided', yours: false })).ownId).toBe(false);
    });

    it('who kept it is told nothing has changed', () => {
      expect(idStatusSays(holder({ state: 'decided', yours: true }), t as never).lines).toEqual(['Nothing about your registration has changed.']);
      expect(idStatusSays(holder({ state: 'withdrawn' }), t as never).title).toBe('The other person withdrew it');
    });
  });

  describe('the ticket', () => {
    it('says when, where, when visitors are received and who to ask for — as the country’s company wrote it', () => {
      const place = { company: 'SeeBuyGet Kenya', address: 'Mombasa Road, gate 4', hours: 'Gate 6am–6pm', visitDays: ['fri', 'mon'], visitFrom: '09:00', visitTo: '16:00', contactName: 'Grace', phone: '+254 20 000 111' };
      const lines = ticketLines(ticket({ place }), t as never);
      expect(lines.when).toContain('2026');
      // The VISITING days and hours, in the week's order — not the gate's hours, which are for a haulier.
      expect(lines.where).toEqual(['SeeBuyGet Kenya', 'Mombasa Road, gate 4', 'Visitors: Monday, Friday · 09:00 to 16:00', 'Ask for Grace', 'Telephone +254 20 000 111']);
      // A week runs Sunday to Saturday (the user, 2026-10-26).
      expect(visitingWords({ company: 'x', visitDays: ['sat', 'sun'] }, t as never)).toBe('Sunday, Saturday');
      expect(visitingWords({ company: 'x' }, t as never)).toBeNull();
      // A Saturday morning only is said apart from the week, not folded into its hours.
      expect(visitingWords({ company: 'x', visitDays: ['mon', 'sat'], visitFrom: '09:00', visitTo: '16:00', visitHoursByDay: { sat: { from: '09:00', to: '12:00' } } }, t as never)).toBe(
        'Monday · 09:00 to 16:00; Saturday · 09:00 to 12:00',
      );
    });

    it('says what the company has not written, beside what it has — and to ask before travelling', () => {
      // Days, no address.
      expect(ticketLines(ticket({ place: { company: 'SeeBuyGet Kenya', visitDays: ['mon'] } }), t as never).where).toEqual(['SeeBuyGet Kenya', 'Its address is not written down here yet: ask SeeBuyGet staff where to go before you travel.', 'Visitors: Monday']);
      // An address, no days: the gate's hours if it wrote any, and that visiting days are not said.
      expect(ticketLines(ticket({ place: { company: 'SeeBuyGet Kenya', address: 'Mombasa Road, gate 4', hours: 'Gate 6am–6pm' } }), t as never).where).toEqual(['SeeBuyGet Kenya', 'Mombasa Road, gate 4', 'Gate 6am–6pm', 'It has not said which days it receives visitors: ask before you travel.']);
      expect(ticketLines(ticket({ place: { company: 'SeeBuyGet Kenya', address: 'Mombasa Road, gate 4' } }), t as never).where[2]).toContain('has not said which days');
      // Nothing at all.
      expect(ticketLines(ticket(), t as never).where).toEqual(['The SeeBuyGet office for your country. Its address is not written down here yet: ask SeeBuyGet staff where to go before you travel.']);
    });

    it('offers the days the SERVER says there are — never its own reckoning — and any day only where the office set none', () => {
      const days = [{ date: '2026-10-09' }, { date: '2026-10-12' }, { date: '2026-10-16' }];
      expect(dayChoices({ choices: days })).toEqual(days);
      // An empty list is an answer — no day is free — and is not the same as no list at all.
      expect(dayChoices({ choices: [] })).toEqual([]);
      expect(dayChoices({})).toBeNull();
      // Moving an appointment: the day it is already on is not a change to offer …
      expect(dayChoices({ choices: days, ticket: ticket({ date: '2026-10-12' }) })!.map((d) => d.date)).toEqual(['2026-10-09', '2026-10-16']);
      // … unless that day has hours, and the change is to another hour of it.
      const withHours = [{ date: '2026-10-12', hours: [{ at: '09:00', free: 1 }, { at: '10:00', free: 0 }] }];
      expect(dayChoices({ choices: withHours, ticket: ticket({ date: '2026-10-12', at: '09:00', until: '10:00' }) })).toEqual(withHours);
      expect(dayLabel('2026-10-12')).toMatch(/12/);
    });

    it('asks for an hour where the office counts its visitors by the hour — and a full hour, or none, is not enough to go on', () => {
      const s = { choices: [{ date: '2026-10-12', hours: [{ at: '09:00', free: 2 }, { at: '10:00', free: 0 }] }, { date: '2026-10-13' }] };
      expect(hoursOn(s, '2026-10-12')).toEqual([{ at: '09:00', free: 2 }, { at: '10:00', free: 0 }]);
      // A day without hours: a day is all there is to choose.
      expect(hoursOn(s, '2026-10-13')).toBeNull();
      expect(hoursOn({}, '2026-10-12')).toBeNull();
      expect(readyToAppoint(s, '', '')).toBe(false);
      expect(readyToAppoint(s, '2026-10-12', '')).toBe(false);
      expect(readyToAppoint(s, '2026-10-12', '10:00')).toBe(false);
      expect(readyToAppoint(s, '2026-10-12', '11:00')).toBe(false);
      expect(readyToAppoint(s, '2026-10-12', '09:00')).toBe(true);
      expect(readyToAppoint(s, '2026-10-13', '')).toBe(true);
      // No list at all — the office set no days — and any day typed will do.
      expect(readyToAppoint({}, '2026-10-14', '')).toBe(true);
    });

    it('says a reminder will come the day before — or that it went, or that none can reach somebody with no account', () => {
      expect(reminderLine({ willRemind: true }, t as never)).toBe('We remind you the day before, here and by email: when, where and what to bring.');
      expect(reminderLine({ willRemind: true, remindedAt: '2026-10-08T06:00:00.000Z' }, t as never)).toMatch(/^A reminder went to you on .*2026/);
      const none = reminderLine({ willRemind: false }, t as never);
      expect(none).toContain('We cannot remind you');
      expect(none).toContain('Write the day down');
      // Not said of somebody the server did not say it of.
      expect(reminderLine({}, t as never)).toContain('We cannot remind you');
    });

    it('says the hour on the ticket where there is one', () => {
      expect(ticketLines(ticket({ at: '10:00', until: '11:00' }), t as never).when).toMatch(/2026, 10:00 to 11:00$/);
      expect(ticketLines(ticket(), t as never).when).toMatch(/2026$/);
      expect(t('account.id.hourFull', { at: '10:00' })).toBe('10:00 · full');
    });

    it('lists what to bring in the order it is asked for, with the second document that fits what they registered as', () => {
      const driver = bringLines(ticket(), 'driver', t as never);
      expect(driver).toHaveLength(4);
      expect(driver[0]).toContain('Not a copy, not a photograph');
      expect(driver[2]).toBe('Your reference: ID-WXYZ-6789');
      expect(driver[3]).toContain('driving licence');
      expect(bringLines(ticket(), 'shop', t as never)[3]).toContain('trading licence');
    });

    it('is the appointment’s maker’s to move, while changes are left; the other is told they may come', () => {
      const mine = status({ state: 'appointment', yours: false, ticket: ticket() });
      expect(idActions(mine).changeDay).toBe(true);
      expect(idStatusSays(mine, t as never).title).toBe('You have an appointment');
      expect(idActions(status({ state: 'appointment', ticket: ticket({ changesLeft: 0 }) })).changeDay).toBe(false);
      const theirs = status({ side: 'holder', state: 'appointment', yours: true, ticket: ticket({ yours: false, changesLeft: 0 }) });
      expect(idActions(theirs).changeDay).toBe(false);
      // Not theirs to move, whatever the count says: the screen does not lean on the server having zeroed it.
      expect(idActions(status({ side: 'holder', state: 'appointment', yours: true, ticket: ticket({ yours: false, changesLeft: 2 }) })).changeDay).toBe(false);
      expect(idStatusSays(theirs, t as never).lines[0]).toContain('You may come too');
    });

    it('can be made from tomorrow, three weeks ahead', () => {
      expect(appointmentDays(Date.parse('2026-10-08T15:00:00.000Z'))).toEqual({ min: '2026-10-09', max: '2026-10-29' });
    });
  });

  it('says on the Settings list what there is to do: answer by a day, read a decision, or end a hold', () => {
    const base = { reference: 'ID-WXYZ-6789', register: 'driver' as const };
    const asked = settingsIdSays({ ...base, state: 'answering', answerBy: '2026-10-15T09:00:00.000Z' }, t as never);
    expect(asked.title).toBe('Somebody says the national ID on your registration is theirs');
    expect(asked.detail).toMatch(/^Answer by .*2026/);
    expect(asked.cta).toBe('See what to do');
    // Sent, and with staff: no day to answer by any more.
    expect(settingsIdSays({ ...base, state: 'ready' }, t as never).detail).toContain('are deciding whose it is');
    // Decided: it must not go on saying that staff are deciding.
    for (const state of ['decided', 'appointment', 'rechecked', 'final'] as const) {
      const decided = settingsIdSays({ ...base, state }, t as never);
      expect(decided.title).toBe('A decision was made about the national ID on your registration');
      expect(decided.detail).not.toContain('are deciding');
      expect(decided.cta).toBe('Read the decision');
    }
    // Held outranks everything: it is what stops them working, and it has one way out.
    const held = settingsIdSays({ ...base, state: 'decided', held: true }, t as never);
    expect(held).toMatchObject({ title: 'Your registration is held', cta: 'Put my own ID number on record' });
    expect(held.detail).toContain('start nothing new until the number of your own ID card is on record');
  });

  it('says a decision made in person is final', () => {
    expect(all({ state: 'final', yours: false, reason: 'x' })).toContain('decided in person and is final');
    expect(all({ state: 'decided', yours: false, reason: 'x' })).not.toContain('final');
  });
});
