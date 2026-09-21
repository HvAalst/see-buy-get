import { FieldObservationService, REDACTION_NOTICE_VERSION } from './field-observation.service';

/**
 * CL5 — the two gates on holding a photograph of an official document, and the rules that keep the told
 * layer honest.
 *
 * The cases worth asserting are the ones that decide whether a photograph of somebody's customs paperwork
 * ends up on our disk: each gate ALONE, both together, and what happens to the observation when one of
 * them is shut — because the answer is "it is still recorded", and a slice that quietly dropped the words
 * along with the picture would have thrown away the useful half.
 */
describe('what somebody was asked for, and whether we may photograph it', () => {
  const NOW = Date.parse('2026-09-20T10:00:00.000Z');
  const who = { did: 'did:glos:amos', name: 'Amos' };
  const told = { country: 'ET', place: 'Modjo dry port', subject: 'Investment licence', happenedOn: '2026-09-18', firstHand: true };

  /** The country gate, answered by a stub, because whose answer it is matters more than how it is stored. */
  const svc = (allowed: string[] = []) => new FieldObservationService({ can: (j: string, c: string) => c === 'fieldEvidence' && allowed.includes(j) } as never);

  it('records what somebody was asked for, dated when it happened and attributed', () => {
    const s = svc();
    const o = s.record(told, who, NOW);
    expect(o).toMatchObject({ country: 'ET', place: 'Modjo dry port', subject: 'Investment licence', happenedOn: '2026-09-18', byName: 'Amos', tier: 'told' });
    // The tier is DERIVED. A tier somebody can pick is a tier somebody can claim.
    expect(o.evidenceMediaId).toBeUndefined();
  });

  it('refuses a rumour rather than keeping it at low confidence', () => {
    const s = svc();
    // First-hand, evidenced, or not at all. A rumour stored weakly is still a rumour on a screen, and
    // worse, it is a rumour wearing a date.
    expect(() => s.record({ ...told, firstHand: false }, who, NOW)).toThrow(/what you were asked for yourself/);
    expect(s.list()).toEqual([]);
  });

  it('refuses a date that has not happened, and one that is not a date', () => {
    const s = svc();
    expect(() => s.record({ ...told, happenedOn: '2026-12-01' }, who, NOW)).toThrow(/has not happened yet/);
    expect(() => s.record({ ...told, happenedOn: 'last week' }, who, NOW)).toThrow(/YYYY-MM-DD/);
  });

  it('will not keep a photograph where the country has not been switched on — and keeps the words anyway', () => {
    const s = svc(); // ET not permitted
    expect(() => s.record({ ...told, evidenceMediaId: 'med_1', consent: { agreed: true, noticeVersion: REDACTION_NOTICE_VERSION } }, who, NOW)).toThrow(
      /not permitted to keep photographs of official documents in ET/,
    );
    // The useful half survives: the same observation without the picture is accepted.
    expect(s.record(told, who, NOW).tier).toBe('told');
  });

  it('will not keep a photograph without the person-s own agreement, on this upload', () => {
    const s = svc(['ET']); // the country gate is OPEN, and that is still not enough
    expect(() => s.record({ ...told, evidenceMediaId: 'med_1' }, who, NOW)).toThrow(/your agreement, on this upload/);
    expect(() => s.record({ ...told, evidenceMediaId: 'med_1', consent: { agreed: false, noticeVersion: REDACTION_NOTICE_VERSION } }, who, NOW)).toThrow(/your agreement/);
  });

  it('refuses agreement given to wording that is no longer on the screen', () => {
    const s = svc(['ET']);
    // A consent is consent to the words that were actually shown. Re-wording the notice without a new
    // version would silently re-attribute everybody's past agreement to a sentence they never read.
    expect(() => s.record({ ...told, evidenceMediaId: 'med_1', consent: { agreed: true, noticeVersion: '2020-01-01' } }, who, NOW)).toThrow(/agree to the current wording/);
  });

  it('keeps the photograph only when BOTH gates are open, with the words they agreed to', () => {
    const s = svc(['ET']);
    const o = s.record({ ...told, evidenceMediaId: 'med_1', consent: { agreed: true, noticeVersion: REDACTION_NOTICE_VERSION } }, who, NOW);
    expect(o.tier).toBe('evidenced');
    expect(o.evidenceMediaId).toBe('med_1');
    expect(o.consent?.agreedBy).toBe('Amos');
    // Kept verbatim, so nobody has to reconstruct later what was on the screen.
    expect(o.consent?.notice).toMatch(/Black out the numbers/);
    expect(o.consent?.noticeVersion).toBe(REDACTION_NOTICE_VERSION);
  });

  it('is one country-s answer, never another-s', () => {
    const s = svc(['KE']);
    expect(s.mayHoldEvidence('KE')).toBe(true);
    expect(s.mayHoldEvidence('ET')).toBe(false);
    expect(s.mayHoldEvidence(undefined)).toBe(false);
  });

  it('says no when nothing can answer the question', () => {
    // No presence service wired at all must mean NO. Defaulting to yes is the closed eye.
    const s = new FieldObservationService();
    expect(s.mayHoldEvidence('ET')).toBe(false);
  });

  it('stops HOLDING the photograph when it is taken back, not merely unlinking it', () => {
    // Found by driving: the observation read "told" while the photograph still answered 200 for the rest
    // of its ninety days. Both reasons to take one back — a visible number, a country withdrawing its
    // permission — mean we must stop holding it now.
    const withdrawn: string[] = [];
    const media = { withdrawFieldEvidence: (id?: string) => id && withdrawn.push(id) };
    const s = new FieldObservationService({ can: () => true } as never, media as never);
    const o = s.record({ ...told, evidenceMediaId: 'med_9', consent: { agreed: true, noticeVersion: REDACTION_NOTICE_VERSION } }, who, NOW);
    s.removeEvidence(o.observationId, 'Hans', 'A declaration number was visible', NOW);
    expect(withdrawn).toEqual(['med_9']);
  });

  it('takes a photograph back without losing the observation', () => {
    const s = svc(['ET']);
    const o = s.record({ ...told, evidenceMediaId: 'med_1', consent: { agreed: true, noticeVersion: REDACTION_NOTICE_VERSION } }, who, NOW);
    expect(() => s.removeEvidence(o.observationId, 'Hans', '')).toThrow(/why/);
    const after = s.removeEvidence(o.observationId, 'Hans', 'A tax number was visible', NOW);
    expect(after.evidenceMediaId).toBeUndefined();
    // It falls back to what it now is, and the words stay — they were first-hand and still are.
    expect(after.tier).toBe('told');
    expect(after.subject).toBe('Investment licence');
    expect(after.note).toMatch(/Photograph removed .* by Hans: A tax number was visible/);
  });

  it('reads back newest first, by the date it HAPPENED', () => {
    const s = svc();
    s.record({ ...told, subject: 'Older', happenedOn: '2026-01-05' }, who, NOW);
    s.record({ ...told, subject: 'Newer', happenedOn: '2026-09-01' }, who, NOW);
    // The date leads because it is the whole claim: last year's entry reads as last year's with nobody
    // marking it stale, which is the only honest way to hold knowledge about a moving target.
    expect(s.at('ET').map((o) => o.subject)).toEqual(['Newer', 'Older']);
    expect(s.at('ET', 'modjo')).toHaveLength(2);
    expect(s.at('KE')).toEqual([]);
  });
});
