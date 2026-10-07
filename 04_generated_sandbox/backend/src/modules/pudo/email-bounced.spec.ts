import { Test } from '@nestjs/testing';
import { AuthService } from '../../foundation/auth/auth.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { DidService } from '../../foundation/did/did.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { MailBounces, SOFT_BOUNCE_PAUSE_H } from '../../foundation/mail/mail-bounces.service';
import { MailService } from '../../foundation/mail/mail.service';
import { MAIL_SENDER } from '../../foundation/mail/mail.types';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { EmailCodeService } from './email-code.service';
import { MediaService } from './media.service';
import { PersonService } from './person.service';

/*
 * THE PERSON WHOSE EMAIL CAME BACK. A recovery email is the one way to reach somebody who has lost their phone — and
 * when it stops working nobody knows: not us (until the provider says), and not them. So when the provider says an
 * address came back for good, its owner is told in their own app, on the row where the address is — and the way out
 * is the one they would use anyway: confirm it again with a code, or replace it.
 *
 * On the real person, code and mail services, wired as the app wires them.
 */
describe('a recovery email that came back', () => {
  let persons: PersonService;
  let bounces: MailBounces;
  let codes: EmailCodeService;
  let seq = 0;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PersonService, MediaService, AuthService, DidService, IdentityVault, OperationalStore, FieldEncryption, EventBus, LedgerService, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }, EmailCodeService, MailService, MailBounces, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender }],
    }).compile();
    persons = moduleRef.get(PersonService);
    bounces = moduleRef.get(MailBounces);
    codes = moduleRef.get(EmailCodeService);
  });

  const aPerson = (email?: string) => {
    seq += 1;
    const person = persons.ensurePerson(`+2519130${String(seq).padStart(5, '0')}`);
    persons.setPin(person.personDid, '4826');
    if (email) persons.setEmail(person.personDid, email);
    return person.personDid;
  };
  const view = (did: string) => persons.view(persons.requireByDid(did));

  it('is said to its owner, and to nobody else — from the address’s key, the address itself being kept nowhere to read', () => {
    const amina = aPerson('amina@kilima.co.ke');
    const brian = aPerson('brian@kilima.co.ke');
    expect(view(amina).emailBounced).toBeUndefined();

    bounces.record('Amina@Kilima.co.ke', 'hard', 'bad-mailbox');

    expect(view(amina)).toMatchObject({ emailBounced: true, email: expect.stringContaining('@kilima.co.ke') });
    expect(view(brian).emailBounced).toBeUndefined();
    // Somebody with no email on record has nothing to be told about.
    expect(view(aPerson()).emailBounced).toBeUndefined();
  });

  it('is not said for a bounce that clears by itself: a full mailbox is not a broken address', () => {
    const amina = aPerson('amina2@kilima.co.ke');
    bounces.record('amina2@kilima.co.ke', 'soft', 'mailbox-full');
    expect(bounces.stopped('amina2@kilima.co.ke')).toBe('soft');
    expect(view(amina).emailBounced).toBeUndefined();
    expect(SOFT_BOUNCE_PAUSE_H).toBe(24);
  });

  it('stops being said the moment they read a code sent there and type it in: the address works', () => {
    const amina = aPerson('amina3@kilima.co.ke');
    bounces.record('amina3@kilima.co.ke', 'hard', undefined);
    expect(view(amina).emailBounced).toBe(true);

    const { code } = codes.request('amina3@kilima.co.ke');
    // A wrong code proves nothing.
    expect(() => codes.verify('amina3@kilima.co.ke', code === '000000' ? '111111' : '000000')).toThrow();
    expect(view(amina).emailBounced).toBe(true);
    codes.verify('Amina3@kilima.co.ke', code);

    expect(view(amina).emailBounced).toBeUndefined();
    expect(bounces.stopped('amina3@kilima.co.ke')).toBeUndefined();
  });

  it('stops being said when they replace the address — and the old one stays stopped for whoever is written to there next', () => {
    const amina = aPerson('amina4@kilima.co.ke');
    bounces.record('amina4@kilima.co.ke', 'hard', undefined);
    persons.setEmail(amina, 'amina.new@kilima.co.ke');
    expect(view(amina).emailBounced).toBeUndefined();
    expect(bounces.stopped('amina4@kilima.co.ke')).toBe('hard');
    expect(bounces.stopped('amina.new@kilima.co.ke')).toBeUndefined();
  });
});
