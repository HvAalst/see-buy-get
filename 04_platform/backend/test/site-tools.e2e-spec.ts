import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';
import { declared } from './declared';
import { PapersWatchService } from '../src/modules/pudo/papers-watch.service';
import { NotificationService } from '../src/modules/pudo/notification.service';

type Auth = Record<string, string>;

/**
 * 2026-11-13 — A SHOP'S AND A HUB'S TOOLS, OVER THE WIRE (the owner: "shop and hub tools"; plan T1, T3, T4, T5). The shop says
 * its own from its sign-in — staff read them and change nothing; another shop may not touch them. Its public card says what
 * they let it take and whether it prints labels. In Kenya an approved scale is a stamped one, and the stamp is reminded.
 */
describe('a shop’s and a hub’s tools, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff: Auth;
  const bearer = (token: string): Auth => ({ authorization: `Bearer ${token}` });
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

  async function aShop(shopName: string): Promise<{ did: string; token: Auth }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const did = (await http().post('/v1/sbg/agents').set(staff).send({
      shopName, zone: `Tools${u}`, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
      openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
      fullName: `${shopName} owner`, nationalId: `ID-TL-${u}`, mobile: `+2547${u}3`, deviceImei: `IMEI-TL-${u}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    }).expect(201)).body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const shopPhoto = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await shopPhoto('kyc_id'), tradingLicenceRef: await shopPhoto('kyc_licence'), shopPhotoRefs: [await shopPhoto('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    return { did, token };
  }

  const photo = async (who: Auth, n: string) => {
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`stamp:${n}:${digits()}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(who).send({ kind: 'kyc_licence', dataUrl }).expect(201)).body.mediaId as string;
  };
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it('a shop says its tools; staff read them and change nothing; its card says what it takes and that it prints labels', async () => {
    const shop = await aShop('Duka la Zana');
    const other = await aShop('Duka Jirani');
    const tools = `/v1/sbg/agents/${shop.did}/tools`;
    // Before it says anything: by hand alone, 23 kg.
    expect((await http().get(tools).set(shop.token).expect(200)).body).toMatchObject({ equipment: [], limits: { maxKg: 23, by: 'hands', pallets: false, weighs: false, printsLabels: false }, stamp: { state: 'none' }, stampCountry: true });

    // A sack barrow, a pallet jack and a ramp; a printer; a scale not stamped — a guide only.
    const set = (await http().put(tools).set(shop.token).send({ equipment: ['HTR', 'PLT', 'RMP'], scale: { maxKg: 60, approved: false }, labelPrinter: true, cctv: true }).expect(200)).body;
    expect(set).toMatchObject({ equipment: ['HTR', 'PLT', 'RMP'], limits: { maxKg: 30, by: 'network', pallets: true, weighs: false, printsLabels: true }, stamp: { state: 'not_approved' } });
    expect(set.tools.history[0]).toMatchObject({ said: expect.stringContaining('a sack barrow added') });

    // Staff read; they do not say; another shop may not either.
    expect((await http().get(tools).set(staff).expect(200)).body.limits.maxKg).toBe(30);
    expect((await http().put(tools).set(staff).send({ equipment: [], labelPrinter: false, cctv: false }).expect(403)).body.detail).toMatch(/A shop says its own tools/);
    await http().put(tools).set(other.token).send({ equipment: [], labelPrinter: false, cctv: false }).expect(403);
    await http().get(tools).set(other.token).expect(403);

    // Refused by name, nothing changed: a crane, a forklift without its licence; in Kenya an approved scale needs its stamp.
    await http().put(tools).set(shop.token).send({ equipment: ['CRN'], labelPrinter: false, cctv: false }).expect(400);
    expect((await http().put(tools).set(shop.token).send({ equipment: ['FLT'], labelPrinter: false, cctv: false }).expect(400)).body.detail).toMatch(/operator’s licence/);
    expect((await http().put(tools).set(shop.token).send({ equipment: [], scale: { maxKg: 60, approved: true }, labelPrinter: false, cctv: false }).expect(400)).body.detail).toMatch(/the day the inspector’s stamp runs to/);
    expect((await http().get(tools).set(shop.token).expect(200)).body.equipment).toEqual(['HTR', 'PLT', 'RMP']);
    // A certificate that is another shop's own is not this shop's to show.
    const theirs = await photo(other.token, 'theirs');
    await http().put(tools).set(shop.token).send({ equipment: [], scale: { maxKg: 60, approved: true, stampedUntil: inDays(200), certificateRef: theirs }, labelPrinter: false, cctv: false }).expect(400);

    // On its public card: up to 30 kg, pallets, prints labels; weights not counted.
    const card = (await http().get('/v1/sbg/network/points').expect(200)).body.find((p: { did: string }) => p.did === shop.did);
    expect(card).toMatchObject({ maxParcelKg: 30, takesPallets: true, weighs: false, printsLabels: true });
  });

  it('in Kenya a stamped scale counts; the stamp is reminded thirty days ahead and on the day, once each', async () => {
    const shop = await aShop('Duka la Mizani');
    const tools = `/v1/sbg/agents/${shop.did}/tools`;
    const certificate = await photo(shop.token, 'mine');
    const stamped = (await http().put(tools).set(shop.token).send({ equipment: ['HTR'], scale: { maxKg: 25, approved: true, stampedUntil: inDays(20), certificateRef: certificate }, labelPrinter: false, cctv: false }).expect(200)).body;
    expect(stamped).toMatchObject({ limits: { maxKg: 25, by: 'scale', weighs: true }, stamp: { state: 'due' } });
    // The same certificate again is kept as it is.
    await http().put(tools).set(shop.token).send({ equipment: ['HTR'], scale: { maxKg: 25, approved: true, stampedUntil: inDays(20), certificateRef: certificate }, labelPrinter: true, cctv: false }).expect(200);

    const watch = app.get(PapersWatchService);
    const notes = app.get(NotificationService);
    const stampNotes = () => notes.inboxFor(shop.did).filter((n) => /^Your scale’s stamp/.test(n.title));
    await watch.sweep();
    await watch.sweep();
    expect(stampNotes()).toHaveLength(1);
    expect(stampNotes()[0]).toMatchObject({ kind: 'papers_due', title: expect.stringMatching(/^Your scale’s stamp runs out in \d+ days$/) });
    // The day it runs out: told again, and its weights stop counting.
    await watch.sweep(Date.now() + 21 * 86_400_000);
    expect(stampNotes().map((n: { kind: string }) => n.kind)).toEqual(expect.arrayContaining(['papers_due', 'papers_lapsed']));
  });

  it('a hub says its own tools; staff read them and change nothing', async () => {
    const hub = (await http().post('/v1/sbg/mdps').set(staff).send({ name: `Hub Zana ${digits()}`, zones: ['ToolsHub'], location: { lat: -1.25, lng: 36.9 } }).expect(201)).body;
    declared(app, 'hub', hub.did);
    const asHub = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    const tools = `/v1/sbg/mdps/${hub.mdpId}/tools`;
    expect((await http().put(tools).set(asHub).send({ equipment: ['FLT', 'RMP'], forkliftLicence: 'G-2201', labelPrinter: true, cctv: true }).expect(200)).body).toMatchObject({ equipment: ['FLT', 'RMP'], tools: { forkliftLicence: 'G-2201' }, limits: { maxKg: 30, pallets: true } });
    expect((await http().get(tools).set(staff).expect(200)).body.equipment).toEqual(['FLT', 'RMP']);
    expect((await http().put(tools).set(staff).send({ equipment: [], labelPrinter: false, cctv: false }).expect(403)).body.detail).toMatch(/A hub says its own tools/);
  });
});
