import { describe, expect, it } from 'vitest';
import {
  EMPTY_ACCEPT,
  acceptMissing,
  canAccept,
  destinationZones,
  gateNotice,
  handoverSummary,
  homeSummary,
  money,
  otpValid,
  priceBand,
  releaseStage,
  roundMoney,
  statusNotice,
} from './logic';
import type { AgentView, Benchmark, CorridorRow, GateView } from './types';

const agent = (over: Partial<AgentView> = {}): AgentView => ({
  agentId: 'ag_1',
  did: 'did:glos:agent:1',
  shopName: 'Mama Njeri',
  zone: 'Z-A',
  openState: 'open',
  pricePerParcel: 1.5,
  status: 'ACTIVE',
  balance: 20,
  ...over,
});

const gate = (over: Partial<GateView> = {}): GateView => ({ ok: true, balance: 20, ...over });

describe('gateNotice', () => {
  it('is silent while the gate is open', () => {
    expect(gateNotice(agent(), gate())).toBeNull();
  });

  it('a locked account outranks a thin wallet', () => {
    const n = gateNotice(agent({ status: 'LOCKED' }), gate({ ok: false, code: 'AGENT_LOCKED', balance: -3 }));
    expect(n?.tone).toBe('danger');
    expect(n?.title).toBe('Account locked');
  });

  it('a thin wallet names the exact top-up needed', () => {
    const n = gateNotice(agent(), gate({ ok: false, code: 'WALLET_INSUFFICIENT', balance: 0.4, shortfall: 4.6 }));
    expect(n?.tone).toBe('warn');
    expect(n?.detail).toContain('4.60');
  });

  it('canAccept follows the gate alone', () => {
    expect(canAccept(gate())).toBe(true);
    expect(canAccept(gate({ ok: false }))).toBe(false);
    expect(canAccept(null)).toBe(false);
  });
});

describe('statusNotice', () => {
  it('active and locked shops get no onboarding notice', () => {
    expect(statusNotice('ACTIVE')).toBeNull();
    expect(statusNotice('LOCKED')).toBeNull(); // locked is the gate's story, not onboarding's
  });
  it('a draft shop is told the office must activate it', () => {
    expect(statusNotice('KYC_PENDING')).toContain('kyc pending');
  });
});

describe('destinationZones', () => {
  const corridors: CorridorRow[] = [
    { corridorId: 'c1', name: 'A→B', originZone: 'Z-A', destZone: 'Z-B', status: 'active' },
    { corridorId: 'c2', name: 'A→C', originZone: 'Z-A', destZone: 'Z-C', status: 'active' },
    { corridorId: 'c3', name: 'B→A', originZone: 'Z-B', destZone: 'Z-A', status: 'active' },
    { corridorId: 'c4', name: 'A→D', originZone: 'Z-A', destZone: 'Z-D', status: 'paused' },
    { corridorId: 'c5', name: 'A→B dup', originZone: 'Z-A', destZone: 'Z-B', status: 'active' },
  ];

  it('keeps only active corridors leaving my zone, deduplicated', () => {
    expect(destinationZones(corridors, 'Z-A')).toEqual(['Z-B', 'Z-C']);
  });

  it('is empty without corridors or a zone', () => {
    expect(destinationZones(null, 'Z-A')).toEqual([]);
    expect(destinationZones(corridors, undefined)).toEqual([]);
  });
});

describe('acceptMissing', () => {
  it('walks the counter flow in order', () => {
    expect(acceptMissing(EMPTY_ACCEPT)).toContain('sticker');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1' })).toContain('size');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', size: 'M' })).toContain('going');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', size: 'M', destZone: 'Z-B' })).toContain('photo');
    expect(acceptMissing({ ...EMPTY_ACCEPT, parcelId: 'P-1', size: 'M', destZone: 'Z-B', photoRef: 'p.jpg' })).toBeNull();
  });
});

describe('releaseStage', () => {
  it('maps parcel status to the release step', () => {
    expect(releaseStage('On_Bus')).toBe('arrive');
    expect(releaseStage('Ready_For_Pickup')).toBe('otp');
    expect(releaseStage('Delivered')).toBe('rate');
    expect(releaseStage('At_MDP')).toBe('blocked');
    expect(releaseStage('Voided')).toBe('blocked');
  });
});

describe('otpValid', () => {
  it('accepts exactly four digits', () => {
    expect(otpValid('0042')).toBe(true);
    expect(otpValid(' 1234 ')).toBe(true);
    expect(otpValid('123')).toBe(false);
    expect(otpValid('12345')).toBe(false);
    expect(otpValid('12a4')).toBe(false);
  });
});

describe('priceBand', () => {
  const bm: Benchmark = { count: 8, median: 2, p25: 1.5, p75: 2.5, min: 1, max: 3 };

  it('needs a usable benchmark', () => {
    expect(priceBand(1.5, null)).toBeNull();
    expect(priceBand(1.5, { ...bm, count: 0 })).toBeNull();
  });

  it('reads above / below / at with a ±1% dead zone', () => {
    expect(priceBand(2.5, bm)?.headline).toContain('25% more');
    expect(priceBand(1.5, bm)?.headline).toContain('25% less');
    expect(priceBand(2.01, bm)?.showMatch).toBe(false);
  });

  it('the match price is money-rounded exactly as it will be PATCHed', () => {
    const b = priceBand(3, { ...bm, median: 1.999 });
    expect(b?.matchPrice).toBe(2);
    expect(roundMoney(1.006)).toBe(1.01);
    expect(roundMoney(2.994)).toBe(2.99);
  });
});

describe('speaking', () => {
  it('money always carries two decimals', () => {
    expect(money(5)).toBe('5.00');
    expect(money(undefined)).toBe('0.00');
  });

  it('home summary reads the gate and the closed state', () => {
    expect(homeSummary(agent({ balance: 12.5, openState: 'closed' }), gate({ ok: false }))).toBe(
      'Wallet balance 12.50. Top up to accept parcels. Your shop is marked closed.',
    );
  });

  it('handover summary counts the waiting and the chosen', () => {
    expect(handoverSummary(0, 0)).toContain('No parcels');
    expect(handoverSummary(3, 2)).toContain('3 parcels');
  });
});
