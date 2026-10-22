import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PersonService } from '../src/modules/pudo/person.service';
import { AgentService } from '../src/modules/pudo/agent.service';
import { AccountClosingService } from '../src/modules/pudo/account-closing.service';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';
import { IdentityVault } from '../src/foundation/data-firewall/identity-vault.service';
import { DidService } from '../src/foundation/did/did.service';

/**
 * CLOSING AN ACCOUNT, OVER THE WIRE (the user, 2026-10-22: "After it is inactive for 48 months the account owner will be
 * informed that his inactive account can be closed"; the owner closes it, only when nothing is open, and closing removes
 * personal details only). Held to here: nobody can close before they were told; the notice goes once, in the app and by
 * email; something open refuses the close and says what; the close needs the PIN; and after it the name, ID number, phone,
 * email and photographs are gone — the numbers free for somebody else — while the shop's record stays, locked.
 */
describe('closing an account — over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '58213';
  const FIVE_YEARS_AGO = new Date(Date.now() - 5 * 365 * 86_400_000).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** An approved shop, its owner with a PIN and a recovery email, signed in as themselves. */
  async function anOwner() {
    const u = digits();
    const mobile = `+2547${u}7`;
    const nationalId = `ID-CLOSE-${u}`;
    const hours = { open: '08:00', close: '18:00' };
    const body = (shopName: string) => ({
      shopName, zone: `Close${u}`, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
      openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
      fullName: 'Amani Closing', nationalId, mobile, deviceImei: `IMEI-CLOSE-${u}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${u}`, criminalRecordClear: true },
    });
    const did = (await http().post('/v1/sbg/agents').set(staff).send(body('Duka la Kufunga')).expect(201)).body.did as string;
    const shopToken = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(shopToken).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    const idCopy = await photo('kyc_id');
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(shopToken).send({ idCopyRef: idCopy, tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    const persons = app.get(PersonService);
    const person = persons.attachRole(mobile, 'agent', did);
    persons.setPin(person.personDid, PIN);
    const email = `closing.${u}@example.com`;
    persons.setEmail(person.personDid, email);
    const owner = bearer(persons.mintConsumerToken(person).access_token);
    // Time passes: four years and more without a sign-in. (A sign-in cannot be backdated over the wire.)
    const record = persons.findByDid(person.personDid)!;
    record.lastSignInAt = FIVE_YEARS_AGO;
    record.createdAt = FIVE_YEARS_AGO;
    return { did, shopToken, owner, personDid: person.personDid, mobile, nationalId, email, idCopy, body };
  }

  it('cannot be closed before its owner is told; the notice goes once, in the app and by email', async () => {
    const a = await anOwner();
    const closing = app.get(AccountClosingService);
    // Not told yet: nothing to close, and closing is refused.
    app.get(PersonService).findByDid(a.personDid)!.lastSignInAt = new Date().toISOString();
    expect((await http().get('/v1/sbg/account/closing').set(a.owner).expect(200)).body).toEqual({ open: [] });
    expect((await http().post('/v1/sbg/account/close').set(a.owner).send({ pin: PIN }).expect(400)).body).toMatchObject({ params: { reason: 'not_closable' } });
    await closing.sweep();
    expect(app.get(PersonService).findByDid(a.personDid)!.closableSince).toBeUndefined();

    // Four years and more: told — in the app, as themselves and as their shop, and by email.
    app.get(PersonService).findByDid(a.personDid)!.lastSignInAt = FIVE_YEARS_AGO;
    await closing.sweep();
    const since = app.get(PersonService).findByDid(a.personDid)!.closableSince;
    expect(since).toEqual(expect.any(String));
    const inbox = app.get(NotificationService);
    for (const owner of [a.personDid, a.did]) expect(inbox.inboxFor(owner).map((n) => n.title)).toContain('Your account can be closed');
    expect(app.get(OutboxMailSender).recent(a.email).map((m) => m.template)).toContain('account-may-close');
    // Once: the next look tells nobody again.
    const before = app.get(OutboxMailSender).recent(a.email).length;
    await closing.sweep();
    expect(app.get(OutboxMailSender).recent(a.email).length).toBe(before);
    // Settings now says it can be closed, and that nothing is open.
    expect((await http().get('/v1/sbg/account/closing').set(a.owner).expect(200)).body).toEqual({ closableSince: since, open: [] });
  });

  it('something open refuses the close, and says what', async () => {
    const a = await anOwner();
    // They also run a sort hub: SeeBuyGet staff take a hub off the network before its owner can go.
    app.get(PersonService).attachRole(a.mobile, 'mdp', `did:glos:close-hub-${digits()}`);
    await app.get(AccountClosingService).sweep();
    const standing = (await http().get('/v1/sbg/account/closing').set(a.owner).expect(200)).body;
    expect(standing.open).toEqual([{ kind: 'hub', count: 1 }]);
    const refused = await http().post('/v1/sbg/account/close').set(a.owner).send({ pin: PIN }).expect(400);
    expect(refused.body).toMatchObject({ params: { reason: 'still_open', open: [{ kind: 'hub', count: 1 }] } });
    expect(app.get(PersonService).findByDid(a.personDid)!.closedAt).toBeUndefined();
  });

  it('closes with the PIN: personal details gone, the numbers free again, the shop locked and kept', async () => {
    const a = await anOwner();
    await app.get(AccountClosingService).sweep();
    const persons = app.get(PersonService);
    const agents = app.get(AgentService);
    const vaultRef = agents.get(a.did).vaultRef as string;
    const personVault = persons.findByDid(a.personDid)!.vaultRef as string;
    expect(app.get(IdentityVault).exists(vaultRef)).toBe(true);

    // The wrong PIN changes nothing.
    await http().post('/v1/sbg/account/close').set(a.owner).send({ pin: '97531' }).expect(403);
    expect(persons.findByDid(a.personDid)!.closedAt).toBeUndefined();

    const closed = await http().post('/v1/sbg/account/close').set(a.owner).send({ pin: PIN }).expect(201);
    expect(closed.body.closedAt).toEqual(expect.any(String));
    // Told on the way out, at the address that then goes.
    expect(app.get(OutboxMailSender).recent(a.email).some((m) => m.template === 'account-safety')).toBe(true);

    // Every session is over.
    await http().get('/v1/sbg/account/me').set(a.owner).expect(401);
    // The person: kept under a key that is nobody's number, with nothing of theirs in it.
    const person = persons.findByDid(a.personDid)!;
    expect(person).toMatchObject({ closedAt: closed.body.closedAt, phoneHash: `closed:${a.personDid}` });
    expect([person.vaultRef, person.emailHash, person.pinHash, person.avatarMediaId]).toEqual([undefined, undefined, undefined, undefined]);
    expect(persons.findByPhone(a.mobile)).toBeUndefined();
    expect(persons.findByEmail(a.email)).toBeUndefined();
    expect(app.get(IdentityVault).exists(personVault)).toBe(false);
    // The shop: locked, its owner's name, ID and phone gone from the vault, the ID photograph gone, the DID nobody's.
    const shop = agents.get(a.did);
    expect([shop.status, shop.deviceImei]).toEqual(['LOCKED', '']);
    expect(app.get(IdentityVault).exists(vaultRef)).toBe(false);
    await http().get(`/v1/sbg/media/${a.idCopy}`).set(staff).expect(404);
    expect(app.get(DidService).resolve(a.did)?.controller).toBe(`closed:${a.did}`);
    // Off the map, and never offered for a new parcel.
    const points = (await http().get('/v1/sbg/network/points').expect(200)).body as Array<{ did: string }>;
    expect(points.find((p) => p.did === a.did)).toBeUndefined();

    // The numbers are free: somebody can register with the same national ID and phone, and the phone is a new account.
    const reg = await http().post('/v1/sbg/agents').set(staff).send(a.body('Duka Jipya'));
    expect([reg.status, reg.body.detail ?? '']).toEqual([201, '']);
    const again = persons.attachRole(a.mobile, 'consumer', '');
    expect(again.personDid).not.toBe(a.personDid);

    // Closing again changes nothing (and nobody is signed in as it to ask).
    expect(app.get(AccountClosingService).standing(a.personDid)).toEqual({ open: [] });
  });
});
