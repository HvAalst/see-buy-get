import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { linkWords, opensItself, passwordBlocker, staffAddWay, staffFoldHint, staffListOf, waitingActions, waitingLine, welcomeTokenFrom, type StaffWaiting } from './staff';

const day = (iso: string) => iso.slice(0, 10);
const asked: StaffWaiting = { proposalId: 'spr_1', email: 'chloe@sbg.test', name: 'Chloe Wanjiru', askedBy: 'Amina Otieno', askedAt: '2026-10-11T09:00:00Z', until: '2026-10-18T09:00:00Z', mine: false, forSetupKey: false };

describe('adding a member of staff takes two people', () => {
  it('has somebody with their own account ask, and the setup key make', () => {
    expect(staffAddWay(true)).toBe('ask');
    expect(staffAddWay(false)).toBe('key');
  });

  it('never offers the one who asked a way to approve their own', () => {
    expect(waitingActions({ mine: true }, true)).toEqual(['takeBack']);
    expect(waitingActions({ mine: true, forSetupKey: true }, true)).toEqual(['takeBack']);
    expect(waitingActions({ mine: false }, true)).toEqual(['approve', 'decline']);
  });

  it('offers the setup key an approval only where there is no colleague to give it — and nothing else, ever', () => {
    expect(waitingActions({ mine: false, forSetupKey: true }, false)).toEqual(['approve']);
    expect(waitingActions({ mine: false, forSetupKey: false }, false)).toEqual([]);
    expect(waitingActions({ mine: false }, false)).toEqual([]);
    expect(waitingActions({ mine: true }, false)).toEqual([]);
  });

  it('arrives open only for somebody who has one to approve', () => {
    expect(opensItself([{ mine: true }, { mine: false }], true)).toBe(true);
    expect(opensItself([{ mine: false, forSetupKey: true }], false)).toBe(true);
    // Your own request is not work for you; the setup key is nobody's second where a colleague is; nothing opens nothing.
    expect(opensItself([{ mine: true }], true)).toBe(false);
    expect(opensItself([{ mine: true, forSetupKey: true }], true)).toBe(false);
    expect(opensItself([{ mine: false }], false)).toBe(false);
    expect(opensItself([], true)).toBe(false);
  });

  it('says who asked and until when, and what the reader is to do about it', () => {
    expect(waitingLine(asked, true, t, day)).toBe('Amina Otieno asked on 2026-10-11. Approve it only if you know this person and this is their address. It waits until 2026-10-18.');
    expect(waitingLine({ ...asked, mine: true }, true, t, day)).toBe('You asked on 2026-10-11. A second member of staff approves it. It waits until 2026-10-18.');
    expect(waitingLine(asked, false, t, day)).toBe('Amina Otieno asked on 2026-10-11. A second member of staff decides, signed in with their own account. It waits until 2026-10-18.');
  });

  it('says so when the only possible second is the setup key — to the one who asked, and to whoever holds the key', () => {
    const lone = { ...asked, forSetupKey: true };
    expect(waitingLine({ ...lone, mine: true }, true, t, day)).toBe('You asked on 2026-10-11. You are the only one who can sign in, so the setup key approves this one. It waits until 2026-10-18.');
    expect(waitingLine(lone, false, t, day)).toBe('Amina Otieno asked on 2026-10-11 and is the only one who can sign in, so the setup key is their second. Approve it only if you know this person and this is their address. It waits until 2026-10-18.');
  });

  it('counts the ones asked for on the folded panel only when there are some', () => {
    expect(staffFoldHint(3, 0, t)).toBe('3 people on staff');
    expect(staffFoldHint(3, 2, t)).toBe('3 people on staff · 2 asked for, waiting for a second');
  });
});

describe('the staff list, and whether it is all the caller reaches', () => {
  it('shows the setup key its one screen only when the server says that is all it has', () => {
    expect(staffListOf({ items: [{ operatorId: 'opr_1' }], waiting: [asked], setupOnly: true })).toEqual({ items: [{ operatorId: 'opr_1' }], waiting: [asked], setupOnly: true });
    // On a laptop, and from a server that predates it, nothing is said: the whole console is the key's, as before.
    expect(staffListOf({ items: [], waiting: [] }).setupOnly).toBe(false);
    // Only the server's plain yes counts — not a word that merely looks like one.
    for (const not of ['true', 1, {}, null, undefined, false]) expect([not, staffListOf({ items: [], waiting: [], setupOnly: not }).setupOnly]).toEqual([not, false]);
    // Nothing at all, or something that is not a list: an empty list, never a crash.
    for (const nothing of [undefined, null, {}, { items: 'x', waiting: 3 }]) expect(staffListOf(nothing)).toEqual({ items: [], waiting: [], setupOnly: false });
  });
});

describe('the link a new member of staff is emailed', () => {
  const now = Date.parse('2026-10-11T09:00:00Z');

  it('is read off the address only when it is one: after the #, a token and nothing else', () => {
    const token = 'kJ3_x-9Qa7ZpL0vT2mN5bR8cWfYhUeGd';
    expect(welcomeTokenFrom(`#welcome=${token}`)).toBe(token);
    expect(welcomeTokenFrom(` #welcome=${token} `)).toBe(token);
    for (const not of ['', undefined, '#', '#welcome=', '#welcome=short', `#other=${token}`, `#welcome=${token}&x=1`, `#welcome=${token}/../x`, `welcome=${token}`]) expect([not, welcomeTokenFrom(not)]).toEqual([not, null]);
  });

  it('says what is wrong with a password typed twice before the server is asked', () => {
    expect(passwordBlocker('nine-char', 'nine-char')).toBe('tower.welcome.needTen');
    expect(passwordBlocker('ten-chars!', 'ten-chars?')).toBe('tower.welcome.noMatch');
    expect(passwordBlocker('ten-chars!', 'ten-chars!')).toBeNull();
  });

  it('says until when the link works, and that it has lapsed once it has', () => {
    expect(linkWords('2026-10-13T09:00:00Z', now, t, day)).toBe('The link in their email works until 2026-10-13.');
    expect(linkWords('2026-10-11T09:00:00Z', now, t, day)).toBe('The link in their email has lapsed.');
    expect(linkWords('2026-10-10T09:00:00Z', now, t, day)).toBe('The link in their email has lapsed.');
  });
});
