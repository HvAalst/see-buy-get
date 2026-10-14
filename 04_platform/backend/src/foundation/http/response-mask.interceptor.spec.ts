import { CallHandler } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseMaskInterceptor } from './response-mask.interceptor';

/** Run a value through the interceptor and return the masked result. */
async function mask(value: unknown): Promise<unknown> {
  const interceptor = new ResponseMaskInterceptor();
  const next: CallHandler = { handle: () => of(value) };
  return firstValueFrom(interceptor.intercept({} as never, next));
}

describe('ResponseMaskInterceptor', () => {
  it('strips credential fields at any depth', async () => {
    const out = (await mask({ did: 'did:glos:a', salt: 's', hash: 'h', profile: { password: 'p', pinHash: 'x', name: 'ok' } })) as Record<string, unknown>;
    expect(out).toEqual({ did: 'did:glos:a', profile: { name: 'ok' } });
  });

  it('masks inside arrays', async () => {
    const out = (await mask([{ id: 1, hash: 'h' }, { id: 2, hash: 'h2' }])) as Array<Record<string, unknown>>;
    expect(out).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('never mutates the source object the service still holds', async () => {
    const source = { did: 'd', salt: 'secret-salt' };
    await mask(source);
    expect(source.salt).toBe('secret-salt'); // rebuild, not mutate
  });

  it('leaves benign fields untouched — including a legitimate `code`', async () => {
    const out = (await mask({ code: '090111', secret: 'whsec_x', balance: 20 })) as Record<string, unknown>;
    // `secret` is NOT in the credential denylist (register returns it once); `code` is a real field.
    expect(out).toEqual({ code: '090111', secret: 'whsec_x', balance: 20 });
  });

  it('passes primitives and Dates through by reference', async () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(await mask('hello')).toBe('hello');
    expect(await mask(42)).toBe(42);
    expect(await mask(d)).toBe(d);
  });
});
