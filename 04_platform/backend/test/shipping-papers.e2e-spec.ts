import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isSscc } from '../src/foundation/gs1/gs1';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { AGREED } from './agreed';

/**
 * A SHIPPER'S PAPERS — through the booted application, over HTTP: its GS1 company prefix, the SSCCs its packages get,
 * the labels carrying them beside our code, and the commercial invoice it writes and signs, printed in three copies.
 * The shipper's own record: staff and the carrier read it and change none of it.
 */
describe('a shipper’s papers, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aShipper(name: string): Promise<{ token: string; entityId: string }> {
    const n = digits();
    const phone = `+2547${n}7`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `papers-${n}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const made = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${n}`, country: 'KE', registrationNo: `REG-PAP-${n}`, activities: ['shipper'], yourName: 'Achieng' }).expect(201);
    return { token: made.body.token.access_token, entityId: made.body.business.entityId };
  }

  async function aFleet(): Promise<string> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Pap Fleet ${n}`, contactPhone: `+2548${n}1`, ownerFullName: 'O O', ownerNationalId: `MGR-PAP-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-PAP-${n}`, transportOperatorLicence: `TOL-PAP-${n}`, taxId: `TAX-PAP-${n}` },
    });
    return (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
  }

  it('gives a shipper’s packages its own GS1 codes, prints them beside ours, and carries its signed commercial invoice in three copies', async () => {
    const jenga = await aShipper('Jenga Bricks');
    const other = await aShipper('Other Goods');
    const fleet = await aFleet();

    // The GS1 company prefix is the business's to give: staff are refused, a prefix that is not one is refused.
    await http().post('/v1/sbg/business/me/gs1').set(bearer(operator)).send({ companyPrefix: '6161234', extensionDigit: 3 }).expect(403);
    await http().post('/v1/sbg/business/me/gs1').set(bearer(jenga.token)).send({ companyPrefix: '616', extensionDigit: 3 }).expect(400);
    const set = await http().post('/v1/sbg/business/me/gs1').set(bearer(jenga.token)).send({ companyPrefix: '616 1234', extensionDigit: 3 }).expect(201);
    expect(set.body.gs1).toMatchObject({ companyPrefix: '6161234', extensionDigit: 3, left: 1_000_000_000, setBy: 'Achieng' });

    // A load of three packages, Kenya to Uganda: each package gets its SSCC, under the shipper's prefix.
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(jenga.token))
      .send({ description: 'Clay bricks, 3 pallets', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', destLocation: { lat: 0.31, lng: 32.58 }, weightKg: 1200, packaging: 'palletised', packages: 3, pickupCountry: 'KE', destCountry: 'UG' })
      .expect(201);
    const id = posted.body.freightId as string;
    expect(posted.body.packages).toBe(3);
    const labels = (await http().get(`/v1/sbg/dispatch/freight/${id}/package-labels`).set(bearer(jenga.token)).expect(200)).body;
    expect(labels).toMatchObject({ labels: 3, packages: 3, companyPrefix: '6161234' });
    expect(labels.codes).toHaveLength(3);
    for (const c of labels.codes) {
      expect(isSscc(c)).toBe(true);
      expect(c.slice(0, 8)).toBe('36161234');
    }
    // Another business reads nothing of it.
    await http().get(`/v1/sbg/dispatch/freight/${id}/package-labels`).set(bearer(other.token)).expect(404);
    // More packages than can be labelled one by one: refused before the load exists.
    await http().post('/v1/sbg/dispatch/freight').set(bearer(jenga.token)).send({ description: 'Too many', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', weightKg: 1200, packages: 501 }).expect(400);

    // The commercial invoice: the shipper's to write. Staff and a fleet are refused in words; a line customs would stop is refused.
    const invoice = {
      number: 'INV-2026-0042',
      importer: { name: 'Kampala Build Co', address: 'Plot 4, Industrial Area', country: 'UG' },
      currency: 'USD',
      reason: 'sale',
      lines: [{ description: 'Clay bricks, fired', quantity: 3000, netKg: 1050, unitValue: 0.12, originCountry: 'KE', hsCode: '6904.10' }],
      declare: true,
    };
    const url = `/v1/sbg/dispatch/freight/${id}/commercial-invoice`;
    const staff = await http().post(url).set(bearer(operator)).send(invoice).expect(403);
    expect(staff.body.detail).toMatch(/shipper’s own paper/);
    await http().post(url).set(bearer(fleet)).send(invoice).expect(403);
    await http().post(url).set(bearer(other.token)).send(invoice).expect(404);
    await http().post(url).set(bearer(jenga.token)).send({ ...invoice, lines: [{ ...invoice.lines[0], hsCode: '69' }] }).expect(400);
    await http().post(url).set(bearer(jenga.token)).send({ ...invoice, declare: false }).expect(400);
    // A currency some country settles in: "KSH" is three letters and no currency.
    const ksh = await http().post(url).set(bearer(jenga.token)).send({ ...invoice, currency: 'KSH' }).expect(400);
    expect(ksh.body.detail).toBe('“KSH” is no currency we know — use its three-letter code, like KES or USD');

    // NO PAPERS, NO LOADING. The load is claimed by a driver (put so here: the border rules that decide who may carry it
    // are tested where they live); taking it over is refused until the shipper's invoice exists — the FIRST thing asked.
    const dispatch = app.get(DispatchService);
    Object.assign(dispatch.requireFreightPublic(id), { status: 'claimed', claimedBy: 'did:glos:papers-driver' });
    const takeOver = () => { try { dispatch.pickupFreight(id, 'did:glos:papers-driver', {}); return 'taken'; } catch (e) { return (e as { code?: string }).code; } };
    expect(takeOver()).toBe('COMMERCIAL_INVOICE_REQUIRED');
    expect((await http().get(url).set(bearer(jenga.token)).expect(200)).body).toMatchObject({ crossesBorder: true, collectable: false });

    // CMR Art. 8(2): what the driver noted at taking over binds the sender only where it agrees. Its own answer, once.
    const answer = `/v1/sbg/dispatch/freight/${id}/reservations/answer`;
    expect((await http().post(answer).set(bearer(jenga.token)).send({ agreed: true }).expect(400)).body.detail).toMatch(/wrote no reservations/);
    Object.assign(dispatch.requireFreightPublic(id), { reservations: { note: 'Two pallets wrapped loose', at: new Date().toISOString(), by: 'did:glos:papers-driver' } });
    await http().post(answer).set(bearer(other.token)).send({ agreed: true }).expect(404);
    await http().post(answer).set(bearer(jenga.token)).send({ agreed: false }).expect(400);
    const answered = (await http().post(answer).set(bearer(jenga.token)).send({ agreed: false, note: 'Wrapped tight at loading: see the photo' }).expect(201)).body;
    expect(answered.reservations.answer).toMatchObject({ agreed: false, note: 'Wrapped tight at loading: see the photo' });
    expect((await http().post(answer).set(bearer(jenga.token)).send({ agreed: true }).expect(400)).body.detail).toBe('You already disputed these reservations');
    const postedRow = (await http().get('/v1/sbg/dispatch/posted').set(bearer(jenga.token)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === id);
    expect(postedRow.reservations).toMatchObject({ note: 'Two pallets wrapped loose', answer: { agreed: false } });
    delete (dispatch.requireFreightPublic(id) as { reservations?: unknown }).reservations;
    // The shipper's own paper travels: staff may not say so for it; the shipper may. The next thing asked is the safety check.
    await http().post(`${url}/own-paper`).set(bearer(operator)).send({ travels: true }).expect(403);
    expect((await http().post(`${url}/own-paper`).set(bearer(jenga.token)).send({ travels: true }).expect(201)).body.ownPaper).toMatchObject({ by: 'Achieng' });
    expect(takeOver()).toBe('SAFETY_CHECK_INCOMPLETE');
    // Taken back: held again — and then the invoice, signed here, lets it go.
    await http().post(`${url}/own-paper`).set(bearer(jenga.token)).send({ travels: false }).expect(201);
    expect(takeOver()).toBe('COMMERCIAL_INVOICE_REQUIRED');
    const signed = (await http().post(url).set(bearer(jenga.token)).send(invoice).expect(201)).body;
    expect(signed).toMatchObject({ number: 'INV-2026-0042', totalValue: 360, packages: 3, grossKg: 1200, copies: 3, signed: { name: 'Achieng' } });
    expect(signed.lines[0]).toMatchObject({ hsCode: '690410', originCountry: 'KE', lineValue: 360 });
    expect(takeOver()).toBe('SAFETY_CHECK_INCOMPLETE');

    // The shipper may write a new one; staff read it and may not.
    expect((await http().get(url).set(bearer(jenga.token)).expect(200)).body).toMatchObject({ crossesBorder: true, mayWrite: true, current: { invoiceId: signed.invoiceId } });
    expect((await http().get(url).set(bearer(operator)).expect(200)).body).toMatchObject({ mayWrite: false, current: { invoiceId: signed.invoiceId } });

    // NEED-TO-KNOW (round 38, the user: "Carrier from pickup, cross-border only"). The carrier's office is told that an
    // invoice travels and nothing it says; the driver too, until the goods are taken over; from then on the driver reads it,
    // the paper to show at the border. On a load in one country it stays with the shipper.
    const managers = app.get(FleetManagerService);
    const n = digits();
    const office = managers.register({
      companyName: `Carrier ${n}`, contactPhone: `+2548${n}2`, ownerFullName: 'C C', ownerNationalId: `MGR-CAR-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-CAR-${n}`, transportOperatorLicence: `TOL-CAR-${n}`, taxId: `TAX-CAR-${n}` },
    });
    const officeToken = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: office.did, tenant: office.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    const d = (await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Opiyo', fullName: 'Opiyo Border', nationalId: `DRV-PAP-${n}`, mobile: `+2547${n}8`, licenceClasses: ['truck'], licenceNumber: `DL-PAP-${n}`, licenceExpiresAt: '2030-01-01' }).expect(201)).body;
    const driverToken = (await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    Object.assign(dispatch.requireFreightPublic(id), { carrierDid: office.did, claimedBy: d.did });
    for (const reader of [officeToken, driverToken]) {
      expect((await http().get(url).set(bearer(reader)).expect(200)).body).toEqual({ freightId: id, crossesBorder: true, collectable: true, earlier: [], mayWrite: false, withheld: true, travels: true });
      expect((await http().get(`${url}.html`).set(bearer(reader)).expect(403)).text).toMatch(/reads it from pickup on/);
    }
    const claimOf = () => dispatch.claimsFor(d.did).find((c) => c.ref === id);
    expect(claimOf()?.invoiceToShow).toBeUndefined();
    // Taken over: the driver reads it, and it is theirs to show at the border. The office still does not.
    Object.assign(dispatch.requireFreightPublic(id), { status: 'in_transit', pickedUpAt: new Date().toISOString() });
    expect((await http().get(url).set(bearer(driverToken)).expect(200)).body).toMatchObject({ current: { invoiceId: signed.invoiceId, totalValue: 360 } });
    expect((await http().get(`${url}.html`).set(bearer(driverToken)).expect(200)).text).toContain('6904.10');
    expect(claimOf()?.invoiceToShow).toBe(true);
    expect((await http().get(url).set(bearer(officeToken)).expect(200)).body.withheld).toBe(true);
    await http().get(`${url}.html`).set(bearer(officeToken)).expect(403);
    // In one country it stays with the shipper, even from the driver carrying it.
    Object.assign(dispatch.requireFreightPublic(id), { destCountry: 'KE' });
    expect((await http().get(url).set(bearer(driverToken)).expect(200)).body.withheld).toBe(true);
    expect(claimOf()?.invoiceToShow).toBeUndefined();
    expect((await http().get(url).set(bearer(jenga.token)).expect(200)).body.current.invoiceId).toBe(signed.invoiceId);
    Object.assign(dispatch.requireFreightPublic(id), { destCountry: 'UG', status: 'claimed', pickedUpAt: undefined, claimedBy: 'did:glos:papers-driver', carrierDid: undefined });

    // Printed: three copies; the labels name the papers in the pouch and carry each SSCC in its GS1-128 form.
    const copies = (await http().get(`${url}.html`).set(bearer(jenga.token)).expect(200)).text;
    expect((copies.match(/<section class="copy">/g) ?? []).length).toBe(3);
    expect(copies).toContain('6904.10');
    const page = (await http().get(`/v1/sbg/dispatch/freight/${id}/package-labels.html`).set(bearer(jenga.token)).expect(200)).text;
    expect((page.match(/<svg class="label"/g) ?? []).length).toBe(3);
    for (const c of labels.codes) expect(page).toContain(`(00) ${c}`);
    expect(page).toContain('In the pouch: commercial invoice INV-2026-0042, 3 copies');

    // The consignment note: box 5 lists the invoice, box 6 the SSCCs, box 7 the number of packages.
    const note = (await http().get(`/v1/sbg/dispatch/freight/${id}/consignment-note`).set(bearer(jenga.token)).expect(200)).body;
    // Kenya to Uganda: the Northern Corridor's road protocol, never the CMR (no CMR country at either end).
    expect(note.kind).toBe('northern_corridor');

    // The CMR check (2026-10-28): the sender names who receives the goods, declares dangerous goods by their UN number,
    // name, class and packing group, and gives its instructions for customs — and the note carries each where the CMR puts it.
    const paint = { description: 'Paint, 40 drums', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', destLocation: { lat: 0.31, lng: 32.58 }, weightKg: 900, packaging: 'drummed', packages: 40, natureCode: 'HAZ-CHEM', pickupCountry: 'KE', destCountry: 'UG' };
    const badUn = await http().post('/v1/sbg/dispatch/freight').set(bearer(jenga.token)).send({ ...paint, dangerousGoods: { unNumber: '12', properShippingName: 'Paint', hazardClass: '3' } }).expect(400);
    expect(JSON.stringify(badUn.body)).toContain('A UN number is UN and four digits, like UN1263');
    const declared = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(jenga.token))
        .send({ ...paint, consignee: { name: 'Kampala Build Co', address: 'Plot 4, Industrial Area' }, dangerousGoods: { unNumber: '1263', properShippingName: 'Paint', hazardClass: '3', packingGroup: 'III' }, customsInstructions: 'Cleared at Malaba by Pwani Clearing' })
        .expect(201)
    ).body;
    const paintNote = (await http().get(`/v1/sbg/dispatch/freight/${declared.freightId}/consignment-note`).set(bearer(jenga.token)).expect(200)).body;
    expect(paintNote.consignee).toMatchObject({ name: 'Kampala Build Co', address: 'Plot 4, Industrial Area', country: 'Uganda' });
    expect(paintNote.goods.dangerousGoods).toEqual({ unNumber: 'UN1263', properShippingName: 'Paint', hazardClass: '3', packingGroup: 'III' });
    expect(paintNote.instructions).toContain('For customs: Cleared at Malaba by Pwani Clearing');
    // A value declared (CMR Art. 6(2)(d)) is in a money some country uses; it goes in box 19.
    await http().post('/v1/sbg/dispatch/freight').set(bearer(jenga.token)).send({ ...paint, natureCode: 'GEN', declaredValue: { amount: 12500, currency: 'KSH' } }).expect(400);
    const valued = (await http().post('/v1/sbg/dispatch/freight').set(bearer(jenga.token)).send({ ...paint, natureCode: 'GEN', declaredValue: { amount: 12500, currency: 'usd' }, noTranshipment: true }).expect(201)).body;
    const valuedNote = (await http().get(`/v1/sbg/dispatch/freight/${valued.freightId}/consignment-note`).set(bearer(jenga.token)).expect(200)).body;
    expect(valuedNote.agreements).toEqual(['Value of the goods declared by the sender: 12,500 USD']);
    expect(valuedNote.instructions).toContain('Transhipment is not allowed: the goods stay on the vehicle that took them over');
    expect(note.documents).toContain('Commercial invoice INV-2026-0042 of ' + signed.issuedOn + ', 3 copies');
    expect(note.goods).toMatchObject({ packages: 3, marks: labels.codes.map((c: string) => `SSCC ${c}`) });

    // A client's goods, sent by the business as their expeditor: they carry the client's code, never the expeditor's.
    await http().patch('/v1/sbg/business/me').set(bearer(jenga.token)).send({ activities: ['shipper', 'expeditor'] }).expect(200);
    const client = (await http().post('/v1/sbg/business/me/clients').set(bearer(jenga.token)).send({ name: 'Kitui Clay Co' }).expect(201)).body;
    const forClient = await http().post('/v1/sbg/dispatch/freight').set(bearer(jenga.token)).send({ description: 'Their pots', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', weightKg: 300, packages: 2, forClientId: client.clientId }).expect(201);
    expect((await http().get(`/v1/sbg/dispatch/freight/${forClient.body.freightId}/package-labels`).set(bearer(jenga.token)).expect(200)).body).toMatchObject({ labels: 2, codes: [] });

    // Cleared, the prefix gives no more codes; the load keeps the ones it has.
    await http().delete('/v1/sbg/business/me/gs1').set(bearer(jenga.token)).expect(200);
    const later = await http().post('/v1/sbg/dispatch/freight').set(bearer(jenga.token)).send({ description: 'Tiles', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', weightKg: 500, packages: 2 }).expect(201);
    expect((await http().get(`/v1/sbg/dispatch/freight/${later.body.freightId}/package-labels`).set(bearer(jenga.token)).expect(200)).body).toMatchObject({ labels: 2, codes: [] });
    expect((await http().get(`/v1/sbg/dispatch/freight/${id}/package-labels`).set(bearer(jenga.token)).expect(200)).body.codes).toEqual(labels.codes);
  });
});
