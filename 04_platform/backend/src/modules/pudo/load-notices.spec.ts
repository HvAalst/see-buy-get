import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * A NOTICE ABOUT A LOAD NAMES ITS SENDER AS SOMEBODY WHO CAN BE TOLD (found 2026-10-27). A store's order turned into
 * freight records the store's RECORD id as its shipper; a notice addressed to that id is filed where no bell reads it,
 * so a store was told of none of its loads' troubles — a delivery that could not be made, a load handed back, a claim
 * decided, a seal broken, a load held. Every notice now asks DispatchService.senderDidOf; this keeps a new one from
 * reading the raw fields again.
 */
describe('a notice about a load is addressed to an account', () => {
  it('never names the raw shipper as the one to tell', () => {
    const files = readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    const sources = files.map((f) => readFileSync(join(__dirname, f), 'utf8'));
    // It read the module, not an empty folder.
    expect(sources.length).toBeGreaterThan(50);
    const raw = sources.flatMap((s, i) => (s.match(/posterDid:\s*\w+\.postedByDid\s*\?\?\s*\w+\.shipperDid/g) ?? []).map((m) => `${files[i]}: ${m}`));
    expect(raw).toEqual([]);
    // …and the notices that name a sender go through the one answer.
    expect(sources.join('\n').match(/senderDidOf\(f\)/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
  });
});
