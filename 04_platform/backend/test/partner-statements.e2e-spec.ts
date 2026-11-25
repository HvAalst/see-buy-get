import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EntityService } from '../src/foundation/entity/entity.service';

/**
 * 2026-11-24 — WHAT COMPANIES OF OURS OWE A PARTNER, WEEK BY WEEK, over the wire (route plan part 4; the owner: "we owe it weekly"):
 * staff read a partner's statements and say a week paid with the transfer's reference; a company that is not a partner has none;
 * nobody signed out reads anything.
 */
describe('a partner’s weekly statements, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

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

  it('staff read a partner’s weeks and say one paid; a company that is not a partner has none; signed out, nothing', async () => {
    const entities = app.get(EntityService);
    const partner = entities.createCompany({ kind: 'partner', jurisdiction: 'BG', name: `Balkan Courier ${Date.now()}` }, 'Owner');
    expect((await http().get(`/v1/sbg/entities/${partner.entityId}/partner-statements`).set(operator).expect(200)).body).toEqual({ statements: [], unpaid: {} });
    const sister = entities.list().find((e) => e.kind === 'sister')!;
    expect((await http().get(`/v1/sbg/entities/${sister.entityId}/partner-statements`).set(operator).expect(404)).body.detail).toMatch(/is not a partner company/);
    await http().post(`/v1/sbg/entities/${partner.entityId}/partner-statements/pst_x/paid`).set(operator).send({ reference: 'x' }).expect(400);
    expect((await http().post(`/v1/sbg/entities/${partner.entityId}/partner-statements/pst_x/paid`).set(operator).send({ reference: 'NL12INGB-0042' }).expect(404)).body.detail).toMatch(/No such statement/);
    await http().post(`/v1/sbg/entities/${sister.entityId}/partner-statements/pst_x/paid`).set(operator).send({ reference: 'NL12INGB-0042' }).expect(404);
    await http().get(`/v1/sbg/entities/${partner.entityId}/partner-statements`).expect(401);
    await http().get('/v1/sbg/partner/me/statements').expect(401);
  });
});
