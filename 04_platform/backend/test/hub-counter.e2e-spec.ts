import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * A HUB THAT SORTS AND HANDS OUT, over the wire (2026-11-09 — the owner: "The hub decides that. Only Sort vs Sort and Hand
 * Out"; "Shop app at the hub"; "Its own counter fee"). Its owner chooses, from the hub's own sign-in; the counter opens on
 * the hub's hours with the shelf and fee it says; it is offered beside the shops; the hub owner's email and password open
 * the Shop app for it; back to "Sort only" it closes, and only the hub opens it again.
 */
describe('a hub that sorts and hands out, over the wire', () => {
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

  const photo = async (token: Record<string, string>, kind: string, tag: string) =>
    (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${digits()}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;

  it('its owner opens a counter on the hub’s hours with its own shelf and fee; it is offered as a shop; the Shop app opens with the hub’s password; sort only closes it', async () => {
    const u = digits();
    const email = `ghala.counter.${u}@depot.example`;
    const password = 'mabati-na-misumari-4';
    const phone = `+2547${u}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const signed = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'mdp', email, password, phone, profile: { mdp: { name: `Ghala Counter ${u}`, zones: [`HC${u}`], country: 'KE', location: { lat: -1.3, lng: 36.9 }, address: 'Mombasa Road, gate 4' } } }).expect(201)).body;
    const hub = bearer(signed.token.access_token as string);
    const own = ((await http().get('/v1/sbg/mdps').set(hub).expect(200)).body as Array<{ did: string; mdpId: string }>).find((m) => m.did === signed.did)!;
    const counterOf = () => http().get(`/v1/sbg/mdps/${own.mdpId}/counter`).set(hub);
    const choose = (body: Record<string, unknown>, token = hub) => http().post(`/v1/sbg/mdps/${own.mdpId}/counter`).set(token).send(body);

    // Not approved yet: it hands out nothing.
    expect((await choose({ mode: 'sort_and_hand_out', rows: 3, cols: 4, pricePerParcel: 40 }).expect(400)).body.detail).toMatch(/once SeeBuyGet has approved it/);
    const papers = { idCopyRef: await photo(hub, 'kyc_id', u), licenceRef: await photo(hub, 'kyc_licence', u), photoRefs: [await photo(hub, 'shop', u)] };
    await http().post(`/v1/sbg/mdps/${own.mdpId}/papers`).set(hub).send(papers).expect(201);
    await http().post(`/v1/sbg/mdps/${own.mdpId}/papers-decision`).set(operator).send({ approve: true }).expect(201);

    expect((await counterOf().expect(200)).body).toEqual({ mdpId: own.mdpId, mode: 'sort', hoursSet: false });
    // Its hours first: the counter opens on them.
    expect((await choose({ mode: 'sort_and_hand_out', rows: 3, cols: 4, pricePerParcel: 40 }).expect(400)).body.detail).toMatch(/Say your hub’s opening hours first/);
    const day = { open: '08:00', close: '18:00' };
    await http().put(`/v1/sbg/mdps/${own.mdpId}/contact`).set(hub).send({ openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null } }).expect(200);
    // Staff choose nothing in its name; another hub reads nothing of it.
    expect((await choose({ mode: 'sort_and_hand_out', rows: 3, cols: 4, pricePerParcel: 40 }, operator).expect(403)).body.detail).toMatch(/staff change nothing in its name/);
    // Its shelf and its fee, said.
    await choose({ mode: 'sort_and_hand_out', rows: 3, cols: 4 }).expect(400);
    const opened = (await choose({ mode: 'sort_and_hand_out', rows: 3, cols: 4, pricePerParcel: 40 }).expect(201)).body;
    expect(opened).toMatchObject({ mode: 'sort_and_hand_out', hoursSet: true, counter: { shopName: `Ghala Counter ${u}`, open: true, pricePerParcel: 40, rows: 3, cols: 4, signIn: email } });
    const counterDid = opened.counter.did as string;

    // Offered beside the shops, as a shop is.
    const card = ((await http().get('/v1/sbg/agents').set(hub).expect(200)).body as Array<{ did: string; shopName: string; openState: string; takesNew: boolean }>).find((a) => a.did === counterDid);
    expect(card).toMatchObject({ shopName: `Ghala Counter ${u}`, openState: 'open', takesNew: true });

    // The Shop app opens with the hub owner's email and password (on a new phone, it asks for the phone's code as any shop does).
    const shopLogin = await http().post('/v1/sbg/auth/login').send({ email, password, role: 'pudo' });
    expect(shopLogin.body.code).not.toBe('AUTH_FAILED');
    expect(shopLogin.status).not.toBe(401);
    expect((await http().post('/v1/sbg/auth/login').send({ email, password: 'not-the-password-1', role: 'pudo' })).body.code).toBe('AUTH_FAILED');

    // Sort only: the counter closes, and the counter cannot open itself.
    expect((await choose({ mode: 'sort' }).expect(201)).body).toMatchObject({ mode: 'sort', counter: { open: false } });
    const counter = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did: counterDid }).expect(201)).body.access_token);
    expect((await http().post(`/v1/sbg/agents/${counterDid}/availability`).set(counter).send({ open: true }).expect(400)).body.detail).toMatch(/the hub sorts only now/);
    // Hand out again: the same counter opens.
    expect((await choose({ mode: 'sort_and_hand_out' }).expect(201)).body).toMatchObject({ mode: 'sort_and_hand_out', counter: { did: counterDid, open: true } });
    // Staff read it; a counter of its own is never a second Shop app sign-in at the same email.
    expect((await http().get(`/v1/sbg/mdps/${own.mdpId}/counter`).set(operator).expect(200)).body.counter.did).toBe(counterDid);
  });
});
