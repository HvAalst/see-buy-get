import { Test } from '@nestjs/testing';
import { OperatorAccountService } from './operator-account.service';
import { AuthService } from '../auth/auth.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { OperationalStore } from '../data-firewall/operational-store.service';

/**
 * Network staff, one account each — so that "a different person must approve this" is about people, not about
 * two names typed beside one shared key.
 */
describe('network staff accounts', () => {
  let staff: OperatorAccountService;
  let auth: AuthService;
  const email = (n: string) => `${n}-${Math.random().toString(36).slice(2, 8)}@sbg.test`;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [OperatorAccountService, AuthService, DidService, LedgerService, EventBus, OperationalStore, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    staff = moduleRef.get(OperatorAccountService);
    auth = moduleRef.get(AuthService);
  });

  it('signs a person in as an operator whose token carries the name the account was created with', () => {
    const made = staff.create({ email: email('amina'), name: 'Amina Otieno' }, 'setup key');
    expect(made.temporaryPassword).toHaveLength(12);
    const { token } = staff.login(made.email, made.temporaryPassword);
    expect(auth.introspect(token.access_token)).toMatchObject({ active: true, role: 'operator', actorName: 'Amina Otieno', scopes: ['*'] });
  });

  it('never shows a hash, refuses a second account on one email, and names neither half of a failed login', () => {
    const made = staff.create({ email: email('brian'), name: 'Brian' }, 'setup key');
    expect(JSON.stringify(staff.list())).not.toMatch(/hash|salt|temporaryPassword/);
    expect(() => staff.create({ email: made.email.toUpperCase(), name: 'Brian again' }, 'setup key')).toThrow(/already has a staff account/);
    expect(() => staff.login(made.email, 'not-it')).toThrow('Wrong email or password');
    expect(() => staff.login('nobody@sbg.test', 'not-it')).toThrow('Wrong email or password');
  });

  it('ends that person’s other sessions when they change their password, and nobody else’s', () => {
    const a = staff.create({ email: email('a'), name: 'A' }, 'setup key');
    const b = staff.create({ email: email('b'), name: 'B' }, 'setup key');
    const aLaptop = staff.login(a.email, a.temporaryPassword).token.access_token;
    const bLaptop = staff.login(b.email, b.temporaryPassword).token.access_token;
    expect(() => staff.changePassword(a.email, a.temporaryPassword, 'short')).toThrow(/at least 10/);
    staff.changePassword(a.email, a.temporaryPassword, 'a-long-new-password');
    expect(auth.introspect(aLaptop)).toMatchObject({ active: false, reason: 'revoked' });
    expect(auth.introspect(bLaptop).active).toBe(true);
    expect(auth.introspect(staff.login(a.email, 'a-long-new-password').token.access_token).active).toBe(true);
  });

  it('revokes a login at once, and keeps the record', () => {
    const leaver = staff.create({ email: email('leaver'), name: 'Leaver' }, 'setup key');
    const session = staff.login(leaver.email, leaver.temporaryPassword).token.access_token;
    const revoked = staff.revoke(leaver.operatorId, 'Amina Otieno');
    expect(revoked.revokedAt).toBeDefined();
    expect(auth.introspect(session)).toMatchObject({ active: false, reason: 'revoked' });
    expect(() => staff.login(leaver.email, leaver.temporaryPassword)).toThrow('Wrong email or password');
    expect(staff.list().some((a) => a.operatorId === leaver.operatorId)).toBe(false);
  });
});
