import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { looksLikeReference, moveStatusSays, supportLines, type MoveState, type MoveStatus } from './move';

const status = (state: MoveState, over: Partial<MoveStatus> = {}): MoveStatus => ({ state, askedAt: '2026-10-08T09:00:00.000Z', ...over });
const STATES: MoveState[] = ['asked', 'checked', 'moved', 'refused', 'stopped', 'lapsed'];

/*
 * The person this is for has no number, no PIN and no inbox: nothing we send reaches them. What they learn, they
 * learn by coming back with a reference — so every state has to say where it stands AND what to do next.
 */
describe('asking staff to move an account, as the asker is told', () => {
  it('has its own words for every state, and none of them is a key or left blank', () => {
    const said = STATES.map((s) => moveStatusSays(status(s, { lapsesAt: '2026-10-22T09:00:00.000Z', reason: 'x' }), t as never));
    expect(new Set(said.map((x) => x.title)).size).toBe(STATES.length);
    for (const x of said) {
      expect(x.title).not.toMatch(/account\.move/);
      expect(x.lines.length).toBeGreaterThan(0);
      for (const line of x.lines) expect(line).not.toMatch(/account\.move|\{[a-z]+\}/);
    }
  });

  it('says who it waits on while it waits — and that is not a reason to ask again', () => {
    const asked = moveStatusSays(status('asked', { lapsesAt: '2026-10-22T09:00:00.000Z' }), t as never);
    expect(asked).toMatchObject({ tone: 'info', canAskAgain: false });
    expect(asked.lines[0]).toContain('give them your reference');
    const checked = moveStatusSays(status('checked', { lapsesAt: '2026-10-22T09:00:00.000Z' }), t as never);
    expect(checked.lines[0]).toContain('A second member of staff has to approve');
    expect(checked.canAskAgain).toBe(false);
  });

  it('says how to get in once it is moved: the new number, a code, a new PIN', () => {
    const moved = moveStatusSays(status('moved', { decidedAt: '2026-10-09T09:00:00.000Z' }), t as never);
    expect(moved).toMatchObject({ tone: 'ok', icon: 'check', canAskAgain: false });
    expect(moved.lines.join(' ')).toMatch(/Sign in with the new number.*forgot your PIN.*choose a new PIN/);
  });

  it('gives staff’s reason for a refusal in their own words — and says nothing where they gave none', () => {
    const refused = moveStatusSays(status('refused', { reason: 'Bring your ID to an office.' }), t as never);
    expect(refused.lines).toEqual(['They said: “Bring your ID to an office.”', 'You can ask again.']);
    expect(refused.canAskAgain).toBe(true);
    expect(moveStatusSays(status('refused'), t as never).lines).toEqual(['You can ask again.']);
  });

  it('says what "stopped" means, and what is still open to somebody who can sign in after all', () => {
    const stopped = moveStatusSays(status('stopped'), t as never);
    expect(stopped.tone).toBe('warn');
    expect(stopped.lines[0]).toContain('move the number yourself: Settings, then Phone number');
    expect(moveStatusSays(status('lapsed'), t as never).canAskAgain).toBe(true);
  });

  it('says who to speak to as the company wrote it — and something useful when it wrote nothing', () => {
    expect(supportLines({ company: 'SeeBuyGet Kenya', contactName: 'The help desk', phone: '+254 20 555 0100', phoneAlt: '+254 700 000 100', email: 'help@sbg-ke.example', hours: 'Mon–Sat 8–18' }, t as never)).toEqual([
      'SeeBuyGet Kenya — The help desk',
      'Telephone +254 20 555 0100 / +254 700 000 100',
      'Email help@sbg-ke.example',
      'Mon–Sat 8–18',
    ]);
    expect(supportLines({ company: 'SeeBuyGet Kenya', email: 'help@sbg-ke.example' }, t as never)).toEqual(['SeeBuyGet Kenya', 'Email help@sbg-ke.example']);
    const none = supportLines(undefined, t as never);
    expect(none).toHaveLength(1);
    expect(none[0]).toContain('Take your reference');
  });

  it('knows what could be a reference, however it was typed — so a slip is caught before it is asked about', () => {
    for (const ok of ['MV-ABCD-2345', 'mv-abcd-2345', 'ABCD2345', ' mv abcd 2345 ', 'MVABCD2345']) expect(looksLikeReference(ok)).toBe(true);
    for (const not of ['', 'MV-ABCD', 'MV-ABCD-23456', 'ABCD-234', 'hello']) expect(looksLikeReference(not)).toBe(false);
  });
});
