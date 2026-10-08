import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { appointmentDays, bringLines, idActions, idStatusSays, looksLikeIdReference, settingsIdSays, ticketLines, type DisputeState, type DisputeStatus, type DisputeTicket } from './idDispute';

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
    it('says when, where and who to ask for — or, with no address written down, to ring first', () => {
      const lines = ticketLines(ticket({ place: { company: 'SeeBuyGet Kenya', address: 'Mombasa Road, gate 4', hours: 'Mon–Fri 8–17', contactName: 'Grace', phone: '+254 20 000 111' } }), t as never);
      expect(lines.when).toContain('2026');
      expect(lines.where).toEqual(['SeeBuyGet Kenya', 'Mombasa Road, gate 4', 'Mon–Fri 8–17', 'Ask for Grace', 'Telephone +254 20 000 111']);
      expect(ticketLines(ticket(), t as never).where[0]).toContain('ask SeeBuyGet staff where to go before you travel');
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
