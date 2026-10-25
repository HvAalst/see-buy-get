import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { PersonService } from '../src/modules/pudo/person.service';
import { MailService } from '../src/foundation/mail/mail.service';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';
import { MAIL_TEMPLATES } from '../src/foundation/mail/mail.templates';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { AGREED } from './agreed';

/**
 * AN ACCOUNT MUTED BY ITS OWNER, OVER THE WIRE (the user, 2026-10-22: "an account can be muted by the user"; it rests,
 * and can still read). The owner mutes from Settings; their shop leaves the map and no new parcel starts there or names
 * it; email beyond codes and their own safety waits; they read everything as before; and unmuting brings it all back.
 * Every sign-in is noted, the day it happened: it is what the 48 months are counted from.
 */
describe('an account at rest — over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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

  /** A trading shop, and the person who owns it signed in as themselves. */
  async function anOwnedShop(shopName: string) {
    const u = digits();
    const mobile = `+2547${u}8`;
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(staff)
      .send({
        shopName, zone: `Rest${u}`, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-REST-${u}`, mobile, deviceImei: `IMEI-REST-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${u}`, criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const shopToken = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    let n = 0;
    const photograph = async (kind: string) => {
      n += 1;
      const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}:${n}`)]).toString('base64')}`;
      return (await http().post('/v1/sbg/media').set(shopToken).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
    };
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(shopToken).send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: await photograph('kyc_licence'), shopPhotoRefs: [await photograph('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/deposit`).set(staff).expect(201);
    await http().post(`/v1/sbg/agents/${did}/top-up`).set(staff).send({ amount: 50 });
    declared(app, 'shop', did);
    // The person behind the shop — as a shop's own sign-up links them — signed in as themselves.
    const persons = app.get(PersonService);
    const person = persons.attachRole(mobile, 'agent', did);
    const owner = bearer(persons.mintConsumerToken(person).access_token);
    return { did, shopToken, owner, personDid: person.personDid };
  }

  const point = async (did: string) => ((await http().get('/v1/sbg/network/points').expect(200)).body as Array<{ did: string; takesNew: boolean }>).find((p) => p.did === did);

  it('the owner mutes: the shop leaves the map and starts nothing new; codes and safety still reach them; unmuting brings it back', async () => {
    const shop = await anOwnedShop('Duka la Kupumzika');
    const persons = app.get(PersonService);
    expect(await point(shop.did)).toMatchObject({ takesNew: true });

    // Every sign-in is noted, by the day.
    expect(persons.findByDid(shop.personDid)?.lastSignInAt?.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));

    // Nobody mutes an account they are not signed in as.
    await http().post('/v1/sbg/account/mute').expect(401);
    const muted = await http().post('/v1/sbg/account/mute').set(shop.owner).expect(201);
    expect(muted.body.mutedAt).toEqual(expect.any(String));
    expect((await http().get('/v1/sbg/account/me').set(shop.owner).expect(200)).body.mutedAt).toBe(muted.body.mutedAt);
    // Muting again changes nothing.
    expect((await http().post('/v1/sbg/account/mute').set(shop.owner).expect(201)).body.mutedAt).toBe(muted.body.mutedAt);

    // Off the map; and no new parcel starts at its counter.
    expect(await point(shop.did)).toBeUndefined();
    const walkUp = await http()
      .post('/v1/sbg/parcels/accept')
      .set(shop.shopToken)
      .send({ agentDid: shop.did, parcelId: `REST-${digits()}`, size: 'S', destZone: 'Elsewhere', senderMobile: '+254700000611', receiverMobile: '+254700000612', paymentMode: 'prepaid', dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop.did) });
    expect(walkUp.status).toBe(403);
    expect(walkUp.body).toMatchObject({ params: { reason: 'shop_resting' } });
    expect(walkUp.body.detail).toMatch(/its owner muted the account/);
    // They still read their own shop.
    await http().get(`/v1/sbg/agents/${shop.did}`).set(shop.shopToken).expect(200);

    // Email: a reminder waits; their own safety, and a code, still go.
    const address = `rest.${digits()}@example.com`;
    persons.setEmail(shop.personDid, address);
    const mail = app.get(MailService);
    const sent = () => app.get(OutboxMailSender).recent(address).map((m) => m.template);
    await mail.send('papers-due', { address, name: 'Owner' }, MAIL_TEMPLATES['papers-due'].sample);
    await mail.send('account-safety', { address, name: 'Owner' }, MAIL_TEMPLATES['account-safety'].sample);
    await mail.send('email-code', { address, name: 'Owner' }, MAIL_TEMPLATES['email-code'].sample);
    expect(sent()).toEqual(expect.arrayContaining(['account-safety', 'email-code']));
    expect(sent()).not.toContain('papers-due');

    // Unmuted: on the map and taking parcels again, at once; the reminder goes again.
    const awake = await http().post('/v1/sbg/account/unmute').set(shop.owner).expect(201);
    expect(awake.body.mutedAt).toBeUndefined();
    expect(await point(shop.did)).toMatchObject({ takesNew: true });
    await mail.send('papers-due', { address, name: 'Owner' }, MAIL_TEMPLATES['papers-due'].sample);
    expect(sent()).toContain('papers-due');
  });

  it('a muted owner’s store takes no new order, and their driver is offered no load — until they unmute', async () => {
    const shop = await anOwnedShop('Duka la Mpokeaji');
    const ownerPhone = `+2547${digits()}9`;
    const store = (await http().post('/v1/sbg/vendors').send({ ...AGREED, name: 'Mfano Online', country: 'KE', ownerPhone }).expect(201)).body as { vendorId: string; secret: string };
    const storeToken = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: store.vendorId, secret: store.secret }).expect(201)).body.token.access_token);
    const persons = app.get(PersonService);
    const owner = persons.findByPhone(ownerPhone)!;
    const ownerToken = bearer(persons.mintConsumerToken(owner).access_token);
    // The same person drives too.
    const driverDid = `did:glos:rest-driver-${digits()}`;
    persons.attachRole(ownerPhone, 'driver', driverDid);
    const fleet = app.get(FleetService);
    const checkout = () => http().post(`/v1/sbg/vendors/${store.vendorId}/checkout`).set(storeToken).send({ destPudoDid: shop.did, buyerEmail: 'buyer@example.com' });

    await checkout().expect(201);
    expect(fleet.acceptingWork(driverDid)).toBe(true);

    await http().post('/v1/sbg/account/mute').set(ownerToken).expect(201);
    const refused = await checkout().expect(403);
    expect(refused.body).toMatchObject({ params: { reason: 'store_resting' } });
    expect(fleet.acceptingWork(driverDid)).toBe(false);
    // The store still reads what it has.
    await http().get(`/v1/sbg/vendors/${store.vendorId}/checkouts`).set(storeToken).expect(200);

    await http().post('/v1/sbg/account/unmute').set(ownerToken).expect(201);
    await checkout().expect(201);
    expect(fleet.acceptingWork(driverDid)).toBe(true);
  });

  it('a muted owner of one shop leaves another person’s shop as it is', async () => {
    const mine = await anOwnedShop('Duka Langu');
    const theirs = await anOwnedShop('Duka Lao');
    await http().post('/v1/sbg/account/mute').set(mine.owner).expect(201);
    expect(await point(mine.did)).toBeUndefined();
    expect(await point(theirs.did)).toMatchObject({ takesNew: true });
    await http().post('/v1/sbg/account/unmute').set(mine.owner).expect(201);
  });
});
