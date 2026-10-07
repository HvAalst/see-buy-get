import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { FEW_LEFT, linkRowSays, linkSays, looksLikeAKey, readLinkKey, type DocumentLinkRow, type DocumentLinkView } from './documentLink';
import { fileNameFor } from './handOver';
import { day } from './words';

const KEY = 'Qm9v-a2V5X3Ro_YXRfaXNfNDNfY2hhcnNfbG9uZw'.padEnd(43, '0').slice(0, 43); // 43 characters of the alphabet a key is written in
const until = '2026-11-06T12:04:00.000Z';
const ready = (over: Partial<DocumentLinkView> = {}): DocumentLinkView => ({ state: 'ready', expiresAt: until, number: 'CMR-FRT-010', from: 'Mama Sarah Shop', to: 'Riverside Corner', deliveredAt: '2026-10-07T12:04:00.000Z', opensLeft: 25, documentUntil: '2027-10-07T12:04:00.000Z', ...over });
const row = (over: Partial<DocumentLinkRow> = {}): DocumentLinkRow => ({ linkId: 'dl_1', state: 'ready', sentTo: 'm…@kilima.co.ke', createdAt: '2026-10-07T12:04:00.000Z', expiresAt: until, opened: 0, ...over });

describe('a link to a document', () => {
  describe('the key in the address', () => {
    it('is read from after the #, where no server ever saw it', () => {
      expect(KEY).toHaveLength(43);
      expect(readLinkKey(`#doc=${KEY}`)).toBe(KEY);
      expect(readLinkKey(`#x=1&doc=${KEY}&y=2`)).toBe(KEY);
      // Not from anywhere else, and not from something that only ends the same way.
      for (const not of [undefined, '', '#', '#note=abc', `#mydoc=${KEY}`, `?doc=${KEY}`, `doc=${KEY}`]) expect(readLinkKey(not)).toBeUndefined();
    });

    it('is handed back even when it cannot be a key — somebody was still sent here for a document', () => {
      // A mail program cut the address short: they land on a page that says so, not on a front door that says nothing.
      expect(readLinkKey('#doc=Qm9v')).toBe('Qm9v');
      expect(readLinkKey('#doc=')).toBe('');
      expect(readLinkKey('#doc=%20Qm9v%20')).toBe('Qm9v');
      expect(readLinkKey('#doc=%E0%A4%A')).toBe('%E0%A4%A');
      expect(readLinkKey(`#doc=${'A'.repeat(500)}`)).toHaveLength(200);
      expect([looksLikeAKey(KEY), looksLikeAKey('Qm9v'), looksLikeAKey(''), looksLikeAKey(KEY + 'A'), looksLikeAKey(KEY.slice(1)), looksLikeAKey(`${KEY.slice(0, 42)}=`), looksLikeAKey(` ${KEY.slice(1)}`)]).toEqual([true, false, false, false, false, false, false]);
    });
  });

  describe('what the page says', () => {
    it('says what a link opens before anything is taken: which note, between where, until when, and that the file is the copy to keep', () => {
      const s = linkSays({ view: ready() }, t);
      expect([s.tone, s.icon, s.title, s.canTake, s.canRetry, s.canVerify]).toEqual(['ok', 'check', 'Consignment note CMR-FRT-010', true, false, false]);
      expect(s.lines).toEqual([
        `From Mama Sarah Shop to Riverside Corner, delivered ${day('2026-10-07T12:04:00.000Z')}.`,
        'It is one file: the note, every copy of it as it was signed, and its photographs. Once you have the file it needs nothing from us.',
        `This link works until ${day(until)}.`,
        `We keep the note itself until ${day('2027-10-07T12:04:00.000Z')}. After that nobody can be given another copy, so keep the file.`,
      ]);
      // Not delivered yet: no date is made up. No dates known: nothing is said that is not known.
      expect(linkSays({ view: ready({ deliveredAt: undefined }) }, t).lines[0]).toBe('From Mama Sarah Shop to Riverside Corner.');
      expect(linkSays({ view: ready({ from: undefined, to: undefined, deliveredAt: undefined, documentUntil: undefined }) }, t).lines).toEqual([expect.stringMatching(/^It is one file/), `This link works until ${day(until)}.`]);
    });

    it('says how many openings are left only once they are few — and "once", not "1 times"', () => {
      const left = (n: number | undefined) => linkSays({ view: ready({ opensLeft: n }) }, t).lines.filter((l) => /used/.test(l));
      expect(left(25)).toEqual([]);
      expect(left(FEW_LEFT + 1)).toEqual([]);
      expect(left(undefined)).toEqual([]);
      expect(left(FEW_LEFT)).toEqual([`It can be used ${FEW_LEFT} more times.`]);
      expect(left(2)).toEqual(['It can be used 2 more times.']);
      expect(left(1)).toEqual(['It can be used once more.']);
    });

    it('says which way a link stopped, and who to turn to — the sender, never us', () => {
      const stopped = (view: DocumentLinkView) => linkSays({ view }, t);
      const expired = stopped({ state: 'expired', expiresAt: until });
      expect([expired.tone, expired.title, expired.canTake, expired.canRetry]).toEqual(['warn', 'This link has stopped working', false, false]);
      expect(expired.lines).toEqual([`It worked until ${day(until)}.`, 'If you should have the note, ask whoever sent you the email: it is theirs to give.']);
      const cancelled = stopped({ state: 'cancelled', expiresAt: until });
      expect([cancelled.title, cancelled.lines[0], cancelled.canTake]).toEqual(['This link was cancelled', 'Whoever it was made for has cancelled it.', false]);
      const usedUp = stopped({ state: 'used_up', expiresAt: until });
      expect([usedUp.title, usedUp.canTake]).toEqual(['This link has been used as often as one link can be', false]);
      for (const s of [expired, cancelled, usedUp]) expect(s.lines[s.lines.length - 1]).toMatch(/ask whoever sent you the email/);
      // A stopped link says nothing of what it opened, whatever the answer carried.
      expect(JSON.stringify(stopped({ state: 'expired', expiresAt: until, number: 'CMR-FRT-010', from: 'Mama Sarah Shop' }))).not.toMatch(/CMR-FRT-010|Mama Sarah/);
    });

    it('says a note that is no longer kept is gone for everybody — and what can still be done with a copy somebody holds', () => {
      const s = linkSays({ view: { state: 'gone', expiresAt: until } }, t);
      expect([s.tone, s.title, s.canTake, s.canVerify, s.canRetry]).toEqual(['info', 'This note is no longer kept', false, true, false]);
      expect(s.lines.join(' ')).toMatch(/We cannot give anybody another copy\. If you hold a copy, we can still confirm that it is genuine\./);
      // Not "ask the sender": the sender cannot get it from us either.
      expect(s.lines.join(' ')).not.toMatch(/ask whoever/);
    });

    it('tells a link that is not ours from a server that did not answer: one is final, the other is worth trying again', () => {
      const notOurs = linkSays({ failed: 'not_ours' }, t);
      expect([notOurs.tone, notOurs.title, notOurs.canRetry, notOurs.canTake]).toEqual(['danger', 'This is not a link we made', false, false]);
      expect(notOurs.lines[0]).toMatch(/some mail programs cut a long address short\. Open it again from the email itself\./);
      const unreachable = linkSays({ failed: 'unreachable' }, t);
      expect([unreachable.icon, unreachable.title, unreachable.canRetry]).toEqual(['offline', 'Could not reach us just now', true]);
      expect(unreachable.lines.join(' ')).toMatch(/The link is not used up by trying\./);
      const busy = linkSays({ failed: 'busy' }, t);
      expect([busy.title, busy.canRetry, busy.canTake]).toEqual(['Too many tries from here', true, false]);
    });
  });

  describe('on the document, for the party it was made for', () => {
    it('says where it went and whether it still opens — and offers to cancel only one that does', () => {
      expect(linkRowSays(row(), t)).toEqual({ title: `Emailed to m…@kilima.co.ke on ${day('2026-10-07T12:04:00.000Z')}`, state: `Works until ${day(until)}`, used: 'Not opened yet', canCancel: true });
      expect(linkRowSays(row({ sentTo: undefined }), t).title).toBe(`Made on ${day('2026-10-07T12:04:00.000Z')}`);
      const states: Array<[Partial<DocumentLinkRow>, string]> = [
        [{ state: 'expired' }, `Stopped on ${day(until)}`],
        [{ state: 'cancelled', cancelledAt: '2026-10-09T08:00:00.000Z' }, `Cancelled on ${day('2026-10-09T08:00:00.000Z')}`],
        [{ state: 'used_up' }, 'Used as often as one link can be'],
        [{ state: 'gone' }, 'The note is no longer kept'],
      ];
      for (const [over, words] of states) expect(linkRowSays(row(over), t)).toMatchObject({ state: words, canCancel: false });
    });

    it('says how it was used: never, once, or how many times and when last', () => {
      expect(linkRowSays(row({ opened: 1, lastOpenedAt: '2026-10-08T09:00:00.000Z' }), t).used).toBe(`Opened once, on ${day('2026-10-08T09:00:00.000Z')}`);
      expect(linkRowSays(row({ opened: 7, lastOpenedAt: '2026-10-12T09:00:00.000Z' }), t).used).toBe(`Opened 7 times, last on ${day('2026-10-12T09:00:00.000Z')}`);
      expect(linkRowSays(row({ opened: 0 }), t).used).toBe('Not opened yet');
    });
  });

  it('names the file by the note’s number, as something any computer will save', () => {
    expect(fileNameFor('CMR-FRT-010')).toBe('CMR-FRT-010.zip');
    expect(fileNameFor('CMR/FRT 010:*?')).toBe('CMR-FRT-010.zip');
    expect(fileNameFor('')).toBe('consignment-note.zip');
    expect(fileNameFor('///')).toBe('consignment-note.zip');
  });
});
