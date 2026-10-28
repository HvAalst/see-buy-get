import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { MdpService } from '../src/modules/pudo/mdp.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { MediaService } from '../src/modules/pudo/media.service';
import { AGREED } from './agreed';

/**
 * ROUND 39 — THE YEARLY SECURITY DECLARATION, OVER THE WIRE (the user: "At joining and yearly (Recommended)"). A shop, a
 * hub, a fleet's office and a rider in no fleet each sign one short declaration — at joining, and again each year; a new
 * wording is signed again. Not in force: nothing new is taken on, in words that say where it is signed. A fleet's driver
 * signs nothing of their own: the fleet does. Staff read who stands where, and sign for nobody.
 */
describe('the yearly security declaration — over the wire', () => {
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

  async function aShop(shopName: string): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(staff)
      .send({
        shopName, zone: `Decl${u}`, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-DECL-${u}`, mobile: `+2547${u}8`, deviceImei: `IMEI-DECL-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photograph = async (kind: string) => {
      const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}`;
      return (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
    };
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: await photograph('kyc_licence'), shopPhotoRefs: [await photograph('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    return { did, token };
  }

  it('a shop takes nothing in until it has signed, from its own sign-in, the wording it was shown', async () => {
    const shop = await aShop('Mama Neema');
    const mine = async () => (await http().get('/v1/sbg/declarations/mine').set(shop.token).expect(200)).body;
    const first = await mine();
    expect(first).toMatchObject({ required: true, kind: 'shop', state: 'missing', version: expect.any(Number), title: expect.stringMatching(/security declaration/) });
    expect(first.lines.length).toBeGreaterThanOrEqual(4);

    // Nothing new taken in — said with where it is signed.
    const walkUp = (id: string) => ({ agentDid: shop.did, parcelId: id, size: 'S', destZone: 'Elsewhere', senderMobile: '+254700000501', receiverMobile: '+254700000502', paymentMode: 'prepaid' });
    const refused = await http().post('/v1/sbg/parcels/accept').set(shop.token).send({ ...walkUp(`DECL-${digits()}`), dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop.did) }).expect(409);
    expect(refused.body).toMatchObject({ code: 'DECLARATION_REQUIRED' });
    expect(refused.body.detail).toBe('Mama Neema has not signed its security declaration: nothing new is taken on until it has. It is signed in the Shop app, on the home screen.');

    // Not staff's to sign, and only the wording in force.
    await http().post('/v1/sbg/declarations/mine/sign').set(staff).send({ version: first.version }).expect(403);
    await http().post('/v1/sbg/declarations/mine/sign').set(shop.token).send({ version: first.version + 1 }).expect(409);
    const signed = (await http().post('/v1/sbg/declarations/mine/sign').set(shop.token).send({ version: first.version, by: 'Neema Wanjiru' }).expect(201)).body;
    expect(signed).toMatchObject({ required: true, state: 'signed', signedBy: 'Neema Wanjiru', until: expect.any(String) });
    expect(Date.parse(signed.until) - Date.parse(signed.signedAt)).toBe(365 * 86_400_000);

    // Signed: the parcel comes in.
    await http().post('/v1/sbg/parcels/accept').set(shop.token).send({ ...walkUp(`DECL-${digits()}`), dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop.did) }).expect(201);

    // Staff read where it stands — and the report is vetting's.
    const report = (await http().get('/v1/sbg/declarations').set(staff).expect(200)).body.items as Array<{ did: string; kind: string; state: string }>;
    expect(report.find((r) => r.did === shop.did)).toMatchObject({ kind: 'shop', state: 'signed' });
  });

  it('a rider in no fleet signs their own; a fleet’s driver signs nothing, and their fleet answers for them', async () => {
    const u = digits();
    const rider = (await http().post('/v1/sbg/drivers/onboard').set(staff).send({ displayName: `Rider ${u.slice(-3)}`, fullName: `Rider ${u}`, nationalId: `ID-DR-${u}`, mobile: `+2547${u}7`, licenceClasses: ['motorcycle'], licenceNumber: `L-${u}`, licenceExpiresAt: '2031-01-01', jurisdiction: 'KE' }).expect(201)).body;
    const riderToken = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: rider.did, type: 'client_credentials' }).expect(201)).body.access_token);
    const own = (await http().get('/v1/sbg/declarations/mine').set(riderToken).expect(200)).body;
    expect(own).toMatchObject({ required: true, kind: 'driver', state: 'missing' });
    // Waiting on them, on staff's list, before anybody who has signed.
    const before = (await http().get('/v1/sbg/declarations').set(staff).expect(200)).body.items as Array<{ did: string; state: string }>;
    expect(before.find((r) => r.did === rider.did)).toMatchObject({ state: 'missing' });
    expect(before.findIndex((r) => r.state === 'signed')).toBeGreaterThan(before.findIndex((r) => r.did === rider.did));
    // Out on a motorcycle, a hub loads a bag onto them: refused, in words for the hub, before anything is moved.
    const moto = (await http().post('/v1/sbg/vehicles').set(staff).send({ plate: `DM-${u}`, vehicleClass: 'motorcycle', ownerName: 'Rider' }).expect(201)).body;
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/start-session`).set(staff).send({ vehicleId: moto.vehicleId }).expect(201);
    const mdps = app.get(MdpService);
    const hub = mdps.register({ name: `Decl Sort ${u}`, zones: [`DS${u}`], country: 'KE', location: { lat: -1.29, lng: 36.82 } }, { approvedBy: 'Test' });
    declared(app, 'hub', hub.did);
    const bag = mdps.registerTote(hub.mdpId);
    expect(() => mdps.loadBag(bag.code, rider.badgeId)).toThrow(/^This rider has not signed their security declaration: nothing new is taken on until they have/);
    await http().post('/v1/sbg/declarations/mine/sign').set(riderToken).send({ version: own.version }).expect(201);
    expect((await http().get('/v1/sbg/declarations/mine').set(riderToken).expect(200)).body.state).toBe('signed');
    // Riding for themselves, the rider is the carrier on its notes: an address, or a pin of its station (2026-10-28) —
    // its own to give, never staff's to write in its name, and one of the two at least.
    const place = `/v1/sbg/fleet/drivers/${rider.did}/carrier-place`;
    await http().post(place).set(riderToken).send({}).expect(400);
    await http().post(place).set(staff).send({ address: 'Kencom, Nairobi' }).expect(403);
    const placed = (await http().post(place).set(riderToken).send({ station: { lat: -1.283333, lng: 36.816667, label: 'Kencom stage' } }).expect(201)).body;
    expect(placed.carrierPlace).toMatchObject({ station: { lat: -1.28333, lng: 36.81667, label: 'Kencom stage' } });
    expect((await http().get(`/v1/sbg/fleet/drivers/${rider.did}`).set(riderToken).expect(200)).body.carrierPlace).toMatchObject({ station: { label: 'Kencom stage' } });

    // Riding for themselves, the rider may prove their OWN cover (the user, 2026-10-28: "Someone willing to invest in it
    // should be rewarded for it"): sent from the app, read by staff — and then a load that asks for cover is open to them.
    const coverAt = `/v1/sbg/fleet/drivers/${rider.did}/cover`;
    const board = app.get(DispatchService);
    const coverLoad = board.registerFreight({ description: 'Phones, 2 boxes', pickupLocation: { lat: -1.29, lng: 36.82 }, pickupLabel: 'Kencom', destLabel: 'Westlands', destLocation: { lat: -1.26, lng: 36.8 }, weightKg: 5, coverRequired: true });
    const coverBlock = () => board.board({ driverDid: rider.did, from: { lat: -1.29, lng: 36.82 } }).find((r) => r.freightId === coverLoad.freightId)?.blockers.find((b) => b.code === 'COVER_REQUIRED')?.message;
    expect(coverBlock()).toBe('The sender asks for a carrier whose insurance cover SeeBuyGet has checked: you have none on record that is still running. Send your policy from the Driver app.');
    const inAYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const policy = app.get(MediaService).upload({ ownerDid: rider.did, kind: 'kyc_insurance', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }).mediaId;
    await http().post(coverAt).set(staff).send({ copyRef: policy, expiresAt: inAYear }).expect(403);
    expect((await http().post(`${coverAt}/record`).set(staff).send({ expiresAt: inAYear }).expect(400)).body.detail).toMatch(/No policy has been sent/);
    await http().post(coverAt).set(riderToken).send({ copyRef: policy, expiresAt: inAYear, reference: 'GIT-R-9' }).expect(201);
    await http().post(`${coverAt}/record`).set(riderToken).send({ expiresAt: inAYear }).expect(403);
    // Sent is not proof: still closed until staff have read it.
    expect(coverBlock()).toBeDefined();
    await http().post(`${coverAt}/record`).set(staff).send({ expiresAt: inAYear, limit: 300000, currency: 'KSH' }).expect(400);
    const recorded = (await http().post(`${coverAt}/record`).set(staff).send({ expiresAt: inAYear, covers: 'goods_in_transit', limit: 300000, currency: 'KES' }).expect(201)).body;
    expect(recorded.proven).toMatchObject({ policy: 'GIT-R-9', covers: 'goods_in_transit', limit: 300000, currency: 'KES' });
    expect(coverBlock()).toBeUndefined();
    // …until it runs out: the day after, the load is closed to them again, with nobody withdrawing anything.
    expect(board.board({ driverDid: rider.did, from: { lat: -1.29, lng: 36.82 } }, Date.now() + 400 * 86_400_000).find((r) => r.freightId === coverLoad.freightId)?.blockers.map((x) => x.code)).toContain('COVER_REQUIRED');
    expect((await http().get(`/v1/sbg/fleet/drivers/${rider.did}`).set(riderToken).expect(200)).body.cover).toMatchObject({ policy: 'GIT-R-9', expiresAt: inAYear });

    // A fleet's office signs for the fleet, from its own sign-in.
    const managers = app.get(FleetManagerService);
    const v = digits();
    const m = managers.register({
      companyName: `Decl Fleet ${v}`, contactPhone: `+2548${v}1`, ownerFullName: 'O O', ownerNationalId: `MGR-DECL-${v}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-DECL-${v}`, transportOperatorLicence: `TOL-DECL-${v}`, taxId: `TAX-DECL-${v}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = bearer((await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token);
    const theirs = (await http().get('/v1/sbg/declarations/mine').set(office).expect(200)).body;
    expect(theirs).toMatchObject({ required: true, kind: 'fleet', state: 'missing', title: expect.stringMatching(/as a SeeBuyGet fleet/) });
    await http().post('/v1/sbg/declarations/mine/sign').set(office).send({ version: theirs.version }).expect(201);
    const fleet = { did: m.did, companyName: m.companyName };
    // A fleet's driver: covered by the fleet, and nothing of their own to sign.
    const fleetDriver = (await http().post('/v1/sbg/drivers/onboard').set(staff).send({ displayName: `Fleet ${v.slice(-3)}`, fullName: `Fleet Driver ${v}`, nationalId: `ID-FD-${v}`, mobile: `+2547${v}6`, licenceClasses: ['motorcycle'], licenceNumber: `L-${v}`, licenceExpiresAt: '2031-01-01', managerDid: fleet.did }).expect(201)).body;
    const fleetToken = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: fleetDriver.did, type: 'client_credentials' }).expect(201)).body.access_token);
    expect((await http().get('/v1/sbg/declarations/mine').set(fleetToken).expect(200)).body).toEqual({ required: false, coveredBy: fleet.companyName });
    expect((await http().post('/v1/sbg/declarations/mine/sign').set(fleetToken).send({ version: own.version }).expect(400)).body.detail).toMatch(/signs the security declaration for its drivers/);
  });

  it('a hub opens no new tote, and a fleet’s driver takes no load, until the hub — and the fleet — has signed', async () => {
    // A hub staff registered: no new tote until its own sign-in has signed.
    const mdps = app.get(MdpService);
    const hub = mdps.register({ name: `Decl Hub ${digits()}`, zones: [`DZ${digits()}`], country: 'KE', location: { lat: -1.29, lng: 36.82 } }, { approvedBy: 'Test' });
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did, type: 'client_credentials' }).expect(201)).body.access_token);
    const tote = () => http().post(`/v1/sbg/mdps/${hub.mdpId}/totes`).set(hubToken);
    const refused = (await tote().expect(409)).body;
    expect(refused).toMatchObject({ code: 'DECLARATION_REQUIRED' });
    expect(refused.detail).toMatch(/has not signed its security declaration: nothing new is taken on until it has\. It is signed in the Hub app/);
    const hubs = (await http().get('/v1/sbg/declarations/mine').set(hubToken).expect(200)).body;
    await http().post('/v1/sbg/declarations/mine/sign').set(hubToken).send({ version: hubs.version }).expect(201);
    await tote().expect(201);

    // A fleet's driver out in its truck: the office puts no load on them until the fleet has signed.
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Decl Haulage ${n}`, contactPhone: `+2548${n}2`, ownerFullName: 'O O', ownerNationalId: `MGR-DH-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-DH-${n}`, transportOperatorLicence: `TOL-DH-${n}`, taxId: `TAX-DH-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = bearer((await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token);
    const phone = `+2547${digits()}4`;
    const driver = (await http().post('/v1/sbg/drivers/onboard').set(staff).send({ displayName: 'Baraka', fullName: 'Baraka Driver', nationalId: `ID-DH-${n}`, mobile: phone, licenceClasses: ['truck'], licenceNumber: `L-DH-${n}`, licenceExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: m.did }).expect(201)).body;
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/submit-kyc`).set(staff).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/kyc-decision`).set(staff).send({ approve: true, by: 'Test' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `decl${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: '48261', device: enrolled.body.device }).expect(201);
    const truck = app.get(VehicleService).register({ plate: `DCL ${n.slice(-3)}T`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: 'Decl Haulage', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: m.did } as never);
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/start-session`).set(bearer(session.body.token.access_token)).send({ vehicleId: truck.vehicleId, pin: '48261' }).expect(201);
    // A fleet's driver carries for the fleet: its depot is the carrier's address, and the driver is never asked for one.
    expect((await http().post(`/v1/sbg/fleet/drivers/${driver.did}/carrier-place`).set(bearer(session.body.token.access_token)).send({ address: 'Home' }).expect(403)).body.detail).toMatch(/the fleet’s depot is the carrier’s address/);
    // …and is covered by the fleet's insurance, never by a policy of their own.
    expect((await http().post(`/v1/sbg/fleet/drivers/${driver.did}/cover`).set(bearer(session.body.token.access_token)).send({ copyRef: 'med_x', expiresAt: '2031-01-01' }).expect(403)).body.detail).toMatch(/covered by the fleet’s insurance/);
    const dispatch = app.get(DispatchService);
    const load = dispatch.registerFreight({ description: 'Cement, 40 bags', pickupLocation: { lat: -1.3, lng: 36.85 }, pickupLabel: 'Bamburi depot', destLabel: 'Site 7', destLocation: { lat: -1.25, lng: 36.9 }, weightKg: 2000, packaging: 'palletised' } as never);
    const assign = () => {
      try {
        dispatch.assign(load.freightId, driver.did, { managerDid: m.did, name: 'Office' });
        return 'assigned';
      } catch (e) {
        return `${(e as { code?: string }).code}: ${(e as Error).message}`;
      }
    };
    expect(assign()).toBe('DECLARATION_REQUIRED: Your fleet has not signed its security declaration: nothing new is taken on until it has. It is signed in the Fleet app, on the home screen.');
    const fleets = (await http().get('/v1/sbg/declarations/mine').set(office).expect(200)).body;
    await http().post('/v1/sbg/declarations/mine/sign').set(office).send({ version: fleets.version }).expect(201);
    expect(assign()).toBe('assigned');

    /*
     * COVER THE SENDER ASKS FOR (the user, 2026-10-28: "Toggle cover needed/not needed" — "they must prove it"). The same
     * fleet, now signed: a load whose sender asks for cover is not put on its driver until staff have read the fleet's
     * insurance off the policy it sent. The board says so first, in the take's own words.
     */
    const covered = dispatch.registerFreight({ description: 'Paint, 20 drums', pickupLocation: { lat: -1.3, lng: 36.85 }, pickupLabel: 'Bamburi depot', destLabel: 'Site 8', destLocation: { lat: -1.25, lng: 36.9 }, weightKg: 1500, packaging: 'drummed', coverRequired: true });
    const assignCovered = () => {
      try {
        dispatch.assign(covered.freightId, driver.did, { managerDid: m.did, name: 'Office' });
        return 'assigned';
      } catch (e) {
        return `${(e as { code?: string }).code}: ${(e as Error).message}`;
      }
    };
    const refusal = 'FORBIDDEN: The sender asks for a carrier whose insurance cover SeeBuyGet has checked: your fleet has none on record that is still running. Your office sends the policy from the Fleet app.';
    expect(assignCovered()).toBe(refusal);
    // Never offered either: what refuses a load is not pushed to the driver it would refuse.
    const offered = () => [...dispatch.suggestNearby(driver.did, { lat: -1.3, lng: 36.85 }, 50).map((o) => o.ref), dispatch.offerNear(driver.did, { lat: -1.3, lng: 36.85 })?.ref, ...dispatch.suggest(driver.did, { from: { lat: -1.3, lng: 36.85 }, to: { lat: -1.25, lng: 36.9 } }).map((o) => o.ref)];
    expect(offered()).not.toContain(covered.freightId);
    const row = dispatch.board({ driverDid: driver.did, from: { lat: -1.3, lng: 36.85 } }).find((r) => r.freightId === covered.freightId);
    expect(row).toMatchObject({ coverRequired: true });
    expect(row?.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'COVER_REQUIRED', kind: 'resolvable' })]));
    // A date typed with no document is no proof.
    const inAYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    await http().post(`/v1/sbg/fleet/managers/${m.did}/papers`).set(staff).send({ insuranceExpiresAt: inAYear, insurancePolicy: 'GIT-DH-1' }).expect(201);
    expect(assignCovered()).toBe(refusal);
    // The office sends its policy; staff read it off the image, with what it covers and up to how much a load.
    const policy = app.get(MediaService).upload({ ownerDid: m.did, kind: 'kyc_insurance', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }).mediaId;
    managers.sendPaper(m.did, { kind: 'carrier_insurance', copyRef: policy, expiresAt: inAYear, reference: 'GIT-DH-1' }, { ownerDid: m.did });
    await http().post(`/v1/sbg/fleet/managers/${m.did}/papers`).set(staff).send({ insuranceExpiresAt: inAYear, insuranceCovers: 'both', insuranceLimit: 2500000, insuranceCurrency: 'KES' }).expect(201);
    const own = (await http().get(`/v1/sbg/fleet/managers/${m.did}/papers`).set(office).expect(200)).body;
    expect(own.cover).toMatchObject({ policy: 'GIT-DH-1', covers: 'both', limit: 2500000, currency: 'KES' });
    expect(dispatch.board({ driverDid: driver.did, from: { lat: -1.3, lng: 36.85 } }).find((r) => r.freightId === covered.freightId)?.blockers.map((b) => b.code)).not.toContain('COVER_REQUIRED');
    expect(offered()).toContain(covered.freightId);
    expect(assignCovered()).toBe('assigned');
    // The note says what the sender asked for and the cover the carrier holds.
    const note = (await http().get(`/v1/sbg/dispatch/freight/${covered.freightId}/consignment-note`).set(staff).expect(200)).body;
    expect(note.instructions).toContain('Insurance: the sender requires a carrier whose insurance cover SeeBuyGet has checked');
    expect(note.carrier.cover).toMatch(/^Insurance cover: goods in transit and the carrier’s liability up to 2,500,000 KES a load, policy GIT-DH-1, valid until /);
  });
});
