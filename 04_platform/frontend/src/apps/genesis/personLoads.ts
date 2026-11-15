import type { SbgClient } from '../../lib/sbg';
import type { MessageKey } from '../../shared/i18n';
import { EMPTY_WORK, workBlocker, workBody, type LoadWorkForm, type LoadWorkView } from '../../shared/loadWork';

/**
 * 2026-11-13 — A PERSON POSTS A LOAD (unusual loads, U5; part 3a): something too big for a shop, posted for drivers to name a
 * price on, and the person chooses one. Where SeeBuyGet only matches, the person pays the driver directly; where a company of
 * ours takes the money, the server says paying up front is coming. The form here, the request, and the person's own loads.
 */
export interface Place {
  label: string;
  pin: { lat: number; lng: number } | null;
}

export interface PersonLoadForm {
  description: string;
  weightKg: string;
  from: Place;
  to: Place;
  contactPhone: string;
  note: string;
  work: LoadWorkForm;
}

export const EMPTY_PERSON_LOAD = (phone = ''): PersonLoadForm => ({ description: '', weightKg: '', from: { label: '', pin: null }, to: { label: '', pin: null }, contactPhone: phone, note: '', work: EMPTY_WORK });

/** What still needs saying, in the order the form asks it — or null. */
export function personLoadBlocker(f: PersonLoadForm): MessageKey | null {
  if (f.description.trim().length < 3) return 'send.load.needWhat';
  const kg = Number(f.weightKg.replace(',', '.'));
  if (!(kg > 0 && kg <= 40000)) return 'send.load.needKg';
  if (!f.from.pin || f.from.label.trim().length < 2) return 'send.load.needFrom';
  if (!f.to.pin || f.to.label.trim().length < 2) return 'send.load.needTo';
  if (!f.contactPhone.trim()) return 'send.load.needPhone';
  return workBlocker(f.work);
}

/** The request: only what was said. A person names no rate — the server makes it negotiated. */
export function personLoadBody(f: PersonLoadForm) {
  const work = workBody(f.work);
  return {
    description: f.description.trim(),
    weightKg: Number(f.weightKg.replace(',', '.')),
    pickupLabel: f.from.label.trim(),
    pickupLocation: f.from.pin!,
    destLabel: f.to.label.trim(),
    destLocation: f.to.pin!,
    contactPhone: f.contactPhone.trim(),
    ...(f.note.trim() ? { instructions: f.note.trim() } : {}),
    ...(work ? { work } : {}),
  };
}

/** One of the person's loads, as the posted list says it. */
export interface PersonLoadRow {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  status: string;
  commitMode?: string;
  currency?: string;
  openProposals?: number;
  work?: LoadWorkView;
  /** 2026-11-13 — paid first to SeeBuyGet and held until delivery (part 3b); its delivery code; a price being paid. */
  escrow?: boolean;
  deliveryCode?: string;
  awaitingPayment?: string;
  /** 2026-11-15 — delivered: the driver's pay held until, whether a problem can still be reported, what was decided. */
  heldUntil?: string;
  canReport?: boolean;
  reported?: boolean;
  holdWords?: string;
}

/** A driver's price on it, and the person's price back where they gave one. */
export interface LoadOffer {
  proposalId: string;
  price: number;
  note?: string;
  status: string;
  counter?: { price: number; note?: string };
  /** What the person pays for it, all in (a load paid first), and whether the driver took their price back. */
  charge?: number;
  counterTaken?: string;
}

/** The person's payment for a load paid first. */
export interface LoadPaymentView {
  state: 'awaiting' | 'paid' | 'lapsed' | 'refunded' | 'delivered' | 'reversed';
  amount: number;
  currency: string;
  price: number;
  until: string;
  phoneMasked: string;
  instructions?: string;
  reference?: string;
  pushed?: boolean;
  owedBack?: number;
}

export function personLoadApi(sbg: SbgClient) {
  return {
    post: (body: ReturnType<typeof personLoadBody>) => sbg.request((c) => c.POST('/v1/sbg/dispatch/freight', { body: body as never })),
    mine: () => sbg.request((c) => c.GET('/v1/sbg/dispatch/posted', {})),
    offers: (freightId: string) => sbg.request((c) => c.GET('/v1/sbg/dispatch/freight/{id}/proposals', { params: { path: { id: freightId } } })),
    accept: (proposalId: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/proposals/{id}/accept', { params: { path: { id: proposalId } } })),
    decline: (proposalId: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/proposals/{id}/decline', { params: { path: { id: proposalId } } })),
    counter: (proposalId: string, price: number) => sbg.request((c) => c.POST('/v1/sbg/dispatch/proposals/{id}/counter', { params: { path: { id: proposalId } }, body: { price } })),
    // 2026-11-13 — a load paid first (part 3b): pay to accept, read the payment, say it arrived.
    pay: (freightId: string, proposalId: string, phone: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/pay', { params: { path: { id: freightId } }, body: { proposalId, phone } })),
    payment: (freightId: string) => sbg.request((c) => c.GET('/v1/sbg/dispatch/freight/{id}/payment', { params: { path: { id: freightId } } })),
    arrived: (freightId: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/arrived', { params: { path: { id: freightId } } })),
  };
}
