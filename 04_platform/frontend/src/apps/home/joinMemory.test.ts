import { describe, expect, it } from 'vitest';
import { EMPTY_JOIN, roleById, type JoinKind } from './logic';
import { JOIN_KEPT_MS, joinRestored, joinSnapshot } from './joinMemory';

/*
 * The owner, 2026-11-01: "when I have to switch apps, from chrome on mobile to mail, to fetch the security code to
 * confirm my email, the sbg page is refreshed and I can't write the code from the earlier email".
 */
const kindOf = (id: string): JoinKind | null => roleById(id)?.kind ?? null;
const T0 = Date.UTC(2026, 10, 1, 9, 0);

describe('a sign-up kept through a reload', () => {
  it('keeps the step and what was typed — never the PIN, a password or a code', () => {
    const form = { ...EMPTY_JOIN, phone: '+31653568351', country: 'NL', displayName: 'Central Sort', pin: '48261', password: 'hunter22', code: '123456', recoveryEmail: 'me@example.com', recoveryCode: '654321' };
    const kept = joinSnapshot({ screen: 'join', roleId: 'mdp', step: 'login', form, pinEmail: 'first' }, T0)!;
    expect(kept).toMatchObject({ roleId: 'mdp', step: 'login', pinEmail: 'first', at: T0 });
    expect(kept.form).toMatchObject({ phone: '+31653568351', country: 'NL', displayName: 'Central Sort', recoveryEmail: 'me@example.com' });
    for (const secret of ['pin', 'password', 'code', 'recoveryCode']) expect(kept.form).not.toHaveProperty(secret);
  });

  it('keeps nothing once the sign-up is done or left', () => {
    expect(joinSnapshot({ screen: 'join', roleId: 'mdp', step: 'done', form: EMPTY_JOIN, pinEmail: null }, T0)).toBeNull();
    expect(joinSnapshot({ screen: 'roles', roleId: 'mdp', step: 'about', form: EMPTY_JOIN, pinEmail: null }, T0)).toBeNull();
  });

  it('puts them back where they were, for half an hour', () => {
    const kept = joinSnapshot({ screen: 'join', roleId: 'driver', step: 'pin', form: { ...EMPTY_JOIN, recoveryEmail: 'me@example.com' }, pinEmail: 'first' }, T0);
    expect(joinRestored(kept, kindOf, T0 + 5 * 60_000)).toMatchObject({ roleId: 'driver', step: 'pin', pinEmail: 'first', form: { recoveryEmail: 'me@example.com' } });
    expect(joinRestored(kept, kindOf, T0 + JOIN_KEPT_MS + 1)).toBeNull();
    expect(joinRestored(null, kindOf, T0)).toBeNull();
  });

  it('starts a step that needs them signed in at the PIN again: the sign-in is never kept', () => {
    const at = (roleId: string, step: 'about' | 'where' | 'papers') => joinRestored(joinSnapshot({ screen: 'join', roleId, step, form: EMPTY_JOIN, pinEmail: null }, T0), kindOf, T0 + 60_000)?.step;
    expect(at('fleet', 'papers')).toBe('pin');
    expect(at('fleet', 'about')).toBe('pin');
    expect(at('driver', 'papers')).toBe('pin');
    // Before the PIN nothing needs the sign-in: put back exactly there.
    expect(at('driver', 'where')).toBe('where');
    expect(at('pudo', 'about')).toBe('about');
  });
});
