import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * WHO A COMPANY SIGN-IN IS, ASKED BY ITS TOKEN (the user, 2026-10-22: "the browser password manager should ask if the
 * user wants to save the login credentials"). The console no longer keeps a company administrator's password to sign
 * itself back in with; when a tab comes back it holds only the session, and asks the server whose it is. Proven over
 * the wire: the answer comes from the token, a changed password ends it, and nobody else is answered as a company.
 */
describe('a company sign-in says who it is, from its token alone', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator = '';

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

  it('answers the administrator’s name and company; refuses staff and nobody; ends with a changed password', async () => {
    const email = `amani.${digits()}@sbg.co.ke`;
    const made = await http().post('/v1/sbg/entities/sbg-ke/admins').set(bearer(operator)).send({ email, name: 'Amani Njoroge' }).expect(201);
    const password = made.body.temporaryPassword as string;
    const token = (await http().post('/v1/sbg/entities/admins/login').send({ email, password }).expect(201)).body.token.access_token as string;

    const me = await http().get('/v1/sbg/entities/admins/me').set(bearer(token)).expect(200);
    expect(me.body).toEqual({ name: 'Amani Njoroge', entityId: 'sbg-ke' });

    // Staff pass every labelled route; they are still not a company's administrator.
    await http().get('/v1/sbg/entities/admins/me').set(bearer(operator)).expect(403);
    await http().get('/v1/sbg/entities/admins/me').expect(401);

    // A changed password ends this administrator's sessions: the console's held token is no longer anybody.
    await http().post('/v1/sbg/entities/admins/password').send({ email, password, newPassword: `Kilima-${digits()}-ridge` }).expect(201);
    await http().get('/v1/sbg/entities/admins/me').set(bearer(token)).expect(401);
  });
});
