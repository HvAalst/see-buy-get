import { SanctionsScreeningService } from './sanctions.service';

describe('SanctionsScreeningService', () => {
  const service = new SanctionsScreeningService();

  it('clears an ordinary name', () => {
    expect(service.screen('Jane Doe').hit).toBe(false);
  });

  it('flags a denylisted name (case-insensitive, substring)', () => {
    const result = service.screen('Mr OFAC Test Person Jr');
    expect(result.hit).toBe(true);
    expect(result.matchedList).toBe('OFAC-SDN');
  });

  it('supports extending the denylist', () => {
    service.addDeniedTerm('evil corp', 'CUSTOM');
    expect(service.screen('Evil Corp Ltd').hit).toBe(true);
  });
});
