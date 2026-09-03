import { Body, Controller, Post } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';

/**
 * A write is replay-safe when the caller names its attempt.
 *
 * This is what the outbox rests on. A queue retries by design, on a schedule nobody is watching, and the
 * failure it exists for is "the server did it and the answer never came back" — so the second send is not
 * an edge case, it is the expected path. Without this, an offline queue would be a machine for charging
 * shops twice for the same parcel.
 */
@Controller('test')
class CountingController {
  calls = 0;
  @Post('do')
  do(@Body() body: { n?: number }) {
    this.calls += 1;
    return { ran: this.calls, echoed: body.n };
  }
}

describe('idempotent writes', () => {
  let app: import('@nestjs/common').INestApplication;
  let controller: CountingController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CountingController],
      providers: [IdempotencyService, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication();
    controller = moduleRef.get(CountingController);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('runs the work ONCE and returns the first answer to a replay', async () => {
    const first = await request(app.getHttpServer()).post('/test/do').set('Idempotency-Key', 'k1').send({ n: 7 }).expect(201);
    const second = await request(app.getHttpServer()).post('/test/do').set('Idempotency-Key', 'k1').send({ n: 7 }).expect(201);
    expect(first.body).toEqual({ ran: 1, echoed: 7 });
    expect(second.body).toEqual(first.body); // byte for byte, and the handler never ran again
    expect(controller.calls).toBe(1);
  });

  it('refuses the same name used for a DIFFERENT request', async () => {
    // The caller's own bookkeeping has gone wrong — two different acts sharing one name. Quietly
    // returning the first would confirm work that was never done.
    await request(app.getHttpServer()).post('/test/do').set('Idempotency-Key', 'k2').send({ n: 1 }).expect(201);
    await request(app.getHttpServer()).post('/test/do').set('Idempotency-Key', 'k2').send({ n: 2 }).expect(409);
    expect(controller.calls).toBe(1);
  });

  it('leaves an unnamed request exactly as it was', async () => {
    // Idempotency is the caller's tool. A client that retries nothing must not be made to carry it.
    await request(app.getHttpServer()).post('/test/do').send({ n: 1 }).expect(201);
    await request(app.getHttpServer()).post('/test/do').send({ n: 1 }).expect(201);
    expect(controller.calls).toBe(2);
  });
});
