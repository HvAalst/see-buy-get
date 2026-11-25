/**
 * 2026-11-24 — WHICH OF OUR COMPANIES BOUGHT A STEP FROM A PARTNER, AND FOR HOW MUCH (route plan part 4; the owner: "we owe it
 * weekly"). A step in a Partnered country on parcels a company of ours sold — a hand-over sheet, a bag's road or its loading — is
 * paid by the partner to its hand, and owed to the partner by the company that sold each parcel, its share by its parcels. A
 * parcel the partner took in itself (no seller) is the partner's own: nobody of ours owes for it.
 */
export interface BoughtShare {
  entityId: string;
  amount: number;
}

/** The amount split by the sellers of the parcels in the unit, to the cent; nothing where no parcel was sold by us. */
export function splitBySeller(sellers: Array<string | undefined>, amount: number): BoughtShare[] | undefined {
  if (!(amount > 0) || !sellers.length) return undefined;
  const counts = new Map<string, number>();
  for (const s of sellers) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  if (!counts.size) return undefined;
  const cents = Math.round(amount * 100);
  const shares = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([entityId, n]) => ({ entityId, cents: Math.floor((cents * n) / sellers.length) }));
  // What the sellers owe in all is their parcels' share of the whole; the cent lost to rounding goes to the first.
  const owedCents = Math.round((cents * [...counts.values()].reduce((a, b) => a + b, 0)) / sellers.length);
  const lost = owedCents - shares.reduce((s, x) => s + x.cents, 0);
  if (lost > 0) shares[0].cents += lost;
  return shares.filter((s) => s.cents > 0).map((s) => ({ entityId: s.entityId, amount: s.cents / 100 }));
}
