/**
 * A QUOTATION as the screens read it — the figure one party asked another to pay, the proforma, and open or paid.
 *
 * The user, 2026-10-04: "we don't manage the clearing agent's fee, but we do handle quotations for anyone. Like proforma
 * invoices are common so we have a field for it, but the user needs to confirm open/paid. That keeps all vital
 * information in one place." So nothing here is money we hold: "paid" is a party saying so, by name.
 */
export interface QuoteParty {
  name: string;
  entityId?: string;
  did?: string;
}

export interface QuoteEvent {
  at: string;
  by: string;
  what: 'quoted' | 'requoted' | 'proforma' | 'agreed' | 'paid' | 'open';
  note?: string;
}

export interface QuoteView {
  quoteId: string;
  subject: { kind: 'import' | 'freight' | 'booking' | 'export'; id: string; code?: string };
  issuer: QuoteParty;
  payer: QuoteParty;
  amount: number;
  currency: string;
  note?: string;
  reference?: string;
  proforma?: { fileName: string; contentType: string; size: number; fingerprint: string; addedBy: string; addedAt: string };
  agreedAt?: string;
  agreedBy?: string;
  status: 'open' | 'paid';
  paidAt?: string;
  paidBy?: string;
  paidReference?: string;
  history: QuoteEvent[];
  createdAt: string;
  createdBy: string;
}

/** "18,000 ETB" — the figure as it was quoted, never converted. */
export function quoteFigure(q: Pick<QuoteView, 'amount' | 'currency'>): string {
  return `${q.amount.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${q.currency}`;
}

/** How a quotation reads in a list: settled once a party said so, otherwise still somebody's to pay. */
export function quoteTone(q: Pick<QuoteView, 'status'> | null | undefined): 'ok' | 'warn' | 'quiet' {
  if (!q) return 'quiet';
  return q.status === 'paid' ? 'ok' : 'warn';
}

/** A three-letter currency, the server's own test. */
export function currencyReady(value: string): boolean {
  return /^[A-Za-z]{3}$/.test(value.trim());
}
