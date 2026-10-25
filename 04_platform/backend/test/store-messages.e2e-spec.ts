import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * A STORE'S MESSAGES TO ITS OWN SYSTEM, over the wire (the user, round 9: "Webhooks for every party", the store first).
 * The store reads whether each arrived; sends itself a test; sends one again — and that is its own act: staff and
 * another store are refused.
 */
describe('a store’s messages to its own system, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: Record<string, string> = {};
  let receiver: Server;
  let origin = '';
  let landed: Array<{ event: string; delivery: string; body: string }> = [];
  let answer = 200;

  beforeAll(async () => {
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ event: String(req.headers['x-sbg-event']), delivery: String(req.headers['x-sbg-delivery']), body: Buffer.concat(chunks).toString() });
        res.writeHead(answer);
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const a = receiver.address();
    origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = { authorization: `Bearer ${(await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token}` };
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  async function aStore(path: string): Promise<{ vendorId: string; auth: Record<string, string> }> {
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ ...AGREED, name: `Store ${Math.random().toString(16).slice(2, 8)}`, callbackUrl: `${origin}${path}` }).expect(201)).body;
    const signedIn = await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201);
    return { vendorId: made.vendorId, auth: { authorization: `Bearer ${signedIn.body.token.access_token}` } };
  }

  it('sends itself a test, sees it arrive, and sends one again that did not — nobody else can', async () => {
    const store = await aStore('/hooks/sbg');
    const other = await aStore('/hooks/other');

    landed = [];
    const test = (await http().post(`/v1/sbg/vendors/${store.vendorId}/callbacks/test`).set(store.auth).expect(201)).body;
    expect(test).toMatchObject({ event: 'test', state: 'delivered', attempts: 1 });
    expect(landed).toEqual([expect.objectContaining({ event: 'test', delivery: test.id })]);

    // Its system is down: the next one does not arrive, and the store reads why.
    answer = 503;
    const down = (await http().post(`/v1/sbg/vendors/${store.vendorId}/callbacks/test`).set(store.auth).expect(201)).body;
    expect(down).toMatchObject({ state: 'pending', attempts: 1 });
    expect(down.lastError).toBeTruthy();
    const listed = (await http().get(`/v1/sbg/vendors/${store.vendorId}/callbacks`).set(store.auth).expect(200)).body as Array<{ id: string; state: string }>;
    expect(listed.find((c) => c.id === down.id)).toMatchObject({ state: 'pending' });

    // Up again, it sends that one again itself: the same message, arrived.
    answer = 200;
    landed = [];
    const again = (await http().post(`/v1/sbg/vendors/${store.vendorId}/callbacks/${down.id}/resend`).set(store.auth).expect(201)).body;
    expect(again).toMatchObject({ id: down.id, state: 'delivered', resent: 1 });
    expect(landed).toEqual([expect.objectContaining({ delivery: down.id, body: down.body })]);

    // Staff do not send a store's messages in its name; another store cannot even find it.
    expect((await http().post(`/v1/sbg/vendors/${store.vendorId}/callbacks/${down.id}/resend`).set(operator).expect(403)).body.detail).toMatch(/A store makes its own changes/);
    await http().post(`/v1/sbg/vendors/${store.vendorId}/callbacks/${down.id}/resend`).set(other.auth).expect(403);
    await http().post(`/v1/sbg/vendors/${other.vendorId}/callbacks/${down.id}/resend`).set(other.auth).expect(404);
    await http().post(`/v1/sbg/vendors/${store.vendorId}/callbacks/test`).set(operator).expect(403);
  });
});
