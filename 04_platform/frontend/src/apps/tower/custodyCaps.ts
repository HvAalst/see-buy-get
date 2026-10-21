import type { MessageKey } from '../../shared/i18n';

/** Round 38 — the custody cap as typed on Rates & tax: two boxes for new shops, two for new independent riders. */
export interface CustodyCapsDraft {
  shopStart: string;
  shopLift: string;
  riderStart: string;
  riderLift: string;
}

type Cap = { start: number; liftedAfter: number };

/**
 * THE DRAFT AS THE SERVER READS IT. A kind with both boxes empty is not capped; one half filled, not whole numbers, a start
 * below one, or lifted sooner than it starts, is said — before anything is sent.
 */
export function custodyCapsBody(d: CustodyCapsDraft): { value?: { shop?: Cap; rider?: Cap }; error?: MessageKey } {
  const one = (start: string, lift: string): Cap | null | 'bad' => {
    const s = start.trim();
    const l = lift.trim();
    if (!s && !l) return null;
    if (!/^\d+$/.test(s) || !/^\d+$/.test(l)) return 'bad';
    const c = { start: Number(s), liftedAfter: Number(l) };
    return c.start >= 1 && c.liftedAfter >= c.start ? c : 'bad';
  };
  const shop = one(d.shopStart, d.shopLift);
  const rider = one(d.riderStart, d.riderLift);
  if (shop === 'bad' || rider === 'bad') return { error: 'tower.custodyCaps.bad' };
  return { value: { ...(shop ? { shop } : {}), ...(rider ? { rider } : {}) } };
}
