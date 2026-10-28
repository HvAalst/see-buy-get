import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'crypto';
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
  async function anExporter(activities: string[] = ['shipper'], called = 'Kericho Tea'): Promise<{ token: string; entityId: string; name: string; loading: string; terminal: string; depot: string }> {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `export-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${called} ${digits()}`, country: 'KE', registrationNo: `EXP-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return {
      token,
      entityId,
      name: made.business.name as string,
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

    // The letter of instruction, filled in and signed on the export (EX9).
    await http().post(`${path}/sli`).set(bearer(x.token)).send({ consigneeKind: 'to_order', notify: { name: 'Van Rees Tea BV', address: 'Rotterdam' }, dischargePort: 'Rotterdam', freight: 'prepaid', blRelease: 'sea_waybill', lines: [{ packages: 640, packageKind: 'sacks', description: 'Black tea', grossKg: 18640 }] }).expect(201);
    await http().post(`${path}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' }).expect(201);
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
  /*
   * EX6 — THE BOX'S CLOCK ON AN EXPORT (the user, 2026-10-28: "1 and 2 are clear addition to what you built here"). The
   * import's clock the other way round: detention while the box is outside, from the empty out to the gate; demurrage
   * while it waits inside, from the gate to the ship. Dates and whole days, never money; the free days are the exporter's
   * figure, and no figure means no date.
   */
  it('the box’s clock: outside until the gate, inside until it is loaded — the exporter’s free days, counted and warned, never charged', async () => {
    const x = await anExporter();
    const D = 24 * H;
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Avocados, 1,600 cartons', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '45R1', booking: booking(Date.now() + 20 * D), loadingSiteId: x.loading, terminalSiteId: x.terminal, emptyDepotSiteId: x.depot }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async () => (await http().get(path).set(bearer(x.token)).expect(200)).body;
    const mine = (told: string[]) => told.filter((t) => t.startsWith(`${made.code}:`));
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;

    // Before the empty is out, no clock runs — and nobody guesses at one.
    expect((await read()).box).toMatchObject({ kind: 'unknown', overdue: false, dueSoon: false });

    // Our empty load fetches it: its pickup starts detention, and a typed second date is refused.
    const empty = (await http().post(`${path}/empty-leg`).set(bearer(x.token)).expect(201)).body.emptyLeg;
    const typed = await http().post(`${path}/empty-out`).set(bearer(x.token)).send({ at: new Date(Date.now() - H).toISOString() });
    expect([typed.status, typed.body.detail]).toEqual([400, `The empty is fetched on load ${empty.code}: its pickup says when it left the depot`]);
    const out = new Date(Date.now() - 5 * D - H).toISOString();
    store.set(empty.freightId, { ...store.get(empty.freightId), status: 'delivered', pickedUpAt: out, deliveredAt: out });
    const running = (await read()).box;
    expect(running).toMatchObject({ kind: 'detention', since: out, daysElapsed: 5, overdue: false, emptyOutAt: out, emptyOutFrom: 'load' });
    expect(running.dueAt).toBeUndefined();
    expect(running.basis).toContain('Nobody has said how many free days the line gives');

    // The free days: the exporter's figure, a whole number; staff give none in its name. A correction is a second claim.
    expect((await http().post(`${path}/free-days`).set(bearer(x.token)).send({ kind: 'detention', days: 120 })).status).toBe(400);
    // And the record refuses it itself, whatever door it came through.
    expect(() => app.get(ExportService).claimFreeDays(made.exportId, x.entityId, 'detention', 120, 'Wanjiku')).toThrow('Free days are a whole number of days, 0 to 90');
    expect(() => app.get(ExportService).claimFreeDays(made.exportId, x.entityId, 'detention', 2.5, 'Wanjiku')).toThrow('Free days are a whole number of days, 0 to 90');
    const staff = await http().post(`${path}/free-days`).set(bearer(operator)).send({ kind: 'detention', days: 7 });
    expect([staff.status, staff.body.detail]).toEqual([403, 'An export is the exporter’s to write, signed in as itself: staff read it, and write nothing in its name']);
    await http().post(`${path}/free-days`).set(bearer(x.token)).send({ kind: 'detention', days: 7 }).expect(201);
    await http().post(`${path}/free-days`).set(bearer(x.token)).send({ kind: 'detention', days: 6 }).expect(201);
    const counted = await read();
    expect(counted.consignment.freeDays).toHaveLength(2);
    expect(counted.box).toMatchObject({ kind: 'detention', freeDays: 6, daysLeft: 1, dueSoon: true, overdue: false, dueAt: new Date(Date.parse(out) + 6 * D).toISOString() });

    // The watch: once inside the three days, once more when the date passed — and never twice for the same date.
    const exports = app.get(ExportService);
    const now = Date.now();
    expect(mine(exports.sweep(now))).toEqual([`${made.code}:box:detention:soon`]);
    expect(mine(exports.sweep(now + H))).toEqual([]);
    expect(mine(exports.sweep(now + 2 * D))).toEqual([`${made.code}:box:detention:over`]);
    expect(mine(exports.sweep(now + 2 * D + H))).toEqual([]);
    const did = app.get(EntityService).get(x.entityId).did;
    const titles = app.get(NotificationService).inboxFor(did).map((n) => n.title);
    expect(titles.some((t) => t.startsWith(`${made.code}: the box’s free days outside the terminal end`))).toBe(true);
    expect(titles).toContain(`${made.code}: the box’s free days outside the terminal ran out`);

    // Not loaded on board before it is inside the gate.
    const early = await http().post(`${path}/loaded`).set(bearer(x.token)).send({ at: new Date().toISOString() });
    expect([early.status, early.body.detail]).toEqual([400, `${made.code} is not inside the terminal yet: a box is loaded on board only after it gated in`]);

    // Inside the gate: detention closes on whole days, demurrage runs from the gate.
    await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);
    const laden = (await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({ weightKg: 21000 }).expect(201)).body.ladenLeg;
    const gated = new Date(Date.now() - D - H).toISOString();
    store.set(laden.freightId, { ...store.get(laden.freightId), status: 'delivered', pickedUpAt: gated, deliveredAt: gated });
    const inside = (await read()).box;
    expect(inside).toMatchObject({ kind: 'demurrage', since: gated, daysElapsed: 1, detentionDays: 4, overdue: false });
    expect(inside.dueAt).toBeUndefined();
    await http().post(`${path}/free-days`).set(bearer(x.token)).send({ kind: 'demurrage', days: 3 }).expect(201);
    expect((await read()).box).toMatchObject({ kind: 'demurrage', freeDays: 3, daysLeft: 2, dueSoon: true });
    expect(mine(exports.sweep(now))).toEqual([`${made.code}:box:demurrage:soon`]);

    // Loaded on board: never before the gate, never ahead of now — and then the clock has stopped.
    expect((await http().post(`${path}/loaded`).set(bearer(x.token)).send({ at: new Date(Date.parse(gated) - H).toISOString() })).status).toBe(400);
    expect((await http().post(`${path}/loaded`).set(bearer(x.token)).send({ at: new Date(Date.now() + 2 * H).toISOString() })).status).toBe(400);
    await http().post(`${path}/loaded`).set(bearer(x.token)).send({ at: new Date().toISOString() }).expect(201);
    const stopped = (await read()).box;
    expect(stopped).toMatchObject({ kind: 'stopped', overdue: false, detentionDays: 4, demurrageDays: 1 });
    expect(stopped.basis).toContain('Loaded on board on');
    expect((await http().post(`${path}/free-days`).set(bearer(x.token)).send({ kind: 'demurrage', days: 5 })).status).toBe(400);
    expect(mine(exports.sweep(now + 9 * D))).toEqual([]);

    // The file for the forwarder carries the clock in words.
    const file = (await http().get(`${path}/handover.html`).set(bearer(x.token)).expect(200)).text;
    for (const fact of ['The box’s clock', 'Free days outside the terminal (detention)', '6 days, said by', 'Free days inside the terminal (demurrage)', '3 days, said by', 'Loaded on board']) expect(file).toContain(fact);
  });

  /*
   * EX7 — A CLEARING AGENT ON AN EXPORT. The import's appointment, the other way: the exporter appoints, the agent reads the
   * papers attached on this export (and nothing else of the exporter's), gives the export entry, and accepts each paper or
   * sends it back with a reason. Ended, the reading ends on the same call. Both sides are told.
   */
  it('a clearing agent: appointed by the exporter, reads what is attached, gives the entry, accepts or sends back — and reads nothing once it ends', async () => {
    const x = await anExporter();
    const agent = await anExporter(['clearing_agent'], 'Pwani Clearing');
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Green coffee, 320 bags', originCountry: 'KE', destCountry: 'DE', loadingPort: 'Mombasa', containerType: '22G1', booking: booking(Date.now() + 72 * H), loadingSiteId: x.loading, terminalSiteId: x.terminal }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async (token = x.token) => (await http().get(path).set(bearer(token)).expect(200)).body;
    const bell = (entityId: string) => app.get(NotificationService).inboxFor(app.get(EntityService).get(entityId).did).map((n) => n.title);
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% invoice 117\n%%EOF\n').toString('base64')}`;
    const invoice = (await http().post(`/v1/sbg/entities/${x.entityId}/documents`).set(bearer(x.token)).send({ kind: 'commercial_invoice', title: 'Invoice 117', dataUrl: pdf }).expect(201)).body.documentId as string;
    await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'commercial_invoice', documentId: invoice }).expect(201);
    await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'packing_list', reference: 'PL-117' }).expect(201);

    // Before any appointment the agent is told there is no such export, and reads none of its papers.
    expect((await http().get(path).set(bearer(agent.token))).status).toBe(404);
    expect((await http().get(`${path}/papers/commercial_invoice/file`).set(bearer(agent.token))).status).toBe(404);
    expect((await http().get('/v1/sbg/exports').set(bearer(agent.token)).expect(200)).body.items.some((r: { exportId: string }) => r.exportId === made.exportId)).toBe(false);

    // The exporter's decision alone: staff appoint nobody in its name, and appointing itself grants nothing.
    const staff = await http().post(`${path}/agent`).set(bearer(operator)).send({ agentEntityId: agent.entityId });
    expect([staff.status, staff.body.detail]).toEqual([403, 'An export is the exporter’s to write, signed in as itself: staff read it, and write nothing in its name']);
    expect((await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: x.entityId })).status).toBe(400);
    const appointed = (await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: agent.entityId }).expect(201)).body;
    expect(appointed.agent).toMatchObject({ entityId: agent.entityId, name: agent.name });
    // Never a silent swap: a second appointment waits until the first is ended.
    const twice = await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: (await anExporter(['clearing_agent'])).entityId });
    expect([twice.status, String(twice.body.detail)]).toEqual([400, expect.stringContaining(`${agent.name} is already appointed on ${made.code}`)]);

    // The agent is told, finds it among its exports, and reads what is attached — not the exporter's other papers.
    expect(bell(agent.entityId)).toContain(`${made.code}: you are appointed to clear an export`);
    const row = (await http().get('/v1/sbg/exports').set(bearer(agent.token)).expect(200)).body.items.find((r: { exportId: string }) => r.exportId === made.exportId);
    expect(row).toMatchObject({ you: 'agent', exporterName: x.name });
    const seen = await read(agent.token);
    expect(seen).toMatchObject({ you: 'agent', exporterName: x.name, documents: [] });
    const file = await http().get(`${path}/papers/commercial_invoice/file`).set(bearer(agent.token)).expect(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.headers['x-fingerprint-intact']).toBe('true');
    expect((await http().get(`${path}/papers/packing_list/file`).set(bearer(agent.token))).status).toBe(404);
    expect((await http().get(`${path}/papers/commercial_invoice/file`).set(bearer(operator))).status).toBe(200);

    // The agent writes none of the exporter's papers — and gives the entry, its own work; the exporter is told.
    const theirs = await http().post(`${path}/papers`).set(bearer(agent.token)).send({ key: 'packing_list', reference: 'PL-999' });
    expect([theirs.status, theirs.body.detail]).toEqual([403, 'The exporter supplies its own papers: as its clearing agent you give the export entry, and accept or send back the rest']);
    const entry = (await http().post(`${path}/papers`).set(bearer(agent.token)).send({ key: 'export_entry', reference: '2026KEMSA7712045' }).expect(201)).body;
    expect(entry.papers.find((p: { key: string }) => p.key === 'export_entry')).toMatchObject({ reference: '2026KEMSA7712045', acceptedAt: expect.any(String) });
    expect(bell(x.entityId)).toContain(`${made.code}: your clearing agent gave the export entry`);

    // Its word on each paper: accepted, or sent back with a reason. The exporter gives no word on its own papers.
    expect((await http().post(`${path}/papers/packing_list/refuse`).set(bearer(agent.token)).send({ reason: '' })).status).toBe(400);
    expect((await http().post(`${path}/papers/commercial_invoice/accept`).set(bearer(x.token))).status).toBe(403);
    await http().post(`${path}/papers/packing_list/refuse`).set(bearer(agent.token)).send({ reason: 'The weights do not match the invoice' }).expect(201);
    await http().post(`${path}/papers/commercial_invoice/accept`).set(bearer(agent.token)).expect(201);
    const back = await read();
    expect(back.missing).toContain('Packing list — sent back by your clearing agent: The weights do not match the invoice');
    expect(back.papers.find((p: { key: string }) => p.key === 'commercial_invoice')).toMatchObject({ acceptedAt: expect.any(String) });
    expect(bell(x.entityId)).toContain(`${made.code}: your clearing agent sent back the packing list`);

    // Supplied again: the old word no longer stands, and the agent is told to read it.
    const again = (await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'packing_list', reference: 'PL-117b' }).expect(201)).body;
    expect(again.papers.find((p: { key: string }) => p.key === 'packing_list').refusedAt).toBeUndefined();
    expect(again.missing.some((m: string) => m.startsWith('Packing list'))).toBe(false);
    expect(bell(agent.entityId)).toContain(`${made.code}: the packing list was supplied again`);

    // The file for the forwarder names the agent and its word.
    const handover = (await http().get(`${path}/handover.html`).set(bearer(agent.token)).expect(200)).text;
    expect(handover).toContain(agent.name);
    expect(handover).toContain('accepted by');

    // Ended: at once, kept on the record, the agent told — and it reads nothing more.
    const ended = (await http().post(`${path}/agent/end`).set(bearer(x.token)).send({ reason: 'Cleared by our own office' }).expect(201)).body;
    expect(ended.agent).toBeUndefined();
    expect(ended.consignment.formerAgents).toEqual([expect.objectContaining({ entityId: agent.entityId, reason: 'Cleared by our own office' })]);
    expect(bell(agent.entityId)).toContain(`${made.code}: your appointment ended`);
    expect((await http().get(path).set(bearer(agent.token))).status).toBe(404);
    expect((await http().get(`${path}/papers/commercial_invoice/file`).set(bearer(agent.token))).status).toBe(404);
    expect((await http().post(`${path}/papers/commercial_invoice/accept`).set(bearer(agent.token))).status).toBe(404);
  });
  /*
   * EX8 — THE AGENT'S FEE (the user, 2026-10-28: "ok, great, implement it"). The import's bargain on an export: the agent
   * quotes, the exporter agrees, either says it is paid — a quotation between them, nothing through us. One per
   * appointment: a new agent quotes its own, and the former one's stays on its record.
   */
  it('the agent’s fee: quoted by the agent, agreed by the exporter, paid as either says — one quotation per appointment', async () => {
    const x = await anExporter();
    const agent = await anExporter(['clearing_agent'], 'Pwani Clearing');
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Cut roses', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '45R1', booking: booking(Date.now() + 72 * H), loadingSiteId: x.loading, terminalSiteId: x.terminal }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const bell = (entityId: string) => app.get(NotificationService).inboxFor(app.get(EntityService).get(entityId).did).map((n) => n.title);

    // No agent, no fee: nobody quotes on an export it was not appointed on.
    expect((await http().post(`${path}/fee`).set(bearer(agent.token)).send({ amount: 18000 })).status).toBe(404);
    await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: agent.entityId }).expect(201);
    expect((await http().get(path).set(bearer(x.token)).expect(200)).body.feeState).toBe('none');
    // The exporter quotes nothing to itself; the agent quotes, in the currency of where it is sent from unless it says.
    expect((await http().post(`${path}/fee`).set(bearer(x.token)).send({ amount: 18000 })).status).toBe(403);
    expect((await http().post(`${path}/fee`).set(bearer(agent.token)).send({ amount: 0 })).status).toBe(400);
    const quoted = (await http().post(`${path}/fee`).set(bearer(agent.token)).send({ amount: 18000, reference: 'PC-2026-044', note: 'Export entry and documents' }).expect(201)).body;
    expect(quoted).toMatchObject({ feeState: 'quoted', fee: { amount: 18000, currency: 'KES', reference: 'PC-2026-044', issuer: { entityId: agent.entityId }, payer: { entityId: x.entityId }, subject: { kind: 'export', code: made.code } } });
    expect(bell(x.entityId)).toContain(`${made.code}: your clearing agent quoted its fee`);

    // Agreed by the exporter only; the agent is told. A re-quote drops the agreement — it is a different number.
    expect((await http().post(`${path}/fee/accept`).set(bearer(agent.token))).status).toBe(404);
    expect((await http().post(`${path}/fee/accept`).set(bearer(x.token)).expect(201)).body.feeState).toBe('accepted');
    expect(bell(agent.entityId)).toContain(`${made.code}: the exporter agreed to your fee`);
    const requoted = (await http().post(`${path}/fee`).set(bearer(agent.token)).send({ amount: 19500 }).expect(201)).body;
    expect(requoted).toMatchObject({ feeState: 'quoted', fee: { quoteId: quoted.fee.quoteId, amount: 19500 } });
    await http().post(`${path}/fee/accept`).set(bearer(x.token)).expect(201);

    // Paid as a party says, with its reference — on the quotation itself; staff say nothing in their name.
    const quoteId = quoted.fee.quoteId as string;
    expect((await http().post(`/v1/sbg/quotes/${quoteId}/status`).set(bearer(operator)).send({ status: 'paid' })).status).toBe(404);
    await http().post(`/v1/sbg/quotes/${quoteId}/status`).set(bearer(x.token)).send({ status: 'paid', reference: 'QJK4TR21XY' }).expect(201);
    const paid = (await http().get(path).set(bearer(agent.token)).expect(200)).body;
    expect(paid).toMatchObject({ feeState: 'paid', fee: { status: 'paid', paidReference: 'QJK4TR21XY' } });
    expect((await http().post(`${path}/fee`).set(bearer(agent.token)).send({ amount: 21000 })).status).toBe(400);
    // Staff read the fee, change nothing.
    expect((await http().get(path).set(bearer(operator)).expect(200)).body.fee.quoteId).toBe(quoteId);

    // The appointment ends: its quotation stays on its record; the next agent quotes its own, from nothing.
    const ended = (await http().post(`${path}/agent/end`).set(bearer(x.token)).send({}).expect(201)).body;
    expect(ended.fee).toBeUndefined();
    // And the export itself carries no stale stamp of a fee from an appointment that ended.
    expect(ended.consignment.fee).toBeUndefined();
    expect(ended.feeState).toBe('none');
    expect(ended.consignment.formerAgents[0]).toMatchObject({ entityId: agent.entityId, feeQuoteId: quoteId });
    const next = await anExporter(['clearing_agent'], 'Kilindini Clearing');
    await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: next.entityId }).expect(201);
    const fresh = (await http().post(`${path}/fee`).set(bearer(next.token)).send({ amount: 15000, currency: 'usd' }).expect(201)).body;
    expect(fresh.fee.quoteId).not.toBe(quoteId);
    expect(fresh).toMatchObject({ feeState: 'quoted', fee: { amount: 15000, currency: 'USD', issuer: { entityId: next.entityId } } });
  });

  /* EX6b — A BOX THE EXPORTER OWNS: nobody lent it, so no line's free days run on it, and nobody is warned about them. */
  it('a box the exporter owns: no line’s clock, no free days, no warning — until it says the box is the line’s after all', async () => {
    const x = await anExporter();
    const D = 24 * H;
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Machine parts', originCountry: 'KE', destCountry: 'TZ', loadingPort: 'Mombasa', containerType: '22G1', booking: booking(Date.now() + 20 * D), loadingSiteId: x.loading, terminalSiteId: x.terminal, ownBox: true }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async () => (await http().get(path).set(bearer(x.token)).expect(200)).body;
    expect(made.ownBox).toMatchObject({ by: expect.any(String) });
    await http().post(`${path}/empty-out`).set(bearer(x.token)).send({ at: new Date(Date.now() - 9 * D).toISOString() }).expect(201);
    const owned = (await read()).box;
    expect(owned).toMatchObject({ kind: 'owned', overdue: false, dueSoon: false });
    expect(owned.basis).toContain('shipper-owned');
    // No line's free days on it — and the watch says nothing, however long it is out.
    const refused = await http().post(`${path}/free-days`).set(bearer(x.token)).send({ kind: 'detention', days: 5 });
    expect([refused.status, refused.body.detail]).toEqual([400, 'The box is your own: no line lent it, so no line’s free days run on it']);
    const exports = app.get(ExportService);
    expect(exports.sweep(Date.now()).filter((t) => t.startsWith(`${made.code}:box`))).toEqual([]);
    expect((await http().get(`${path}/handover.html`).set(bearer(x.token)).expect(200)).text).toContain('The exporter (a shipper-owned container)');
    // Staff say nothing about whose box it is.
    expect((await http().post(`${path}/own-box`).set(bearer(operator)).send({ own: false })).status).toBe(403);
    // The line's after all: the clock runs from the empty out, and the free days can be given.
    expect((await http().post(`${path}/own-box`).set(bearer(x.token)).send({ own: false }).expect(201)).body.box).toMatchObject({ kind: 'detention', daysElapsed: 9 });
    await http().post(`${path}/free-days`).set(bearer(x.token)).send({ kind: 'detention', days: 7 }).expect(201);
    expect((await read()).box).toMatchObject({ kind: 'detention', overdue: true });
  });
  /*
   * THE PAPERS AN EXPORT HOLDS (the user, 2026-10-28: "in the exports field I miss quiet a bit of documents. Shouldn't we
   * add them? we don't book but we hold documents as a report"). Needed on every export; kept when there is one; asked
   * for when the goods, the buyer or the destination need it — by the exporter or its agent, attributed; another by name.
   */
  it('the papers an export holds: needed, kept when there is one, and asked for these goods — by whoever knows they are needed', async () => {
    const x = await anExporter();
    const agent = await anExporter(['clearing_agent'], 'Pwani Clearing');
    const base = { goodsDescription: 'Fresh avocados, 1,600 cartons', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '45R1', booking: booking(Date.now() + 72 * H), loadingSiteId: x.loading, terminalSiteId: x.terminal };
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send(base).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async (token = x.token) => (await http().get(path).set(bearer(token)).expect(200)).body;
    const line = (d: { papers: Array<{ key: string }> }, key: string) => d.papers.find((p) => p.key === key) as Record<string, unknown> | undefined;
    const bell = (entityId: string) => app.get(NotificationService).inboxFor(app.get(EntityService).get(entityId).did).map((n) => n.title);

    // Every export: the three needed, the four kept when there is one — and nothing asked for yet.
    const first = await read();
    const groups = Object.fromEntries(first.papers.map((p: { key: string; group: string }) => [p.key, p.group]));
    expect(groups).toEqual({ commercial_invoice: 'needed', packing_list: 'needed', export_entry: 'needed', booking_confirmation: 'kept', shipping_instructions: 'needed', weighbridge_ticket: 'kept', bill_of_lading: 'kept' });
    for (const kept of ['Booking confirmation', 'Weighbridge ticket', 'Bill of lading']) expect(first.missing).not.toContain(kept);
    // Hazardous goods carry their declaration from the start.
    const hazardous = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ ...base, goodsDescription: 'Paint, 400 drums', natureCode: 'HAZ-CHEM' }).expect(201)).body;
    expect(hazardous.papers.map((p: { key: string }) => p.key)).toContain('dangerous_goods_declaration');
    expect((await http().get(`/v1/sbg/exports/${hazardous.exportId}`).set(bearer(x.token)).expect(200)).body.missing).toContain('Dangerous goods declaration');

    // Asked for these goods by the exporter: on the list, counted missing, its own to take off while nothing is given.
    expect((await http().post(`${path}/papers/add`).set(bearer(x.token)).send({ key: 'packing_list' })).status).toBe(400);
    expect((await http().post(`${path}/papers/add`).set(bearer(x.token)).send({ key: 'no_such_paper' })).status).toBe(404);
    const staff = await http().post(`${path}/papers/add`).set(bearer(operator)).send({ key: 'phytosanitary_certificate' });
    expect([staff.status, staff.body.detail]).toEqual([403, 'An export is the exporter’s to write, signed in as itself: staff read it, and write nothing in its name']);
    const added = (await http().post(`${path}/papers/add`).set(bearer(x.token)).send({ key: 'phytosanitary_certificate' }).expect(201)).body;
    expect(line(added, 'phytosanitary_certificate')).toMatchObject({ group: 'asked', addedByEntityId: x.entityId, removable: true });
    expect(added.missing).toContain('Phytosanitary certificate (plant health)');
    expect((await http().post(`${path}/papers/add`).set(bearer(x.token)).send({ key: 'phytosanitary_certificate' })).status).toBe(409);

    // Asked for by its agent, who knows the border: the exporter is told, and cannot take the agent's ask off the list.
    await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: agent.entityId }).expect(201);
    const asked = (await http().post(`${path}/papers/add`).set(bearer(agent.token)).send({ key: 'other', title: 'Maximum residue level test report' }).expect(201)).body;
    expect(line(asked, 'other-1')).toMatchObject({ title: 'Maximum residue level test report', label: 'Maximum residue level test report', group: 'asked', addedByEntityId: agent.entityId });
    expect(bell(x.entityId)).toContain(`${made.code}: your clearing agent asks for “Maximum residue level test report”`);
    expect((await read()).missing).toContain('Maximum residue level test report');
    expect(line(await read(), 'other-1')?.removable).toBeUndefined();
    expect((await http().post(`${path}/papers/other-1/remove`).set(bearer(x.token))).status).toBe(403);
    expect((await http().post(`${path}/papers/add`).set(bearer(agent.token)).send({ key: 'other', title: '' })).status).toBe(400);

    // Given: a file of its own, filed under this export's line, and it stays on the record — nobody takes it off.
    const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% phyto KE-PC-2026-0091\n%%EOF\n').toString('base64')}`;
    const doc = (await http().post(`/v1/sbg/entities/${x.entityId}/documents`).set(bearer(x.token)).send({ kind: 'other', title: 'Phytosanitary certificate', relatesTo: `${made.code}:phytosanitary_certificate`, dataUrl: pdf }).expect(201)).body.documentId;
    await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'phytosanitary_certificate', documentId: doc, reference: 'KE-PC-2026-0091' }).expect(201);
    expect((await http().post(`${path}/papers/phytosanitary_certificate/remove`).set(bearer(x.token))).status).toBe(400);
    // The agent reads it, gives its word, and the given paper is no longer missing.
    expect((await http().get(`${path}/papers/phytosanitary_certificate/file`).set(bearer(agent.token))).status).toBe(200);
    await http().post(`${path}/papers/phytosanitary_certificate/accept`).set(bearer(agent.token)).expect(201);
    expect((await read()).missing).not.toContain('Phytosanitary certificate (plant health)');

    // The agent takes its own ask off the list while nothing was given.
    expect(line((await http().post(`${path}/papers/other-1/remove`).set(bearer(agent.token)).expect(201)).body, 'other-1')).toBeUndefined();
    // A paper asked for by name keeps its name, and who asked, once it is given.
    await http().post(`${path}/papers/add`).set(bearer(x.token)).send({ key: 'other', title: 'Buyer’s purchase order' }).expect(201);
    const po = (await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'other-1', reference: 'PO-4471' }).expect(201)).body;
    expect(line(po, 'other-1')).toMatchObject({ title: 'Buyer’s purchase order', label: 'Buyer’s purchase order', reference: 'PO-4471', group: 'asked', addedByEntityId: x.entityId });

    // The bill of lading's number stands on its line until its copy is attached; the file lists what is kept apart.
    await http().post(`${path}/bill-of-lading`).set(bearer(x.token)).send({ number: 'MEDU8812345' }).expect(201);
    expect(line(await read(), 'bill_of_lading')).toMatchObject({ reference: 'MEDU8812345' });
    const file = (await http().get(`${path}/handover.html`).set(bearer(x.token)).expect(200)).text;
    expect(file).toContain('Kept with the export');
    expect(file).toContain(`Phytosanitary certificate (plant health) (asked for by`);
    expect(file).toContain('KE-PC-2026-0091');
    expect(file).toContain('None kept here');
  });
  /*
   * EX9 — THE SHIPPER'S LETTER OF INSTRUCTION (the user, 2026-10-28: "the shippers letter of instruction is an important
   * doc, I think we should not just take the reference, but rather the form fields"; then: a form, needed, frozen on
   * signing). Most of it is read off the export; the form asks the rest; signed, it stops changing.
   */
  it('the letter of instruction: a form, never just a reference; refused until complete; frozen on signing, a change a new version', async () => {
    const x = await anExporter();
    const agent = await anExporter(['clearing_agent'], 'Pwani Clearing');
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Black tea, 640 bags', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '22G1', booking: booking(Date.now() + 72 * H), loadingSiteId: x.loading, terminalSiteId: x.terminal }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const read = async (token = x.token) => (await http().get(path).set(bearer(token)).expect(200)).body;
    const page = async (q = '', token = x.token) => (await http().get(`${path}/sli.html${q}`).set(bearer(token)).expect(200)).text;
    const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: agent.entityId }).expect(201);

    // Needed on every export, and never just a reference.
    expect((await read()).missing).toContain('Shipping instructions to the forwarder');
    const typed = await http().post(`${path}/papers`).set(bearer(x.token)).send({ key: 'shipping_instructions', reference: 'SI-117' });
    expect([typed.status, typed.body.detail]).toEqual([400, 'Fill in and sign the letter of instruction on the export: the forwarder drafts the bill of lading from it']);
    expect(String((await http().post(`${path}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' })).body.detail)).toContain('Fill in the form');

    // A form saved half-done is a draft; signing it says what is still needed. Staff fill in nothing.
    await http().post(`${path}/sli`).set(bearer(x.token)).send({ consigneeKind: 'named', lines: [] }).expect(201);
    const half = await http().post(`${path}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' });
    expect(half.status).toBe(400);
    for (const gap of ['The consignee’s name and address', 'The port of discharge', 'Freight prepaid or collect', 'How the bill of lading is released', 'The goods: at least one line', 'The box’s number, on the export']) expect(half.body.detail).toContain(gap);
    expect((await http().post(`${path}/sli`).set(bearer(operator)).send({ consigneeKind: 'to_order', lines: [] })).status).toBe(403);

    const form = {
      shipperContact: 'Wanjiku Mwangi, +254 700 000 000',
      consigneeKind: 'named',
      consignee: { name: 'Van Rees Tea BV', address: 'Wilhelminakade 1\nRotterdam, Netherlands', contact: 'imports@vanrees.example' },
      notifySameAsConsignee: true,
      dischargePort: 'Rotterdam',
      placeOfDelivery: 'Rotterdam',
      incoterm: 'FOB',
      incotermPlace: 'Mombasa',
      freight: 'collect',
      blRelease: 'originals',
      lines: [{ marks: 'KTEA/NL/1-640', packages: 640, packageKind: 'bags', description: 'Black tea, CTC, in poly-lined paper sacks', hsCode: '0902.40', grossKg: 18400, netKg: 17920, volumeM3: 32.5 }],
      instructions: 'Freight collect. Shipped on board bills, please.',
    };
    await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);
    await http().post(`${path}/vgm`).set(bearer(x.token)).send({ method: 1, kg: 18640, signatory: 'Wanjiku Mwangi' }).expect(201);
    const saved = (await http().post(`${path}/sli`).set(bearer(x.token)).send(form).expect(201)).body;
    expect(saved.sli).toMatchObject({ gaps: [], versions: [], stale: false, draft: { originals: 3, lines: [{ hsCode: '090240' }] } });
    // The draft is the exporter's: its agent reads the signed versions only.
    expect((await read(agent.token)).sli.draft).toBeUndefined();
    expect((await http().get(`${path}/sli.html?draft=1`).set(bearer(agent.token))).status).toBe(404);
    expect(await page('?draft=1')).toContain('DRAFT');

    // Signed: version 1, frozen with the fingerprint of its page; its line on the papers given; the agent told.
    const signed = (await http().post(`${path}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' }).expect(201)).body;
    expect(signed.sli.versions).toEqual([expect.objectContaining({ version: 1, signedBy: 'Wanjiku Mwangi', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(signed.papers.find((p: { key: string }) => p.key === 'shipping_instructions')).toMatchObject({ reference: 'Version 1, signed by Wanjiku Mwangi', group: 'needed' });
    expect(signed.missing).not.toContain('Shipping instructions to the forwarder');
    expect(app.get(NotificationService).inboxFor(app.get(EntityService).get(agent.entityId).did).map((n) => n.title)).toContain(`${made.code}: shipping instructions signed, version 1`);
    const v1 = await page('', agent.token);
    expect(sha(v1)).toBe(signed.sli.versions[0].fingerprint);
    for (const fact of [made.code, 'version 1', 'Van Rees Tea BV', 'Rotterdam', 'FOB Mombasa', 'Collect', '3 originals', 'KTEA/NL/1-640', '0902.40', '18,400', 'MSCU1234566', 'Pwani Forwarders', 'Wanjiku Mwangi']) expect(v1).toContain(fact);
    // The paper's own route serves the same frozen page, intact.
    const file = await http().get(`${path}/papers/shipping_instructions/file`).set(bearer(agent.token)).expect(200);
    expect([file.headers['content-type'], file.headers['x-fingerprint'], file.headers['x-fingerprint-intact']]).toEqual([expect.stringContaining('text/html'), signed.sli.versions[0].fingerprint, 'true']);

    // The agent's word, then a change: the draft moves, version 1 does not; signing again is version 2, the word asked again.
    await http().post(`${path}/papers/shipping_instructions/accept`).set(bearer(agent.token)).expect(201);
    await http().post(`${path}/sli`).set(bearer(x.token)).send({ ...form, dischargePort: 'Antwerp', placeOfDelivery: 'Antwerp' }).expect(201);
    expect(await page('?version=1')).toBe(v1);
    const second = (await http().post(`${path}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' }).expect(201)).body;
    expect(second.sli.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(second.papers.find((p: { key: string }) => p.key === 'shipping_instructions').acceptedAt).toBeUndefined();
    expect(await page()).toContain('Antwerp');
    expect(await page('?version=1')).toContain('Rotterdam');

    // A seal written after signing is no change to the letter …
    const laden = (await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({}).expect(201)).body.ladenLeg;
    const photo = async () => (await http().post('/v1/sbg/media').set(bearer(x.token)).send({ kind: 'seal', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/dispatch/freight/${laden.freightId}/seals`).set(bearer(x.token)).send({ number: 'KE 552190', sealClass: 'H', appliedBy: 'sender', photos: { loadedOpen: await photo(), closedWithSeal: await photo(), sealCloseUp: await photo() } }).expect(201);
    expect((await read()).sli.stale).toBe(false);
    // … but the export changing under it is: out of date, and said so, until it is signed again.
    await http().post(`${path}/vgm`).set(bearer(x.token)).send({ method: 1, kg: 21900, signatory: 'Wanjiku Mwangi' }).expect(201);
    const changed = await read();
    expect(changed.sli.stale).toBe(true);
    expect(changed.missing).toContain('The letter of instruction: the export changed since version 2 was signed — sign it again');
    const third = (await http().post(`${path}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' }).expect(201)).body;
    expect(third.sli.stale).toBe(false);
    expect(await page()).toContain('21,900 kg');

    // Hazardous goods: not signed without their UN number and class.
    const paint = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Paint, 80 drums', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '22G1', natureCode: 'HAZ-CHEM', booking: booking(Date.now() + 72 * H), loadingSiteId: x.loading, terminalSiteId: x.terminal }).expect(201)).body;
    const paintPath = `/v1/sbg/exports/${paint.exportId}`;
    await http().post(`${paintPath}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);
    await http().post(`${paintPath}/sli`).set(bearer(x.token)).send({ ...form, lines: [{ packages: 80, packageKind: 'drums', description: 'Paint', grossKg: 16000 }] }).expect(201);
    expect(String((await http().post(`${paintPath}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' })).body.detail)).toContain('The dangerous goods’ UN number and class');
    const dg = (await http().post(`${paintPath}/sli`).set(bearer(x.token)).send({ ...form, lines: [{ packages: 80, packageKind: 'drums', description: 'Paint', grossKg: 16000 }], dangerous: { unNumber: '1263', hazardClass: '3', properShippingName: 'Paint', packingGroup: 'iii' } }).expect(201)).body;
    expect(dg.sli.draft.dangerous).toEqual({ unNumber: 'UN1263', hazardClass: '3', properShippingName: 'Paint', packingGroup: 'III' });
    await http().post(`${paintPath}/sli/sign`).set(bearer(x.token)).send({ signatory: 'Wanjiku Mwangi' }).expect(201);
    expect((await http().get(`${paintPath}/sli.html`).set(bearer(x.token)).expect(200)).text).toContain('UN1263');
  });
});
