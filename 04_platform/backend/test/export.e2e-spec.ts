import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BooksService } from '../src/foundation/books/books.service';
import { EntityService } from '../src/foundation/entity/entity.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { ExportService } from '../src/modules/pudo/export.service';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { AGREED } from './agreed';
import { CONTENTS_PNG } from './content-photo';

/**
 * EXPORTS TO THE PORT (the user, 2026-10-27: "The missing for goods going to a port should be build"). One container leaving
 * through Mombasa, from the exporter's side of the gate: the forwarder's booking and its cut-off, the empty out, the box
 * stuffed and sealed, the laden leg to the terminal, the VGM, the papers, and the file for the forwarder — and the bill of
 * lading's number recorded back. Nothing of the sea is ours: no rate, no booking with a line, nothing sent to one.
 */
describe('an export to the port, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;

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

  /** A tea exporter in Nairobi, with its warehouse, the Mombasa terminal and the empty depot on its list of places. */
  async function anExporter(): Promise<{ token: string; entityId: string; loading: string; terminal: string; depot: string }> {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `export-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Kericho Tea ${digits()}`, country: 'KE', registrationNo: `EXP-${digits()}`, activities: ['shipper'], yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return {
      token,
      entityId,
      loading: await site('loading', 'Kericho warehouse', { lat: -1.32, lng: 36.85 }),
      terminal: await site('port', 'Kipevu container terminal', { lat: -4.05, lng: 39.65 }),
      depot: await site('port', 'Embakasi empty depot', { lat: -1.31, lng: 36.9 }),
    };
  }

  const booking = (cutoff: number) => ({ reference: `MBA${digits()}`, bookedWith: 'forwarder', partyName: 'Pwani Forwarders', vessel: 'MSC Nairobi', voyage: '044E', gateCutoffAt: new Date(cutoff).toISOString(), vgmCutoffAt: new Date(cutoff - 2 * H).toISOString(), emptyReleaseRef: 'REL-7781' });

  it('booked, emptied out, stuffed and sealed, weighed, papered, to the terminal — and the file for the forwarder', async () => {
    const x = await anExporter();
    const cutoff = Date.now() + 48 * H;
    const base = { goodsDescription: 'Black tea, 640 sacks', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '22G1', booking: booking(cutoff), loadingSiteId: x.loading, terminalSiteId: x.terminal, emptyDepotSiteId: x.depot };

    // The facts the road needs come first: no booking number, no cut-off, no box type — refused, nothing written.
    expect((await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ ...base, booking: { ...base.booking, reference: '' } })).status).toBe(400);
    expect((await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ ...base, containerType: undefined })).status).toBe(400);
    // A terminal must be one of its port places, the loading place one of its loading places.
    expect((await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ ...base, loadingSiteId: x.terminal })).status).toBe(400);
    // Staff write nothing in its name.
    const staff = await http().post('/v1/sbg/exports').set(bearer(operator)).send({ ...base, exporterEntityId: x.entityId });
    expect([staff.status, staff.body.detail]).toEqual([403, 'An export is the exporter’s to write, signed in as itself: staff read it, and write nothing in its name']);

    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send(base).expect(201)).body;
    expect(made).toMatchObject({ code: expect.stringMatching(/^EXP-\d{3}$/), booking: { reference: base.booking.reference, partyName: 'Pwani Forwarders', emptyReleaseRef: 'REL-7781' }, loadingPlace: { label: 'Kericho warehouse' }, terminal: { label: 'Kipevu container terminal' } });
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async () => (await http().get(path).set(bearer(x.token)).expect(200)).body;

    // EX1 — the timing, derived: when the box must leave to be inside the gate, on time for now.
    const first = await read();
    expect(first.timing).toMatchObject({ state: 'on_time', roadKm: expect.any(Number), plannedHours: expect.any(Number) });
    expect(Date.parse(first.timing.leaveByAt)).toBeLessThan(cutoff);
    expect(Date.parse(first.timing.leaveByAt)).toBeCloseTo(cutoff - first.timing.plannedHours * H, -5);
    expect(first.missing).toEqual(expect.arrayContaining(['The box’s number', 'A load to the terminal', 'The verified gross mass', 'Commercial invoice', 'Packing list', 'Export entry (from your clearing agent)']));
    expect(first.missing).not.toContain('Certificate of origin');
    // Another company is told there is no such export; staff read it.
    const other = await anExporter();
    expect((await http().get(path).set(bearer(other.token))).status).toBe(404);
    expect((await http().get(path).set(bearer(operator)).expect(200)).body.consignment.code).toBe(made.code);

    // EX2 — the empty out: a run from the depot to the warehouse, carrying the release number.
    const empty = (await http().post(`${path}/empty-leg`).set(bearer(x.token)).expect(201)).body.emptyLeg;
    const emptyLoad = app.get(DispatchService).requireFreightPublic(empty.freightId);
    expect(emptyLoad).toMatchObject({ emptyRun: true, pickupLabel: 'Embakasi empty depot', destLabel: 'Kericho warehouse' });
    expect(emptyLoad.instructions?.text ?? JSON.stringify(emptyLoad)).toContain('REL-7781');
    expect((await http().post(`${path}/empty-leg`).set(bearer(x.token))).status).toBe(409);

    // The box's number, checked by its digit; no load to the terminal before it.
    expect((await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({ weightKg: 18000 })).status).toBe(400);
    expect((await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234560' })).status).toBe(400);
    await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);

    // EX3 — the verified gross mass, signed for; it becomes the laden load's weight.
    expect((await http().post(`${path}/vgm`).set(bearer(x.token)).send({ method: 1, kg: 900, signatory: 'Wanjiku' })).status).toBe(400);
    await http().post(`${path}/vgm`).set(bearer(x.token)).send({ method: 1, kg: 18640, weighbridge: 'Kericho county weighbridge', ticketRef: 'WB-0912', signatory: 'Wanjiku Mwangi' }).expect(201);

    const laden = (await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({}).expect(201)).body.ladenLeg;
    const ladenLoad = app.get(DispatchService).requireFreightPublic(laden.freightId);
    expect(ladenLoad).toMatchObject({ weightKg: 18640, containerNo: 'MSCU1234566', pickupLabel: 'Kericho warehouse', destLabel: 'Kipevu container terminal' });
    expect(JSON.stringify(ladenLoad)).toContain(base.booking.reference);
    expect(JSON.stringify(ladenLoad)).toContain('vessel cut-off');

    // The seal is written on the laden load, with its three photographs — the one way a load is sealed. Until then it is missing.
    expect((await read()).missing).toContain('A seal written on the load to the terminal');
    const photo = async () => (await http().post('/v1/sbg/media').set(bearer(x.token)).send({ kind: 'seal', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/dispatch/freight/${laden.freightId}/seals`).set(bearer(x.token)).send({ number: 'KE 552190', sealClass: 'H', appliedBy: 'sender', photos: { loadedOpen: await photo(), closedWithSeal: await photo(), sealCloseUp: await photo() } }).expect(201);

    // EX4 — the papers: its own documents, or the export entry's reference.
    expect((await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'commercial_invoice', documentId: 'doc_nope' })).status).toBe(404);
    for (const key of ['commercial_invoice', 'packing_list']) await http().post(`${path}/papers`).set(bearer(x.token)).send({ key, reference: `${key}-2026-117` }).expect(201);
    await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'export_entry', reference: '2026KEMSA7712045' }).expect(201);

    const ready = await read();
    expect(ready.missing).toEqual([]);
    expect(ready.seals).toEqual([expect.objectContaining({ number: 'KE 552190', state: 'on' })]);

    // EX5 — the bill of lading's number, once the forwarder issued it; and the file the forwarder takes at the gate.
    await http().post(`${path}/bill-of-lading`).set(bearer(x.token)).send({ number: 'MEDU8812345' }).expect(201);
    const file = (await http().get(`${path}/handover.html`).set(bearer(x.token)).expect(200)).text;
    for (const fact of [made.code, base.booking.reference, 'Pwani Forwarders', 'MSC Nairobi', 'MSCU1234566', 'KE 552190', '18,640 kg', 'Wanjiku Mwangi', '2026KEMSA7712045', `CMR-${laden.code}`, 'MEDU8812345']) expect(file).toContain(fact);
    expect(file).not.toContain('Still missing');
    expect(file).toContain('SeeBuyGet sends nothing to a line');

    // Delivered at the terminal: gated in.
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const at = new Date().toISOString();
    store.set(laden.freightId, { ...store.get(laden.freightId), status: 'delivered', pickedUpAt: at, deliveredAt: at });
    expect((await read()).timing).toMatchObject({ state: 'gated_in', gatedInAt: at, collectedAt: at });
    expect(app.get(BooksService).balances(app.get(EntityService).requireForJurisdiction('KE').entityId)).toEqual({ balanced: true, drift: 0 });
  });

  it('the cut-off watch: told when the box must leave, when the gate closed without it, and when the VGM is due — once each', async () => {
    const x = await anExporter();
    const cutoff = Date.now() + 30 * H;
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Cut roses', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '45R1', booking: booking(cutoff), loadingSiteId: x.loading, terminalSiteId: x.terminal }).expect(201)).body;
    const exports = app.get(ExportService);
    const timing = exports.timingOf(exports.detail(made.exportId, x.entityId).consignment);
    const leaveBy = Date.parse(timing.leaveByAt);
    // Not yet: more than six hours before the latest departure.
    expect(exports.sweep(leaveBy - 7 * H).filter((t) => t.startsWith(made.code))).toEqual([]);
    // Six hours before it, nothing collected: told to leave by then.
    expect(exports.sweep(leaveBy - 5 * H).filter((t) => t.startsWith(made.code))).toEqual([`${made.code}:pickup`]);
    expect(exports.sweep(leaveBy - 4 * H).filter((t) => t.startsWith(made.code))).toEqual([]);
    // Past the latest departure: at risk.
    expect(exports.timingOf(exports.detail(made.exportId, x.entityId).consignment, leaveBy + H).state).toBe('at_risk');
    // Twelve hours before the VGM cut-off, none declared: told. At the gate cut-off, not inside: told, and missed.
    const vgmCut = cutoff - 2 * H;
    expect(exports.sweep(vgmCut - 11 * H).filter((t) => t.startsWith(made.code))).toEqual([`${made.code}:vgm`]);
    expect(exports.sweep(cutoff + 1).filter((t) => t.startsWith(made.code))).toEqual([`${made.code}:gate`]);
    expect(exports.timingOf(exports.detail(made.exportId, x.entityId).consignment, cutoff + 1).state).toBe('missed');
    // In the business's bell.
    const did = app.get(EntityService).get(x.entityId).did;
    const titles = app.get(NotificationService).inboxFor(did).map((n) => n.title);
    expect(titles.some((t) => t.startsWith(`${made.code}: the box must leave by`))).toBe(true);
    expect(titles).toEqual(expect.arrayContaining([`${made.code}: the gate closed without the box`, `${made.code}: declare the verified gross mass`]));
    // After the cut-off, no load to the terminal is posted: a new vessel, a new cut-off first.
    exports.setContainer(made.exportId, x.entityId, 'MSCU1234566');
    expect(() => exports.mintLadenLeg(made.exportId, x.entityId, { weightKg: 20000 }, 'Wanjiku', cutoff + 1)).toThrow(/The gate closed for this booking/);
  });
});
