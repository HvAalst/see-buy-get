import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { DISPUTE_LABEL, DISPUTE_TONE, cardWords, decidedWords, disputeNotes, disputeStep, disputeSub, disputesWaiting, finalWords, mayPropose, photoRefs, placeWords, waitsOnThem, waitsOnUs, type DisputeRow, type DisputeState } from './idDisputes';

const when = (iso: string) => `[${iso.slice(0, 16)}]`;
const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const row = (over: Partial<DisputeRow> = {}): DisputeRow => ({
  disputeId: 'idd_1',
  reference: 'ID-ABCD-2345',
  holderReference: 'ID-WXYZ-6789',
  register: 'driver',
  state: 'ready',
  openedAt: '2026-10-08T09:00:00.000Z',
  claimant: { sentAt: '2026-10-08T10:00:00.000Z', phoneEnds: '907' },
  holder: { sentAt: '2026-10-09T10:00:00.000Z', who: 'Driver: Amos K., with Kilima Logistics', onRecord: ['med_old'] },
  ...over,
});
const STATES: DisputeState[] = ['opened', 'answering', 'ready', 'checked', 'decided', 'appointment', 'rechecked', 'final', 'conceded', 'withdrawn', 'lapsed'];

describe('ID disputes, as the console says them', () => {
  it('has a word and a colour for every state a dispute can be in', () => {
    for (const s of STATES) {
      expect(t(DISPUTE_LABEL[s])).not.toContain('tower.ids');
      expect(DISPUTE_TONE[s]).toBeTruthy();
    }
    expect(new Set(STATES.map((s) => t(DISPUTE_LABEL[s]))).size).toBe(STATES.length);
  });

  it('sorts what waits on us from what waits on the two people — an appointment is theirs until its day, ours from it', () => {
    const ours = STATES.filter((state) => waitsOnUs({ state }, NOW));
    expect(ours).toEqual(['ready', 'checked', 'rechecked']);
    expect(STATES.filter((state) => waitsOnThem({ state }, NOW))).toEqual(['opened', 'answering', 'appointment']);
    expect(waitsOnUs({ state: 'appointment', appointmentDate: '2026-10-16' }, NOW)).toBe(false);
    expect(waitsOnThem({ state: 'appointment', appointmentDate: '2026-10-16' }, NOW)).toBe(true);
    expect(waitsOnUs({ state: 'appointment', appointmentDate: '2026-10-15' }, NOW)).toBe(true);
    expect(waitsOnThem({ state: 'appointment', appointmentDate: '2026-10-15' }, NOW)).toBe(false);
    expect(disputesWaiting(null, NOW)).toBeNull();
    expect(disputesWaiting([], NOW)).toBe(0);
    expect(disputesWaiting(STATES.map((state, i) => row({ disputeId: `d${i}`, state })), NOW)).toBe(3);
  });

  describe('what the reader may do next', () => {
    it('is to say whose it is; then somebody ELSE approves — never the one who said', () => {
      expect(disputeStep(row(), 'Amina Otieno', NOW)).toBe('propose');
      const checked = row({ state: 'checked', proposedBy: 'Amina Otieno' });
      expect(disputeStep(checked, 'Brian Kamau', NOW)).toBe('approve');
      expect(disputeStep({ ...checked, proposedByYou: true }, 'Brian Kamau', NOW)).toBe('other');
      expect(disputeStep(checked, 'Amina Otieno', NOW)).toBe('other');
      // Nobody's name is not everybody's.
      expect(disputeStep(checked, undefined, NOW)).toBe('approve');
      expect(disputeStep(row({ state: 'rechecked', proposedBy: 'Amina Otieno' }), 'Amina Otieno', NOW)).toBe('other');
    });

    it('is to wait while it is the two people’s turn, to record an appointment from its day, and nothing once it is over', () => {
      expect(disputeStep(row({ state: 'opened' }), 'A', NOW)).toBe('wait');
      expect(disputeStep(row({ state: 'answering' }), 'A', NOW)).toBe('wait');
      expect(disputeStep(row({ state: 'appointment', appointmentDate: '2026-10-20' }), 'A', NOW)).toBe('wait');
      expect(disputeStep(row({ state: 'appointment', appointmentDate: '2026-10-15' }), 'A', NOW)).toBe('record');
      for (const state of ['decided', 'final', 'conceded', 'withdrawn', 'lapsed'] as const) expect(disputeStep(row({ state }), 'A', NOW)).toBe('over');
    });
  });

  describe('who the ID may be proposed for', () => {
    it('from the photographs: only somebody whose card was read as carrying it', () => {
      expect(mayPropose(row(), 'claimant')).toEqual({ ok: false, why: 'tower.ids.cannot.claimantCard' });
      expect(mayPropose(row(), 'holder')).toEqual({ ok: false, why: 'tower.ids.cannot.holderCard' });
      expect(mayPropose(row({ claimant: { card: 'matches' } }), 'claimant')).toEqual({ ok: true });
      expect(mayPropose(row({ holder: { card: 'matches' } }), 'holder')).toEqual({ ok: true });
      // The claimant's own card carries another number: it stays where it is, whatever the holder showed.
      expect(mayPropose(row({ claimant: { card: 'differs' } }), 'holder')).toEqual({ ok: true });
      expect(mayPropose(row({ claimant: { card: 'differs' } }), 'claimant').ok).toBe(false);
      for (const key of ['tower.ids.cannot.claimantCard', 'tower.ids.cannot.holderCard', 'tower.ids.cannot.notCame'] as const) expect(t(key)).not.toContain('tower.ids');
    });

    it('after an appointment: the decision changes only for somebody who came', () => {
      const appointed = row({ state: 'appointment', decidedTo: 'claimant', appointmentDate: '2026-10-15' });
      expect(mayPropose(appointed, 'holder', { claimant: true, holder: false })).toEqual({ ok: false, why: 'tower.ids.cannot.notCame' });
      expect(mayPropose(appointed, 'holder', { claimant: false, holder: true })).toEqual({ ok: true });
      // That it stands needs nobody to have come.
      expect(mayPropose(appointed, 'claimant', { claimant: false, holder: false })).toEqual({ ok: true });
    });
  });

  it('lists a dispute by what it is about and what it waits on', () => {
    expect(disputeSub(row(), t)).toBe('A driver’s ID · opened 2026-10-08');
    expect(disputeSub(row({ register: 'shop', state: 'opened', photosBy: '2026-10-15T09:00:00.000Z' }), t)).toBe('A shop’s ID · opened 2026-10-08 · the claimant’s photographs are due by 2026-10-15');
    expect(disputeSub(row({ state: 'answering', answerBy: '2026-10-16T09:00:00.000Z' }), t)).toMatch(/· the holder has until 2026-10-16$/);
    expect(disputeSub(row({ state: 'checked', proposedBy: 'Amina Otieno' }), t)).toMatch(/· proposed by Amina Otieno$/);
    expect(disputeSub(row({ state: 'appointment', appointmentDate: '2026-10-20' }), t)).toMatch(/· appointment on 2026-10-20$/);
  });

  it('says what a card came to — four different answers, and the wrong one in capitals', () => {
    const said = [cardWords({}, t), cardWords({ sentAt: 'x' }, t), cardWords({ sentAt: 'x', card: 'matches' }, t), cardWords({ sentAt: 'x', card: 'differs' }, t)];
    expect(new Set(said).size).toBe(4);
    expect(said[3]).toContain('DIFFERENT');
    // Read in the hand at an appointment, with no photographs ever sent.
    expect(cardWords({ card: 'matches' }, t)).toBe(said[2]);
  });

  it('shows the three photographs in the order they were asked for, and only the ones that are there', () => {
    expect(photoRefs({ back: 'c', face: 'a', front: 'b' })).toEqual(['a', 'b', 'c']);
    expect(photoRefs({ front: 'b' })).toEqual(['b']);
    expect(photoRefs({})).toEqual([]);
  });

  describe('what to weigh', () => {
    it('is nothing once there is nothing to decide', () => {
      const everything = { claimant: { sentAt: 'x', card: 'matches' as const }, holder: { card: 'matches' as const } };
      expect(disputeNotes(row(everything), t).length).toBeGreaterThan(0);
      for (const state of ['checked', 'decided', 'appointment', 'final'] as const) expect(disputeNotes(row({ state, ...everything }), t)).toEqual([]);
    });

    it('says what will happen in the plain cases, and what a photograph cannot settle in the hard one', () => {
      const silent = disputeNotes(row({ holder: { onRecord: ['m'] } }), t);
      expect(silent).toHaveLength(1);
      expect(silent[0]).toMatchObject({ tone: 'warn', text: expect.stringContaining('held, not removed') });
      expect(disputeNotes(row({ claimant: { sentAt: 'x', card: 'differs' } }), t)[0]).toMatchObject({ tone: 'danger', text: expect.stringContaining('the ID stays where it is') });
      expect(disputeNotes(row({ holder: { sentAt: 'x', card: 'differs', onRecord: ['m'] } }), t)[0]).toMatchObject({ tone: 'info', text: expect.stringContaining('nobody is held') });
      const both = disputeNotes(row({ claimant: { sentAt: 'x', card: 'matches' }, holder: { sentAt: 'x', card: 'matches', onRecord: ['m'] } }), t);
      expect(both).toHaveLength(1);
      expect(both[0].tone).toBe('danger');
      expect(both[0].text).toContain('If you cannot tell, leave it with the holder');
      // Nothing older to compare with: said, because it changes how much the photographs have to carry.
      expect(disputeNotes(row({ holder: { sentAt: 'x' } }), t).slice(-1)[0].text).toContain('nothing older to compare');
    });
  });

  it('says where people are sent and when, in the company’s own words — and says what it has not written, never a blank', () => {
    const full = placeWords(row({ place: { company: 'SeeBuyGet Kenya', address: 'Mombasa Road, gate 4', visitDays: ['fri', 'mon'], visitFrom: '09:00', visitTo: '16:00' } }), t);
    expect(full).toEqual({ where: 'SeeBuyGet Kenya, Mombasa Road, gate 4', visiting: 'Visitors: Monday, Friday · 09:00 to 16:00', missing: false });
    const nothing = placeWords(row(), t);
    expect(nothing).toMatchObject({ where: 'No address written', missing: true });
    expect(nothing.visiting).toContain('may choose any day');
    // Either one missing is still something for the company to put right.
    expect(placeWords(row({ place: { company: 'SeeBuyGet Kenya', address: 'Mombasa Road, gate 4' } }), t)).toMatchObject({ where: 'SeeBuyGet Kenya, Mombasa Road, gate 4', missing: true });
    expect(placeWords(row({ place: { company: 'SeeBuyGet Kenya', visitDays: ['mon'] } }), t)).toMatchObject({ where: 'No address written', visiting: 'Visitors: Monday', missing: true });
    // And whose it is to put right is said in so many words: the company's, in its own Settings.
    expect(t('tower.ids.place.theirs')).toContain('under Settings, How to reach you');
  });

  it('says how it was decided — for whom, by whom, and what it did to the holder — and whether the decision stood in person', () => {
    const at = '2026-10-09T12:00:00.000Z';
    expect(decidedWords(row({ state: 'decided', decidedTo: 'claimant', decidedBy: 'Brian Kamau', decidedAt: at, holderEffect: 'held' }), t, when)).toBe('For the one who was refused — approved by Brian Kamau, [2026-10-09T12:00]. The holder’s registration is held.');
    expect(decidedWords(row({ state: 'decided', decidedTo: 'claimant', decidedBy: 'Brian Kamau', decidedAt: at, holderEffect: 'corrected' }), t, when)).toContain('took the number on their own card');
    expect(decidedWords(row({ state: 'decided', decidedTo: 'holder', decidedBy: 'Brian Kamau', decidedAt: at, holderEffect: 'none' }), t, when)).toBe('For the one who holds it — approved by Brian Kamau, [2026-10-09T12:00].');
    expect(decidedWords(row(), t, when)).toBe('');
    const base = { state: 'final' as const, decidedTo: 'claimant' as const, finalBy: 'Amina Otieno', finalAt: at };
    expect(finalWords(row({ ...base, finalTo: 'claimant' }), t, when)).toMatch(/^The decision stands/);
    expect(finalWords(row({ ...base, finalTo: 'holder' }), t, when)).toMatch(/^The decision changed: now for the one who holds it/);
    expect(finalWords(row(), t, when)).toBe('');
  });
});
