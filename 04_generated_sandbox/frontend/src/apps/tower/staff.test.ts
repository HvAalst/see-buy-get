import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { opensItself, staffAddWay, staffFoldHint, waitingActions, waitingLine, type StaffWaiting } from './staff';

const day = (iso: string) => iso.slice(0, 10);
const asked: StaffWaiting = { proposalId: 'spr_1', email: 'chloe@sbg.test', name: 'Chloe Wanjiru', askedBy: 'Amina Otieno', askedAt: '2026-10-11T09:00:00Z', until: '2026-10-18T09:00:00Z', mine: false };

describe('adding a member of staff takes two', () => {
  it('has somebody with their own account ask, the setup key make, and nobody ask who has nobody to approve', () => {
    expect(staffAddWay(true, 2)).toBe('ask');
    expect(staffAddWay(true, 9)).toBe('ask');
    // The only one who can sign in: a request nobody could approve is not offered.
    expect(staffAddWay(true, 1)).toBe('alone');
    expect(staffAddWay(true, 0)).toBe('alone');
    // The setup key makes — whatever the number: the server says when it may not.
    expect(staffAddWay(false, 0)).toBe('key');
    expect(staffAddWay(false, 1)).toBe('key');
    expect(staffAddWay(false, 5)).toBe('key');
  });

  it('never offers the one who asked a way to approve their own, and offers the setup key nothing', () => {
    expect(waitingActions({ mine: true }, true)).toEqual(['takeBack']);
    expect(waitingActions({ mine: false }, true)).toEqual(['approve', 'decline']);
    expect(waitingActions({ mine: false }, false)).toEqual([]);
    expect(waitingActions({ mine: true }, false)).toEqual([]);
  });

  it('arrives open only for somebody who has one to decide', () => {
    expect(opensItself([{ mine: true }, { mine: false }], true)).toBe(true);
    // Your own request is not work for you; the setup key decides nothing; and nothing waiting opens nothing.
    expect(opensItself([{ mine: true }], true)).toBe(false);
    expect(opensItself([{ mine: false }], false)).toBe(false);
    expect(opensItself([], true)).toBe(false);
  });

  it('says who asked and until when, and what the reader is to do about it', () => {
    expect(waitingLine(asked, true, t, day)).toBe('Amina Otieno asked on 2026-10-11. Approve it only if you know this person and this is their address. It waits until 2026-10-18.');
    expect(waitingLine({ ...asked, mine: true }, true, t, day)).toBe('You asked on 2026-10-11. A second member of staff approves it, and is shown the first password. It waits until 2026-10-18.');
    expect(waitingLine(asked, false, t, day)).toBe('Amina Otieno asked on 2026-10-11. A second member of staff decides, signed in with their own account. It waits until 2026-10-18.');
  });

  it('counts the ones asked for on the folded panel only when there are some', () => {
    expect(staffFoldHint(3, 0, t)).toBe('3 people on staff');
    expect(staffFoldHint(3, 2, t)).toBe('3 people on staff · 2 asked for, waiting for a second');
  });
});
