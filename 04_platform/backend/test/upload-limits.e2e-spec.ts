import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { applyBodyLimits } from '../src/body-limits';
import { readProviderEventsRaw } from '../src/foundation/mail/provider-events.raw';
import { UPLOAD_LIMITS } from '../src/foundation/media/upload-limits';

/**
 * A FILE TOO LARGE, OVER THE WIRE (2026-11-02) — through the booted app, started as `main.ts` starts it.
 *
 * The owner: "if we put a filesize limit, it needs to show or tell … It silently refused." What the body parser in front
 * of a route says is invisible to every unit test: it answers before any route runs. It used to answer a body over its
 * limit with a 500 marked "send it again", and it turned a 3 MB paper away from routes that take 8.
 */
describe('a file too large, over the wire', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    readProviderEventsRaw(app as never);
    applyBodyLimits(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a photograph over its limit in our own shape: 413 MEDIA_TOO_LARGE, its size and the most, never "send it again"', async () => {
    // 1.6 million characters of base64: a photo of about 1.2 MB, which no phone of ours sends unshrunk any more.
    const res = await http().post('/v1/sbg/media').send({ kind: 'avatar', dataUrl: `data:image/jpeg;base64,${'A'.repeat(1_600_000)}` });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('MEDIA_TOO_LARGE');
    expect(res.body.retryable).toBe(false);
    expect(res.body.params.maxBytes).toBe(UPLOAD_LIMITS.photo);
    expect(res.body.params.bytes).toBeGreaterThan(1_100_000);
    expect(res.body.params.bytes).toBeLessThan(1_300_000);
    expect(res.body.traceId).toMatch(/^trc_/);
  });

  it('lets a 3 MB paper through to its route — refused there for who is asking, not at the door for its size', async () => {
    const paper = `data:application/pdf;base64,${'A'.repeat(4_000_000)}`; // about 3 MB of file
    const res = await http().post('/v1/sbg/quotes/q_nobody/proforma').send({ dataUrl: paper, fileName: 'proforma.pdf' });
    expect(res.status).not.toBe(413);
    expect(res.status).toBeGreaterThanOrEqual(400); // nobody signed in: the route itself answers
    expect(res.body.code).not.toBe('MEDIA_TOO_LARGE');
  });

  it('says a paper over its route’s own most, at the door, with the paper’s limit', async () => {
    // 12 million characters: a paper of about 9 MB — over the 8 MB a paper may be.
    const res = await http().post('/v1/sbg/entities/ent_nobody/record/declare').send({ paperDataUrl: `data:application/pdf;base64,${'A'.repeat(12_000_000)}` });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('MEDIA_TOO_LARGE');
    expect(res.body.params.maxBytes).toBe(UPLOAD_LIMITS.document);
  });

  it('is what the real start puts on: main.ts calls applyBodyLimits after the raw address, and sets no parser of its own', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main.length).toBeGreaterThan(1500);
    expect(main).toContain('applyBodyLimits(app);');
    expect(main.indexOf('readProviderEventsRaw(app);')).toBeLessThan(main.indexOf('applyBodyLimits(app);'));
    expect(main.indexOf('applyBodyLimits(app);')).toBeLessThan(main.indexOf('app.listen('));
    expect(main).not.toMatch(/\bjson\(\{\s*limit/);
  });
});
