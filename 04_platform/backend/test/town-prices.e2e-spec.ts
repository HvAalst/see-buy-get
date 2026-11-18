import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2026-11-18 — WHAT IT COSTS FROM A TOWN, OVER THE WIRE (the owner: example prices per country, "yes"). The town pages'
 * build reads it with no sign-in, beside the towns themselves; a shop is never named by its internal id there.
 */
describe('the town prices, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;

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

  it('is read by anybody, as a list per town in one money, with no shop’s id in it', async () => {
    const res = await http().get('/v1/sbg/network/prices').expect(200);
    expect(res.headers['cache-control']).toContain('max-age=300');
    expect(Array.isArray(res.body.items)).toBe(true);
    for (const page of res.body.items as Array<{ slug: string; currency: string; to: Array<{ slug: string; from: Record<string, number> }> }>) {
      expect(page.currency).toMatch(/^[A-Z]{3}$/);
      expect(page.to.length).toBeGreaterThan(0);
    }
    const towns = (await http().get('/v1/sbg/network/towns').expect(200)).body.items as Array<{ slug: string }>;
    // Every priced town is a town with a page.
    expect((res.body.items as Array<{ slug: string }>).every((p) => towns.some((t) => t.slug === p.slug))).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/did:|"ids"/);
  });
});
