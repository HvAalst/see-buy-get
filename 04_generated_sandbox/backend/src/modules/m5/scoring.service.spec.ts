import { ScoringService } from './scoring.service';
import { Rating, ReputationRecord, REPUTATION_PRIOR } from './reputation.types';

describe('ScoringService (M5-010..014)', () => {
  const scoring = new ScoringService();
  const now = Date.parse('2026-06-26T00:00:00.000Z');

  function record(role: 'carrier' | 'shipper', ratings: Rating[]): ReputationRecord {
    return { did: 'did:glos:c', role, ratings, dimensions: {}, composite: REPUTATION_PRIOR, confidenceInterval: 0, samples: 0, badges: [], disputes: [], sanction: 'none' };
  }
  const rating = (over: Partial<Rating>): Rating => ({ id: 'r', glosShipmentId: 's', raterDid: 'x', subjectDid: 'did:glos:c', subjectRole: 'carrier', scores: {}, weight: 1, at: '2026-06-26T00:00:00.000Z', ...over });

  it('starts at the neutral prior with a wide interval, narrowing as samples grow', () => {
    const r0 = record('carrier', []);
    scoring.recompute(r0, now);
    expect(r0.composite).toBe(REPUTATION_PRIOR);
    const wide = r0.confidenceInterval;

    const r5 = record('carrier', Array.from({ length: 5 }, () => rating({ scores: { onTime: 100, cargoCare: 100 } })));
    scoring.recompute(r5, now);
    expect(r5.confidenceInterval).toBeLessThan(wide); // M5-013 interval narrows
    expect(r5.composite).toBeGreaterThan(REPUTATION_PRIOR); // good ratings pull above prior
  });

  it('computes weighted dimension scores and a 0–5 composite (M5-010/011)', () => {
    const r = record('carrier', [rating({ scores: { onTime: 100, cargoCare: 50 } }), rating({ scores: { onTime: 100, cargoCare: 50 } })]);
    scoring.recompute(r, now);
    expect(r.dimensions.onTime?.value).toBe(100);
    expect(r.dimensions.cargoCare?.value).toBe(50);
    expect(r.composite).toBeGreaterThan(0);
    expect(r.composite).toBeLessThanOrEqual(5);
  });

  it('excludes on-time for force-majeure transactions (M5-014)', () => {
    const r = record('carrier', [rating({ scores: { onTime: 0 }, forceMajeure: true }), rating({ scores: { onTime: 100 } })]);
    scoring.recompute(r, now);
    expect(r.dimensions.onTime?.value).toBe(100); // the force-majeure late one is excluded
  });

  it('decays old ratings (M5-012)', () => {
    const old = rating({ scores: { onTime: 0 }, at: '2026-01-01T00:00:00.000Z' }); // ~half-life+ ago
    const fresh = rating({ scores: { onTime: 100 }, at: '2026-06-26T00:00:00.000Z' });
    const r = record('carrier', [old, fresh]);
    scoring.recompute(r, now);
    expect(r.dimensions.onTime!.value).toBeGreaterThan(50); // fresh good rating outweighs decayed bad one
  });
});
