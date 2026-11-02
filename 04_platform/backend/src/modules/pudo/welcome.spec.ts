import { Test } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER, type WebPushSubscription } from './notification.types';
import { GUIDE_LINK, WELCOME, welcomeAppOf, type WelcomeApp } from './welcome';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { BusinessService } from './business.service';
import { PersonService } from './person.service';
import { MediaService } from './media.service';
import { AuthService } from '../../foundation/auth/auth.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { HandleService } from '../../foundation/handle/handle.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { MAIL_SENDER } from '../../foundation/mail/mail.types';

/*
 * 2026-11-02 — THE BELL'S FIRST NOTICE (the owner: "I want the business app to get a welcome notification with a short
 * text describing what the bell will be used for and a tooltip on how to get more out of the app"; every bell starts
 * empty). Once per inbox: what arrives in that app's bell, a tap opens where it is acted on, and its link the guide.
 */
const device = (endpoint: string): WebPushSubscription => ({ endpoint, keys: { p256dh: 'BPk_p256dh_key', auth: 'auth_secret' } });
const actor = (role: string, did: string) => ({ role, did, active: true }) as unknown as IntrospectionResult;

describe('the bell’s first notice', () => {
  let n = 0;
  const did = (app: string) => `did:${app}:${(n += 1)}-${Date.now()}`;

  it('is said once per inbox, in two sentences about this app’s bell, with the way to its guide — and never pushed', () => {
    const outbox = new OutboxPushSender();
    const notifications = new NotificationService(outbox);
    const owner = did('drv');
    notifications.subscribe(owner, 'driver', device('https://push/1'));
    expect(notifications.welcomeOnce(owner, 'driver')).toBe(true);
    expect(notifications.welcomeOnce(owner, 'driver')).toBe(false);
    const inbox = notifications.inboxFor(owner);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: 'welcome', title: WELCOME.driver.title, body: WELCOME.driver.body, link: GUIDE_LINK, data: { app: 'driver' } });
    expect(inbox[0].link).toBe('/?guide=1');
    expect(outbox.outboxFor(owner)).toEqual([]);
  });

  it('says, for each app, what arrives in its bell — and that a tap opens where it is acted on', () => {
    const says: Record<WelcomeApp, RegExp> = {
      business: /carrier taking a load, a problem on the road, a delivery, a claim answered, papers checked/,
      driver: /Loads put on you, offers near you, messages, your shift and your vehicle/,
      shop: /Parcels to take in or hand out, bags to close, money in/,
      hub: /Bags coming in and arrivals/,
      store: /shipments, and what reaches your dock/,
      fleet: /drivers, runs, orders and vehicles/,
      send: /Your parcels/,
    };
    for (const [app, words] of Object.entries(says) as Array<[WelcomeApp, RegExp]>) {
      expect(WELCOME[app].body).toMatch(words);
      expect(WELCOME[app].body).toMatch(/Tap one and it opens where you act on it\.$/);
      // Two short sentences, as every notice here is written.
      expect(WELCOME[app].body.split(/(?<=\.) /).length).toBe(2);
    }
  });

  it('knows each app by the role it signs in with — and staff read no bell', () => {
    expect(['business', 'driver', 'agent', 'mdp', 'genesis', 'fleet_manager', 'consumer'].map(welcomeAppOf)).toEqual(['business', 'driver', 'shop', 'hub', 'store', 'fleet', 'send']);
    expect(welcomeAppOf('operator')).toBeNull();
    expect(welcomeAppOf(undefined)).toBeNull();
  });

  it('is found at the first read of the bell after signing in, once, in every app', () => {
    const notifications = new NotificationService(new OutboxPushSender());
    const bell = new NotificationsController(notifications);
    for (const role of ['driver', 'agent', 'mdp', 'genesis', 'fleet_manager', 'consumer', 'business']) {
      const owner = did(role);
      const first = bell.inbox(actor(role, owner));
      expect(first.items.map((x) => x.kind)).toEqual(['welcome']);
      expect(first.unread).toBe(1);
      const again = bell.inbox(actor(role, owner));
      expect(again.items).toHaveLength(1);
    }
  });

  it('a business set up before the bell had a welcome is welcomed at its people’s next read — once, beside what it has', async () => {
    const notifications = new NotificationService(new OutboxPushSender());
    const bell = new NotificationsController(notifications);
    const biz = did('biz');
    await notifications.notify(biz, { kind: 'freight_delivered', title: 'FRT-1 was delivered', body: 'Handed over.', link: '/?load=frt_1' });
    expect(bell.inbox(actor('business', biz)).items.map((x) => x.kind).sort()).toEqual(['freight_delivered', 'welcome']);
    expect(bell.inbox(actor('business', biz)).items).toHaveLength(2);
  });

  it('a business is welcomed the day it is set up', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BusinessService, PersonService, MediaService, AuthService, DidService, EntityService, CompanyDocumentService, HandleService,
        IdentityVault, OperationalStore, FieldEncryption, EventBus, LedgerService, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender },
        NotificationService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender },
      ],
    }).compile();
    moduleRef.get(EntityService).seed();
    const persons = moduleRef.get(PersonService);
    const notifications = moduleRef.get(NotificationService);
    const person = persons.ensurePerson(`+25191199${String(Date.now()).slice(-4)}`);
    persons.setPin(person.personDid, '48261');
    const { entity } = moduleRef.get(BusinessService).create(person.personDid, { name: `Welcome Trading ${Date.now()}`, country: 'ET', registrationNo: `REG-W-${Date.now()}`, activities: ['shipper'], yourName: 'Abebe Kebede' });
    expect(notifications.inboxFor(entity.did).map((x) => x.kind)).toEqual(['welcome']);
    expect(notifications.inboxFor(entity.did)[0].title).toBe(WELCOME.business.title);
    // Its people's first read of the bell finds the same one, not a second.
    expect(new NotificationsController(notifications).inbox(actor('business', entity.did)).items).toHaveLength(1);
  });
});
