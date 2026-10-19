import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { keyLine, keysInOrder, keyTitle, type CompanyKey } from './companyKeys';

const key = (over: Partial<CompanyKey> = {}): CompanyKey => ({ keyId: 'ck_1', mode: 'live', label: 'ERP', hint: 'a3f9', createdAt: '2026-10-19T08:00:00.000Z', createdBy: 'Wanjiku Owner', ...over });

describe('a company’s keys, as both apps say them', () => {
  it('names a key by its world, what it is for and its last four characters — never the key', () => {
    expect(keyTitle(key(), t)).toBe('Live key · ERP · …a3f9');
    expect(keyTitle(key({ mode: 'test', label: undefined }), t)).toBe('Test key · …a3f9');
  });

  it('says who made it and when it was last used — or that it was taken away, by whom, and no longer works', () => {
    expect(keyLine(key(), t)).toMatch(/^Made by Wanjiku Owner, .+\. Not used yet\.$/);
    expect(keyLine(key({ lastUsedAt: '2026-10-19T09:00:00.000Z' }), t)).toMatch(/^Made by Wanjiku Owner, .+\. Last used .+\.$/);
    expect(keyLine(key({ revokedAt: '2026-10-20T08:00:00.000Z', revokedBy: 'Otieno' }), t)).toMatch(/^Taken away by Otieno, .+\. It no longer works\.$/);
  });

  it('lists the keys that work first, newest first, and those taken away after', () => {
    const old = key({ keyId: 'old', createdAt: '2026-10-01T00:00:00.000Z' });
    const fresh = key({ keyId: 'fresh', createdAt: '2026-10-19T00:00:00.000Z' });
    const gone = key({ keyId: 'gone', createdAt: '2026-10-25T00:00:00.000Z', revokedAt: '2026-10-26T00:00:00.000Z' });
    expect(keysInOrder([gone, old, fresh]).map((k) => k.keyId)).toEqual(['fresh', 'old', 'gone']);
  });
});
