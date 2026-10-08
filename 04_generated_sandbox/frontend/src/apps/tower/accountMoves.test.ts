import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { MOVE_LABEL, MOVE_TONE, endedWords, idWords, isOpen, moveStep, moveSub, moveWarnings, movesWaiting, roleLines, type MoveAccount, type MoveRow, type MoveState } from './accountMoves';

const when = (iso: string) => `[${iso.slice(0, 16)}]`;
const row = (over: Partial<MoveRow> = {}): MoveRow => ({ moveId: 'mv_1', reference: 'MV-ABCD-2345', state: 'asked', askedAt: '2026-10-08T09:00:00.000Z', lapsesAt: '2026-10-22T09:00:00.000Z', oldEnds: '412', newEnds: '907', namesAccount: true, ...over });
const account = (over: Partial<MoveAccount> = {}): MoveAccount => ({ since: '2026-03-01T08:00:00.000Z', hasPin: true, roles: [{ role: 'driver', name: 'Amos K.', with: 'Kilima Logistics' }], nationalIdOnRecord: true, ...over });
const STATES: MoveState[] = ['asked', 'checked', 'moved', 'refused', 'stopped', 'lapsed'];

describe('account moves, as the console says them', () => {
  it('has a word and a colour for every state a request can be in', () => {
    for (const s of STATES) {
      expect(t(MOVE_LABEL[s])).not.toContain('tower.moves');
      expect(MOVE_TONE[s]).toBeTruthy();
    }
    expect(new Set(STATES.map((s) => t(MOVE_LABEL[s]))).size).toBe(STATES.length);
    // Stopped from the account itself is the one to read twice: it is not said quietly.
    expect(MOVE_TONE.stopped).toBe('danger');
  });

  it('counts what waits on us — a first look or a second approval — and says nothing while it has not looked', () => {
    expect(movesWaiting(null)).toBeNull();
    expect(movesWaiting([])).toBe(0);
    expect(movesWaiting(STATES.map((state, i) => row({ moveId: `mv_${i}`, state })))).toBe(2);
    expect(STATES.filter((state) => isOpen({ state }))).toEqual(['asked', 'checked']);
  });

  describe('what the reader may do next', () => {
    it('is to check it — or only to refuse it, when the number names no account', () => {
      expect(moveStep(row())).toBe('check');
      expect(moveStep(row({ namesAccount: false }))).toBe('refuse');
    });

    it('is to approve it once somebody ELSE has checked it — never the one who did', () => {
      const checked = row({ state: 'checked', checkedBy: 'Amina Otieno' });
      expect(moveStep(checked, 'Brian Kamau')).toBe('approve');
      // The server says so where the sign-in names somebody…
      expect(moveStep({ ...checked, checkedByYou: true }, 'Brian Kamau')).toBe('other');
      // …and the name does where a sandbox's shared key is in use.
      expect(moveStep(checked, 'Amina Otieno')).toBe('other');
      // Nobody's name is not everybody's: a reader with no name is not taken for the one who checked.
      expect(moveStep(checked, undefined)).toBe('approve');
      expect(moveStep(row({ state: 'checked' }), undefined)).toBe('approve');
    });

    it('is nothing once it is over, however it ended', () => {
      for (const state of ['moved', 'refused', 'stopped', 'lapsed'] as const) expect(moveStep(row({ state, checkedBy: 'Amina Otieno' }), 'Brian Kamau')).toBe('over');
    });
  });

  it('lists a request by the two numbers’ last digits — never a number — with who checked it or that it names nobody', () => {
    expect(moveSub(row(), t)).toBe('From a number ending 412 to one ending 907 · asked 2026-10-08');
    expect(moveSub(row({ state: 'checked', checkedBy: 'Amina Otieno' }), t)).toBe('From a number ending 412 to one ending 907 · asked 2026-10-08 · checked by Amina Otieno');
    expect(moveSub(row({ namesAccount: false }), t)).toMatch(/· names no account$/);
    // Once decided, the line is the plain one again: how it ended is the tag's to say.
    expect(moveSub(row({ state: 'refused', namesAccount: false, checkedBy: 'Amina Otieno' }), t)).toBe('From a number ending 412 to one ending 907 · asked 2026-10-08');
  });

  it('says what the ID they typed came to — four different answers, and the wrong one in capitals', () => {
    const said = [idWords(row({ nationalId: 'matches' }), t), idWords(row({ nationalId: 'differs' }), t), idWords(row({ nationalId: 'none_on_record' }), t), idWords(row(), t)];
    expect(new Set(said).size).toBe(4);
    expect(said[1]).toContain('NOT');
    expect(said[3]).toBe('They typed none');
  });

  describe('what speaks against moving it', () => {
    it('is nothing for a driver whose ID matched and whose account has been quiet', () => {
      expect(moveWarnings(row({ nationalId: 'matches', account: account() }), t, when)).toEqual([]);
      // Before the account has been read there is nothing to say of it — not a clean bill, just nothing yet.
      expect(moveWarnings(row(), t, when)).toEqual([]);
    });

    it('leads with the PIN having been used since it was asked — that one ends the request', () => {
      const w = moveWarnings(row({ nationalId: 'differs', account: account({ pinUsedSince: '2026-10-08T10:15:00.000Z', email: 'a…@example.com' }) }), t, when);
      expect(w.map((x) => x.tone)).toEqual(['danger', 'danger', 'warn']);
      expect(w[0].text).toContain('[2026-10-08T10:15]');
      expect(w[0].text).toContain('will stop the request instead of moving the account');
      expect(w[1].text).toContain('not the one this account registered with');
      expect(w[2].text).toContain('a…@example.com');
    });

    it('says none of it once the request is over: they are things to weigh before deciding, not a verdict afterwards', () => {
      const everything = account({ pinUsedSince: '2026-10-08T10:15:00.000Z', numberChangedAt: '2026-10-08T10:20:00.000Z', email: 'a…@example.com', roles: [], nationalIdOnRecord: false });
      expect(moveWarnings(row({ state: 'checked', nationalId: 'differs', account: everything }), t, when)).toHaveLength(5);
      for (const state of ['moved', 'refused', 'stopped', 'lapsed'] as const) expect(moveWarnings(row({ state, nationalId: 'differs', account: everything }), t, when)).toEqual([]);
    });

    it('says when there is nothing to check anybody against, and when the number has just been changed already', () => {
      const sender = moveWarnings(row({ account: account({ roles: [], nationalIdOnRecord: false }) }), t, when);
      expect(sender).toHaveLength(1);
      expect(sender[0]).toMatchObject({ tone: 'warn', text: expect.stringContaining('we hold no ID for it') });
      const changed = moveWarnings(row({ account: account({ numberChangedAt: '2026-10-08T08:00:00.000Z' }) }), t, when);
      expect(changed[0].text).toContain('already changed at [2026-10-08T08:00]');
    });
  });

  it('says who is on the account: a driver and their fleet, a shop — or that it only sends and collects', () => {
    expect(roleLines(account(), t)).toEqual(['Driver: Amos K., with Kilima Logistics']);
    expect(roleLines(account({ roles: [{ role: 'driver', name: 'Otieno 064' }, { role: 'shop', name: 'Mama Sarah Shop' }] }), t)).toEqual(['Driver: Otieno 064', 'Shop: Mama Sarah Shop']);
    expect(roleLines(account({ roles: [] }), t)).toEqual(['Only sends and collects parcels']);
  });

  it('says how it ended — by whom, or that the account itself stopped it and which way', () => {
    const at = '2026-10-09T12:00:00.000Z';
    expect(endedWords(row({ state: 'moved', decidedBy: 'Brian Kamau', decidedAt: at }), t, when)).toBe('Moved — approved by Brian Kamau, [2026-10-09T12:00]');
    expect(endedWords(row({ state: 'refused', decidedBy: 'Amina Otieno', decidedAt: at }), t, when)).toBe('Refused by Amina Otieno, [2026-10-09T12:00]');
    const holder = endedWords(row({ state: 'stopped', stoppedBy: 'holder', decidedAt: at }), t, when);
    const pin = endedWords(row({ state: 'stopped', stoppedBy: 'pin', decidedAt: at }), t, when);
    expect(holder).toContain('said it was not them');
    expect(pin).toContain('PIN was used after this was asked');
    expect(holder).not.toBe(pin);
    expect(endedWords(row({ state: 'lapsed', decidedAt: at }), t, when)).toContain('nobody decided it in time');
    expect(endedWords(row(), t, when)).toBe('');
  });
});
