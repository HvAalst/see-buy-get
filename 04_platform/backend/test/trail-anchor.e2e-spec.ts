import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LedgerService } from '../src/foundation/ledger/ledger.service';
import { TrailAnchorService } from '../src/modules/pudo/trail-anchor.service';

/**
 * ROUND 40 — THE TRAIL ANCHORED OUTSIDE OUR DATABASE, OVER THE WIRE (the user: "Daily to an auditor"). Two members of staff
 * name the auditor's address — one asks, another approves, the setup key neither; the daily head is kept and read back; and
 * an auditor's copy read out is checked against the chain as it stands. Administration's, and nobody else's.
 */
describe('the trail anchored outside our database — over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aStaff(name: string): Promise<{ authorization: string }> {
    const made = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    const login = await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201);
    return bearer(login.body.token.access_token);
  }

  it('two members of staff name the auditor; the day is kept; a copy read out is checked against the chain', async () => {
    const amina = await aStaff('Amina');
    const brian = await aStaff('Brian');

    // The setup key cannot tell two people apart: it names nobody.
    expect((await http().post('/v1/sbg/ops/anchors/auditor').set(bearer(setupKey)).send({ address: 'audit@example.com' }).expect(403)).body.detail).toMatch(/own staff account/);
    // A driver, or anybody else, does not reach it.
    const driver = (await http().post('/v1/auth/token').send({ role: 'driver', did: 'did:glos:anyone', type: 'client_credentials' })).body.access_token;
    if (driver) await http().get('/v1/sbg/ops/anchors').set(bearer(driver)).expect(403);

    expect((await http().post('/v1/sbg/ops/anchors/auditor').set(amina).send({ address: `audit-${tag}@example.com` }).expect(201)).body.proposal).toMatchObject({ address: `audit-${tag}@example.com`, mine: true });
    // Not hers to approve; Brian's.
    await http().post('/v1/sbg/ops/anchors/auditor/decide').set(amina).send({ approve: true }).expect(403);
    expect((await http().post('/v1/sbg/ops/anchors/auditor/decide').set(brian).send({ approve: true }).expect(201)).body.auditor).toMatchObject({ address: `audit-${tag}@example.com`, proposedBy: `Amina ${tag}`, approvedBy: `Brian ${tag}` });

    // The day's head, kept and read back, and the copy the auditor received checked against the chain.
    const ledger = app.get(LedgerService);
    ledger.anchor({ round: 40, tag, n: 1 });
    ledger.anchor({ round: 40, tag, n: 2 });
    const kept = await app.get(TrailAnchorService).sweep(Date.parse('2099-01-02T00:10:00Z'));
    expect(kept).toMatchObject({ date: '2099-01-02', to: `audit-${tag}@example.com`, whole: true });
    const view = (await http().get('/v1/sbg/ops/anchors').set(brian).expect(200)).body;
    expect(view.heads[0]).toMatchObject({ date: '2099-01-02', height: kept!.height, txId: kept!.txId, stillMatches: true });
    expect(typeof view.delivers).toBe('boolean');

    expect((await http().post('/v1/sbg/ops/anchors/check').set(amina).send({ height: kept!.height, txId: kept!.txId }).expect(201)).body).toMatchObject({ match: true });
    expect((await http().post('/v1/sbg/ops/anchors/check').set(amina).send({ height: kept!.height, txId: 'b'.repeat(64) }).expect(201)).body).toMatchObject({ match: false });
    await http().post('/v1/sbg/ops/anchors/check').set(amina).send({ height: 'two', txId: kept!.txId }).expect(400);
  });
});
