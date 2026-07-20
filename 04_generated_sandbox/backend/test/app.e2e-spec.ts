import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GLOS backend (e2e)', () => {
  let app: INestApplication;

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

    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
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

    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
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
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
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
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
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
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
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
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
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
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
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
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    async function onboard(shopName: string, zone: string) {
      const u = Math.random().toString(16).slice(2, 10);
      const reg = await request(http).post('/v1/pudo/agents').set(auth)
        .send({ shopName, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: `${shopName} owner`, nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
      const did = reg.body.did as string;
      await request(http).post(`/v1/pudo/agents/${did}/submit-kyc`).set(auth).send({ idCopyRef: 'id.jpg', tradingLicenceRef: 'lic.pdf', shopPhotoRefs: ['shop.jpg'] }).expect(201);
      await request(http).post(`/v1/pudo/agents/${did}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
      await request(http).post(`/v1/pudo/agents/${did}/top-up`).set(auth).send({ amount: 50 }).expect(201);
      return did;
    }
    const origin = await onboard('North PUDO', 'NorthTown');
    const dest = await onboard('South PUDO', 'SouthTown');

    // Agent is ACTIVE and the gate passes.
    expect((await request(http).get(`/v1/pudo/agents/${origin}`).set(auth).expect(200)).body.status).toBe('ACTIVE');
    await request(http).get(`/v1/pudo/agents/${origin}/can-transact`).set(auth).expect(200);

    // Static corridor + driver.
    const corridor = await request(http).post('/v1/pudo/corridors').set(auth).send({ name: 'N-S Express', originZone: 'NorthTown', destZone: 'SouthTown' }).expect(201);
    const driver = await request(http).post('/v1/pudo/drivers').set(auth).send({ driverDid: 'did:glos:bus1', name: 'John', corridorId: corridor.body.corridorId }).expect(201);

    // Screen 1 Accept → Screen 2 Handover → arrive → Screen 3 Pickup (OTP).
    await request(http).post('/v1/pudo/parcels/accept').set(auth).send({ agentDid: origin, parcelId: 'E2E-QR-1', size: 'M', destZone: 'SouthTown', senderMobile: '+254700', receiverMobile: '+254711', dropoffPhotoRef: 'drop.jpg' }).expect(201);
    await request(http).post('/v1/pudo/parcels/handover').set(auth).send({ agentDid: origin, driverBadgeId: driver.body.badgeId, parcelIds: ['E2E-QR-1'] }).expect(201);
    const arrival = await request(http).post('/v1/pudo/parcels/E2E-QR-1/arrive').set(auth).send({ destAgentDid: dest }).expect(201);
    const delivered = await request(http).post('/v1/pudo/parcels/E2E-QR-1/pickup').set(auth).send({ agentDid: dest, otp: arrival.body.otp, deliveredPhotoRef: 'del.jpg' }).expect(201);
    expect(delivered.body.status).toBe('Delivered');

    // Tier-1 customer rates → graduates into the shared reputation core.
    const rated = await request(http).post('/v1/pudo/parcels/E2E-QR-1/rate').set(auth).send({ stars: 5, raterMobile: '+254711' }).expect(201);
    expect(rated.body.agentComposite).toBe(5);

    // Operator dashboard reflects the float + activity.
    const dash = await request(http).get('/v1/pudo/dashboard').set(auth).expect(200);
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
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    async function onboard(shop: string, zone: string) {
      const u = Math.random().toString(16).slice(2, 10);
      const reg = await request(http).post('/v1/pudo/agents').set(auth).send({ shopName: shop, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: `${shop} o`, nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
      const did = reg.body.did as string;
      await request(http).post(`/v1/pudo/agents/${did}/submit-kyc`).set(auth).send({ idCopyRef: 'id.jpg', tradingLicenceRef: 'lic.pdf', shopPhotoRefs: ['shop.jpg'] }).expect(201);
      await request(http).post(`/v1/pudo/agents/${did}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
      await request(http).post(`/v1/pudo/agents/${did}/top-up`).set(auth).send({ amount: 20 }).expect(201);
      return did;
    }
    const origin = await onboard('Origin PUDO', 'NorthTown');
    const dest = await onboard('Dest PUDO', 'SouthTown');
    const corridor = await request(http).post('/v1/pudo/corridors').set(auth).send({ name: 'N-S', originZone: 'NorthTown', destZone: 'SouthTown' }).expect(201);
    const driver = await request(http).post('/v1/pudo/drivers').set(auth).send({ driverDid: 'did:glos:invan', name: 'Joe', corridorId: corridor.body.corridorId }).expect(201);

    // Vendor onboarding + the shipment webhook.
    const vendor = await request(http).post('/v1/pudo/vendors').set(auth).send({ name: 'ACME Store', callbackUrl: 'https://acme.example/hook' }).expect(201);
    await request(http).post(`/v1/pudo/vendors/${vendor.body.vendorId}/top-up`).set(auth).send({ amount: 50 }).expect(201); // prepay the daughter co
    const order = await request(http).post('/v1/pudo/inbound/orders').set(auth).send({ vendorId: vendor.body.vendorId, externalOrderId: 'ORD-77', originPudoDid: origin, destPudoDid: dest, buyerMobile: '+254700999', size: 'M', contentPhotoRef: 'content.jpg', items: [{ name: 'Books', qty: 3 }] }).expect(201);
    const parcelId = order.body.parcel.parcelId as string;
    const collectionCode = order.body.parcel.collectionCode as string;
    expect(order.body.label.svg).toContain('<svg');

    // Field flow.
    await request(http).post(`/v1/pudo/parcels/${parcelId}/intake`).set(auth).send({ agentDid: origin }).expect(201);
    await request(http).post('/v1/pudo/parcels/handover').set(auth).send({ agentDid: origin, driverBadgeId: driver.body.badgeId, parcelIds: [parcelId] }).expect(201);
    const shelf = await request(http).post(`/v1/pudo/parcels/${parcelId}/shelve`).set(auth).send({ agentDid: dest }).expect(201);
    expect(shelf.body.binSlot).toMatch(/^[A-Za-z]+-[1-9]$/);

    // Buyer collection.
    const found = await request(http).post('/v1/pudo/parcels/collect').set(auth).send({ agentDid: dest, collectionCode }).expect(201);
    expect(found.body.parcel.parcelId).toBe(parcelId);
    const delivered = await request(http).post(`/v1/pudo/parcels/${parcelId}/collect-confirm`).set(auth).send({ agentDid: dest, collectionCode }).expect(201);
    expect(delivered.body.status).toBe('Delivered');

    // Vendor received signed status callbacks.
    const cbs = await request(http).get(`/v1/pudo/vendors/${vendor.body.vendorId}/callbacks`).set(auth).expect(200);
    expect(cbs.body.map((c: { event: string }) => c.event)).toEqual(expect.arrayContaining(['ready_for_pickup', 'collected']));
  });

  it('PUDO MDP hub: pack a bag → bus scans it → drop+empty → sort each parcel → re-bag (tote-bag flow)', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };

    async function onboard(shop: string, zone: string) {
      const u = Math.random().toString(16).slice(2, 10);
      const reg = await request(http).post('/v1/pudo/agents').set(auth).send({ shopName: shop, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: `${shop} o`, nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
      const did = reg.body.did as string;
      await request(http).post(`/v1/pudo/agents/${did}/submit-kyc`).set(auth).send({ idCopyRef: 'id.jpg', tradingLicenceRef: 'lic.pdf', shopPhotoRefs: ['shop.jpg'] }).expect(201);
      await request(http).post(`/v1/pudo/agents/${did}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
      await request(http).post(`/v1/pudo/agents/${did}/top-up`).set(auth).send({ amount: 20 }).expect(201);
      return did;
    }
    const origin = await onboard('MDP Origin', 'NorthTown');
    const dest = await onboard('MDP Dest', 'EastTown');
    const vendor = await request(http).post('/v1/pudo/vendors').set(auth).send({ name: 'HubShop' }).expect(201);
    await request(http).post(`/v1/pudo/vendors/${vendor.body.vendorId}/top-up`).set(auth).send({ amount: 50 }).expect(201); // prepay the daughter co

    // An MDP hub that last-mile-serves the destination zone.
    const hub = await request(http).post('/v1/pudo/mdps').set(auth).send({ name: 'East Sort Hub', zones: ['EastTown'], location: { lat: -1.25, lng: 36.95 } }).expect(201);
    const hubId = hub.body.mdpId as string;

    // Two inbound parcels, intaken at the origin.
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const order = await request(http).post('/v1/pudo/inbound/orders').set(auth).send({ vendorId: vendor.body.vendorId, originPudoDid: origin, destPudoDid: dest, buyerMobile: `+25470${i}`, size: 'M', contentPhotoRef: 'content.jpg' }).expect(201);
      const pid = order.body.parcel.parcelId as string;
      await request(http).post(`/v1/pudo/parcels/${pid}/intake`).set(auth).send({ agentDid: origin }).expect(201);
      ids.push(pid);
    }

    // The journey plan routes through the hub.
    const plan = await request(http).post('/v1/pudo/routing/plan-journey').set(auth).send({ originAgentDid: origin, destAgentDid: dest, weightKg: 5 }).expect(201);
    expect(plan.body.mdpRouted).toBe(true);
    expect(plan.body.hops.map((h: { type: string }) => h.type)).toEqual(['pudo', 'mdp', 'pudo']);

    // Origin packs a bag toward the hub; the driver scans the BAG (one scan).
    const bag = await request(http).post(`/v1/pudo/mdps/${hubId}/totes`).set(auth).expect(201); // pool tote; physically at the origin
    const code = bag.body.code as string;
    await request(http).post(`/v1/pudo/totes/${code}/assign`).set(auth).send({ destinationNodeId: hubId, destinationLabel: 'East Sort Hub' }).expect(201);
    for (const id of ids) await request(http).post(`/v1/pudo/totes/${code}/fill`).set(auth).send({ parcelId: id }).expect(201);
    const loaded = await request(http).post(`/v1/pudo/totes/${code}/load`).set(auth).send({ driverBadgeId: 'BUS-9' }).expect(201);
    expect(loaded.body.moved).toHaveLength(2);

    // Bus drops the bag at the hub → empty it.
    const dropped = await request(http).post(`/v1/pudo/mdps/${hubId}/drop-bag`).set(auth).send({ code }).expect(201);
    expect(dropped.body.emptied).toHaveLength(2);

    // Worker sorts each parcel → next destination + a destination bag code.
    const s0 = await request(http).post(`/v1/pudo/mdps/${hubId}/sort`).set(auth).send({ parcelId: ids[0] }).expect(201);
    expect(s0.body.nextDestination.id).toBe(dest);
    const s1 = await request(http).post(`/v1/pudo/mdps/${hubId}/sort`).set(auth).send({ parcelId: ids[1] }).expect(201);
    expect(s1.body.toteCode).toBe(s0.body.toteCode); // same destination → same bag

    // The destination bag carries both parcels.
    const destBag = await request(http).get(`/v1/pudo/totes/${s0.body.toteCode}`).set(auth).expect(200);
    expect(destBag.body.parcels).toHaveLength(2);
  });

  it('PUDO fleet: onboard a bike courier + vehicle → couple → bike rejects fragile/over-weight at handover', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    // Origin PUDO + a corridor for the feeder leg.
    const reg = await request(http).post('/v1/pudo/agents').set(auth).send({ shopName: 'Fleet Origin', zone: 'NorthTown', location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: 'Fleet o', nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
    const origin = reg.body.did as string;
    await request(http).post(`/v1/pudo/agents/${origin}/submit-kyc`).set(auth).send({ idCopyRef: 'id', tradingLicenceRef: 'l', shopPhotoRefs: ['s'] }).expect(201);
    await request(http).post(`/v1/pudo/agents/${origin}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
    await request(http).post(`/v1/pudo/agents/${origin}/top-up`).set(auth).send({ amount: 50 }).expect(201);
    const corridor = await request(http).post('/v1/pudo/corridors').set(auth).send({ name: 'feeder', originZone: 'NorthTown', destZone: 'SouthTown' }).expect(201);

    // A bike courier (light registry → ACTIVE immediately) + a bike (own IDs).
    const driver = await request(http).post('/v1/pudo/drivers/onboard').set(auth).send({ displayName: 'Boda', fullName: 'Boda B', nationalId: `DRV-${u}`, mobile: `+254d${u}`, licenceClasses: ['bike'] }).expect(201);
    expect(driver.body.registry).toBe('light');
    expect(driver.body.status).toBe('ACTIVE');
    const bike = await request(http).post('/v1/pudo/vehicles').set(auth).send({ plate: `BD-${u}`, vehicleClass: 'bike', ownerName: 'Boda B' }).expect(201);
    expect(bike.body.capacityKg).toBe(20);

    // Couple driver ↔ bike on the corridor (flexible).
    await request(http).post(`/v1/pudo/fleet/drivers/${driver.body.did}/couple`).set(auth).send({ vehicleId: bike.body.vehicleId, corridorId: corridor.body.corridorId }).expect(201);

    // Three parcels; only the small non-fragile one may ride the bike.
    for (const p of [{ id: `OK-${u}`, size: 'S' }, { id: `FR-${u}`, size: 'S', fragile: true }, { id: `HV-${u}`, size: 'HEAVY' }]) {
      await request(http).post('/v1/pudo/parcels/accept').set(auth).send({ agentDid: origin, parcelId: p.id, size: p.size, destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'd.jpg', fragile: p.fragile }).expect(201);
    }
    const h = await request(http).post('/v1/pudo/parcels/handover').set(auth).send({ agentDid: origin, driverBadgeId: driver.body.badgeId, parcelIds: [`OK-${u}`, `FR-${u}`, `HV-${u}`] }).expect(201);
    expect(h.body.handed).toEqual([`OK-${u}`]);
    expect(h.body.rejected).toHaveLength(2);
    expect(h.body.vehicle).toBe('bus');
  });

  it('PUDO dispatch: agent bags a tote → released → a routed driver is offered it → claims → loads', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    const loc = { lat: -1.2, lng: 36.8 };
    const reg = await request(http).post('/v1/pudo/agents').set(auth).send({ shopName: 'Dispatch PUDO', zone: 'NorthTown', location: loc, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null }, fullName: 'D o', nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201);
    const origin = reg.body.did as string;
    await request(http).post(`/v1/pudo/agents/${origin}/submit-kyc`).set(auth).send({ idCopyRef: 'id', tradingLicenceRef: 'l', shopPhotoRefs: ['s'] }).expect(201);
    await request(http).post(`/v1/pudo/agents/${origin}/kyc-decision`).set(auth).send({ approve: true }).expect(201);
    await request(http).post(`/v1/pudo/agents/${origin}/top-up`).set(auth).send({ amount: 50 }).expect(201);
    const hub = await request(http).post('/v1/pudo/mdps').set(auth).send({ name: 'Hub', zones: ['SouthTown'], location: { lat: -1.25, lng: 36.85 } }).expect(201);

    // A motorcycle courier (light → ACTIVE) coupled to a motorcycle.
    const driver = await request(http).post('/v1/pudo/drivers/onboard').set(auth).send({ displayName: 'Moto', fullName: 'Mo', nationalId: `DRV-${u}`, mobile: `+254d${u}`, licenceClasses: ['motorcycle'] }).expect(201);
    const moto = await request(http).post('/v1/pudo/vehicles').set(auth).send({ plate: `MT-${u}`, vehicleClass: 'motorcycle', ownerName: 'Mo' }).expect(201);
    await request(http).post(`/v1/pudo/fleet/drivers/${driver.body.did}/couple`).set(auth).send({ vehicleId: moto.body.vehicleId }).expect(201);

    // Agent bags two parcels in an outbound tote bound for the hub, then releases it for claim.
    const bag = await request(http).post(`/v1/pudo/agents/${origin}/totes`).set(auth).expect(201);
    await request(http).post(`/v1/pudo/totes/${bag.body.code}/assign`).set(auth).send({ destinationNodeId: hub.body.mdpId, destinationLabel: 'Hub' }).expect(201);
    for (const id of [`P1-${u}`, `P2-${u}`]) {
      await request(http).post('/v1/pudo/parcels/accept').set(auth).send({ agentDid: origin, parcelId: id, size: 'M', destZone: 'SouthTown', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'd.jpg', paymentMode: 'prepaid' }).expect(201);
      await request(http).post(`/v1/pudo/totes/${bag.body.code}/fill`).set(auth).send({ parcelId: id }).expect(201);
    }
    await request(http).post(`/v1/pudo/totes/${bag.body.code}/release`).set(auth).expect(201);

    // The driver declares a route past the PUDO → gets a sized suggestion.
    const sug = await request(http).post(`/v1/pudo/fleet/drivers/${driver.body.did}/suggest-work`).set(auth).send({ from: loc, to: { lat: -1.3, lng: 36.95 } }).expect(201);
    expect(sug.body.remainingCapacityKg).toBe(50);
    expect(sug.body.offers).toHaveLength(1);
    expect(sug.body.offers[0].weightKg).toBe(10);

    // Claim it → reserves 10 kg; then load the bag (claimer only).
    await request(http).post(`/v1/pudo/dispatch/offers/${sug.body.offers[0].offerId}/claim`).set(auth).expect(201);
    const claims = await request(http).get(`/v1/pudo/fleet/drivers/${driver.body.did}/claims`).set(auth).expect(200);
    expect(claims.body.remainingCapacityKg).toBe(40);
    const loaded = await request(http).post(`/v1/pudo/totes/${bag.body.code}/load`).set(auth).send({ driverBadgeId: driver.body.badgeId }).expect(201);
    expect(loaded.body.moved).toHaveLength(2);

    // Fleet-manager dashboard reflects the on-shift driver (located via suggest-work) + active cargo.
    const dash = await request(http).get('/v1/pudo/fleet/dashboard').set(auth).expect(200);
    expect(dash.body.sessions.active).toBeGreaterThanOrEqual(1);
    expect(dash.body.positions.length).toBeGreaterThanOrEqual(1);
    expect(dash.body.cargo.count).toBeGreaterThanOrEqual(1);
    expect(dash.body.cargo.items[0].driver).toBeDefined();
    // The truck sub-type catalog is rich (>15 bodies) for registration UIs.
    const subs = await request(http).get('/v1/pudo/vehicles/truck-subtypes').set(auth).expect(200);
    expect(subs.body.length).toBeGreaterThan(15);
    expect(subs.body.some((s: { id: string }) => s.id === 'fuel_tanker')).toBe(true);
  });

  it('PUDO driver shift session: scan the vehicle QR to start (couple), close to end (decouple)', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    const veh = await request(http).post('/v1/pudo/vehicles').set(auth).send({ plate: `SS-${u}`, vehicleClass: 'motorcycle', ownerName: 'Sh' }).expect(201);
    expect(veh.body.qr).toMatch(/^VEH-/);
    const driver = await request(http).post('/v1/pudo/drivers/onboard').set(auth).send({ displayName: 'Shift', fullName: 'Sh', nationalId: `SES-${u}`, mobile: `+254s${u}`, licenceClasses: ['motorcycle'] }).expect(201);

    await request(http).post(`/v1/pudo/fleet/drivers/${driver.body.did}/start-session`).set(auth).send({ vehicleQr: 'VEH-NOPE' }).expect(404);
    await request(http).post(`/v1/pudo/fleet/drivers/${driver.body.did}/start-session`).set(auth).send({ vehicleQr: veh.body.qr }).expect(201);

    const on = await request(http).get(`/v1/pudo/fleet/drivers/${driver.body.did}/session`).set(auth).expect(200);
    expect(on.body.active).toBe(true);
    expect(on.body.vehicle.plate).toBe(`SS-${u}`.toUpperCase());

    await request(http).post(`/v1/pudo/fleet/drivers/${driver.body.did}/end-session`).set(auth).expect(201);
    const off = await request(http).get(`/v1/pudo/fleet/drivers/${driver.body.did}/session`).set(auth).expect(200);
    expect(off.body.active).toBe(false);
  });

  it('PUDO fleet manager: onboard (requirements + KYC + bond) → ACTIVE → registers a scoped fleet', async () => {
    const http = app.getHttpServer();
    const tokenRes = await request(http).post('/v1/auth/token').send({ sub: 'ops', type: 'client_credentials' }).expect(201);
    const auth = { Authorization: `Bearer ${tokenRes.body.access_token}` };
    const u = Math.random().toString(16).slice(2, 10);

    // Eligibility filter blocks a missing operator licence.
    await request(http).post('/v1/pudo/fleet/managers').set(auth).send({ companyName: 'BadCo', contactPhone: `+254${u}`, ownerFullName: 'O', ownerNationalId: `MGR-${u}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}`, transportOperatorLicence: '', taxId: `TAX-${u}` } }).expect(400);

    const reg = await request(http).post('/v1/pudo/fleet/managers').set(auth).send({ companyName: 'Acme Haulage', contactPhone: `+254${u}`, ownerFullName: 'A Owner', ownerNationalId: `MGR-${u}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}`, transportOperatorLicence: `TOL-${u}`, taxId: `TAX-${u}` } }).expect(201);
    const mDid = reg.body.did as string;
    expect(reg.body.status).toBe('DRAFT');

    // Cannot build a fleet until ACTIVE.
    await request(http).post('/v1/pudo/vehicles').set(auth).send({ plate: `MV-${u}`, vehicleClass: 'van', ownerName: 'A', managerDid: mDid }).expect(400);

    await request(http).post(`/v1/pudo/fleet/managers/${mDid}/submit-kyc`).set(auth).send({ businessRegCertRef: 'r.pdf', operatorLicenceRef: 'l.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'a.pdf' }).expect(201);
    const queue = await request(http).get('/v1/pudo/fleet/managers/kyc-queue').set(auth).expect(200);
    expect(queue.body.some((m: { did: string }) => m.did === mDid)).toBe(true);
    await request(http).post(`/v1/pudo/fleet/managers/${mDid}/kyc-decision`).set(auth).send({ approve: true, by: 'ops' }).expect(201);
    const active = await request(http).post(`/v1/pudo/fleet/managers/${mDid}/bond`).set(auth).expect(201);
    expect(active.body.status).toBe('ACTIVE');
    expect(active.body.loginCode).toMatch(/^FM-/);

    // The manager can sign into the console with the issued code; a bad code is rejected.
    const signin = await request(http).post('/v1/pudo/fleet/managers/login').set(auth).send({ code: active.body.loginCode }).expect(201);
    expect(signin.body.did).toBe(mDid);
    await request(http).post('/v1/pudo/fleet/managers/login').set(auth).send({ code: 'FM-NOPE' }).expect(401);

    // Now the manager can register a vehicle, and the dashboard scopes to their fleet.
    const veh = await request(http).post('/v1/pudo/vehicles').set(auth).send({ plate: `MV-${u}`, vehicleClass: 'van', ownerName: 'Acme', managerDid: mDid }).expect(201);
    expect(veh.body.managerDid).toBe(mDid);
    const dash = await request(http).get('/v1/pudo/fleet/dashboard').query({ manager: mDid }).set(auth).expect(200);
    expect(dash.body.managerDid).toBe(mDid);
    expect(dash.body.vehicles.total).toBe(1);
  });
});
