import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { HandleDirectory } from '../src/modules/pudo/handle-directory.service';
import { HandleService } from '../src/foundation/handle/handle.service';
import { declared } from './declared';
import { AGREED } from './agreed';

/**
 * A HUB IS VETTED BEFORE IT WORKS (the ISO 28000 check: "hubs are not vetted at all") — through the booted application.
 * A hub that signs itself up is shown to nobody else, chosen for no zone and refused its floor until it has sent its
 * papers from its own sign-in and a member of staff who looked has approved them; a refusal says why, and the hub is
 * told. A hub staff register themselves is approved by them, by name, and works at once.
 */
describe('a hub is vetted before it works, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator: Record<string, string> = {};

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

  const aVerifiedNumber = async (u: string) => {
    const phone = `+2547${u}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    return phone;
  };
  /** A photograph uploaded by whoever holds `token`: its id. */
  const photo = async (token: Record<string, string>, kind: string, tag: string) =>
    (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${digits()}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
  const ownRow = async (token: Record<string, string>, did: string) => ((await http().get('/v1/sbg/mdps').set(token).expect(200)).body as Array<{ did: string; mdpId: string; vetting?: Record<string, unknown> }>).find((m) => m.did === did);

  it('a hub that signs itself up is shown to nobody, chosen for nothing and refused its floor until staff have seen its papers', async () => {
    const u = digits();
    const zone = `HV${u}`;
    const name = `Ghala ${u}`;
    const signed = (
      await http()
        .post('/v1/sbg/auth/signup')
        .send({ ...AGREED, role: 'mdp', email: `ghala.${u}@depot.example`, password: 'mabati-na-misumari-4', phone: await aVerifiedNumber(u), profile: { mdp: { name, zones: [zone], country: 'KE', location: { lat: -1.3, lng: 36.9 } } } })
        .expect(201)
    ).body;
    expect(signed.entityStatus).toBe('draft');
    const hub = bearer(signed.token.access_token as string);
    const own = (await ownRow(hub, signed.did))!;
    expect(own.vetting).toEqual({ state: 'draft' });

    // Another hub — one staff registered, so approved by them — is not shown it, and is shown itself.
    const other = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Sort ${u}`, zones: [`HO${u}`], location: { lat: -1.25, lng: 36.9 } }).expect(201)).body;
    expect(other.vetting).toMatchObject({ state: 'approved', approvedBy: expect.any(String) });
    declared(app, 'hub', other.did);
    const otherHub = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: other.did }).expect(201)).body.access_token);
    const seen = (await http().get('/v1/sbg/mdps').set(otherHub).expect(200)).body as Array<{ did: string }>;
    expect([seen.some((m) => m.did === signed.did), seen.some((m) => m.did === other.did)]).toEqual([false, true]);
    expect((await ownRow(operator, signed.did))?.vetting).toEqual({ state: 'draft' });
    // Nor among the fees near it: it competes with nobody yet.
    const feesNear = async () => ((await http().get('/v1/sbg/pricing/near').query({ type: 'mdp', lat: -1.3, lng: 36.9, limit: 50 }).set(otherHub).expect(200)).body.pins as Array<{ id: string }>).map((p) => p.id);
    expect(await feesNear()).toEqual(expect.arrayContaining([other.mdpId]));
    expect(await feesNear()).not.toContain(own.mdpId);
    // And no public page: a handle is never taken back, so none is issued before staff have seen the papers.
    const handleOf = (did: string) => (app.get(HandleDirectory).ensure(), app.get(HandleService).forId(did));
    expect([handleOf(other.did)?.kind, handleOf(signed.did)]).toEqual(['hub', undefined]);

    // Its floor is refused, saying what to do; a bag at another hub is not addressed to it.
    const floor = await http().post(`/v1/sbg/mdps/${own.mdpId}/totes`).set(hub).expect(409);
    expect(floor.body).toMatchObject({ code: 'HUB_NOT_APPROVED', detail: expect.stringMatching(/has not sent its papers yet/) });
    const bag = (await http().post(`/v1/sbg/mdps/${other.mdpId}/totes`).set(otherHub).expect(201)).body;
    expect((await http().post(`/v1/sbg/totes/${bag.code}/assign`).set(otherHub).send({ destinationNodeId: own.mdpId, destinationLabel: name }).expect(409)).body.code).toBe('HUB_NOT_APPROVED');
    expect((await http().post(`/v1/sbg/mdps/${own.mdpId}/drop-bag`).set(hub).send({ code: bag.code }).expect(409)).body.code).toBe('HUB_NOT_APPROVED');
    expect((await http().post(`/v1/sbg/mdps/${own.mdpId}/sort`).set(hub).send({ parcelId: 'SBG-ANY' }).expect(409)).body.code).toBe('HUB_NOT_APPROVED');
    expect((await http().post(`/v1/sbg/totes/${bag.code}/close`).set(hub).send({ photoRef: 'any', observedAt: new Date().toISOString() }).expect(409)).body.code).toBe('HUB_NOT_APPROVED');

    // Its papers, from its own sign-in only: not staff's, not another hub's, and each a photograph it took itself.
    const papers = { idCopyRef: await photo(hub, 'kyc_id', u), licenceRef: await photo(hub, 'kyc_licence', u), photoRefs: [await photo(hub, 'shop', u)] };
    const send = (token: Record<string, string>, body: Record<string, unknown>) => http().post(`/v1/sbg/mdps/${own.mdpId}/papers`).set(token).send(body);
    expect((await send(operator, papers).expect(403)).body.detail).toMatch(/staff check them/);
    await send(otherHub, papers).expect(403);
    const notItsOwn = await photo(otherHub, 'kyc_id', u);
    expect((await send(hub, { ...papers, idCopyRef: notItsOwn }).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    expect((await send(hub, { ...papers, photoRefs: [papers.licenceRef] }).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    expect((await ownRow(hub, signed.did))?.vetting).toEqual({ state: 'draft' }); // nothing written by a refusal
    expect((await send(hub, papers).expect(201)).body.vetting).toMatchObject({ state: 'pending', papers: { ...papers, submittedAt: expect.any(String) } });
    expect((await send(hub, papers).expect(400)).body.detail).toMatch(/with SeeBuyGet already/);
    expect((await http().post(`/v1/sbg/mdps/${own.mdpId}/totes`).set(hub).expect(409)).body.detail).toMatch(/its papers are with SeeBuyGet/);

    // Staff read the queue and the papers; the hub reads neither and decides nothing.
    const queue = (await http().get('/v1/sbg/hub-papers').set(operator).expect(200)).body as Array<{ mdpId: string }>;
    expect(queue.find((r) => r.mdpId === own.mdpId)).toMatchObject({ name, country: 'KE', zones: [zone], papers });
    await http().get('/v1/sbg/hub-papers').set(hub).expect(403);
    await http().get(`/v1/sbg/media/${papers.licenceRef}`).set(operator).expect(200);
    await http().post(`/v1/sbg/mdps/${own.mdpId}/papers-decision`).set(hub).send({ approve: true }).expect(403);

    // Refused: with the reason, which the hub is shown and told; back to sending them.
    const decide = (body: Record<string, unknown>) => http().post(`/v1/sbg/mdps/${own.mdpId}/papers-decision`).set(operator).send(body);
    expect((await decide({ approve: false }).expect(400)).body.code).toBe('REASON_REQUIRED');
    expect((await decide({ approve: false, reason: 'The licence is out of date' }).expect(201)).body.vetting).toMatchObject({ state: 'draft', refusal: { reason: 'The licence is out of date' } });
    await new Promise((r) => setImmediate(r));
    expect(app.get(NotificationService).inboxFor(signed.did)[0]).toMatchObject({ kind: 'papers_checked', title: `${name}: your papers were not accepted`, body: expect.stringContaining('The licence is out of date') });
    expect((await http().get('/v1/sbg/hub-papers').set(operator).expect(200)).body.some((r: { mdpId: string }) => r.mdpId === own.mdpId)).toBe(false);
    expect((await http().post(`/v1/sbg/mdps/${own.mdpId}/totes`).set(hub).expect(409)).body.detail).toMatch(/were not accepted: send them again/);

    // Sent again and approved: it works, it is shown, and bags may be addressed to it.
    const again = { idCopyRef: await photo(hub, 'kyc_id', `${u}b`), licenceRef: await photo(hub, 'kyc_licence', `${u}b`), photoRefs: [await photo(hub, 'shop', `${u}b`)] };
    await send(hub, again).expect(201);
    expect((await decide({ approve: true }).expect(201)).body.vetting).toMatchObject({ state: 'approved', approvedBy: expect.any(String), papers: again });
    // Approved, it signs its security declaration from its own sign-in, as a hub does before it opens a bag (round 39).
    const declaration = (await http().get('/v1/sbg/declarations/mine').set(hub).expect(200)).body;
    await http().post('/v1/sbg/declarations/mine/sign').set(hub).send({ version: declaration.version }).expect(201);
    await new Promise((r) => setImmediate(r));
    expect(app.get(NotificationService).inboxFor(signed.did)[0]).toMatchObject({ kind: 'papers_checked', title: `${name} is approved` });
    await decide({ approve: true }).expect(400);
    await http().post(`/v1/sbg/mdps/${own.mdpId}/totes`).set(hub).expect(201);
    expect(((await http().get('/v1/sbg/mdps').set(otherHub).expect(200)).body as Array<{ did: string }>).some((m) => m.did === signed.did)).toBe(true);
    expect(await feesNear()).toContain(own.mdpId);
    expect(handleOf(signed.did)?.kind).toBe('hub');
    await http().post(`/v1/sbg/totes/${bag.code}/assign`).set(otherHub).send({ destinationNodeId: own.mdpId, destinationLabel: name }).expect(201);
    expect((await send(hub, again).expect(400)).body.detail).toMatch(/approved: there are no papers/);
  });
});
