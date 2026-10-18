/**
 * WHAT A TOP-UP WILL COST, WORKED OUT BEFORE IT IS PAID.
 *
 * The money model's own rule is to tell users what costs money, what is free, and why. A fee that is
 * only discovered afterwards in the register is the opaque deduction the whole design refuses — just
 * slower, and found by the person least able to do anything about it. So the shop app and the store app
 * both say it on the sheet, while an amount is being typed.
 *
 * ONE RULE IN ONE PLACE, and it mirrors `EntityService.topUpFeeFor` on the server deliberately: two
 * screens that each work the fee out for themselves are two screens that can each drift away from what
 * is actually charged, and a sheet that promises a fee the books do not post is worse than a silent one.
 * The server remains the authority — it charges on what ARRIVED, not on what was typed here — and this
 * is the forecast of it.
 */

/** What this sister charges to put money in. Both numbers in its own currency. */
export interface TopUpTerms {
  /** The flat charge below the threshold. */
  charge: number;
  /** Top up this much or more and it costs nothing. */
  freeAbove: number;
  currency?: string;
  /** The tax inside the charge, by its name, where the company charges one (its own, set by itself): said beside the figure. */
  taxLabel?: string;
}

/** What one particular amount will cost, and what will actually land. */
export interface TopUpCost {
  /** The charge on this amount. Zero once the threshold is reached. */
  fee: number;
  /**
   * What the balance actually rises by. The gross is credited and the fee charged as its own line, so
   * this is the two facts added up — stated here because otherwise every shopkeeper does the subtraction
   * themselves, and the ones who do not are the ones who wonder where the money went.
   */
  lands: number;
  /** How much more would make it free. Zero when it already is. */
  shortBy: number;
  free: boolean;
}

/**
 * The standing terms, or `null` where this sister charges nothing.
 *
 * NULL IS THE IMPORTANT ANSWER. Absent means no fee, and a screen must then say nothing at all: an
 * announcement that topping up is free, where no fee was ever decided, invents a charge in the reader's
 * mind in order to waive it. Half a rule — a threshold with no charge behind it, or the reverse — is
 * read as no rule for the same reason, because neither half can be charged on its own.
 */
export function topUpTermsOf(raw: unknown): TopUpTerms | null {
  const t = raw as Partial<TopUpTerms> | null | undefined;
  const charge = Number(t?.charge) || 0;
  const freeAbove = Number(t?.freeAbove) || 0;
  if (!(charge > 0) || !(freeAbove > 0)) return null;
  const currency = typeof t?.currency === 'string' && t.currency.trim() ? t.currency.trim() : undefined;
  const taxLabel = typeof t?.taxLabel === 'string' && t.taxLabel.trim() ? t.taxLabel.trim() : undefined;
  return { charge: round2(charge), freeAbove: round2(freeAbove), currency, ...(taxLabel ? { taxLabel } : {}) };
}

/**
 * What this amount will cost, or `null` while there is no amount worth costing yet.
 *
 * An empty box is not a free top-up, so it gets no verdict — the standing terms are what a screen shows
 * until a figure exists to apply them to.
 */
export function topUpCost(terms: TopUpTerms | null | undefined, amount: number): TopUpCost | null {
  if (!terms) return null;
  const paid = Number(amount);
  if (!Number.isFinite(paid) || paid <= 0) return null;
  // The boundary is the server's: "this much OR MORE is free", so reaching the threshold exactly is free.
  const free = paid >= terms.freeAbove;
  const fee = free ? 0 : terms.charge;
  return { fee, lands: round2(paid - fee), shortBy: free ? 0 : round2(terms.freeAbove - paid), free };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
