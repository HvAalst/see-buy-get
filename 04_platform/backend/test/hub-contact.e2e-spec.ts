import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { HandleDirectory } from '../src/modules/pudo/handle-directory.service';
import { ToteService } from '../src/modules/pudo/tote.service';

/**
 * A HUB'S OPENING HOURS AND HOW TO REACH IT, over the wire (the user, 2026-10-26: "hub has open hours as well? and a
 * contact page for anyone (drivers) wanting to contact the hub" — and, asked who sees the number, "public if the hub ticks
 * it, but the phone number under a button that opens the phone app"). The hub's owner writes it; its public page shows
 * its hours always and its number only once it ticks that; a driver with a bag at the hub sees how to reach it either way;
 * and the hours it takes stores' parcels in bulk stay inside the hours it is open.
 */
describe('a hub’s opening hours and how to reach it', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the owner writes it; the public page shows its hours and, once ticked, its number; a driver at the hub sees how to reach it; bulk hours stay inside opening hours', async () => {
    const tag = digits();
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Ghala Hub ${tag}`, zones: [`GH${tag}`], location: { lat: -1.3, lng: 36.88 } }).expect(201)).body;
    const other = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Other Hub ${tag}`, zones: [`OH${tag}`], location: { lat: -1.31, lng: 36.89 } }).expect(201)).body;
    const asHub = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    const asOther = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: other.did }).expect(201)).body.access_token);
    declared(app, 'hub', hub.did, other.did);
    const contact = `/v1/sbg/mdps/${hub.mdpId}/contact`;
    const day = { open: '07:00', close: '18:00' };
    const week = { sun: null, mon: day, tue: day, wed: day, thu: day, fri: day, sat: { open: '08:00', close: '12:00' } };

    // ITS OWN WORD: written by its owner — not staff, not another hub.
    expect((await http().put(contact).set(operator).send({ phone: '+254700000001' }).expect(403)).body.detail).toMatch(/A hub writes its own hours/);
    await http().put(contact).set(asOther).send({ phone: '+254700000001' }).expect(403);
    expect((await http().put(contact).set(asHub).send({ phone: 'ring the bell' }).expect(400)).body.detail).toMatch(/A telephone number is digits/);
    const written = (await http().put(contact).set(asHub).send({ openingHours: week, phone: '+254 700 000 001', askFor: 'the floor lead', gate: 'Gate 2, behind the market' }).expect(200)).body;
    expect(written).toMatchObject({ name: `Ghala Hub ${tag}`, phone: '+254 700 000 001', askFor: 'the floor lead', gate: 'Gate 2, behind the market', openingHours: { sun: null, sat: { open: '08:00', close: '12:00' } }, zone: 'Africa/Nairobi' });
    expect(typeof written.openNow?.open).toBe('boolean');
    // Read by the hub and by staff; not by another hub.
    await http().get(contact).set(asHub).expect(200);
    await http().get(contact).set(operator).expect(200);
    await http().get(contact).set(asOther).expect(403);

    // ITS PUBLIC PAGE: its hours always; its number and gate only once it ticks that they go there.
    app.get(HandleDirectory).ensure();
    const handle = (await http().get(contact).set(asHub).expect(200)).body.handle as string;
    expect(handle).toBeTruthy();
    const page = () => http().get(`/v1/sbg/profiles/${handle}`).expect(200);
    const before = (await page()).body.hub;
    expect(before).toMatchObject({ openingHours: { mon: day }, basis: expect.stringMatching(/Written by the hub itself/) });
    expect(before.phone).toBeUndefined();
    expect(before.gate).toBeUndefined();
    await http().put(contact).set(asHub).send({ publish: true }).expect(200);
    expect((await page()).body.hub).toMatchObject({ phone: '+254 700 000 001', askFor: 'the floor lead', gate: 'Gate 2, behind the market' });
    await http().put(contact).set(asHub).send({ publish: false }).expect(200);
    expect((await page()).body.hub.phone).toBeUndefined();

    // BULK INSIDE OPENING HOURS: not on a day it is closed, not before it opens — and its hours cannot then shrink past them.
    const bulk = (body: Record<string, unknown>) => http().put(`/v1/sbg/mdps/${hub.mdpId}/bulk`).set(asHub).send({ open: true, ...body });
    expect((await bulk({ hours: { sun: { open: '09:00', close: '12:00' } } }).expect(400)).body.detail).toMatch(/The hub is not open then \(Sunday — the hub is closed then\)/);
    expect((await bulk({ hours: { mon: { open: '06:00', close: '12:00' } } }).expect(400)).body.detail).toMatch(/Monday 06:00–12:00/);
    await bulk({ hours: { mon: { open: '08:00', close: '17:00' }, tue: { open: '08:00', close: '17:00' } } }).expect(200);
    expect((await http().put(contact).set(asHub).send({ openingHours: { ...week, mon: { open: '09:00', close: '18:00' } } }).expect(400)).body.detail).toMatch(/You take stores’ parcels in bulk outside these hours \(Monday 08:00–17:00/);
    // A store reading the hub sees its hours and how to reach it.
    expect((await http().get(`/v1/sbg/mdps/${hub.mdpId}/arrivals`).set(asHub).expect(200)).body.bulk).toMatchObject({ openingHours: { mon: day }, phone: '+254 700 000 001', gate: 'Gate 2, behind the market' });

    // A DRIVER WITH A BAG AT THE HUB — taken there, or going there — sees whether it is open and how to reach it.
    const totes = app.get(ToteService);
    const store = (totes as unknown as { totes: Map<string, Record<string, unknown>> }).totes;
    const fromHub = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/totes`).set(operator).expect(201)).body;
    const toHub = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/totes`).set(operator).expect(201)).body;
    const driverDid = `did:driver:hc-${tag}`;
    store.set(fromHub.toteId, { ...store.get(fromHub.toteId)!, status: 'claimed', claimedBy: driverDid });
    store.set(toHub.toteId, { ...store.get(toHub.toteId)!, status: 'claimed', claimedBy: driverDid, locationId: `did:shop:elsewhere-${tag}`, destinationNodeId: hub.mdpId, destinationLabel: `Ghala Hub ${tag}` });
    const claims = app.get(DispatchService).claimsFor(driverDid);
    const taken = claims.find((c) => c.ref === fromHub.code)!;
    const going = claims.find((c) => c.ref === toHub.code)!;
    expect(taken.pickupHub).toMatchObject({ mdpId: hub.mdpId, name: `Ghala Hub ${tag}`, phone: '+254 700 000 001', askFor: 'the floor lead', gate: 'Gate 2, behind the market', handle });
    expect(typeof taken.pickupHub?.openNow?.open).toBe('boolean');
    expect(going.destHub).toMatchObject({ mdpId: hub.mdpId, phone: '+254 700 000 001' });
    expect(going.pickupHub).toBeUndefined();
  });
});
