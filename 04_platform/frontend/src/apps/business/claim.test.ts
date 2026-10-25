import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { CLAIM_KINDS, CLAIM_KIND_KEYS, claimLine, claimReady, claimStanding, type LoadClaim } from './claim';

/**
 * A PROBLEM WITH THE GOODS DELIVERED, from the business that sent them: where it stands for a claim, what a claim says in a
 * line, and when one can be sent — the same rule the counter and the server keep (the risk-bearer claims; with no trade
 * term, the sender).
 */
describe('a business’s claim on its delivered load', () => {
  const claim = (over: Partial<LoadClaim>): LoadClaim => ({ state: 'resolved', kind: 'damaged', description: 'Two bags split', raisedAt: '2026-10-25T10:00:00Z', ...over });

  it('stands nowhere before delivery; a claim made is said; the receiver claims under a term that passed the risk; else the window', () => {
    expect(claimStanding({ status: 'in_transit', canClaim: false })).toBeNull();
    expect(claimStanding({ status: 'delivered', claim: claim({}), canClaim: false })).toEqual({ kind: 'made', claim: claim({}) });
    expect(claimStanding({ status: 'delivered', claimant: 'receiver', canClaim: true })).toEqual({ kind: 'receiver_claims' });
    expect(claimStanding({ status: 'delivered', claimant: 'sender', canClaim: true })).toEqual({ kind: 'may_claim' });
    expect(claimStanding({ status: 'delivered', canClaim: true })).toEqual({ kind: 'may_claim' });
    expect(claimStanding({ status: 'delivered', canClaim: false })).toEqual({ kind: 'window_closed' });
  });

  it('says a claim in a line: waiting, the report made, or decided', () => {
    expect(claimLine(claim({ state: 'open' })).key).toBe('business.claim.line.open');
    expect(claimLine(claim({ decision: 'report_only' })).key).toBe('business.claim.line.report');
    expect(claimLine(claim({ decision: 'upheld' })).key).toBe('business.claim.line.upheld');
    expect(claimLine(claim({ decision: 'partly_upheld' })).key).toBe('business.claim.line.partly');
    expect(claimLine(claim({ decision: 'rejected' })).key).toBe('business.claim.line.rejected');
    const line = claimLine(claim({ decision: 'report_only', kind: 'short' }));
    expect(t(line.key, { kind: t(CLAIM_KIND_KEYS[line.kind]), when: '25 Oct 2026', note: '' })).toMatch(/^Claim \(Short: some of it is missing\), 25 Oct 2026: the damage claim report was made/);
  });

  it('sends a claim only with what is wrong and a few words of what was found', () => {
    expect(claimReady({ kind: '', text: 'Two bags split' })).toBe(false);
    expect(claimReady({ kind: 'damaged', text: '  a ' })).toBe(false);
    expect(claimReady({ kind: 'damaged', text: 'Two bags split' })).toBe(true);
    for (const k of CLAIM_KINDS) expect(t(CLAIM_KIND_KEYS[k])).not.toBe(CLAIM_KIND_KEYS[k]);
  });
});
