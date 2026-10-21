import { describe, expect, it } from 'vitest';
import specRaw from '../../../../backend/contracts/openapi.json?raw';
import { t } from '../../shared/i18n';

/**
 * EVERY KIND OF COMPANY CHANGE IS SAID IN WORDS. The change log on Rates & tax shows `tower.changes.what.<what>`; a kind
 * the server adds without a line here shows the key itself — found on the screen when round 38 added "sealRules". Read
 * from the contract, so a new kind fails here rather than on somebody's screen.
 */
describe('the company change log’s words', () => {
  it('has words for every kind of change the server records', () => {
    const spec = JSON.parse(specRaw) as { components: { schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }> } };
    const kinds = spec.components.schemas.EntityChange?.properties?.what?.enum ?? [];
    expect(kinds.length).toBeGreaterThan(5); // the contract was read, not an empty list
    expect(kinds).toContain('sealRules');
    const missing = kinds.filter((k) => t(`tower.changes.what.${k}` as never) === `tower.changes.what.${k}`);
    expect(missing).toEqual([]);
  });
});
