import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { glnProblem, graiOf } from '../src/foundation/gs1/gs1';
import { OurGlnSweeper } from '../src/modules/pudo/our-gln.service';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';

/**
 * SEEBUYGET'S OWN GS1 PREFIX, over the wire (2026-11-09, the owner: "we should get our own GS1 prefix"). Without it on the
 * server nothing is numbered and the console says so; with it every approved collection point and hub gets its GLN — on
 * its own page, on the map's card, in staff's lists, told in its bell — and the label of a parcel going to a collection
 * point carries that point's GLN.
 */
describe('our own GS1 prefix, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const was = process.env.SBG_GS1_PREFIX;
  const PREFIX = `87${String(Math.floor(Math.random() * 90_000) + 10_000)}`;

  beforeAll(async () => {
    delete process.env.SBG_GS1_PREFIX;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    if (was === undefined) delete process.env.SBG_GS1_PREFIX;
    else process.env.SBG_GS1_PREFIX = was;
    await app?.close();
  });

  async function aShop(shopName: string, zone: string, lat: number): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-GLN-${u}`, mobile: `+2547${u}8`, deviceImei: `IMEI-GLN-${u}`,
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
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${u}`, amount: 50 }).expect(201);
    return { did, token };
  }

  it('numbers nothing without the prefix; with it, every approved shop and hub its GLN — shown, told, and on the label', async () => {
    const tag = digits();
    const from = await aShop(`GLN From ${tag}`, `GlnFrom${tag}`, -1.286);
    const to = await aShop(`GLN To ${tag}`, `GlnTo${tag}`, -1.1);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `GLN Hub ${tag}`, zones: [`GlnFrom${tag}`, `GlnTo${tag}`], location: { lat: -1.25, lng: 36.88 } }).expect(201)).body;
    const sweeper = app.get(OurGlnSweeper);

    // No prefix on the server: nothing numbered, and the console is told so.
    expect(sweeper.sweep()).toBe(0);
    const none = (await http().get('/v1/sbg/gs1/ours').set(operator).expect(200)).body;
    expect(none.prefix).toBeUndefined();
    expect(none.capacity).toBe(0);
    expect((await http().get(`/v1/sbg/agents/${to.did}`).set(to.token).expect(200)).body.gln).toBeUndefined();

    // The owner writes the prefix on the server.
    process.env.SBG_GS1_PREFIX = PREFIX;
    expect(sweeper.sweep()).toBeGreaterThanOrEqual(3);
    const glnTo = (await http().get(`/v1/sbg/agents/${to.did}`).set(to.token).expect(200)).body.gln as string;
    const glnFrom = (await http().get(`/v1/sbg/agents/${from.did}`).set(from.token).expect(200)).body.gln as string;
    for (const g of [glnTo, glnFrom]) {
      expect(glnProblem(g)).toBeUndefined();
      expect(g.startsWith(PREFIX)).toBe(true);
    }
    expect(glnTo).not.toBe(glnFrom);
    // On the map's card for anybody signed in, and in staff's list.
    expect(((await http().get('/v1/sbg/agents').set(from.token).expect(200)).body as Array<{ did: string; gln?: string }>).find((a) => a.did === to.did)?.gln).toBe(glnTo);
    expect(((await http().get('/v1/sbg/agents').set(operator).expect(200)).body as Array<{ did: string; gln?: string }>).find((a) => a.did === to.did)?.gln).toBe(glnTo);
    // The hub: its own page and the public card.
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    const hubGln = ((await http().get('/v1/sbg/mdps').set(hubToken).expect(200)).body as Array<{ mdpId: string; gln?: string }>).find((m) => m.mdpId === hub.mdpId)?.gln;
    expect(hubGln?.startsWith(PREFIX)).toBe(true);
    expect(((await http().get('/v1/sbg/mdps').set(from.token).expect(200)).body as Array<{ mdpId: string; gln?: string }>).find((m) => m.mdpId === hub.mdpId)?.gln).toBe(hubGln);
    // Told in its bell.
    await new Promise((r) => setTimeout(r, 50));
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(to.token).expect(200)).body.items as Array<{ kind: string; title: string; body: string }>;
    expect(bell.find((n) => n.kind === 'place_gln')).toMatchObject({ title: 'Your collection point has its GS1 location number', body: expect.stringContaining(`GLN ${glnTo}`) });
    // Asked again: the same numbers.
    sweeper.sweep();
    expect((await http().get(`/v1/sbg/agents/${to.did}`).set(to.token).expect(200)).body.gln).toBe(glnTo);

    // A parcel taken in for the collection point: its label carries the point's GLN, on the page and for the thermal printer.
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `GlnFrom → GlnTo ${tag}`, originZone: `GlnFrom${tag}`, destZone: `GlnTo${tag}` }).expect(201);
    const parcelId = `GLN-${tag}`;
    await http().post('/v1/sbg/parcels/accept').set(from.token).send({ agentDid: from.did, parcelId, size: 'S', destZone: `GlnTo${tag}`, destPudoDid: to.did, senderMobile: '+254700000401', receiverMobile: '+254700000402', dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), from.did), paymentMode: 'prepaid' }).expect(201);
    expect((await http().get(`/v1/sbg/parcels/${parcelId}/label`).set(operator).expect(200)).body.svg).toContain(`To GLN ${glnTo}`);
    expect((await http().get(`/v1/sbg/agents/${from.did}/parcels/${parcelId}/label.zpl`).set(from.token).expect(200)).text).toContain(`^FDTo GLN ${glnTo}^FS`);

    // The console: the prefix, and the numbers given under it. Staff only.
    const ours = (await http().get('/v1/sbg/gs1/ours').set(operator).expect(200)).body;
    expect(ours).toMatchObject({ prefix: PREFIX, capacity: 99_998 });
    expect(ours.used).toBeGreaterThanOrEqual(3);
    await http().get('/v1/sbg/gs1/ours').set(from.token).expect(403);
  });

  it('a bag’s tag: its code alone without the prefix; with it, its GRAI — kept, printed, and found by a scan of it', async () => {
    delete process.env.SBG_GS1_PREFIX;
    const tag = digits();
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `GRAI Hub ${tag}`, zones: [`GraiA${tag}`], location: { lat: -1.26, lng: 36.9 } }).expect(201)).body;
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    declared(app, 'hub', hub.did);
    const bag = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/totes`).set(hubToken).expect(201)).body as { code: string };
    const before = (await http().get(`/v1/sbg/totes/${bag.code}/tag`).set(hubToken).expect(200)).body;
    expect(before.grai).toBeUndefined();
    expect(before.svg).toContain(`>${bag.code}<`);
    expect(before.svg).not.toContain('GRAI');

    process.env.SBG_GS1_PREFIX = PREFIX;
    const after = (await http().get(`/v1/sbg/totes/${bag.code}/tag`).set(hubToken).expect(200)).body;
    expect(after.grai).toBe(graiOf(PREFIX, 99_999, bag.code));
    expect(after.svg).toContain(`(8003) ${after.grai}`);
    expect(after.zpl).toContain(`>6${bag.code}^FS`);
    // Kept on the bag: read with it, and the bag found by a scan of it.
    expect((await http().get(`/v1/sbg/totes/${bag.code}`).set(hubToken).expect(200)).body.grai).toBe(after.grai);
    expect((await http().get(`/v1/sbg/totes/${encodeURIComponent(`(8003)${after.grai}`)}`).set(hubToken).expect(200)).body.code).toBe(bag.code);
    // A sender, a store, a business never holds a bag: not theirs to print.
    const shop = await aShop(`GRAI Shop ${tag}`, `GraiA${tag}`, -1.2);
    expect((await http().get(`/v1/sbg/totes/${bag.code}/tag`).set(shop.token).expect(200)).body.grai).toBe(after.grai);
    await http().get(`/v1/sbg/totes/${bag.code}/tag`).expect(401);
  });
});
