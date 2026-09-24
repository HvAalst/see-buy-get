import { InterestService } from './interest.service';

/**
 * THE WAITING LIST, AND THE ONE PROMISE IT MAKES.
 *
 * Every country is on the join form now, and most of them answer "we do not reach here yet" — honest, and
 * a dead end. This is the way out of it: somebody who would carry freight in a country we have never been
 * to is the only real evidence for "which country next", and the decision had none.
 *
 * What the tests hold it to is mostly about not over-promising and not over-collecting.
 */
describe('who is waiting for a country the network has not reached', () => {
  let interest: InterestService;

  const ask = (over: Partial<{ country: string; kind: string; email: string; message: string }> = {}, open = false) =>
    interest.add({ country: 'FR', kind: 'carrier', email: 'pierre@example.fr', message: 'Two vans between Lille and Paris.', ...over }, open);

  beforeEach(() => {
    interest = new InterestService();
    for (const n of interest.list()) interest.withdraw(n.noteId);
  });

  it('records what somebody would do, and why — the half a count cannot give', () => {
    const note = ask();
    expect(note).toMatchObject({ country: 'FR', kind: 'carrier', email: 'pierre@example.fr' });
    expect(note.message).toContain('Lille');
    expect(note.toldAt).toBeUndefined();
  });

  it('refuses a country that is ALREADY OPEN, because there is nothing there to wait for', () => {
    // Not a failure on their part: the right answer is the sign-up, and the caller turns this into one.
    expect(() => ask({ country: 'KE' }, true)).toThrow(/already reaches/);
  });

  it('refuses a country that does not exist — a typed code is a mistake, not a new country', () => {
    expect(() => ask({ country: 'ZZ' })).toThrow(/No such country/);
  });

  it('insists on a reason, because the reason is what the decision is made on', () => {
    expect(() => ask({ message: '   ' })).toThrow(/what you would do here/);
    expect(() => ask({ message: 'x'.repeat(601) })).toThrow(/under 600/);
  });

  it('insists on an address, because it is the only way the promise can be kept', () => {
    expect(() => ask({ email: 'nope' })).toThrow(/valid email/);
  });

  it('REPLACES a second ask about the same country rather than counting it twice', () => {
    /*
     * The count is the number a switch-on decision gets made on, so one person must not be able to move
     * it by asking again. Replacing rather than refusing, because somebody rewriting their reason is
     * doing the useful thing — the newer reason is the better evidence.
     */
    const first = ask();
    const second = ask({ message: 'Three vans now, not two.' });
    expect(second.noteId).toBe(first.noteId);
    expect(interest.list()).toHaveLength(1);
    expect(interest.byCountry()[0].waiting).toBe(1);
    expect(interest.list()[0].message).toContain('Three vans');
  });

  it('counts each country separately, and caps one address before it becomes a survey', () => {
    for (const country of ['FR', 'DE', 'ES', 'IT', 'PT', 'BE', 'LU', 'AT', 'CH', 'PL']) ask({ country });
    expect(interest.list()).toHaveLength(10);
    expect(() => ask({ country: 'CZ' })).toThrow(/a lot of countries/);
    // The cap is per address, not global — somebody else is unaffected by it.
    expect(() => ask({ country: 'CZ', email: 'other@example.com' })).not.toThrow();
  });

  it('groups BY COUNTRY for the decision, biggest first, with what the country implies', () => {
    ask({ country: 'FR', email: 'a@x.fr' });
    ask({ country: 'FR', email: 'b@x.fr', kind: 'shop' });
    ask({ country: 'TD', email: 'c@x.td' });

    const rows = interest.byCountry();
    expect(rows.map((r) => r.country)).toEqual(['FR', 'TD']); // most waiting first
    expect(rows[0]).toMatchObject({ name: 'France', waiting: 2, kinds: { carrier: 1, shop: 1 }, currency: 'EUR' });
    // What the country SPEAKS, which is the translation a switch-on would imply — otherwise worked out by
    // hand, per country, by whoever is making the decision.
    expect(rows[0].languages).toEqual(['fr']);
    expect(rows[1].languages).toContain('ar');
    // The motivation travels with the row: a count alone says ten people tapped a button.
    expect(rows[0].notes).toHaveLength(2);
  });

  it('stops counting somebody once the switch-on has told them, and never tells them twice', () => {
    ask({ country: 'FR', email: 'a@x.fr' });
    ask({ country: 'FR', email: 'b@x.fr' });
    const waiting = interest.waitingFor('FR');
    expect(waiting).toHaveLength(2);

    interest.told(waiting.map((n) => n.noteId), 'matched');
    expect(interest.waitingFor('FR')).toHaveLength(0);
    expect(interest.byCountry()[0].waiting).toBe(0);
    // The notes stay — they are the record of why that country was switched on — and say what it became.
    expect(interest.byCountry()[0].notes).toHaveLength(2);
    expect(interest.byCountry()[0].notes[0].toldLevel).toBe('matched');
  });

  it('takes a note back outright — somebody withdrawing has withdrawn', () => {
    const note = ask();
    interest.withdraw(note.noteId);
    expect(interest.list()).toHaveLength(0);
  });
});
