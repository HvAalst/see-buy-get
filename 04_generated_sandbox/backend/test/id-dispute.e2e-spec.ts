import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * TWO PEOPLE SAY ONE NATIONAL ID IS THEIRS, OVER THE WIRE — as the guards and the route roles see it.
 *
 * The user, 2026-10-08: staff decide from photographs of each person holding their card; still disputed, an
 * appointment in person with a ticket. What has to hold on the wire is who may do which part: either of the two
 * people acts by their own reference and by nothing else; only the holder's own sign-in can say the number was never
 * theirs; only staff see the photographs and decide — and never the same member of staff both halves.
 */
describe('two people say one national ID is theirs, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const aNumber = () => `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${(seq += 1)}`.slice(0, 13);
  const anId = () => `${Math.floor(Math.random() * 90_000_000) + 10_000_000}`;
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
  }, 60_000);
  afterAll(async () => {
    await app?.close();
  });

  async function aVerifiedNumber(): Promise<string> {
    const phone = aNumber();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    return phone;
  }
  /** A person with a PIN who is also a driver, registered with this national ID. */
  async function aDriver(nationalId: string): Promise<{ phone: string; token: string; did: string }> {
    const phone = await aVerifiedNumber();
    const email = `idd-${tag}-${(seq += 1)}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '4826', email, emailCode: mailed.body.code }).expect(201);
    const driver = await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: `Rider ${seq}`, fullName: `Rider ${seq}`, nationalId, mobile: phone, licenceClasses: ['bike'] }).expect(201);
    return { phone, token: enrolled.body.token.access_token, did: driver.body.did };
  }
  async function aStaff(name: string): Promise<string> {
    const made = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    const login = await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201);
    return login.body.token.access_token;
  }
  const idOf = async (reference: string, as: string) => ((await http().get('/v1/sbg/id-disputes').set(bearer(as)).expect(200)).body.items as Array<{ reference: string; disputeId: string }>).find((d) => d.reference === reference)!.disputeId;
  const status = async (reference: string) => (await http().post('/v1/sbg/identity/id-disputes/status').send({ reference }).expect(200)).body;
  const sendAll = async (reference: string) => {
    for (const which of ['face', 'front', 'back']) await http().post('/v1/sbg/identity/id-disputes/photo').send({ reference, which, dataUrl: PNG }).expect(200);
    return (await http().post('/v1/sbg/identity/id-disputes/send').send({ reference }).expect(200)).body;
  };
  const me = async (token: string) => (await http().get('/v1/sbg/account/me').set(bearer(token)).expect(200)).body;

  it('is opened by whoever was refused, answered by the holder, decided by two members of staff — and the loser is held, not removed', async () => {
    const amina = await aStaff('amina-id');
    const brian = await aStaff('brian-id');
    const nationalId = anId();
    const holder = await aDriver(nationalId);
    const bystander = await aDriver(anId());

    // Refused at registration: this is what sends somebody here.
    await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: 'X', fullName: 'X', nationalId, mobile: aNumber(), licenceClasses: ['bike'] }).expect(409);

    // Opening: a confirmed phone, a register we know, a number.
    await http().post('/v1/sbg/identity/id-disputes').send({ register: 'driver', nationalId, phone: aNumber() }).expect(400);
    const phone = await aVerifiedNumber();
    await http().post('/v1/sbg/identity/id-disputes').send({ register: 'pilot', nationalId, phone }).expect(400);
    await http().post('/v1/sbg/identity/id-disputes').send({ register: 'driver', phone }).expect(400);
    const opened = await http().post('/v1/sbg/identity/id-disputes').send({ register: 'driver', nationalId, phone }).expect(201);
    expect(opened.body.reference).toMatch(/^ID-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await http().post('/v1/sbg/identity/id-disputes/status').send({ reference: 'ID-AAAA-AAAA' }).expect(404);
    await http().post('/v1/sbg/identity/id-disputes/status').send({}).expect(400);

    // Nothing has been sent, so the holder has not been told.
    expect((await me(holder.token)).idDispute).toBeUndefined();
    await http().post('/v1/sbg/identity/id-disputes/photo').send({ reference: opened.body.reference, which: 'chin', dataUrl: PNG }).expect(400);
    await http().post('/v1/sbg/identity/id-disputes/photo').send({ reference: opened.body.reference, which: 'face', dataUrl: 'not a picture' }).expect(400);
    await http().post('/v1/sbg/identity/id-disputes/send').send({ reference: opened.body.reference }).expect(400);
    expect(await sendAll(opened.body.reference)).toMatchObject({ side: 'claimant', state: 'answering', sent: true });

    // The holder sees it on their own account, with a reference of THEIR own. Nobody else's account says anything.
    const mine = (await me(holder.token)).idDispute;
    expect(mine).toMatchObject({ register: 'driver', state: 'answering', answerBy: expect.any(String) });
    expect(mine.reference).toMatch(/^ID-/);
    expect(mine.reference).not.toBe(opened.body.reference);
    expect((await me(bystander.token)).idDispute).toBeUndefined();
    // Only the claimant withdraws; only the holder's own sign-in says the number was never theirs.
    await http().post('/v1/sbg/identity/id-disputes/withdraw').send({ reference: mine.reference }).expect(403);
    await http().post('/v1/sbg/account/id-disputes/own-id').send({ nationalId: anId() }).expect(401);
    await http().post('/v1/sbg/account/id-disputes/own-id').set(bearer(bystander.token)).send({ nationalId: anId() }).expect(400);
    expect(await sendAll(mine.reference)).toMatchObject({ side: 'holder', state: 'ready' });

    // Staff alone read the disputes and see the photographs.
    await http().get('/v1/sbg/id-disputes').expect(401);
    await http().get('/v1/sbg/id-disputes').set(bearer(holder.token)).expect(403);
    const disputeId = await idOf(opened.body.reference, amina);
    await http().get(`/v1/sbg/id-disputes/${disputeId}`).set(bearer(holder.token)).expect(403);
    await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(holder.token)).send({}).expect(403);
    const row = (await http().get(`/v1/sbg/id-disputes/${disputeId}`).set(bearer(amina)).expect(200)).body;
    expect(row).toMatchObject({ state: 'ready', register: 'driver', holderReference: mine.reference, claimant: { phoneEnds: phone.slice(-3), face: expect.stringMatching(/^med_/) }, holder: { who: expect.stringMatching(/^Driver: Rider/), back: expect.stringMatching(/^med_/) } });
    expect(JSON.stringify(row)).not.toContain(nationalId);
    expect(JSON.stringify(row)).not.toContain(phone);
    expect(JSON.stringify(row)).not.toContain(holder.phone);
    const picture = await http().get(`/v1/sbg/media/${row.claimant.face}`).set(bearer(amina)).expect(200);
    expect(picture.headers['content-type']).toMatch(/^image\/png/);
    // Not the other person, and not even the one who is in it: these are staff's to look at, for one decision.
    await http().get(`/v1/sbg/media/${row.claimant.face}`).set(bearer(holder.token)).expect(403);
    await http().get(`/v1/sbg/media/${row.holder.face}`).set(bearer(holder.token)).expect(403);

    // Reading the cards: only an answer comes back.
    await http().post(`/v1/sbg/id-disputes/${disputeId}/card`).set(bearer(amina)).send({ side: 'referee', number: nationalId }).expect(400);
    expect((await http().post(`/v1/sbg/id-disputes/${disputeId}/card`).set(bearer(amina)).send({ side: 'claimant', number: nationalId }).expect(200)).body.claimant.card).toBe('matches');
    expect((await http().post(`/v1/sbg/id-disputes/${disputeId}/card`).set(bearer(amina)).send({ side: 'holder', number: nationalId }).expect(200)).body.holder.card).toBe('matches');

    // One says whose it is; that one cannot approve; another does.
    await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(brian)).send({}).expect(400);
    await http().post(`/v1/sbg/id-disputes/${disputeId}/check`).set(bearer(amina)).send({ to: 'claimant', what: 'Face and card match.' }).expect(400);
    const proposed = await http().post(`/v1/sbg/id-disputes/${disputeId}/check`).set(bearer(amina)).send({ to: 'claimant', what: 'Face and card match; reference in the picture.', reason: 'The card you showed is not yours.' }).expect(200);
    expect(proposed.body).toMatchObject({ state: 'checked', proposedTo: 'claimant', proposedBy: `amina-id ${tag}`, proposedByYou: true });
    expect((await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(amina)).send({}).expect(409)).body.detail).toMatch(/A second member of staff has to approve/);
    await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(amina)).send({ by: 'Somebody Else' }).expect(409);
    const decided = await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(brian)).send({}).expect(200);
    expect(decided.body).toMatchObject({ state: 'decided', decidedTo: 'claimant', decidedBy: `brian-id ${tag}`, holderEffect: 'held', contestBy: expect.any(String) });

    // Each is told their own half, by their own reference.
    expect(await status(opened.body.reference)).toMatchObject({ yours: true });
    expect(await status(mine.reference)).toMatchObject({ yours: false, held: true, reason: 'The card you showed is not yours.', contestBy: expect.any(String) });
    expect((await me(holder.token)).idDispute).toMatchObject({ state: 'decided', held: true });

    // Kept for the claimant alone: a stranger is still refused, their own phone gets through.
    await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: 'Y', fullName: 'Y', nationalId, mobile: aNumber(), licenceClasses: ['bike'] }).expect(409);
    await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: 'Claimant', fullName: 'Claimant', nationalId, mobile: phone, licenceClasses: ['bike'] }).expect(201);

    // The held registration puts an ID of its own on record, and the hold is over.
    await http().post('/v1/sbg/account/id-disputes/own-id').set(bearer(holder.token)).send({ nationalId }).expect(409);
    await http().post('/v1/sbg/account/id-disputes/own-id').set(bearer(holder.token)).send({}).expect(400);
    expect((await http().post('/v1/sbg/account/id-disputes/own-id').set(bearer(holder.token)).send({ nationalId: anId() }).expect(200)).body).toEqual({ saved: true });
    expect((await status(mine.reference)).held).toBeUndefined();
  });

  it('still disputed: whoever did not get it makes an appointment and is given a ticket — on a sandbox’s shared key, two names are two people', async () => {
    const nationalId = anId();
    const holder = await aDriver(nationalId);
    const phone = await aVerifiedNumber();
    const opened = await http().post('/v1/sbg/identity/id-disputes').send({ register: 'driver', nationalId, phone }).expect(201);
    await sendAll(opened.body.reference);
    const mine = (await me(holder.token)).idDispute;
    await sendAll(mine.reference);
    const disputeId = await idOf(opened.body.reference, setupKey);
    await http().post(`/v1/sbg/id-disputes/${disputeId}/card`).set(bearer(setupKey)).send({ side: 'holder', number: nationalId, by: 'Amina Otieno' }).expect(200);
    await http().post(`/v1/sbg/id-disputes/${disputeId}/check`).set(bearer(setupKey)).send({ to: 'holder', what: 'Their card carries it.', reason: 'The holder showed the card with this number.', by: 'Amina Otieno' }).expect(200);
    await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(setupKey)).send({ by: 'Amina Otieno' }).expect(409);
    // A second member of staff may send it back instead — and then it waits to be proposed again.
    expect((await http().post(`/v1/sbg/id-disputes/${disputeId}/send-back`).set(bearer(setupKey)).send({ why: 'Read the claimant’s card too.', by: 'Brian Kamau' }).expect(200)).body).toMatchObject({ state: 'ready' });
    await http().post(`/v1/sbg/id-disputes/${disputeId}/check`).set(bearer(setupKey)).send({ to: 'holder', what: 'Both read.', reason: 'The holder showed the card with this number.', by: 'Amina Otieno' }).expect(200);
    expect((await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(setupKey)).send({ by: 'Brian Kamau' }).expect(200)).body).toMatchObject({ state: 'decided', decidedTo: 'holder', holderEffect: 'none' });

    // The holder got it: there is nothing for them to contest. The claimant did not, and names a day.
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await http().post('/v1/sbg/identity/id-disputes/appointment').send({ reference: mine.reference, date: tomorrow }).expect(400);
    await http().post('/v1/sbg/identity/id-disputes/appointment').send({ reference: opened.body.reference, date: 'next Tuesday' }).expect(400);

    // "It's up to the countries to set visiting days and visiting hours" — in their own entry, which is where the
    // ticket fetches the address from too. A signed-in person cannot write a company's entry; the company does.
    const listed = (await http().get('/v1/sbg/entities').set(bearer(setupKey)).expect(200)).body;
    const ke = ((Array.isArray(listed) ? listed : (listed.items ?? listed.entities)) as Array<{ entityId: string; jurisdiction?: string; kind?: string }>).find((e) => e.jurisdiction === 'KE' && e.kind !== 'group')!;
    const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const theDay = DAYS[new Date(tomorrow + 'T00:00:00.000Z').getUTCDay()];
    const anotherDay = DAYS.find((x) => x !== theDay)!;
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(holder.token)).send({ address: 'Nowhere' }).expect(403);
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ visitDays: ['someday'], by: 'Grace' }).expect(400);
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ address: 'Mombasa Road, gate 4', visitDays: [anotherDay], visitFrom: '09:00', visitTo: '16:00', by: 'Grace' }).expect(201);
    // The app is told which days there are before anybody chooses one — and a day that is not one of them is refused.
    expect((await status(opened.body.reference)).support).toMatchObject({ address: 'Mombasa Road, gate 4', visitDays: [anotherDay], visitFrom: '09:00', visitTo: '16:00' });
    const closed = await http().post('/v1/sbg/identity/id-disputes/appointment').send({ reference: opened.body.reference, date: tomorrow }).expect(400);
    expect(closed.body.detail).toMatch(/does not receive visitors on a \w+day\. It does on \w+day\./);
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ visitDays: [anotherDay, theDay], by: 'Grace' }).expect(201);

    // "The country should set it's own public holidays and/or one off closure." A date it closes is refused, by name.
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ closedDates: [{ date: 'the 25th' }], by: 'Grace' }).expect(400);
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ closedDates: [{ date: tomorrow, note: 'Public holiday' }], by: 'Grace' }).expect(201);
    const holiday = await http().post('/v1/sbg/identity/id-disputes/appointment').send({ reference: opened.body.reference, date: tomorrow }).expect(400);
    expect(holiday.body.detail).toMatch(/is closed on .+ \(Public holiday\)\. Choose another day\./);
    expect(((await status(opened.body.reference)).choices as Array<{ date: string }>).map((c) => c.date)).not.toContain(tomorrow);
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ closedDates: [], by: 'Grace' }).expect(201);

    // "The limitation is set by the country as an actual number of visitors per hour." Then the appointment is for an hour.
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ visitorsPerHour: 2.5, by: 'Grace' }).expect(400);
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ visitorsPerHour: 1, by: 'Grace' }).expect(201);
    const offered = ((await status(opened.body.reference)).choices as Array<{ date: string; hours?: Array<{ at: string; free: number }> }>).find((c) => c.date === tomorrow)!;
    expect(offered.hours![0]).toEqual({ at: '09:00', free: 1 });
    expect(offered.hours).toHaveLength(7);
    const noHour = await http().post('/v1/sbg/identity/id-disputes/appointment').send({ reference: opened.body.reference, date: tomorrow }).expect(400);
    expect(noHour.body.detail).toMatch(/^Choose the hour you will come: 09:00, 10:00/);
    await http().post('/v1/sbg/identity/id-disputes/appointment').send({ reference: opened.body.reference, date: tomorrow, at: 'ten' }).expect(400);
    // The one who got the ID is not offered days: there is nothing for them to contest.
    expect((await status(mine.reference)).choices).toBeUndefined();
    const made = await http().post('/v1/sbg/identity/id-disputes/appointment').send({ reference: opened.body.reference, date: tomorrow, at: '10:00' }).expect(200);
    expect(made.body.ticket).toMatchObject({ at: '10:00', until: '11:00' });
    expect(made.body).toMatchObject({ state: 'appointment', ticket: { reference: opened.body.reference, date: tomorrow, yours: true, bring: ['id_card', 'phone', 'reference', 'second_document'], place: { address: 'Mombasa Road, gate 4', visitFrom: '09:00', visitTo: '16:00' } } });
    expect(made.body.ticket.place.visitDays).toContain(theDay);
    expect((await status(mine.reference)).ticket).toMatchObject({ reference: mine.reference, date: tomorrow, yours: false, changesLeft: 0 });
    expect((await me(holder.token)).idDispute).toMatchObject({ state: 'appointment' });
    // What was seen in person is recorded from the day itself, not before.
    const early = await http().post(`/v1/sbg/id-disputes/${disputeId}/check`).set(bearer(setupKey)).send({ to: 'claimant', what: 'x', reason: 'y', claimantCame: true, holderCame: false, by: 'Amina Otieno' }).expect(400);
    expect(early.body.detail).toMatch(/The appointment is on/);
    expect((await http().get(`/v1/sbg/id-disputes/${disputeId}`).set(bearer(setupKey)).expect(200)).body).toMatchObject({ state: 'appointment', appointmentDate: tomorrow, appointmentAt: '10:00', appointmentBy: 'claimant', place: { address: 'Mombasa Road, gate 4', visitorsPerHour: 1 } });
    // PART OF THE TURN-ON PROCESS: the company's record counts its address and its visiting days among what it must have.
    const record = (await http().get(`/v1/sbg/entities/${ke.entityId}/record`).set(bearer(setupKey)).expect(200)).body;
    const item = (key: string) => (record.readiness.items as Array<{ key: string; met: boolean }>).find((i) => i.key === key);
    expect(item('visitors_address')).toMatchObject({ met: true });
    expect(item('visiting_days')).toMatchObject({ met: true });
    await http().post(`/v1/sbg/entities/${ke.entityId}/contact`).set(bearer(setupKey)).send({ visitorsPerHour: 0, visitDays: [], address: '', by: 'Grace' }).expect(201);
    const bare = (await http().get(`/v1/sbg/entities/${ke.entityId}/record`).set(bearer(setupKey)).expect(200)).body;
    expect((bare.readiness.items as Array<{ key: string; met: boolean }>).filter((i) => i.key === 'visitors_address' || i.key === 'visiting_days').map((i) => i.met)).toEqual([false, false]);
    expect(bare.readiness.ready).toBe(false);
  });

  it('the pause is at mint: a shop held over its ID is on the public list as taking nothing new, and no price is given for it', async () => {
    const aShop = async (nationalId: string) =>
      (
        await http()
          .post('/v1/sbg/agents')
          .set(bearer(setupKey))
          .send({
            shopName: `Duka ${tag} ${(seq += 1)}`, zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'blue gate', openingHours: { mon: { open: '08:00', close: '18:00' } }, shelf: { rows: 3, cols: 3 },
            fullName: 'Shop Keeper', nationalId, mobile: aNumber(), deviceImei: `IMEI-${tag}-${seq}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
          })
          .expect(201)
      ).body as { did: string; shopName: string };
    const nationalId = anId();
    const shop = await aShop(nationalId);
    const other = await aShop(anId());
    const listed = async () => ((await http().get('/v1/sbg/network/points').expect(200)).body as Array<{ did: string; takesNew?: boolean }>).find((p) => p.did === shop.did);
    // The list has this shop on it, and says a new parcel may name it.
    expect(await listed()).toMatchObject({ did: shop.did, takesNew: true });

    // Its ID is disputed and goes to the other person: the shop is held.
    const phone = await aVerifiedNumber();
    const opened = await http().post('/v1/sbg/identity/id-disputes').send({ register: 'shop', nationalId, phone }).expect(201);
    await sendAll(opened.body.reference);
    const disputeId = await idOf(opened.body.reference, setupKey);
    const row = (await http().get(`/v1/sbg/id-disputes/${disputeId}`).set(bearer(setupKey)).expect(200)).body;
    await sendAll(row.holderReference);
    for (const side of ['claimant', 'holder']) await http().post(`/v1/sbg/id-disputes/${disputeId}/card`).set(bearer(setupKey)).send({ side, number: nationalId, by: 'Amina Otieno' }).expect(200);
    await http().post(`/v1/sbg/id-disputes/${disputeId}/check`).set(bearer(setupKey)).send({ to: 'claimant', what: 'Both cards carry it.', reason: 'The face on the card you showed is not yours.', by: 'Amina Otieno' }).expect(200);
    expect((await http().post(`/v1/sbg/id-disputes/${disputeId}/approve`).set(bearer(setupKey)).send({ by: 'Brian Kamau' }).expect(200)).body).toMatchObject({ decidedTo: 'claimant', holderEffect: 'held' });

    // Still on the public list — it hands out what it holds — and the list says no new parcel may name it.
    expect(await listed()).toMatchObject({ did: shop.did, takesNew: false });
    // No price for a parcel that would start there, or end there. Told which shop and to choose another; never why.
    const q = (origin: string, dest: string) => `/v1/sbg/quote?origin=${encodeURIComponent(origin)}&dest=${encodeURIComponent(dest)}&size=M`;
    const from = await http().get(q(shop.did, other.did)).expect(403);
    expect(from.body.detail).toBe(`${shop.shopName} is not taking new parcels for now. Choose another shop.`);
    expect((await http().get(q(other.did, shop.did)).expect(403)).body.detail).toBe(`${shop.shopName} is not taking new parcels for now. Choose another shop.`);
    expect(JSON.stringify(from.body)).not.toMatch(/national|held over|reference/i);
    // On the map of many pins, its pin carries the refusal in place of a price.
    const pins = (await http().get(`/v1/sbg/quote/options?origin=${encodeURIComponent(other.did)}&dests=${encodeURIComponent(shop.did)}&size=M`).expect(200)).body.options as Array<{ did: string; quote?: unknown; error?: string }>;
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ did: shop.did, error: expect.stringMatching(/is not taking new parcels for now/) });
    expect(pins[0].quote).toBeUndefined();
  });
});
