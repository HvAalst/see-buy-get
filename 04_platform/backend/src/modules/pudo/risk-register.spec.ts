import { RISK_REVIEW_DAYS, RiskRegisterService, threatsWords } from './risk-register.service';

const DAY = 86_400_000;
// 10:00 in Nairobi (UTC+3): day.
const noon = Date.parse('2026-10-21T07:00:00.000Z');

/**
 * Round 39 — THE RISK REGISTER (the user: "Staff rate, high asks seals"): corridors and hubs rated per threat, looked at again
 * each quarter; an incident proposes a raise and a person decides; high asks for a coded seal, and no night running.
 */
describe('the risk register', () => {
  let risk: RiskRegisterService;
  const id = () => `x-${Math.random()}`;
  beforeEach(() => {
    risk = new RiskRegisterService();
  });

  it('is rated by somebody, per threat, and looked at again within a quarter', () => {
    const hub = id();
    const r = risk.rate('hub', hub, 'pilferage', 'medium', ' Grace ', 'Two cut wraps in a month', noon);
    expect(r).toMatchObject({ level: 'medium', ratedBy: 'Grace', why: 'Two cut wraps in a month', reviewBy: new Date(noon + RISK_REVIEW_DAYS * DAY).toISOString() });
    expect(risk.levelOf('hub', hub, 'unrest')).toBeUndefined();
    expect(risk.highThreats('hub', hub)).toEqual([]);
    risk.rate('hub', hub, 'unrest', 'high', 'Grace', undefined, noon);
    expect(risk.highThreats('hub', hub)).toEqual(['unrest']);
    expect(() => risk.rate('hub', hub, 'weather' as never, 'high', 'Grace')).toThrow(/Say which threat/);
    expect(() => risk.rate('hub', hub, 'unrest', 'extreme' as never, 'Grace')).toThrow(/low, medium or high/);
    expect(() => risk.rate('hub', hub, 'unrest', 'low', '  ')).toThrow(/Say who is rating it/);
  });

  it('takes an incident as a proposal one step up, and a person decides it', () => {
    const corridor = id();
    const first = risk.propose('corridor', corridor, 'pilferage', 'Bag B-1: wrap cut, found at Central Sort', 'B-1', noon)!;
    expect(first).toMatchObject({ to: 'medium', state: 'open', because: 'Bag B-1: wrap cut, found at Central Sort' });
    expect(first.from).toBeUndefined();
    // A second incident while one waits: the one waiting stands.
    expect(risk.propose('corridor', corridor, 'pilferage', 'Bag B-2', 'B-2', noon)!.proposalId).toBe(first.proposalId);
    expect(() => risk.decide(first.proposalId, false, 'Amina')).toThrow(/Say why it stays as it is/);
    const kept = risk.decide(first.proposalId, false, 'Amina', 'One cut wrap, found and sealed at once', noon);
    expect(kept).toMatchObject({ state: 'declined', reason: 'One cut wrap, found and sealed at once', decidedBy: 'Amina' });
    expect(risk.levelOf('corridor', corridor, 'pilferage')).toBeUndefined();
    // Again, and this time raised: medium, then high.
    const again = risk.propose('corridor', corridor, 'pilferage', 'Bag B-3: seal number not as written', 'B-3', noon)!;
    risk.decide(again.proposalId, true, 'Amina', undefined, noon);
    expect(risk.levelOf('corridor', corridor, 'pilferage')).toBe('medium');
    expect(risk.propose('corridor', corridor, 'pilferage', 'Bag B-4', 'B-4', noon)!.to).toBe('high');
    // Rated high by hand: the proposal is answered, and nothing more is proposed.
    risk.rate('corridor', corridor, 'pilferage', 'high', 'Brian', 'Hijack attempt reported by the fleet', noon);
    expect(risk.openProposals().filter((p) => p.id === corridor)).toEqual([]);
    expect(risk.propose('corridor', corridor, 'pilferage', 'Bag B-5', 'B-5', noon)).toBeUndefined();
    expect(() => risk.decide(again.proposalId, true, 'Amina')).toThrow(/accepted already/);
  });

  it('proposes from tampering: the hub where it was found, the corridor of whoever carried it', () => {
    const hub = id();
    const corridor = id();
    risk.registerCorridorOf((did) => (did === 'did:driver:moto' ? corridor : undefined));
    const made = risk.proposeFromTamper({ hubMdpId: hub, carrierDid: 'did:driver:moto', because: 'Bag B-9: wrap cut, found at Central Sort', ref: 'B-9' }, noon);
    expect(made.map((p) => [p.subject, p.id, p.threat, p.to])).toEqual([
      ['hub', hub, 'pilferage', 'medium'],
      ['corridor', corridor, 'pilferage', 'medium'],
    ]);
    expect(risk.proposeFromTamper({ carrierDid: 'did:driver:nobody', because: 'x', ref: 'y' }, noon)).toEqual([]);
  });

  it('knows night by the country’s own clock: from 19:00 until 06:00', () => {
    expect(risk.isNight('KE', Date.parse('2026-10-21T15:59:00.000Z'))).toBe(false); // 18:59 in Nairobi
    expect(risk.isNight('KE', Date.parse('2026-10-21T16:00:00.000Z'))).toBe(true); // 19:00
    expect(risk.isNight('KE', Date.parse('2026-10-22T02:59:00.000Z'))).toBe(true); // 05:59
    expect(risk.isNight('KE', Date.parse('2026-10-22T03:00:00.000Z'))).toBe(false); // 06:00
  });

  it('asks a high hub for a coded seal, and loads nothing there at night', () => {
    const hub = { mdpId: id(), name: 'Central Sort' };
    risk.rate('hub', hub.mdpId, 'pilferage', 'medium', 'Grace', undefined, noon);
    expect(() => risk.assertHubSeal(hub, { photoRef: 'p' } as never)).not.toThrow();
    risk.rate('hub', hub.mdpId, 'pilferage', 'high', 'Grace', undefined, noon);
    expect(() => risk.assertHubSeal(hub, undefined)).toThrow('Central Sort is rated high for pilferage: a bag leaves it only on a coded seal. Put one on, and photograph it.');
    expect(() => risk.assertHubSeal(hub, { seal: 'KE-0042' })).not.toThrow();
    expect(() => risk.assertHubDay(hub, 'KE', noon)).not.toThrow();
    expect(() => risk.assertHubDay(hub, 'KE', Date.parse('2026-10-21T20:00:00.000Z'))).toThrow(/nothing is loaded there between 19:00 and 06:00/);
  });

  it('asks a high corridor for parcels in a sealed bag, and nothing at night', () => {
    const corridor = { corridorId: id(), name: 'Nairobi–Nakuru' };
    expect(() => risk.assertCorridorAllows(corridor, { loose: true, country: 'KE' }, noon)).not.toThrow();
    risk.rate('corridor', corridor.corridorId, 'hijacking', 'high', 'Brian', undefined, noon);
    risk.rate('corridor', corridor.corridorId, 'extortion', 'high', 'Brian', undefined, noon);
    expect(() => risk.assertCorridorAllows(corridor, { loose: true, country: 'KE' }, noon)).toThrow('Nairobi–Nakuru is rated high for hijacking and roadblock extortion: parcels travel on it only in a bag closed on a coded seal. Bag them, and seal the bag.');
    expect(() => risk.assertCorridorAllows(corridor, { bagSealed: false, country: 'KE' }, noon)).toThrow(/this one was closed with a photograph/);
    expect(() => risk.assertCorridorAllows(corridor, { bagSealed: true, country: 'KE' }, noon)).not.toThrow();
    expect(() => risk.assertCorridorAllows(corridor, { bagSealed: true, country: 'KE' }, Date.parse('2026-10-21T17:30:00.000Z'))).toThrow(/nothing goes onto it between 19:00 and 06:00/);
    expect(() => risk.assertCorridorAllows(undefined, { loose: true }, noon)).not.toThrow();
  });

  it('says threats as a sentence says them', () => {
    expect(threatsWords(['pilferage'])).toBe('pilferage');
    expect(threatsWords(['pilferage', 'unrest', 'extortion'])).toBe('pilferage, unrest and roadblock extortion');
  });
});
