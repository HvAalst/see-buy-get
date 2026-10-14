import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { applyEdge } from '../src/edge';

/**
 * WHAT THE SERVER SHOWS THE OUTSIDE — asked over the wire, with the same edge `main.ts` puts on.
 *
 * It answered every website, and served a page listing every route, wherever it ran. Outside a sandbox it now
 * answers our own sites — and, for the shipping API a store's page calls, everybody's — and keeps its map to itself.
 */
describe('the edge: which websites are answered, and the docs page', () => {
  const OURS = 'https://seebuyget.example';
  const STRANGER = 'https://evil.example';

  async function serverWith(env: Record<string, string | undefined>): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    applyEdge(app, env);
    await app.init();
    return app;
  }
  /** What a browser on `origin` is told it may read: the origin it was answered for, or nothing. */
  const answeredFor = async (app: INestApplication, path: string, origin?: string) => {
    const r = await request(app.getHttpServer()).get(path).set(origin ? { origin } : {});
    return { status: r.status, allowed: r.headers['access-control-allow-origin'] as string | undefined };
  };
  /** The question a browser asks BEFORE a call that carries a token or a JSON body. */
  const mayCall = async (app: INestApplication, path: string, origin: string) => {
    const r = await request(app.getHttpServer()).options(path).set({ origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' });
    return r.headers['access-control-allow-origin'] as string | undefined;
  };

  describe('outside a sandbox', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await serverWith({ GLOS_ENV: 'production', SBG_PUBLIC_URL: `${OURS}/`, SBG_CONSOLE_URL: 'https://console.seebuyget.example/tower/' });
    });
    afterAll(async () => {
      await app?.close();
    });

    it('answers our own sites, at a public answer and at a sign-in', async () => {
      expect(await answeredFor(app, '/v1/sbg/countries', OURS)).toEqual({ status: 200, allowed: OURS });
      expect(await mayCall(app, '/v1/sbg/auth/login', OURS)).toBe(OURS);
      expect(await mayCall(app, '/v1/sbg/operators/login', 'https://console.seebuyget.example')).toBe('https://console.seebuyget.example');
    });

    it('answers no other website: the call is made, and the browser is told nothing it may read', async () => {
      // The server still answers — a rule about websites is kept by the visitor's browser, not by us — but without
      // the header a page on that site can neither read the answer nor send a call that carries a token.
      expect(await answeredFor(app, '/v1/sbg/countries', STRANGER)).toEqual({ status: 200, allowed: undefined });
      for (const path of ['/v1/sbg/auth/login', '/v1/sbg/identity/login', '/v1/sbg/vendors/session', '/v1/sbg/operators/login', '/v1/auth/token']) {
        expect([path, await mayCall(app, path, STRANGER)]).toEqual([path, undefined]);
      }
      expect(await mayCall(app, '/v1/sbg/auth/login', `${OURS}.evil.example`)).toBeUndefined();
    });

    it('answers every website at the shipping API — what a store’s own page calls', async () => {
      const areas = await answeredFor(app, '/v1/sbg/shipping/areas', STRANGER);
      expect(areas.allowed).toBe(STRANGER);
      expect(await mayCall(app, '/v1/sbg/shipping/quotes', STRANGER)).toBe(STRANGER);
    });

    it('a call from no website at all — the same site, a script, another server — is answered as it always was', async () => {
      expect(await answeredFor(app, '/v1/sbg/countries')).toEqual({ status: 200, allowed: undefined });
    });

    it('does not serve the page that lists every route', async () => {
      await request(app.getHttpServer()).get('/v1/docs').expect(404);
      await request(app.getHttpServer()).get('/v1/docs-json').expect(404);
    });
  });

  it('is what the real start puts on: main.ts calls applyEdge, and sets up neither of these itself', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main.length).toBeGreaterThan(1500);
    expect(main).toContain('applyEdge(app);');
    // After the prefix, because the docs page is mounted under it; before listening, because cors must be on by then.
    expect(main.indexOf("app.setGlobalPrefix('v1')")).toBeLessThan(main.indexOf('applyEdge(app);'));
    expect(main.indexOf('applyEdge(app);')).toBeLessThan(main.indexOf('app.listen('));
    expect(main).not.toContain('enableCors');
    expect(main).not.toContain('SwaggerModule');
  });

  describe('in a sandbox', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await serverWith({});
    });
    afterAll(async () => {
      await app?.close();
    });

    it('answers any website: each app is a dev server on its own port', async () => {
      expect(await answeredFor(app, '/v1/sbg/countries', 'http://localhost:5175')).toEqual({ status: 200, allowed: 'http://localhost:5175' });
      expect(await mayCall(app, '/v1/sbg/auth/login', STRANGER)).toBe(STRANGER);
    });

    it('serves the docs page', async () => {
      const page = await request(app.getHttpServer()).get('/v1/docs').redirects(1);
      expect(page.status).toBe(200);
      expect(page.text).toContain('swagger');
    });
  });
});
