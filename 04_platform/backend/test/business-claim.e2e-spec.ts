import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';
import { DispatchService } from '../src/modules/pudo/dispatch.service';

/**
 * A BUSINESS CLAIMS ON ITS OWN DELIVERED LOAD, over the wire (found 2026-10-25 building the receiving moment: only a shop at
 * its counter could). The rule is the one the counter keeps: whoever carries the risk on the road claims — the trade term
 * says who, and with none it is the sender; a viewer reads and claims nothing; nothing of ours pays without stated cover,
 * so the claim closes at once with the damage claim report, and the business's bell says where it is.
 */
describe('a business claims on its own delivered load', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `bclaim-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token };
  }

  async function aBusiness(name: string): Promise<{ token: string; entityId: string; viewer: () => Promise<string> }> {
    const owner = await aPerson();
    const created = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `BCL-${tag}-${seq}`, activities: ['shipper'], yourName: `${name} Owner` }).expect(201);
    const token = created.body.token.access_token as string;
    const entityId = created.body.business.entityId as string;
    const viewer = async () => {
      const who = await aPerson();
      await http().post('/v1/sbg/business/me/members').set(bearer(token)).send({ phone: who.phone, name: `${name} viewer`, role: 'viewer' }).expect(201);
      const invite = (await http().get('/v1/sbg/business/mine').set(bearer(who.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === entityId);
      await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(who.token)).expect(201);
      return (await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(201)).body.token.access_token as string;
    };
    return { token, entityId, viewer };
  }

  /** A photograph taken by whoever holds `token`. */
  const photo = async (token: string, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(bearer(token)).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };

  /** Posted, then delivered by a driver of ours (the haul itself is pinned elsewhere). */
  async function deliveredLoad(token: string, stored: Record<string, unknown> = {}): Promise<{ freightId: string; code: string }> {
    const posted = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(token))
        .send({ description: 'Cement, 40 bags', pickupLocation: { lat: -1.42, lng: 36.95 }, pickupLabel: 'Athi River works', destLabel: 'Ruiru yard', destLocation: { lat: -1.15, lng: 36.96 }, weightKg: 2000, packaging: 'bagged', packages: 40, pickupCountry: 'KE', destCountry: 'KE' })
        .expect(201)
    ).body;
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const at = new Date().toISOString();
    // A trade term is switched on per country by two members of staff (pinned in its own tests): set on the load here.
    store.set(posted.freightId, { ...store.get(posted.freightId), status: 'delivered', claimedBy: `did:glos:drv-${tag}`, claimedAt: at, pickedUpAt: at, deliveredAt: at, proofOfDelivery: { receiverName: 'Grace at the yard', at }, ...stored });
    return { freightId: posted.freightId, code: posted.code };
  }

  const rowOf = async (token: string, freightId: string) => {
    const body = (await http().get('/v1/sbg/dispatch/posted').set(bearer(token)).expect(200)).body;
    return ((body.items ?? body) as Array<Record<string, unknown>>).find((r) => r.freightId === freightId)!;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the sender claims from its own sign-in, a viewer claims nothing, and the claim closes at once with the report', async () => {
    const biz = await aBusiness('Simba Cement');
    const viewer = await biz.viewer();
    const load = await deliveredLoad(biz.token);
    expect(await rowOf(biz.token, load.freightId)).toMatchObject({ status: 'delivered', canClaim: true });
    // A viewer reads it, and claims nothing.
    expect((await rowOf(viewer, load.freightId)).canClaim).toBe(true);
    await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/claim`).set(bearer(viewer)).send({ kind: 'damaged', description: 'Two bags split at the seam' }).expect(403);
    // Its own photo, and the claim.
    const split = await photo(biz.token, 'dispute');
    const made = (await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/claim`).set(bearer(biz.token)).send({ kind: 'damaged', description: 'Two bags split at the seam', photoRef: split }).expect(201)).body;
    expect(made.claim).toMatchObject({ kind: 'damaged', description: 'Two bags split at the seam', photoRef: split });
    // Nothing of ours pays without stated cover: the report was made, nobody decides it.
    const after = await rowOf(biz.token, load.freightId);
    expect(after).toMatchObject({ canClaim: false, claim: { state: 'resolved', decision: 'report_only' } });
    await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/claim`).set(bearer(biz.token)).send({ kind: 'short', description: 'And three missing' }).expect(400);
    // Its bell says where the report is.
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(biz.token)).expect(200)).body;
    const told = ((bell.items ?? bell) as Array<{ kind: string; title: string }>).find((n) => n.kind === 'claim_decided');
    expect(told?.title).toBe(`A damage claim report was made for ${load.code}`);
  });

  it('under a trade term that passed the risk at the origin, the sender is told the receiver claims — and cannot', async () => {
    const biz = await aBusiness('Pwani Exporters');
    const load = await deliveredLoad(biz.token, { incoterm: 'CPT', namedPlace: 'Ruiru' });
    expect(await rowOf(biz.token, load.freightId)).toMatchObject({ incoterm: 'CPT', claimant: 'receiver' });
    const refused = await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/claim`).set(bearer(biz.token)).send({ kind: 'damaged', description: 'Two bags split at the seam' }).expect(403);
    expect(refused.body.code).toBe('NOT_THE_CLAIMANT');
  });
});
