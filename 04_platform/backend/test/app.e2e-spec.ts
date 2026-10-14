import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';

describe('GLOS backend (e2e)', () => {
  let app: INestApplication;

  /**
   * A fleet's papers, put on record the way staff do it: four pictures the sender uploaded. (A file name with no file
   * behind it is refused; and whoever puts them on record is not the one who approves — a test names a second person.)
   */
  const sendFleetPapers = async (did: string, sender: Record<string, string>): Promise<void> => {
    const http = app.getHttpServer();
    const scan = async (kind: string) => {
      const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}`;
      return (await request(http).post('/v1/sbg/media').set(sender).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
    };
    await request(http)
      .post(`/v1/sbg/fleet/managers/${did}/submit-kyc`)
      .set(sender)
      .send({ businessRegCertRef: await scan('kyc_registration'), operatorLicenceRef: await scan('kyc_licence'), ownerIdRef: await scan('kyc_id'), proofOfAddressRef: await scan('kyc_address') })
      .expect(201);
  };

  /**
   * A shop's papers, sent the way a shop sends them: three photographs it uploaded itself. (A sandbox lets a test
   * sign in as the shop; staff cannot send a shop's papers for it, and a file name with no file behind it is refused.)
   */
  const sendShopPapers = async (did: string): Promise<void> => {
    const http = app.getHttpServer();
    const shop = { Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token}` };
    const photograph = async (kind: string) => {
      const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}`;
      return (await request(http).post('/v1/sbg/media').set(shop).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
    };
    await request(http)
      .post(`/v1/sbg/agents/${did}/submit-kyc`)
      .set(shop)
      .send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: await photograph('kyc_licence'), shopPhotoRefs: [await photograph('shop')] })
      .expect(201);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * PUT MONEY IN THE WAY MONEY ACTUALLY GETS IN — ask, then let the provider confirm it.
   *
   * These tests used to POST a top-up and carry on, because a top-up used to BE the credit. It is not:
   * asking moves nothing and the books wait for a payment provider (money model, rule 5). So the helper
   * does both halves over HTTP, and the second half goes through the signed callback door — which makes
   * the end-to-end suite the only place that proves the whole inbound rail, signature included.
   */
  async function fund(path: string, amount: number, auth: Record<string, string>, staff: Record<string, string> = auth): Promise<{ asked: request.Response; paid: request.Response }> {
    const http = app.getHttpServer();
    const asked = await request(http).post(path).set(auth).send({ amount }).expect(201);
    const fundingId = asked.body.fundingId as string;
    expect(asked.body.status).toBe('awaiting');
    const providerRef = `MPX${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
    // The sandbox rail signs it exactly as a provider would and it is verified on the way back in.
    const paid = await request(http).post(`/v1/rails/funding/${fundingId}/simulate`).set(staff).send({ providerRef, amount }).expect(201);
    expect(paid.body.status).toBe('confirmed');
    return { asked, paid };
  }

  /** A store signed in as itself, the old way (its number and the secret it was handed once): what changes a store. */
  async function asStore(vendor: { vendorId: string; secret: string }): Promise<Record<string, string>> {
    const signedIn = await request(app.getHttpServer()).post('/v1/sbg/vendors/login').send({ vendorId: vendor.vendorId, secret: vendor.secret }).expect(201);
    return { Authorization: `Bearer ${signedIn.body.token.access_token}` };
  }

  it('/v1/health (GET) is public and returns ok', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect((res: request.Response) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.modules).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'pudo', 'sse']);
      });
  });

  it('/v1/identity (GET) is rejected without a token', () => {
    return request(app.getHttpServer()).get('/v1/identity').expect(401);
  });

  it('client-credentials token unlocks a protected route', async () => {
    const tokenRes = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ sub: 'client-1', type: 'client_credentials' })
      .expect(201);

    const token = tokenRes.body.access_token as string;
    expect(token.split('.')).toHaveLength(3);

    return request(app.getHttpServer())
      .get('/v1/identity')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res: request.Response) => expect(res.body.module).toBe('M1'));
  });

  it('DID → DID-bound token → protected route works end-to-end', async () => {
    const didRes = await request(app.getHttpServer())
      .post('/v1/did')
      .send({ controller: 'participant-e2e' })
      .expect(201);
    const did = didRes.body.id as string;
    expect(did).toMatch(/^did:glos:/);

    const tokenRes = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ sub: did, type: 'did' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/shipments/module-info')
      .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
      .expect(200);

    // The anchored DID document is publicly resolvable.
    await request(app.getHttpServer()).get(`/v1/did/${did}`).expect(200);
  });

  it('M1 onboarding: register → liveness → verify-identity reaches Tier 2 with a DID', async () => {
    const reg = await request(app.getHttpServer())
      .post('/v1/identity/register')
      .send({ fullName: 'Jane Doe', email: 'jane@example.com', jurisdiction: 'NL', roles: ['shipper', 'carrier'] })
      .expect(201);
    expect(reg.body.tier).toBe(1);
    const accountId = reg.body.accountId as string;

    const challenge = await request(app.getHttpServer()).post('/v1/identity/liveness/challenge').expect(201);

    const verified = await request(app.getHttpServer())
      .post(`/v1/identity/accounts/${accountId}/verify-identity`)
      .send({
        governmentId: 'P1234567',
        livenessChallengeId: challenge.body.challengeId,
        livenessResponse: challenge.body.phrase,
      })
      .expect(201);

    expect(verified.body.account.tier).toBe(2);
    expect(verified.body.account.did).toMatch(/^did:glos:/);
    const carrier = verified.body.account.roles.find((r: { role: string }) => r.role === 'carrier');
    expect(carrier.status).toBe('active');
  });

  it('M1 onboarding: a sanctioned registration is auto-suspended', async () => {
    const reg = await request(app.getHttpServer())
      .post('/v1/identity/register')
      .send({ fullName: 'OFAC Test Person', roles: ['shipper'] })
      .expect(201);
    expect(reg.body.status).toBe('suspended');
  });

  it('M1 register rejects an empty roles array (validation)', async () => {
    await request(app.getHttpServer())
      .post('/v1/identity/register')
      .send({ fullName: 'Jane Doe', roles: [] })
      .expect(400);
  });

  it('M1 wallet: provisioned on verify, then credit → cash-out → bank-link', async () => {
    const reg = await request(app.getHttpServer())
      .post('/v1/identity/register')
      .send({ fullName: 'Wallet User', jurisdiction: 'NL', roles: ['carrier'] })
      .expect(201);
    const accountId = reg.body.accountId as string;

    const challenge = await request(app.getHttpServer()).post('/v1/identity/liveness/challenge').expect(201);
    const verify = await request(app.getHttpServer())
      .post(`/v1/identity/accounts/${accountId}/verify-identity`)
      .send({ governmentId: 'P1', livenessChallengeId: challenge.body.challengeId, livenessResponse: challenge.body.phrase })
      .expect(201);
    expect(verify.body.wallet.settlementCurrency).toBe('EUR');
    expect(verify.body.backgroundCheck.passed).toBe(true);

    const base = `/v1/identity/accounts/${accountId}/wallet`;
    await request(app.getHttpServer()).post(`${base}/credit`).send({ amount: 38.5 }).expect(201);

    const cashOut = await request(app.getHttpServer()).post(`${base}/cash-out`).send({ amount: 20 }).expect(201);
    expect(cashOut.body.status).toBe('completed');

    const walletAfter = await request(app.getHttpServer()).get(base).expect(200);
    expect(walletAfter.body.balances.EUR).toBeCloseTo(18.5);

    const start = await request(app.getHttpServer()).post(`${base}/bank-link/start`).expect(201);
    const link = await request(app.getHttpServer())
      .post(`${base}/bank-link/verify`)
      .send({ challengeId: start.body.challengeId, amount1: start.body.amounts[0], amount2: start.body.amounts[1] })
      .expect(201);
    expect(link.body.linked).toBe(true);
  });

  it('M2 shipment: create (DID-auth) → decompose into legs with handover geofences', async () => {
    // Shipment endpoints are protected — unauthenticated create is rejected.
    await request(app.getHttpServer())
      .post('/v1/shipments')
      .send({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 1000, packageCount: 10, mode: 'ocean' })
      .expect(401);

    const tokenRes = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ sub: 'shipper-client', type: 'client_credentials' })
      .expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    const created = await request(app.getHttpServer())
      .post('/v1/shipments')
      .set(auth)
      .send({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 1000, packageCount: 10, mode: 'ocean', handlingCodes: ['TEMP_2_8C'] })
      .expect(201);
    const id = created.body.glosShipmentId as string;
    expect(id).toMatch(/^GLOS-/);

    const decomposed = await request(app.getHttpServer()).post(`/v1/shipments/${id}/decompose`).set(auth).expect(201);
    expect(decomposed.body.legs.map((l: { mode: string }) => l.mode)).toEqual(['road', 'ocean', 'courier']);
    expect(decomposed.body.legs[0].handover.geofence.id).toMatch(/^GEO-/);

    const jrv = await request(app.getHttpServer()).get(`/v1/shipments/${id}/job-requirements`).set(auth).expect(200);
    expect(jrv.body.perLeg[0].mandatoryVCs).toContain('cold-chain');
  });

  it('M2 ingestion channels: batch CSV, Shopify plugin, and template all create twins (M2-010/013)', async () => {
    const tokenRes = await request(app.getHttpServer()).post('/v1/auth/token').send({ sub: 'shipper', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    // Batch CSV.
    const csv = ['origin,destination,totalWeightKg,packageCount,mode', 'Rotterdam,Berlin,12,1,road', 'Hamburg,Zurich,800,4,ocean'].join('\n');
    const batch = await request(app.getHttpServer()).post('/v1/shipments/batch').set(auth).send({ csv }).expect(201);
    expect(batch.body.created).toHaveLength(2);

    // Shopify plugin.
    const ship = await request(app.getHttpServer()).post('/v1/shipments/via/shopify').set(auth).send({ order: { id: 5, shipping_address: { city: 'Paris' }, line_items: [{ grams: 1000, quantity: 1 }] } }).expect(201);
    expect(ship.body.destination).toBe('Paris');

    // Template → create from template.
    const tpl = await request(app.getHttpServer()).post('/v1/shipments/templates').set(auth).send({ name: 'EU Export', fields: { origin: 'Rotterdam', mode: 'ocean', totalWeightKg: 500, packageCount: 5 } }).expect(201);
    const fromTpl = await request(app.getHttpServer()).post(`/v1/shipments/from-template/${tpl.body.id}`).set(auth).send({ destination: 'Singapore' }).expect(201);
    expect(fromTpl.body.origin).toBe('Rotterdam');
    expect(fromTpl.body.destination).toBe('Singapore');
  });

  it('M2 schema + constraints: published schema, DG classify, Incoterm validation (M2-020..033)', async () => {
    const tokenRes = await request(app.getHttpServer()).post('/v1/auth/token').send({ sub: 'shipper', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    const schema = await request(app.getHttpServer()).get('/v1/shipments/schema').set(auth).expect(200);
    expect(schema.body.title).toContain('E-Waybill');

    const dg = await request(app.getHttpServer()).post('/v1/shipments/classify-dg').set(auth).send({ unNumber: 'UN1203' }).expect(201);
    expect(dg.body.class).toBe('3');

    const hs = await request(app.getHttpServer()).get('/v1/shipments/hs-code/suggest').query({ q: 'roasted coffee' }).set(auth).expect(200);
    expect(hs.body.code).toBe('090111');

    // Invalid Incoterm is rejected by the schema validator.
    await request(app.getHttpServer()).post('/v1/shipments').set(auth)
      .send({ origin: 'A', destination: 'B', totalWeightKg: 5, packageCount: 1, goods: { incoterms: 'ZZZ' } }).expect(400);
  });

  it('M2 §5.2.4-5.2.6: smart label, Fabric verification, leg data isolation', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'shipper', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    const did = await request(http).post('/v1/did').send({ controller: 'shipper-e2e' }).expect(201);
    const shipperDid = did.body.id as string;

    // Non-VC handling codes so a carrier can be assigned without pre-issued credentials.
    const created = await request(http).post('/v1/shipments').set(auth)
      .send({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 100, packageCount: 2, mode: 'ocean', handlingCodes: ['THIS_WAY_UP', 'KEEP_DRY'], goods: { incoterms: 'FOB', commercialValue: { amount: 5000, currency: 'USD' }, description: 'machinery' }, parties: [{ role: 'shipper', did: shipperDid }] })
      .expect(201);
    const id = created.body.glosShipmentId as string;

    // Smart label + ZPL render.
    const label = await request(http).post(`/v1/shipments/${id}/label`).set(auth).expect(201);
    expect(label.body.pictograms).toEqual(expect.arrayContaining(['⬆️', '☂️']));
    const zpl = await request(http).get(`/v1/shipments/${id}/label`).query({ format: 'zpl' }).set(auth).expect(200);
    expect(zpl.text).toContain('^XA');

    // Lightweight Fabric verification.
    const verify = await request(http).get(`/v1/shipments/${id}/verify`).set(auth).expect(200);
    expect(verify.body.verified).toBe(true);
    expect(verify.body.network.network).toBe('hyperledger-fabric');

    // NFR-M2-06: open schema published as JSON Schema + Protobuf.
    const proto = await request(http).get('/v1/shipments/schema').query({ format: 'proto' }).set(auth).expect(200);
    expect(proto.text).toContain('syntax = "proto3"');
    // NFR-M2-05: standards crosswalk + conformance report.
    const std = await request(http).get('/v1/shipments/schema/standards').set(auth).expect(200);
    expect(std.body.standards.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['UN/CEFACT MMT', 'WCO Data Model', 'IATA ONE Record']));
    const conf = await request(http).get(`/v1/shipments/${id}/conformance`).set(auth).expect(200);
    expect(conf.body.conformant).toBe(true);

    // Decompose, assign a carrier to leg 0, and prove data isolation.
    await request(http).post(`/v1/shipments/${id}/decompose`).set(auth).expect(201);
    await request(http).post(`/v1/shipments/${id}/legs/0/assign`).set(auth).send({ carrierDid: 'did:glos:c0' }).expect(201);
    await request(http).get(`/v1/shipments/${id}/legs/0/view`).query({ requester: 'did:glos:c0' }).set(auth).expect(200);
    await request(http).get(`/v1/shipments/${id}/legs/1/view`).query({ requester: 'did:glos:c0' }).set(auth).expect(403); // leg-0 carrier can't see leg 1
  });

  it('M4 tracking: M2 decompose registers context → ingest events → anchored timeline + delivery', async () => {
    const tokenRes = await request(app.getHttpServer())
      .post('/v1/auth/token')
      .send({ sub: 'ops-client', type: 'client_credentials' })
      .expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    // Unauthenticated tracking is rejected.
    await request(app.getHttpServer()).post('/v1/tracking/events').send({ glosShipmentId: 'X', type: 'PICKUP' }).expect(401);

    // Create + decompose a shipment; M4 picks up the context from the leg_decomposed event.
    const created = await request(app.getHttpServer())
      .post('/v1/shipments')
      .set(auth)
      .send({ origin: 'Oslo', destination: 'Oslo', totalWeightKg: 5, packageCount: 1, mode: 'courier' })
      .expect(201);
    const id = created.body.glosShipmentId as string;
    await request(app.getHttpServer()).post(`/v1/shipments/${id}/decompose`).set(auth).expect(201);

    // Ingest pickup (via connector) then out-for-delivery, then deliver with PoD.
    const pickup = await request(app.getHttpServer())
      .post('/v1/tracking/events/via/rest-carrier')
      .set(auth)
      .send({ payload: { shipmentId: id, status: 'picked_up', ts: '2026-06-26T08:00:00.000Z' } })
      .expect(201);
    expect(pickup.body.hasContext).toBe(true);

    await request(app.getHttpServer())
      .post('/v1/tracking/events')
      .set(auth)
      .send({ glosShipmentId: id, type: 'OUT_FOR_DELIVERY', occurredAt: '2026-06-26T09:00:00.000Z' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/tracking/${id}/delivery`)
      .set(auth)
      .send({ type: 'photo', ref: 'photo-1' })
      .expect(201);

    const timeline = await request(app.getHttpServer()).get(`/v1/tracking/${id}/timeline`).set(auth).expect(200);
    expect(timeline.body.currentState).toBe('DELIVERED');
    expect(timeline.body.events).toHaveLength(3);
    expect(timeline.body.events.every((e: { anchorTxId: string }) => /^[0-9a-f]{64}$/.test(e.anchorTxId))).toBe(true); // Fabric tx ids
  });

  it('full loop: funded escrow pays the carrier when M4 confirms pickup (M1→M2→M4→SSE→M1)', async () => {
    const http = app.getHttpServer();

    // Onboard a shipper (payer) and a carrier (payee) to Tier 2 — public onboarding.
    async function onboard(role: string) {
      const reg = await request(http).post('/v1/identity/register').send({ fullName: `${role} user`, jurisdiction: 'US', roles: [role] }).expect(201);
      const accountId = reg.body.accountId as string;
      const ch = await request(http).post('/v1/identity/liveness/challenge').expect(201);
      const ver = await request(http)
        .post(`/v1/identity/accounts/${accountId}/verify-identity`)
        .send({ governmentId: 'P1', livenessChallengeId: ch.body.challengeId, livenessResponse: ch.body.phrase })
        .expect(201);
      return { accountId, did: ver.body.account.did as string };
    }
    const shipper = await onboard('shipper');
    const carrier = await onboard('carrier');

    // Fund the shipper's wallet (prototype credit).
    await request(http).post(`/v1/identity/accounts/${shipper.accountId}/wallet/credit`).send({ amount: 1000 }).expect(201);

    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    // Create + decompose a shipment.
    const created = await request(http).post('/v1/shipments').set(auth).send({ origin: 'NYC', destination: 'LA', totalWeightKg: 10, packageCount: 1, mode: 'road' }).expect(201);
    const shipmentId = created.body.glosShipmentId as string;
    await request(http).post(`/v1/shipments/${shipmentId}/decompose`).set(auth).expect(201);

    // Create + fund the escrow (terms supplied directly — M3 stand-in).
    const escrow = await request(http)
      .post('/v1/settlement/escrows')
      .set(auth)
      .send({
        glosShipmentId: shipmentId,
        payerDid: shipper.did,
        currency: 'USD',
        totalAmount: 1000,
        commissionRate: 0,
        milestones: [
          { name: 'PICKUP', percent: 40, payeeDid: carrier.did },
          { name: 'DELIVERY', percent: 60, payeeDid: carrier.did },
        ],
      })
      .expect(201);
    const escrowId = escrow.body.escrowId as string;
    await request(http).post(`/v1/settlement/escrows/${escrowId}/fund`).set(auth).expect(201);

    // M4 confirms pickup → SSE releases the PICKUP milestone → carrier wallet credited.
    await request(http).post('/v1/tracking/events').set(auth).send({ glosShipmentId: shipmentId, type: 'PICKUP' }).expect(201);

    const carrierWallet = await request(http).get(`/v1/identity/accounts/${carrier.accountId}/wallet`).expect(200);
    expect(carrierWallet.body.balances.USD).toBe(400); // 40% of 1000, paid by the settlement loop

    const summary = await request(http).get(`/v1/settlement/escrows/${escrowId}`).set(auth).expect(200);
    expect(summary.body.status).toBe('partially_released');
    expect(summary.body.releasedAmount).toBe(400);
  });

  it('grand loop: M2→M3 match→accept auto-creates escrow→fund→M4 pickup pays carrier (M2→M3→SSE→M4→M1)', async () => {
    const http = app.getHttpServer();

    async function onboard(role: string) {
      const reg = await request(http).post('/v1/identity/register').send({ fullName: `${role} u`, jurisdiction: 'US', roles: [role] }).expect(201);
      const accountId = reg.body.accountId as string;
      const ch = await request(http).post('/v1/identity/liveness/challenge').expect(201);
      const ver = await request(http).post(`/v1/identity/accounts/${accountId}/verify-identity`).send({ governmentId: 'P1', livenessChallengeId: ch.body.challengeId, livenessResponse: ch.body.phrase }).expect(201);
      return { accountId, did: ver.body.account.did as string };
    }
    const shipper = await onboard('shipper');
    const carrier = await onboard('carrier');
    await request(http).post(`/v1/identity/accounts/${shipper.accountId}/wallet/credit`).send({ amount: 1000 }).expect(201);

    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    // Shipment.
    const created = await request(http).post('/v1/shipments').set(auth).send({ origin: 'NYC', destination: 'Boston', totalWeightKg: 8, packageCount: 1, mode: 'road' }).expect(201);
    const shipmentId = created.body.glosShipmentId as string;
    await request(http).post(`/v1/shipments/${shipmentId}/decompose`).set(auth).expect(201);

    // Carrier broadcasts availability; shipper submits demand → match → accept.
    await request(http).post('/v1/matching/availability').set(auth).send({ did: carrier.did, zone: 'US', equipment: [] }).expect(201);
    const match = await request(http).post('/v1/matching/demands').set(auth).send({ glosShipmentId: shipmentId, payerDid: shipper.did, currency: 'USD' }).expect(201);
    expect(match.body.status).toBe('offered');
    expect(match.body.currentOffer.carrierDid).toBe(carrier.did);
    await request(http).post(`/v1/matching/matches/${match.body.matchId}/accept`).set(auth).expect(201);

    // The accepted match auto-created the escrow (no manual create).
    const escrow = await request(http).get(`/v1/settlement/escrows/by-shipment/${shipmentId}`).set(auth).expect(200);
    expect(escrow.body.totalAmount).toBeGreaterThan(0);
    await request(http).post(`/v1/settlement/escrows/${escrow.body.escrowId}/fund`).set(auth).expect(201);

    // M4 confirms pickup → SSE releases PICKUP → carrier paid.
    await request(http).post('/v1/tracking/events').set(auth).send({ glosShipmentId: shipmentId, type: 'PICKUP' }).expect(201);
    const carrierWallet = await request(http).get(`/v1/identity/accounts/${carrier.accountId}/wallet`).expect(200);
    expect(carrierWallet.body.balances.USD).toBeGreaterThan(0); // settlement reached the carrier
  });

  it('M5 reputation: a delivered transaction is rated → composite updates → feeds M3 (M2→M3→M4→M5)', async () => {
    const http = app.getHttpServer();
    async function onboard(role: string) {
      const reg = await request(http).post('/v1/identity/register').send({ fullName: `${role} r`, jurisdiction: 'US', roles: [role] }).expect(201);
      const accountId = reg.body.accountId as string;
      const ch = await request(http).post('/v1/identity/liveness/challenge').expect(201);
      const ver = await request(http).post(`/v1/identity/accounts/${accountId}/verify-identity`).send({ governmentId: 'P1', livenessChallengeId: ch.body.challengeId, livenessResponse: ch.body.phrase }).expect(201);
      return { accountId, did: ver.body.account.did as string };
    }
    const shipper = await onboard('shipper');
    const carrier = await onboard('carrier');
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    // Shipment → match → accept (records the transaction participants in M5).
    const created = await request(http).post('/v1/shipments').set(auth).send({ origin: 'NYC', destination: 'Boston', totalWeightKg: 6, packageCount: 1, mode: 'road' }).expect(201);
    const shipmentId = created.body.glosShipmentId as string;
    await request(http).post(`/v1/shipments/${shipmentId}/decompose`).set(auth).expect(201);
    await request(http).post('/v1/matching/availability').set(auth).send({ did: carrier.did, zone: 'US' }).expect(201);
    const match = await request(http).post('/v1/matching/demands').set(auth).send({ glosShipmentId: shipmentId, payerDid: shipper.did, currency: 'USD' }).expect(201);
    await request(http).post(`/v1/matching/matches/${match.body.matchId}/accept`).set(auth).expect(201);

    // Track to delivery (marks the transaction complete in M5).
    await request(http).post('/v1/tracking/events').set(auth).send({ glosShipmentId: shipmentId, type: 'PICKUP' }).expect(201);
    await request(http).post('/v1/tracking/events').set(auth).send({ glosShipmentId: shipmentId, type: 'OUT_FOR_DELIVERY' }).expect(201);
    await request(http).post(`/v1/tracking/${shipmentId}/delivery`).set(auth).send({ type: 'signature', ref: 'sig' }).expect(201);

    // Shipper rates the carrier.
    await request(http).post('/v1/reputation/ratings').set(auth).send({ glosShipmentId: shipmentId, raterDid: shipper.did, onTime: 'yes', cargoCare: 'pristine', communication: 5, documentation: 'accurate', equipment: 'compliant' }).expect(201);

    const rep = await request(http).get(`/v1/reputation/${carrier.did}`).set(auth).expect(200);
    expect(rep.body.composite).toBeGreaterThan(3.0); // moved above the neutral prior
    expect(rep.body.explanation).toContain('Trust Score');
    expect(rep.body.dimensions.onTime.value).toBe(100);
  });

  it('SSE dispute → M5: filing + resolving an at-fault dispute lowers the carrier reputation (SSE→M5)', async () => {
    const http = app.getHttpServer();
    async function onboard(role: string) {
      const reg = await request(http).post('/v1/identity/register').send({ fullName: `${role} d`, jurisdiction: 'US', roles: [role] }).expect(201);
      const accountId = reg.body.accountId as string;
      const ch = await request(http).post('/v1/identity/liveness/challenge').expect(201);
      const ver = await request(http).post(`/v1/identity/accounts/${accountId}/verify-identity`).send({ governmentId: 'P1', livenessChallengeId: ch.body.challengeId, livenessResponse: ch.body.phrase }).expect(201);
      return { accountId, did: ver.body.account.did as string };
    }
    const shipper = await onboard('shipper');
    const carrier = await onboard('carrier');
    await request(http).post(`/v1/identity/accounts/${shipper.accountId}/wallet/credit`).send({ amount: 1000 }).expect(201);
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    const created = await request(http).post('/v1/shipments').set(auth).send({ origin: 'LA', destination: 'SF', totalWeightKg: 9, packageCount: 1, mode: 'road' }).expect(201);
    const shipmentId = created.body.glosShipmentId as string;
    await request(http).post(`/v1/shipments/${shipmentId}/decompose`).set(auth).expect(201);

    const escrow = await request(http).post('/v1/settlement/escrows').set(auth)
      .send({ glosShipmentId: shipmentId, payerDid: shipper.did, currency: 'USD', totalAmount: 1000, commissionRate: 0, milestones: [{ name: 'PICKUP', percent: 100, payeeDid: carrier.did }] })
      .expect(201);
    const escrowId = escrow.body.escrowId as string;
    await request(http).post(`/v1/settlement/escrows/${escrowId}/fund`).set(auth).expect(201);

    // File a damage dispute, check the evidence pack + journal, resolve at-fault → notifies M5.
    const filed = await request(http).post(`/v1/settlement/escrows/${escrowId}/disputes`).set(auth)
      .send({ milestone: 'PICKUP', tag: 'damage', reason: 'crushed pallet', filedByDid: shipper.did }).expect(201);
    const ev = await request(http).get(`/v1/settlement/disputes/${filed.body.disputeId}/evidence`).set(auth).expect(200);
    expect(ev.body.journalVerified).toBe(true);

    await request(http).post(`/v1/settlement/disputes/${filed.body.disputeId}/resolve`).set(auth)
      .send({ level: 3, atFault: true, atFaultDid: carrier.did }).expect(201);

    const rep = await request(http).get(`/v1/reputation/${carrier.did}`).set(auth).expect(200);
    expect(rep.body.dimensions.cargoCare.value).toBe(0); // damage → cargo care tanked
    expect(rep.body.disputeSummary.atFault).toBe(1);
    expect(rep.body.sanction).toBe('training');
  });

  it('M7 control tower: tracked shipment → disruption → blast radius → policy auto-rebook via M3 (§11.5)', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const shipper = 'did:glos:shipper-m7';

    // M2 → twin: an ocean shipment digitized + decomposed populates the digital twin.
    const created = await request(http).post('/v1/shipments').set(auth).send({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 800, packageCount: 5, mode: 'ocean' }).expect(201);
    const shipmentId = created.body.glosShipmentId as string;
    await request(http).post(`/v1/shipments/${shipmentId}/decompose`).set(auth).expect(201);

    // M3 → twin: match + accept adds the carrier + assigned-to edge.
    await request(http).post('/v1/matching/availability').set(auth).send({ did: 'did:glos:carrier-a', zone: 'EU' }).expect(201);
    await request(http).post('/v1/matching/availability').set(auth).send({ did: 'did:glos:carrier-b', zone: 'EU' }).expect(201);
    const match = await request(http).post('/v1/matching/demands').set(auth).send({ glosShipmentId: shipmentId, payerDid: shipper, currency: 'USD' }).expect(201);
    await request(http).post(`/v1/matching/matches/${match.body.matchId}/accept`).set(auth).expect(201);

    // The twin reflects the live state, and ETA is predicted.
    const node = await request(http).get(`/v1/control-tower/twin/shipments/${shipmentId}`).set(auth).expect(200);
    expect(node.body.node.state).toBe('assigned');
    const etaRes = await request(http).get(`/v1/control-tower/eta/${shipmentId}`).set(auth).expect(200);
    expect(etaRes.body.hoursRemaining).toBeGreaterThan(0);

    // Disruption ingested + classified, blast radius lists this shipment.
    const disr = await request(http).post('/v1/control-tower/disruptions').set(auth).send({ zone: 'Singapore', keywords: ['port strike'], severity: 'high' }).expect(201);
    expect(disr.body.type).toBe('port_strike');
    const impact = await request(http).get(`/v1/control-tower/disruptions/${disr.body.id}/impact`).set(auth).expect(200);
    expect(impact.body.map((i: { glosShipmentId: string }) => i.glosShipmentId)).toContain(shipmentId);

    // A shipper policy fires → autonomous rebook through M3, anchored + reversible.
    await request(http).post('/v1/control-tower/policies').set(auth).send({ shipperDid: shipper, ifDelayHoursGt: 6, ifExtraCostLt: 1000, thenAction: 'rebook_fastest' }).expect(201);
    const action = await request(http).post(`/v1/control-tower/disruptions/${disr.body.id}/evaluate/${shipmentId}`).set(auth).expect(201);
    expect(action.body.status).toBe('executed');
    expect(action.body.anchorTxId).toMatch(/^[0-9a-f]{64}$/);
    expect(action.body.rematchId).toBeDefined();
  });

  it('M3 Sprint 2/3: batch matching, explainable quote, tiers, override + fairness', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    // Two decomposed shipments + two available carriers.
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const created = await request(http).post('/v1/shipments').set(auth).send({ origin: 'Paris', destination: 'Lyon', totalWeightKg: 8, packageCount: 1, mode: 'road' }).expect(201);
      ids.push(created.body.glosShipmentId);
      await request(http).post(`/v1/shipments/${created.body.glosShipmentId}/decompose`).set(auth).expect(201);
    }
    await request(http).post('/v1/matching/availability').set(auth).send({ did: 'did:glos:e2e-c1', zone: 'EU' }).expect(201);
    await request(http).post('/v1/matching/availability').set(auth).send({ did: 'did:glos:e2e-c2', zone: 'EU' }).expect(201);

    // Explainable quote (M3-060) with a service tier (M3-044).
    const quote = await request(http).post('/v1/matching/quote').set(auth).send({ glosShipmentId: ids[0], payerDid: 'did:glos:e2e-shipper', zone: 'EU', slo: { tier: 'express' } }).expect(201);
    expect(quote.body.explanation).toContain('Chose');
    expect(quote.body.price.tier).toBe('express');
    expect(quote.body.price.tierMultiplier).toBe(1.4);

    // Batch matching (M3-031): both shipments assigned to distinct carriers.
    const batch = await request(http).post('/v1/matching/batch').set(auth)
      .send({ window: 'batch', demands: ids.map((id) => ({ glosShipmentId: id, payerDid: 'did:glos:e2e-shipper', zone: 'EU' })) }).expect(201);
    expect(batch.body.assigned).toBe(2);
    expect(new Set(batch.body.assignments.map((a: { carrierDid: string }) => a.carrierDid)).size).toBe(2);

    // Governed override (M3-062) on one of the batch matches.
    const forced = await request(http).post(`/v1/matching/matches/${batch.body.assignments[0].matchId}/force-assign`).set(auth)
      .send({ carrierDid: 'did:glos:e2e-vip', reason: 'VIP customer', by: 'ops:e2e' }).expect(201);
    expect(forced.body.status).toBe('confirmed');
    expect(forced.body.confirmedCarrierDid).toBe('did:glos:e2e-vip');

    // Forecast + pre-book (M3-022) and the fairness dashboard (M3-061).
    const forecast = await request(http).get('/v1/matching/forecast/EU').set(auth).expect(200);
    expect(forecast.body.zone).toBe('EU');
    const fairness = await request(http).get('/v1/matching/fairness').set(auth).expect(200);
    expect(fairness.body.totalOffers).toBeGreaterThanOrEqual(2);
  });

  it('M4 Sprint 2/3: ETA + geofence + IoT exception → M7 autonomous response (M4→M7 telemetry loop)', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const shipper = 'did:glos:e2e-acme';

    // Digitize + decompose (twin + tracking context), match + accept (twin gets payer + carrier).
    const created = await request(http).post('/v1/shipments').set(auth).send({ origin: 'Rotterdam', destination: 'Singapore', totalWeightKg: 700, packageCount: 5, mode: 'ocean' }).expect(201);
    const shipmentId = created.body.glosShipmentId as string;
    await request(http).post(`/v1/shipments/${shipmentId}/decompose`).set(auth).expect(201);
    await request(http).post('/v1/matching/availability').set(auth).send({ did: 'did:glos:e2e-tc1', zone: 'EU' }).expect(201);
    await request(http).post('/v1/matching/availability').set(auth).send({ did: 'did:glos:e2e-tc2', zone: 'EU' }).expect(201);
    const match = await request(http).post('/v1/matching/demands').set(auth).send({ glosShipmentId: shipmentId, payerDid: shipper, currency: 'USD' }).expect(201);
    await request(http).post(`/v1/matching/matches/${match.body.matchId}/accept`).set(auth).expect(201);

    // M4 receives a pickup → live ETA with a multi-leg breakdown.
    await request(http).post('/v1/tracking/events').set(auth).send({ glosShipmentId: shipmentId, type: 'PICKUP' }).expect(201);
    const eta = await request(http).get(`/v1/tracking/${shipmentId}/eta`).set(auth).expect(200);
    expect(eta.body.hoursRemaining).toBeGreaterThan(0);
    expect(eta.body.perLeg.length).toBeGreaterThan(0);

    // Alert rule + webhook subscribed before the breach.
    await request(http).post('/v1/tracking/alerts/rules').set(auth).send({ on: 'exception', minSeverity: 'high', channels: ['in_app'], label: 'Cold-chain breach' }).expect(201);
    await request(http).post('/v1/tracking/webhooks').set(auth).send({ url: 'https://ops.example/hook', secret: 'sk', events: ['tracking.exception_raised'] }).expect(201);

    // A shipper autonomy policy, then an IoT temperature breach → critical exception → autonomous rebook.
    await request(http).post('/v1/control-tower/policies').set(auth).send({ shipperDid: shipper, ifDelayHoursGt: 6, ifExtraCostLt: 1000, thenAction: 'rebook_fastest' }).expect(201);
    const breach = await request(http).post(`/v1/tracking/${shipmentId}/sensor`).set(auth).send({ metric: 'temperature', value: 15 }).expect(201);
    expect(breach.body.type).toBe('temperature_breach');

    // The exception became a case, raised an alert + signed webhook, and drove an M7 action.
    const cases = await request(http).get(`/v1/tracking/${shipmentId}/exceptions`).set(auth).expect(200);
    expect(cases.body.some((c: { type: string }) => c.type === 'temperature_breach')).toBe(true);
    const outbox = await request(http).get('/v1/tracking/webhooks/outbox').set(auth).expect(200);
    expect(outbox.body.length).toBeGreaterThanOrEqual(1);
    const actions = await request(http).get(`/v1/control-tower/actions?shipment=${shipmentId}`).set(auth).expect(200);
    expect(actions.body.some((a: { glosShipmentId: string; status: string }) => a.glosShipmentId === shipmentId && a.status === 'executed')).toBe(true);
  });

  it('PUDO Light: agent onboarding + pre-paid gate + steel-thread parcel flow (emerging-market on-ramp)', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    async function onboard(shopName: string, zone: string) {
      const u = Math.random().toString(16).slice(2, 10);
      const reg = await request(http).post('/v1/sbg/agents').set(auth)
        .send({ shopName, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: `${shopName} owner`, nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
      const did = reg.body.did as string;
      await sendShopPapers(did);
      await request(http).post(`/v1/sbg/agents/${did}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
      await fund(`/v1/sbg/agents/${did}/top-up`, 50, auth);
      return did;
    }
    const origin = await onboard('North PUDO', 'NorthTown');
    const dest = await onboard('South PUDO', 'SouthTown');

    // Agent is ACTIVE and the gate passes.
    expect((await request(http).get(`/v1/sbg/agents/${origin}`).set(auth).expect(200)).body.status).toBe('ACTIVE');
    await request(http).get(`/v1/sbg/agents/${origin}/can-transact`).set(auth).expect(200);

    // Static corridor + driver.
    const corridor = await request(http).post('/v1/sbg/corridors').set(auth).send({ name: 'N-S Express', originZone: 'NorthTown', destZone: 'SouthTown' }).expect(201);
    const driver = await request(http).post('/v1/sbg/drivers').set(auth).send({ driverDid: 'did:glos:bus1', name: 'John', corridorId: corridor.body.corridorId }).expect(201);

    // Screen 1 Accept → Screen 2 Handover → arrive → Screen 3 Pickup (OTP).
    // The release code is minted at intake and held by the sender from that moment — never handed back on
    // arrival, because the shop that releases a parcel must never learn its secret (see parcel-release-secret).
    const accepted = await request(http).post('/v1/sbg/parcels/accept').set(auth).send({ agentDid: origin, parcelId: 'E2E-QR-1', size: 'M', destZone: 'SouthTown', senderMobile: '+254700', receiverMobile: '+254711', dropoffPhotoRef: 'drop.jpg' }).expect(201);
    await request(http).post('/v1/sbg/parcels/handover').set(auth).send({ agentDid: origin, driverBadgeId: driver.body.badgeId, parcelIds: ['E2E-QR-1'] }).expect(201);
    const arrival = await request(http).post('/v1/sbg/parcels/E2E-QR-1/arrive').set(auth).send({ destAgentDid: dest }).expect(201);
    expect(arrival.body.otp).toBeUndefined();
    const delivered = await request(http).post('/v1/sbg/parcels/E2E-QR-1/pickup').set(auth).send({ agentDid: dest, otp: accepted.body.otp, deliveredPhotoRef: 'del.jpg' }).expect(201);
    expect(delivered.body.status).toBe('Delivered');

    // Tier-1 customer rates → graduates into the shared reputation core.
    const rated = await request(http).post('/v1/sbg/parcels/E2E-QR-1/rate').set(auth).send({ stars: 5, raterMobile: '+254711' }).expect(201);
    expect(rated.body.agentComposite).toBe(5);

    // Operator dashboard reflects the float + activity.
    const dash = await request(http).get('/v1/sbg/dashboard').set(auth).expect(200);
    expect(dash.body.agentsTotal).toBeGreaterThanOrEqual(2);
    expect(dash.body.systemFloat).toBeGreaterThan(0);

    // Graduation: the PUDO parcel is now visible on the GLOS spine — M7 control tower + M4 timeline.
    const twin = await request(http).get('/v1/control-tower/twin/shipments/E2E-QR-1').set(auth).expect(200);
    expect(twin.body.node.props.source).toBe('pudo');
    expect(twin.body.node.state).toBe('delivered');
    const m4 = await request(http).get('/v1/tracking/E2E-QR-1/timeline').set(auth).expect(200);
    expect(m4.body.currentState).toBe('DELIVERED');
    expect(m4.body.events.some((e: { type: string }) => e.type === 'PICKUP')).toBe(true);
  });

  it('PUDO inbound e-commerce: vendor webhook → label → intake → bus → shelve → collect + vendor callbacks', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    async function onboard(shop: string, zone: string) {
      const u = Math.random().toString(16).slice(2, 10);
      const reg = await request(http).post('/v1/sbg/agents').set(auth).send({ shopName: shop, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: `${shop} o`, nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
      const did = reg.body.did as string;
      await sendShopPapers(did);
      await request(http).post(`/v1/sbg/agents/${did}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
      await fund(`/v1/sbg/agents/${did}/top-up`, 20, auth);
      return did;
    }
    const origin = await onboard('Origin PUDO', 'NorthTown');
    const dest = await onboard('Dest PUDO', 'SouthTown');
    const corridor = await request(http).post('/v1/sbg/corridors').set(auth).send({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' }).expect(201);
    const driver = await request(http).post('/v1/sbg/drivers').set(auth).send({ driverDid: 'did:glos:invan', name: 'Joe', corridorId: corridor.body.corridorId }).expect(201);

    // Vendor onboarding + the shipment webhook.
    const vendor = await request(http).post('/v1/sbg/vendors').set(auth).send({ name: 'ACME Store', callbackUrl: 'https://acme.example/hook' }).expect(201);
    expect(vendor.body.secret).toMatch(/^whsec_/); // issued exactly once, at registration
    // But a later fetch must NOT re-expose the signing secret (a guessed vendorId would leak the key).
    const reFetched = await request(http).get(`/v1/sbg/vendors/${vendor.body.vendorId}`).set(auth).expect(200);
    expect(reFetched.body.secret).toBeUndefined();
    // The store pays in and mints its own order, signed in as itself: staff do neither in a store's name.
    const acme = await asStore(vendor.body);
    // THE STORE NAMES ITS INSURER on its shipping policy, signed in as itself: staff cannot, and half an insurer is refused.
    await request(http).patch(`/v1/sbg/vendors/${vendor.body.vendorId}`).set(auth).send({ shippingPolicy: { insurer: { name: 'Jubilee', email: 'claims@jubilee.example' } } }).expect(403);
    expect((await request(http).patch(`/v1/sbg/vendors/${vendor.body.vendorId}`).set(acme).send({ shippingPolicy: { insurer: { name: 'Jubilee', email: 'not-an-address' } } })).status).toBe(400);
    const insured = await request(http).patch(`/v1/sbg/vendors/${vendor.body.vendorId}`).set(acme).send({ shippingPolicy: { insurer: { name: 'Jubilee Allianz Claims', email: 'Claims@Jubilee.Example' } } }).expect(200);
    expect(insured.body.shippingPolicy.insurer).toEqual({ name: 'Jubilee Allianz Claims', email: 'claims@jubilee.example' });
    await request(http).post(`/v1/sbg/vendors/${vendor.body.vendorId}/top-up`).set(auth).send({ amount: 50 }).expect(403);
    const { asked: topped } = await fund(`/v1/sbg/vendors/${vendor.body.vendorId}/top-up`, 50, acme, auth); // prepay the daughter co
    expect(topped.body.secret).toBeUndefined();
    await request(http).post('/v1/sbg/inbound/orders').set(auth).send({ vendorId: vendor.body.vendorId, originPudoDid: origin, destPudoDid: dest, buyerMobile: '+254700999', size: 'M', contentPhotoRef: 'content.jpg' }).expect(403);
    const order = await request(http).post('/v1/sbg/inbound/orders').set(acme).send({ vendorId: vendor.body.vendorId, externalOrderId: 'ORD-77', originPudoDid: origin, destPudoDid: dest, buyerMobile: '+254700999', size: 'M', contentPhotoRef: 'content.jpg', items: [{ name: 'Books', qty: 3 }] }).expect(201);
    const parcelId = order.body.parcel.parcelId as string;
    const collectionCode = order.body.parcel.collectionCode as string;
    expect(order.body.label.svg).toContain('<svg');

    // Field flow.
    await request(http).post(`/v1/sbg/parcels/${parcelId}/intake`).set(auth).send({ agentDid: origin }).expect(201);
    await request(http).post('/v1/sbg/parcels/handover').set(auth).send({ agentDid: origin, driverBadgeId: driver.body.badgeId, parcelIds: [parcelId] }).expect(201);
    const shelf = await request(http).post(`/v1/sbg/parcels/${parcelId}/shelve`).set(auth).send({ agentDid: dest }).expect(201);
    expect(shelf.body.binSlot).toMatch(/^[A-Za-z]+-[1-9]$/);

    // THE PROMISE IS KEPT. The plan made when the counter took it in — the route, and when it should be ready — is kept
    // on the parcel, and the tracking page reads THAT, not an estimate worked out again from whenever somebody looks.
    const route = (await request(http).get(`/v1/sbg/parcels/${parcelId}/route`).set(acme).expect(200)).body;
    const kept = route.promise as { pickupReadyAt: string; plannedAt: string; hops: Array<{ id: string }> };
    expect(kept.hops[0].id).toBe(origin);
    expect(kept.hops[kept.hops.length - 1].id).toBe(dest);
    // Shelved, so it is ready to collect: the store reads how it went against that promise.
    expect(route.againstPromise).toMatchObject({ promisedAt: kept.pickupReadyAt, onTime: expect.any(Boolean), routeKept: expect.any(Boolean) });
    const trackKey = order.body.parcel.trackingKey as string;
    expect((await request(http).get(`/v1/sbg/track/${trackKey}`).expect(200)).body.plannedRoute.pickupReadyAt).toBe(kept.pickupReadyAt);
    // Staff read each lane against its plans: every parcel counted is on time or late, and this one is among them.
    const lanes = (await request(http).get('/v1/sbg/network/plan-vs-actual').set(auth).expect(200)).body.lanes as Array<{ arrived: number; late: number; onTime: number; routeKnown: number }>;
    expect(lanes.reduce((n, l) => n + l.arrived, 0)).toBeGreaterThanOrEqual(1);
    expect(lanes.every((l) => l.onTime + l.late === l.arrived && l.routeKnown <= l.arrived)).toBe(true);

    // A PROBLEM REPORTED AT THE COUNTER. Nobody of ours decides it: the damage claim report is made on the spot, the
    // parcel stays collectable, and the report is emailed to the store's insurer as a link — the user, 2026-10-13.
    const reported = await request(http).post(`/v1/sbg/parcels/${parcelId}/dispute`).set(auth).send({ agentDid: dest, reason: 'The box is torn at one corner', photoProofRef: 'proof.jpg' }).expect(201);
    expect(reported.body).toMatchObject({ status: 'Ready_For_Pickup', dispute: { state: 'resolved', decision: 'report_only' } });
    const [mail] = app.get(OutboxMailSender).recent('claims@jubilee.example');
    expect(mail).toMatchObject({ template: 'damage-report', to: { address: 'claims@jubilee.example', name: 'Jubilee Allianz Claims' }, subject: `Damage claim report DCR-${parcelId} — ACME Store, order ORD-77` });
    expect(mail.text).toContain('The box is torn at one corner');
    const key = /#report=([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1] ?? '';
    expect(key).toHaveLength(43);
    // Whoever holds the email opens it with nobody signed in.
    expect((await request(http).post('/v1/sbg/damage-report-links/look').send({ token: key }).expect(200)).body).toMatchObject({ state: 'ready', number: `DCR-${parcelId}`, parcelId });
    // The store lists it with where it went; staff read the list too; the order itself says it has a report.
    const mine = await request(http).get(`/v1/sbg/vendors/${vendor.body.vendorId}/damage-reports`).set(acme).expect(200);
    expect(mine.body.items).toEqual([expect.objectContaining({ parcelId, number: `DCR-${parcelId}`, origin: 'counter', links: 1, insurer: expect.objectContaining({ insurer: 'Jubilee Allianz Claims' }) })]);
    expect(mine.body.items[0].insurer.sentTo).not.toContain('claims@');
    await request(http).get(`/v1/sbg/vendors/${vendor.body.vendorId}/damage-reports`).set(auth).expect(200);
    expect((await request(http).get(`/v1/sbg/vendors/${vendor.body.vendorId}/orders/${parcelId}`).set(acme).expect(200)).body.damageReport).toEqual({ number: `DCR-${parcelId}` });
    const theirs = await request(http).get(`/v1/sbg/parcels/${parcelId}/damage-report`).set(acme).expect(200);
    expect(theirs.body.insurer).toMatchObject({ insurer: 'Jubilee Allianz Claims' });
    expect((await request(http).get(`/v1/sbg/parcels/${parcelId}/damage-report/links`).set(acme).expect(200)).body.items).toEqual([expect.objectContaining({ state: 'ready', opened: 0 })]);

    // Buyer collection.
    const found = await request(http).post('/v1/sbg/parcels/collect').set(auth).send({ agentDid: dest, collectionCode }).expect(201);
    expect(found.body.parcel.parcelId).toBe(parcelId);
    const delivered = await request(http).post(`/v1/sbg/parcels/${parcelId}/collect-confirm`).set(auth).send({ agentDid: dest, collectionCode }).expect(201);
    expect(delivered.body.status).toBe('Delivered');

    // Vendor received signed status callbacks.
    const cbs = await request(http).get(`/v1/sbg/vendors/${vendor.body.vendorId}/callbacks`).set(auth).expect(200);
    expect(cbs.body.map((c: { event: string }) => c.event)).toEqual(expect.arrayContaining(['ready_for_pickup', 'disputed', 'collected']));
  });

  it('PUDO MDP hub: pack a bag → bus scans it → drop+empty → sort each parcel → re-bag (tote-bag flow)', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    async function onboard(shop: string, zone: string) {
      const u = Math.random().toString(16).slice(2, 10);
      const reg = await request(http).post('/v1/sbg/agents').set(auth).send({ shopName: shop, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: `${shop} o`, nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
      const did = reg.body.did as string;
      await sendShopPapers(did);
      await request(http).post(`/v1/sbg/agents/${did}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
      await fund(`/v1/sbg/agents/${did}/top-up`, 20, auth);
      return did;
    }
    const origin = await onboard('MDP Origin', 'NorthTown');
    const dest = await onboard('MDP Dest', 'EastTown');
    const vendor = await request(http).post('/v1/sbg/vendors').set(auth).send({ name: 'HubShop' }).expect(201);
    const hubShop = await asStore(vendor.body);
    await fund(`/v1/sbg/vendors/${vendor.body.vendorId}/top-up`, 50, hubShop, auth); // prepay the daughter co

    // An MDP hub that last-mile-serves the destination zone.
    const hub = await request(http).post('/v1/sbg/mdps').set(auth).send({ name: 'East Sort Hub', zones: ['EastTown'], location: { lat: -1.25, lng: 36.95 } }).expect(201);
    const hubId = hub.body.mdpId as string;

    // Two inbound parcels, intaken at the origin.
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const order = await request(http).post('/v1/sbg/inbound/orders').set(hubShop).send({ vendorId: vendor.body.vendorId, originPudoDid: origin, destPudoDid: dest, buyerMobile: `+25470${i}`, size: 'M', contentPhotoRef: 'content.jpg' }).expect(201);
      const pid = order.body.parcel.parcelId as string;
      await request(http).post(`/v1/sbg/parcels/${pid}/intake`).set(auth).send({ agentDid: origin }).expect(201);
      ids.push(pid);
    }

    // The journey plan routes through the hub.
    const plan = await request(http).post('/v1/sbg/routing/plan-journey').set(auth).send({ originAgentDid: origin, destAgentDid: dest, weightKg: 5 }).expect(201);
    expect(plan.body.mdpRouted).toBe(true);
    expect(plan.body.hops.map((h: { type: string }) => h.type)).toEqual(['pudo', 'mdp', 'pudo']);

    // Origin packs a bag toward the hub; the driver scans the BAG (one scan).
    const bag = await request(http).post(`/v1/sbg/mdps/${hubId}/totes`).set(auth).expect(201); // pool tote; physically at the origin
    const code = bag.body.code as string;
    await request(http).post(`/v1/sbg/totes/${code}/assign`).set(auth).send({ destinationNodeId: hubId, destinationLabel: 'East Sort Hub' }).expect(201);
    for (const id of ids) await request(http).post(`/v1/sbg/totes/${code}/fill`).set(auth).send({ parcelId: id }).expect(201);
    const loaded = await request(http).post(`/v1/sbg/totes/${code}/load`).set(auth).send({ driverBadgeId: 'BUS-9' }).expect(201);
    expect(loaded.body.moved).toHaveLength(2);

    // Bus drops the bag at the hub → empty it.
    const dropped = await request(http).post(`/v1/sbg/mdps/${hubId}/drop-bag`).set(auth).send({ code }).expect(201);
    expect(dropped.body.emptied).toHaveLength(2);

    // Worker sorts each parcel → next destination + a destination bag code.
    const s0 = await request(http).post(`/v1/sbg/mdps/${hubId}/sort`).set(auth).send({ parcelId: ids[0] }).expect(201);
    expect(s0.body.nextDestination.id).toBe(dest);
    const s1 = await request(http).post(`/v1/sbg/mdps/${hubId}/sort`).set(auth).send({ parcelId: ids[1] }).expect(201);
    expect(s1.body.toteCode).toBe(s0.body.toteCode); // same destination → same bag

    // The destination bag carries both parcels.
    const destBag = await request(http).get(`/v1/sbg/totes/${s0.body.toteCode}`).set(auth).expect(200);
    expect(destBag.body.parcels).toHaveLength(2);
  });

  it('PUDO fleet: onboard a bike courier + vehicle → couple → bike rejects fragile/over-weight at handover', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    // Origin PUDO + a corridor for the feeder leg.
    const reg = await request(http).post('/v1/sbg/agents').set(auth).send({ shopName: 'Fleet Origin', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: 'Fleet o', nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
    const origin = reg.body.did as string;
    await sendShopPapers(origin);
    await request(http).post(`/v1/sbg/agents/${origin}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
    await fund(`/v1/sbg/agents/${origin}/top-up`, 50, auth);
    const corridor = await request(http).post('/v1/sbg/corridors').set(auth).send({ name: 'feeder', originZone: 'NorthTown', destZone: 'SouthTown' }).expect(201);

    // A bike courier (light registry → ACTIVE immediately) + a bike (own IDs).
    const driver = await request(http).post('/v1/sbg/drivers/onboard').set(auth).send({ displayName: 'Boda', fullName: 'Boda B', nationalId: `DRV-${u}`, mobile: `+254d${u}`, licenceClasses: ['bike'] }).expect(201);
    expect(driver.body.registry).toBe('light');
    expect(driver.body.status).toBe('ACTIVE');
    const bike = await request(http).post('/v1/sbg/vehicles').set(auth).send({ plate: `BD-${u}`, vehicleClass: 'bike', ownerName: 'Boda B' }).expect(201);
    expect(bike.body.capacityKg).toBe(20);

    // Couple driver ↔ bike on the corridor (flexible).
    // The shift is started (staff standing in here), then put on its corridor — nobody 'couples' a driver from an office any more.
    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/start-session`).set(auth).send({ vehicleId: bike.body.vehicleId }).expect(201);
    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/assign-corridor`).set(auth).send({ corridorId: corridor.body.corridorId }).expect(201);
    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/couple`).set(auth).send({ vehicleId: bike.body.vehicleId }).expect(404);

    // Three parcels; only the small non-fragile one may ride the bike.
    for (const p of [{ id: `OK-${u}`, size: 'S' }, { id: `FR-${u}`, size: 'S', fragile: true }, { id: `HV-${u}`, size: 'HEAVY' }]) {
      await request(http).post('/v1/sbg/parcels/accept').set(auth).send({ agentDid: origin, parcelId: p.id, size: p.size, destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'd.jpg', fragile: p.fragile }).expect(201);
    }
    const h = await request(http).post('/v1/sbg/parcels/handover').set(auth).send({ agentDid: origin, driverBadgeId: driver.body.badgeId, parcelIds: [`OK-${u}`, `FR-${u}`, `HV-${u}`] }).expect(201);
    expect(h.body.handed).toEqual([`OK-${u}`]);
    expect(h.body.rejected).toHaveLength(2);
    expect(h.body.vehicle).toBe('bus');
  });

  it('PUDO dispatch: agent bags a tote → released → a routed driver is offered it → claims → loads', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    const loc = { lat: -1.2, lng: 36.8 };
    const reg = await request(http).post('/v1/sbg/agents').set(auth).send({ shopName: 'Dispatch PUDO', zone: 'NorthTown', location: loc, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: 'D o', nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
    const origin = reg.body.did as string;
    await sendShopPapers(origin);
    await request(http).post(`/v1/sbg/agents/${origin}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
    await fund(`/v1/sbg/agents/${origin}/top-up`, 50, auth);
    const hub = await request(http).post('/v1/sbg/mdps').set(auth).send({ name: 'Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } }).expect(201);

    // A motorcycle courier (light → ACTIVE) coupled to a motorcycle.
    const driver = await request(http).post('/v1/sbg/drivers/onboard').set(auth).send({ displayName: 'Moto', fullName: 'Mo', nationalId: `DRV-${u}`, mobile: `+254d${u}`, licenceClasses: ['motorcycle'] }).expect(201);
    const moto = await request(http).post('/v1/sbg/vehicles').set(auth).send({ plate: `MT-${u}`, vehicleClass: 'motorcycle', ownerName: 'Mo' }).expect(201);
    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/start-session`).set(auth).send({ vehicleId: moto.body.vehicleId }).expect(201);

    // Agent bags two parcels in an outbound tote bound for the hub, then releases it for claim.
    const bag = await request(http).post(`/v1/sbg/agents/${origin}/totes`).set(auth).expect(201);
    await request(http).post(`/v1/sbg/totes/${bag.body.code}/assign`).set(auth).send({ destinationNodeId: hub.body.mdpId, destinationLabel: 'Hub' }).expect(201);
    for (const id of [`P1-${u}`, `P2-${u}`]) {
      await request(http).post('/v1/sbg/parcels/accept').set(auth).send({ agentDid: origin, parcelId: id, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'd.jpg', paymentMode: 'prepaid' }).expect(201);
      await request(http).post(`/v1/sbg/totes/${bag.body.code}/fill`).set(auth).send({ parcelId: id }).expect(201);
    }
    await request(http).post(`/v1/sbg/totes/${bag.body.code}/release`).set(auth).expect(201);

    // The phone reports where the driver actually is — the only source of a position on the live map.
    const here = { lat: -1.21, lng: 36.81 };
    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/locate`).set(auth).send(here).expect(201);

    // The driver declares a route past the PUDO → gets a sized suggestion.
    const sug = await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/suggest-work`).set(auth).send({ from: loc, to: { lat: -1.3, lng: 36.95 } }).expect(201);
    expect(sug.body.remainingCapacityKg).toBe(50);
    expect(sug.body.offers).toHaveLength(1);
    expect(sug.body.offers[0].weightKg).toBe(10);

    // Claim it → reserves 10 kg; then load the bag (claimer only).
    await request(http).post(`/v1/sbg/dispatch/offers/${sug.body.offers[0].offerId}/claim`).set(auth).expect(201);
    const claims = await request(http).get(`/v1/sbg/fleet/drivers/${driver.body.did}/claims`).set(auth).expect(200);
    expect(claims.body.remainingCapacityKg).toBe(40);
    const loaded = await request(http).post(`/v1/sbg/totes/${bag.body.code}/load`).set(auth).send({ driverBadgeId: driver.body.badgeId }).expect(201);
    expect(loaded.body.moved).toHaveLength(2);

    // Fleet-manager dashboard reflects the on-shift driver (located by the phone) + active cargo.
    const dash = await request(http).get('/v1/sbg/fleet/dashboard').set(auth).expect(200);
    expect(dash.body.sessions.active).toBeGreaterThanOrEqual(1);
    // WHERE THE PHONE SAID, NOT WHERE THE ROUTE STARTS. Declaring a route used to overwrite this fix with the
    // route's start, freshly stamped, so the map was confidently wrong for the whole first leg.
    const dot = dash.body.positions.find((p: { plate: string }) => p.plate === moto.body.plate); // stored upper-cased
    expect(dot).toBeDefined();
    expect(dot?.location).toEqual(here);
    expect(dot?.location).not.toEqual(loc);
    expect(dash.body.cargo.count).toBeGreaterThanOrEqual(1);
    expect(dash.body.cargo.items[0].driver).toBeDefined();
    // The truck sub-type catalog is rich (>15 bodies) for registration UIs.
    const subs = await request(http).get('/v1/sbg/vehicles/truck-subtypes').set(auth).expect(200);
    expect(subs.body.length).toBeGreaterThan(15);
    expect(subs.body.some((s: { id: string }) => s.id === 'fuel_tanker')).toBe(true);
  });

  it('PUDO driver shift session: scan the vehicle QR to start (couple), close to end (decouple)', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    const veh = await request(http).post('/v1/sbg/vehicles').set(auth).send({ plate: `SS-${u}`, vehicleClass: 'motorcycle', ownerName: 'Sh' }).expect(201);
    expect(veh.body.qr).toMatch(/^VEH-/);
    const driver = await request(http).post('/v1/sbg/drivers/onboard').set(auth).send({ displayName: 'Shift', fullName: 'Sh', nationalId: `SES-${u}`, mobile: `+254s${u}`, licenceClasses: ['motorcycle'] }).expect(201);

    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/start-session`).set(auth).send({ vehicleQr: 'VEH-NOPE' }).expect(404);
    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/start-session`).set(auth).send({ vehicleQr: veh.body.qr }).expect(201);

    const on = await request(http).get(`/v1/sbg/fleet/drivers/${driver.body.did}/session`).set(auth).expect(200);
    expect(on.body.active).toBe(true);
    expect(on.body.vehicle.plate).toBe(`SS-${u}`.toUpperCase());

    await request(http).post(`/v1/sbg/fleet/drivers/${driver.body.did}/end-session`).set(auth).expect(201);
    const off = await request(http).get(`/v1/sbg/fleet/drivers/${driver.body.did}/session`).set(auth).expect(200);
    expect(off.body.active).toBe(false);
  });

  it('PUDO fleet manager: onboard (requirements + KYC + bond) → ACTIVE → registers a scoped fleet', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    // Eligibility filter blocks a missing operator licence — with a domain code the codemod attached.
    const ineligible = await request(http).post('/v1/sbg/fleet/managers').set(auth).send({ companyName: 'BadCo', contactPhone: `+254${u}`, ownerFullName: 'O', ownerNationalId: `MGR-${u}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}`, transportOperatorLicence: '', taxId: `TAX-${u}` } }).expect(400);
    expect(ineligible.body.code).toBe('REQUIREMENTS_NOT_MET');

    const reg = await request(http).post('/v1/sbg/fleet/managers').set(auth).send({ companyName: 'Acme Haulage', contactPhone: `+254${u}`, ownerFullName: 'A Owner', ownerNationalId: `MGR-${u}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}`, transportOperatorLicence: `TOL-${u}`, taxId: `TAX-${u}` } }).expect(201);
    const mDid = reg.body.did as string;
    expect(reg.body.status).toBe('DRAFT');

    // Cannot build a fleet until ACTIVE — an INVALID_STATE, not a generic bad request.
    const tooEarly = await request(http).post('/v1/sbg/vehicles').set(auth).send({ plate: `MV-${u}`, vehicleClass: 'van', ownerName: 'A', managerDid: mDid }).expect(400);
    expect(tooEarly.body.code).toBe('INVALID_STATE');

    await sendFleetPapers(mDid, auth);
    const queue = await request(http).get('/v1/sbg/fleet/managers/kyc-queue').set(auth).expect(200);
    expect(queue.body.some((m: { did: string }) => m.did === mDid)).toBe(true);
    await request(http).post(`/v1/sbg/fleet/managers/${mDid}/kyc-decision`).set(auth).send({ approve: true, by: 'ops' }).expect(201);
    const active = await request(http).post(`/v1/sbg/fleet/managers/${mDid}/bond`).set(auth).expect(201);
    expect(active.body.status).toBe('ACTIVE');
    expect(active.body.loginCode).toMatch(/^FM-/);

    // The manager can sign into the console with the issued code; a bad code is rejected.
    const signin = await request(http).post('/v1/sbg/fleet/managers/login').set(auth).send({ code: active.body.loginCode }).expect(201);
    expect(signin.body.did).toBe(mDid);
    const badCode = await request(http).post('/v1/sbg/fleet/managers/login').set(auth).send({ code: 'FM-NOPE' }).expect(401);
    expect(badCode.body.code).toBe('AUTH_CODE_INVALID');

    // Now the manager can register a vehicle, and the dashboard scopes to their fleet.
    const veh = await request(http).post('/v1/sbg/vehicles').set(auth).send({ plate: `MV-${u}`, vehicleClass: 'van', ownerName: 'Acme', managerDid: mDid }).expect(201);
    expect(veh.body.managerDid).toBe(mDid);
    const dash = await request(http).get('/v1/sbg/fleet/dashboard').query({ manager: mDid }).set(auth).expect(200);
    expect(dash.body.managerDid).toBe(mDid);
    expect(dash.body.vehicles.total).toBe(1);
  });

  it('S3 authorization: a field token cannot perform operator actions, and fleets are tenant-isolated', async () => {
    const http = app.getHttpServer();
    const u = Math.floor(Math.random() * 1e6);
    const operator = { Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token}` };

    // Onboard + activate two fleet managers, each with one vehicle (operator actions).
    const onboardManager = async (name: string) => {
      const m = (await request(http).post('/v1/sbg/fleet/managers').set(operator).send({ companyName: name, tradingName: name, contactPhone: `+2547${u}${name.length}`, contactEmail: `ops@${name}.example`, ownerFullName: 'Owner', ownerNationalId: `MGR-${u}-${name}`, depotAddress: '1 Depot Rd', location: { lat: -1.3, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}-${name}`, transportOperatorLicence: `TOL-${u}-${name}`, taxId: `TAX-${u}-${name}`, declaredFleetSize: 3 } }).expect(201)).body;
      await sendFleetPapers(m.did, operator);
      await request(http).post(`/v1/sbg/fleet/managers/${m.did}/kyc-decision`).set(operator).send({ approve: true, by: 'A second member of staff' }).expect(201);
      await request(http).post(`/v1/sbg/fleet/managers/${m.did}/bond`).set(operator).expect(201);
      await request(http).post('/v1/sbg/vehicles').set(operator).send({ plate: `${name}-${u}`, vehicleClass: 'van', ownerName: name, managerDid: m.did }).expect(201);
      return m.did as string;
    };
    const mA = await onboardManager('AlphaCo');
    const mB = await onboardManager('BetaCo');

    // Actor tokens: manager A (fleet_manager, tenant=mA) and a driver under A (field role).
    const aToken = { Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ role: 'fleet_manager', did: mA, tenant: mA, type: 'client_credentials' }).expect(201)).body.access_token}` };
    const driver = (await request(http).post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: 'Boda', fullName: 'Boda Rider', nationalId: `DRV-${u}`, mobile: `+254d${u}`, licenceClasses: ['motorcycle'], managerDid: mA }).expect(201)).body;
    const dToken = { Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ role: 'driver', did: driver.did, tenant: mA, type: 'client_credentials' }).expect(201)).body.access_token}` };

    // 1) A driver (field) token is FORBIDDEN from operator actions — the core S3 hole, now closed.
    await request(http).post(`/v1/sbg/fleet/managers/${mB}/bond`).set(dToken).expect(403);
    await request(http).post(`/v1/sbg/fleet/managers/${mB}/kyc-decision`).set(dToken).send({ approve: true }).expect(403);
    await request(http).get('/v1/sbg/finance').set(dToken).expect(403);
    await request(http).get('/v1/sbg/agents/kyc-queue').set(dToken).expect(403);

    // 2) Tenant isolation — manager A sees ONLY their own vehicle, never BetaCo's, and cannot widen
    //    the scope with ?manager=<competitor> (the query is ignored for a non-operator).
    const own = await request(http).get('/v1/sbg/vehicles').set(aToken).expect(200);
    expect(own.body.every((v: { managerDid?: string }) => v.managerDid === mA)).toBe(true);
    const spoof = await request(http).get('/v1/sbg/vehicles').query({ manager: mB }).set(aToken).expect(200);
    expect(spoof.body.every((v: { managerDid?: string }) => v.managerDid === mA)).toBe(true); // query did NOT widen scope

    // 3) The operator still sees everything.
    const all = await request(http).get('/v1/sbg/vehicles').set(operator).expect(200);
    expect(all.body.length).toBeGreaterThanOrEqual(2);
  });

  it('a fleet driver’s renewed licence: the driver sends the photograph, their OWN office opens it and records the date — no other office, no colleague, nobody signed out', async () => {
    const http = app.getHttpServer();
    const u = Math.floor(Math.random() * 1e6);
    const as = async (body: Record<string, unknown>) => ({ Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ ...body, type: 'client_credentials' }).expect(201)).body.access_token}` });
    const operator = await as({ role: 'operator' });
    const onboardManager = async (name: string) => {
      const m = (await request(http).post('/v1/sbg/fleet/managers').set(operator).send({ companyName: name, tradingName: name, contactPhone: `+2547${u}${name.length}`, contactEmail: `ops@${name}.example`, ownerFullName: 'Owner', ownerNationalId: `MGR-${u}-${name}`, depotAddress: '1 Depot Rd', location: { lat: -1.3, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}-${name}`, transportOperatorLicence: `TOL-${u}-${name}`, taxId: `TAX-${u}-${name}`, declaredFleetSize: 3 } }).expect(201)).body;
      await sendFleetPapers(m.did, operator);
      await request(http).post(`/v1/sbg/fleet/managers/${m.did}/kyc-decision`).set(operator).send({ approve: true, by: 'A second member of staff' }).expect(201);
      await request(http).post(`/v1/sbg/fleet/managers/${m.did}/bond`).set(operator).expect(201);
      return m.did as string;
    };
    const mA = await onboardManager('CardCo');
    const mB = await onboardManager('RivalCard');
    const office = await as({ role: 'fleet_manager', did: mA, tenant: mA });
    const rival = await as({ role: 'fleet_manager', did: mB, tenant: mB });
    // A phone number is compared by its digits, so the two differ in a digit and not in a name.
    const onboardDriver = async (tag: string) =>
      (await request(http).post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: tag, fullName: `${tag} Rider`, nationalId: `CARD-${u}-${tag}`, mobile: `+25471${u}${tag.length}`, licenceClasses: ['motorcycle'], managerDid: mA }).expect(201)).body as { did: string };
    const amos = await onboardDriver('Amos');
    const colleague = await onboardDriver('Baraka');
    // Exactly what a fleet driver's sign-in carries: the fleet rides in the token as its tenant.
    const asAmos = await as({ role: 'driver', did: amos.did, tenant: mA });
    const asColleague = await as({ role: 'driver', did: colleague.did, tenant: mA });

    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const photo = async () => (await request(http).post('/v1/sbg/media').set(asAmos).send({ kind: 'kyc_licence', dataUrl: PNG }).expect(201)).body.mediaId as string;
    const card = await photo();
    const send = `/v1/sbg/fleet/drivers/${amos.did}/licence-renewal`;
    const cardAt = (id: string) => `/v1/sbg/fleet/drivers/${amos.did}/licence-card/${id}`;

    // A photograph the driver has taken and not sent is not the office's to open.
    await request(http).get(cardAt(card)).set(office).expect(404);
    // Sent by the driver. Their office cannot send one for them, and neither can a colleague.
    await request(http).post(send).set(office).send({ copyRef: card, expiresAt: '2031-03-31' }).expect(403);
    await request(http).post(send).set(asColleague).send({ copyRef: card, expiresAt: '2031-03-31' }).expect(403);
    const sent = await request(http).post(send).set(asAmos).send({ copyRef: card, expiresAt: '2031-03-31' }).expect(201);
    expect(sent.body.licenceRenewal).toMatchObject({ copyRef: card, expiresAt: '2031-03-31' });

    // The office is told, in its own inbox, and its driver list carries the card.
    const bell = (await request(http).get('/v1/sbg/notifications/inbox').set(office).expect(200)).body.items as Array<{ kind: string; title: string }>;
    expect(bell.filter((n) => n.kind === 'papers_sent').map((n) => n.title)).toEqual(['Amos sent their renewed licence']);
    const list = (await request(http).get('/v1/sbg/fleet/drivers').set(office).expect(200)).body as Array<{ did: string; licenceRenewal?: { copyRef: string } }>;
    expect(list.find((d) => d.did === amos.did)?.licenceRenewal?.copyRef).toBe(card);

    // THE PHOTOGRAPH: the bytes, as an image, never cached — for that office, by this door and no other.
    const opened = await request(http).get(cardAt(card)).set(office).expect(200);
    expect(opened.headers['content-type']).toMatch(/^image\/png/);
    expect(opened.headers['cache-control']).toBe('private, no-store');
    expect(opened.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.isBuffer(opened.body) && opened.body.length > 0).toBe(true);
    await request(http).get(`/v1/sbg/media/${card}`).set(office).expect(403); // the general door stays shut to it
    for (const who of [rival, asColleague, asAmos, operator]) await request(http).get(cardAt(card)).set(who).expect(403);
    await request(http).get(cardAt(card)).expect(401);
    // The driver's other photographs are not reachable by naming them here.
    const other = await photo();
    await request(http).get(cardAt(other)).set(office).expect(404);

    // REFUSED by that office and nobody else's; the driver reads the office's own sentence.
    const refuse = `/v1/sbg/fleet/drivers/${amos.did}/licence-renewal/refuse`;
    await request(http).post(refuse).set(rival).send({ reason: 'No.' }).expect(403);
    await request(http).post(refuse).set(asColleague).send({ reason: 'No.' }).expect(403);
    await request(http).post(refuse).set(asAmos).send({ reason: 'No.' }).expect(403);
    await request(http).post(refuse).set(office).send({ reason: 'The date is under your thumb.' }).expect(201);
    const me = (await request(http).get(`/v1/sbg/fleet/drivers/${amos.did}`).set(asAmos).expect(200)).body;
    expect(me.licenceRenewal).toBeUndefined();
    expect(me.licenceRenewalRefusal).toMatchObject({ reason: 'The date is under your thumb.' });
    await request(http).get(cardAt(card)).set(office).expect(404); // deleted with the refusal

    // SENT AGAIN, RECORDED by the office from the card: the date is the office's reading, and the driver is told.
    const second = await photo();
    await request(http).post(send).set(asAmos).send({ copyRef: second, expiresAt: '2031-03-31' }).expect(201);
    await request(http).post(`/v1/sbg/fleet/drivers/${amos.did}/licence`).set(rival).send({ expiresAt: '2031-03-30' }).expect(403);
    const recorded = await request(http).post(`/v1/sbg/fleet/drivers/${amos.did}/licence`).set(office).send({ expiresAt: '2031-03-30' }).expect(201);
    expect(recorded.body.licence).toMatchObject({ expiresAt: '2031-03-30', copyRef: second });
    expect(recorded.body.licenceRenewal).toBeUndefined();
    await request(http).get(cardAt(second)).set(office).expect(200); // the card the date was read from, still theirs to open
    const told = (await request(http).get('/v1/sbg/notifications/inbox').set(asAmos).expect(200)).body.items as Array<{ kind: string; title: string }>;
    expect(told.filter((n) => n.kind === 'papers_checked').map((n) => n.title).sort()).toEqual(['Your licence is recorded', 'Your licence photo was not accepted']);

    // WHO IS PAID, as a fleet's driver reads it on their earnings screen: their fleet — and no figure of the fleet's.
    const summary = (await request(http).get(`/v1/sbg/fleet/drivers/${amos.did}/jobs/summary`).set(asAmos).expect(200)).body;
    expect(summary.settlement).toMatchObject({ payeeDid: mA, paidToMe: false, standing: 'fleet', settled: 0, inFlight: 0 });
    await request(http).get(`/v1/sbg/fleet/drivers/${amos.did}/jobs/summary`).set(asColleague).expect(403);
  });

  it('a rider who has left their fleet becomes a courier at once, from their own sign-in — not their old office, not staff, nobody signed out', async () => {
    const http = app.getHttpServer();
    const u = Math.floor(Math.random() * 1e6);
    const as = async (body: Record<string, unknown>) => ({ Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ ...body, type: 'client_credentials' }).expect(201)).body.access_token}` });
    const operator = await as({ role: 'operator' });
    const fleetDid = (await (async () => {
      const m = (await request(http).post('/v1/sbg/fleet/managers').set(operator).send({ companyName: 'AloneCo', tradingName: 'AloneCo', contactPhone: `+25473${u}7`, contactEmail: 'ops@AloneCo.example', ownerFullName: 'Owner', ownerNationalId: `MGR-AL-${u}`, depotAddress: '1 Depot Rd', location: { lat: -1.3, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-AL-${u}`, transportOperatorLicence: `TOL-AL-${u}`, taxId: `TAX-AL-${u}`, declaredFleetSize: 3 } }).expect(201)).body;
      await sendFleetPapers(m.did, operator);
      await request(http).post(`/v1/sbg/fleet/managers/${m.did}/kyc-decision`).set(operator).send({ approve: true, by: 'A second member of staff' }).expect(201);
      await request(http).post(`/v1/sbg/fleet/managers/${m.did}/bond`).set(operator).expect(201);
      return m.did as string;
    })());
    const office = await as({ role: 'fleet_manager', did: fleetDid, tenant: fleetDid });
    const rider = (await request(http).post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: 'Wanjiru', fullName: 'Wanjiru Rider', nationalId: `ALONE-${u}`, mobile: `+25474${u}3`, licenceClasses: ['motorcycle'], managerDid: fleetDid }).expect(201)).body as { did: string };
    const inFleet = await as({ role: 'driver', did: rider.did, tenant: fleetDid });
    const terms = `/v1/sbg/drivers/${rider.did}/ride-alone`;
    const body = { country: 'KE', vehicleClass: 'motorcycle', plate: `kmal ${u}` };

    // IN A FLEET it is not offered, and says what comes first. Asking changes nothing.
    expect((await request(http).get(terms).set(inFleet).expect(200)).body).toMatchObject({ offered: false, why: 'You drive for AloneCo. Leave that fleet first: “Your fleet”, under your name', classes: [], countries: [] });
    expect((await request(http).post(terms).set(inFleet).send(body)).body.code).toBe('INVALID_STATE');

    // They leave. The phone is handed a sign-in that names no fleet; that is the one that asks from here on.
    const left = (await request(http).post(`/v1/sbg/drivers/${rider.did}/leave-fleet`).set(inFleet).expect(201)).body;
    const asRider = { Authorization: `Bearer ${left.token.access_token}` };
    const offered = (await request(http).get(terms).set(asRider).expect(200)).body;
    expect(offered).toMatchObject({ offered: true, classes: ['motorcycle'] });
    const kenya = (offered.countries as Array<{ jurisdiction: string; companyName?: string }>).find((c) => c.jurisdiction === 'KE')!;
    expect(kenya.companyName).toEqual(expect.any(String));

    // NOBODY ELSE'S TO DO: not the office they left, not staff, not a stranger with no sign-in — and none of them is told what it would take.
    for (const who of [office, operator]) {
      await request(http).post(terms).set(who).send(body).expect(403);
      await request(http).get(terms).set(who).expect(403);
    }
    await request(http).post(terms).send(body).expect(401);
    // What cannot be meant is refused before anything is made: a country in words, a vehicle they are not cleared for.
    await request(http).post(terms).set(asRider).send({ ...body, country: 'Kenya' }).expect(400);
    expect((await request(http).post(terms).set(asRider).send({ ...body, vehicleClass: 'truck' })).body.code).toBe('CANNOT_COUPLE');
    expect((await request(http).get(`/v1/sbg/fleet/drivers/${rider.did}`).set(asRider).expect(200)).body.removedFrom).toBeDefined();

    // AT ONCE: a courier, in Kenya, for Kenya's company, with a motorcycle of their own.
    const done = (await request(http).post(terms).set(asRider).send(body).expect(201)).body;
    expect(done).toMatchObject({ did: rider.did, jurisdiction: 'KE', companyName: kenya.companyName, vehicle: { plate: `KMAL ${u}`, vehicleClass: 'motorcycle' } });
    const me = (await request(http).get(`/v1/sbg/fleet/drivers/${rider.did}`).set(asRider).expect(200)).body;
    expect(me).toMatchObject({ did: rider.did, jurisdiction: 'KE', status: 'ACTIVE', offRoad: [] });
    expect(me.managerDid).toBeUndefined();
    expect(me.removedFrom).toBeUndefined();
    // The same sign-in goes on working, and their earnings are theirs from here.
    expect((await request(http).get(`/v1/sbg/fleet/drivers/${rider.did}/jobs/summary`).set(asRider).expect(200)).body.settlement).toMatchObject({ payeeDid: rider.did, paidToMe: true, standing: 'own' });
    // Done once.
    expect((await request(http).post(terms).set(asRider).send({ ...body, plate: `kmal2 ${u}` })).body).toMatchObject({ code: 'INVALID_STATE', detail: 'You already ride for yourself' });
  });

  it('staff find a store in the list and open it; the store itself, another store and nobody signed out are each refused the staff view', async () => {
    const http = app.getHttpServer();
    const u = Math.floor(Math.random() * 1e6);
    const as = async (body: Record<string, unknown>) => ({ Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ ...body, type: 'client_credentials' }).expect(201)).body.access_token}` });
    const operator = await as({ role: 'operator' });
    const OWNER = `+25471${u}99`;
    const email = `desk.${u}@store.example`;
    // Registered the way a store registers itself: with its own account, its owner's number, and where its systems are told.
    const made = (await request(http).post('/v1/sbg/vendors').send({ name: `Desk Store ${u}`, ownerPhone: OWNER, callbackUrl: 'https://desk.example/hook', address: 'Biashara St 12', email, password: 'vitenge-vya-pwani-8' }).expect(201)).body;
    const store = { Authorization: `Bearer ${made.token.access_token}` };
    // Another store, signed in as itself: no more staff than the first.
    const rival = (await request(http).post('/v1/sbg/vendors').send({ name: `Rival Store ${u}`, email: `rival.${u}@store.example`, password: 'vitenge-vya-bara-9' }).expect(201)).body;
    const shop = { Authorization: `Bearer ${rival.token.access_token}` };

    // THE LIST: staff's, and nobody else's.
    const list = (await request(http).get('/v1/sbg/vendors').set(operator).expect(200)).body as Array<Record<string, unknown>>;
    const row = list.find((r) => r.vendorId === made.vendorId)!;
    expect(row).toMatchObject({ name: `Desk Store ${u}`, hasAccount: true, hasCallback: true, hasDock: false, address: 'Biashara St 12' });
    expect(Object.keys(row).sort()).toEqual(['address', 'balance', 'companyName', 'country', 'createdAt', 'currency', 'hasAccount', 'hasCallback', 'hasDock', 'name', 'vendorId']);
    for (const hidden of [made.secret, OWNER, email, made.did]) expect(JSON.stringify(list)).not.toContain(hidden);
    await request(http).get('/v1/sbg/vendors').set(store).expect(403);
    await request(http).get('/v1/sbg/vendors').set(shop).expect(403);
    await request(http).get('/v1/sbg/vendors').expect(401);

    // The store starts a payment, the way its app does: the commonest thing a call is about.
    const asked = (await request(http).post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(store).send({ amount: 500 }).expect(201)).body;

    // THE STORE, OPENED.
    const deskAt = `/v1/sbg/vendors/${made.vendorId}/desk`;
    const desk = (await request(http).get(deskAt).set(operator).expect(200)).body;
    // The payment it started and that has not arrived, by the reference staff confirm it by.
    expect(desk.money.open).toEqual([{ reference: asked.reference, amount: 500, currency: row.currency, openedAt: expect.any(String) }]);
    expect(String(asked.reference).length).toBeGreaterThan(3);
    expect(desk).toMatchObject({ vendorId: made.vendorId, signIn: { hasAccount: true }, contact: { phoneEnding: OWNER.slice(-3) }, shipments: { total: 0, unpaid: 0, active: 0, recent: [] }, keys: [], dock: null, returnsWaiting: 0 });
    expect(desk.callbacks).toMatchObject({ url: 'https://desk.example/hook', carriesCode: true, pending: 0, failed: 0, delivered: 0 });
    for (const hidden of [made.secret, OWNER, email, made.did]) expect(JSON.stringify(desk)).not.toContain(hidden);
    // The store reads its own record by its own door, and is not answered at staff's.
    await request(http).get(`/v1/sbg/vendors/${made.vendorId}`).set(store).expect(200);
    await request(http).get(deskAt).set(store).expect(403);
    await request(http).get(deskAt).set(shop).expect(403);
    await request(http).get(deskAt).expect(401);
    await request(http).get('/v1/sbg/vendors/ven_nobody/desk').set(operator).expect(404);
  });

  it('S4 problem+json: every error carries a machine code, a traceId, and a preserved status', async () => {
    const http = app.getHttpServer();
    const auth = { Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token}` };

    // A 404 renders RFC 9457 with a stable machine code (still status 404) — not a bare Nest body.
    const notFound = await request(http).get('/v1/sbg/vendors/ven_does_not_exist').set(auth).expect(404);
    expect(notFound.body.code).toBe('NOT_FOUND');
    expect(notFound.body.status).toBe(404);
    expect(notFound.body.retryable).toBe(false);
    expect(notFound.body.traceId).toMatch(/^trc_/);
    expect(notFound.body.type).toContain('/problems/NOT_FOUND');
    expect(typeof notFound.body.detail).toBe('string');

    // ValidationPipe failures normalize to VALIDATION_FAILED with the violations surfaced structurally.
    const badBody = await request(http).post('/v1/sbg/vendors').set(auth).send({ callbackUrl: 123 }).expect(400);
    expect(badBody.body.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(badBody.body.params.violations)).toBe(true);
  });

  /**
   * WHAT A PARCEL COSTS AND WHAT EACH STEP PAYS is a list each company keeps, set where its rates are set
   * (modules/pudo/amounts.ts). The services are held by their own specs; this is the door and what comes out of it:
   * who may set a figure, what is refused, and that a shop's counter and the console's shop list then read it.
   *
   * PUT BACK AT THE END, whatever happens in between: one application is shared by every test in this file.
   */
  it('a company’s list of amounts: set by staff, refused to a shop, read back with its terms and felt at a counter', async () => {
    const http = app.getHttpServer();
    const staff = { Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token}` };
    const KE = '/v1/sbg/entities/sbg-ke';
    type Row = { key: string; amount: number; own: boolean; startsAt: number };
    const rowOf = async (key: string) => ((await request(http).get(`${KE}/pricing`).set(staff).expect(200)).body.amounts as Row[]).find((r) => r.key === key)!;

    const u = Math.random().toString(16).slice(2, 10);
    const hours = { open: '08:00', close: '18:00' };
    const reg = await request(http).post('/v1/sbg/agents').set(staff).send({ shopName: 'Amounts Shop', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null }, fullName: 'Amounts owner', nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
    const did = reg.body.did as string;
    await sendShopPapers(did);
    await request(http).post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true }).expect(201);
    await fund(`/v1/sbg/agents/${did}/top-up`, 20, staff);
    const shop = { Authorization: `Bearer ${(await request(http).post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token}` };
    const gate = async () => (await request(http).get(`/v1/sbg/agents/${did}/can-transact`).set(shop).expect(200)).body;

    // Before anybody sets anything: today's figures, in the company's money.
    expect(await rowOf('wholesale')).toEqual({ key: 'wholesale', amount: 1.6, own: false, startsAt: 1.6 });
    expect(await gate()).toMatchObject({ canTransact: true, threshold: 1.6, currency: 'KES', credit: { limit: 32 } });

    // Nobody signed in, and a shop, do not set a company's prices.
    await request(http).post(`${KE}/amounts`).send({ wholesale: 160 }).expect(401);
    await request(http).post(`${KE}/amounts`).set(shop).send({ wholesale: 160 }).expect(403);
    // What cannot be meant is refused, and says why.
    const free = await request(http).post(`${KE}/amounts`).set(staff).send({ wholesale: 0 });
    expect([free.status, free.body.code, free.body.detail]).toEqual([400, 'INVALID_INPUT', expect.stringContaining('A parcel has to cost something')]);
    await request(http).post(`${KE}/amounts`).set(staff).send({ labourFee: -1 }).expect(400);
    await request(http).post(`${KE}/amounts`).set(staff).send({ labourFee: 'forty' }).expect(400);
    expect(await rowOf('wholesale')).toMatchObject({ amount: 1.6, own: false });

    try {
      await request(http).post(`${KE}/amounts`).set(staff).send({ wholesale: 160, handoverFee: 0 }).expect(201);
      expect(await rowOf('wholesale')).toEqual({ key: 'wholesale', amount: 160, own: true, startsAt: 1.6 });
      expect(await rowOf('handoverFee')).toEqual({ key: 'handoverFee', amount: 0, own: true, startsAt: 0.5 });
      expect(await rowOf('labourFee')).toMatchObject({ amount: 0.4, own: false });

      // The shop's counter: the float it needs is the price of one parcel; its credit line, twenty of them.
      expect(await gate()).toMatchObject({ canTransact: true, threshold: 160, currency: 'KES', credit: { limit: 3200, used: 0 } });
      // The console's list of shops is told the price beside each float, so "too thin" is measured against it.
      const rows = (await request(http).get('/v1/sbg/agents').set(staff).expect(200)).body as Array<{ did: string; parcelPrice?: number; currency?: string }>;
      expect(rows.find((r) => r.did === did)).toMatchObject({ parcelPrice: 160, currency: 'KES' });
      // …and nobody who is not staff: the shop's own card of another shop carries no such thing.
      const cards = (await request(http).get('/v1/sbg/agents').set(shop).expect(200)).body as Array<Record<string, unknown>>;
      expect(cards.every((c) => !('parcelPrice' in c) && !('balance' in c))).toBe(true);

      // Written down, with what it was before.
      const changes = (await request(http).get(`${KE}/changes`).set(staff).expect(200)).body.items as Array<{ what: string; from: string; to: string; by: string }>;
      expect(changes[0]).toMatchObject({ what: 'amounts', from: 'parcel price 1.6, hand-over pay 0.5 (KES)', to: 'parcel price 160, hand-over pay 0 (KES)' });
      expect(changes[0].by).toBeTruthy();
    } finally {
      await request(http).post(`${KE}/amounts`).set(staff).send({ wholesale: null, handoverFee: null }).expect(201);
    }
    expect(await rowOf('wholesale')).toEqual({ key: 'wholesale', amount: 1.6, own: false, startsAt: 1.6 });
    expect(await rowOf('handoverFee')).toMatchObject({ amount: 0.5, own: false });
    expect(await gate()).toMatchObject({ threshold: 1.6, credit: { limit: 32 } });
  });
});
