import type { Result, SbgClient } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

/**
 * A BUSINESS'S PARCELS (backend business-parcel.service.ts; the user, 2026-10-29: "Billed to the business"; "A prepaid
 * balance"). A business opens a parcel account — a balance with our company in its country, topped up by M-Pesa or bank —
 * and sends parcels from a shop to a shop, each paid from the balance when it is sent: no balance, no label. The receiver
 * collects with the code the business passes on; nobody texts them.
 */

export interface ParcelAccount {
  open: boolean;
  canOpen: boolean;
  whyNot?: string;
  balance?: number | null;
  company?: { name: string; currency: string };
  waiting?: { reference: string; amount: number; currency: string; openedAt: string; pushed?: boolean; instructions?: string };
  terms?: { freeAbove?: number; amount?: number };
  sent: number;
  unpaid: number;
  moving: number;
}

export interface ParcelEnd {
  did: string;
  name: string;
  zone: string;
}

export interface BusinessParcel {
  parcelId: string;
  status: string;
  paid: boolean;
  reference?: string;
  receiver: string;
  from?: ParcelEnd;
  to: ParcelEnd;
  size: string;
  cost?: number;
  currency: string;
  collectionCode?: string;
  trackingKey?: string;
  sentBy?: string;
  createdAt: string;
  returnParcelId?: string;
}

export interface BusinessParcelDetail extends BusinessParcel {
  weightKg?: number;
  fragile?: boolean;
  routeMode?: string;
  platformFee?: number;
  tax?: number;
  taxLabel?: string;
  declaredValue?: number;
  coverLimit?: number;
  steps: Array<{ at: string; status: string; note?: string }>;
}

export interface ParcelSent {
  parcel: BusinessParcelDetail;
  paid: boolean;
  balance?: number | null;
}

export interface ParcelBookLine {
  id: string;
  type: string;
  sign: '+' | '-';
  amount: number;
  currency: string;
  parcelId?: string;
  note?: string;
  at: string;
}

export interface ParcelCallOff {
  parcelId: string;
  outcome: 'refund' | 'bring_back' | 'pick' | 'to_door' | 'no';
  amount?: number;
  currency?: string;
  backTo?: string;
  why?: string;
  done?: boolean;
}

/** A shop on the network, as anybody may see it. */
export interface NetworkShop {
  did: string;
  shopName: string;
  zone: string;
  country?: string;
  openState?: string;
  takesNew?: boolean;
}

/** What a journey costs, as the public quote says it: the flexible route holds the most, the locked one the cheapest. */
export interface ParcelQuote {
  flexible: { gross: number };
  locked: { gross: number };
  currency: string;
  crossesBorder?: boolean;
  totalKm?: number;
}

export interface SendParcel {
  originPudoDid: string;
  destPudoDid: string;
  receiverMobile: string;
  dimensionsCm: { l: number; w: number; h: number };
  weightKg: number;
  contentPhotoRef: string;
  fragile?: boolean;
  reference?: string;
  routeMode?: 'flexible' | 'locked';
  expectedTotal?: number;
}

export interface ParcelsApi {
  account: () => Promise<Result<ParcelAccount>>;
  open: () => Promise<Result<ParcelAccount>>;
  topUp: (amount: number, phone?: string) => Promise<Result<ParcelAccount>>;
  list: (q?: { q?: string; status?: string; offset?: number }) => Promise<Result<{ items: BusinessParcel[]; total: number }>>;
  detail: (parcelId: string) => Promise<Result<BusinessParcelDetail>>;
  send: (body: SendParcel) => Promise<Result<ParcelSent>>;
  pay: (parcelId: string) => Promise<Result<ParcelSent>>;
  label: (parcelId: string) => Promise<Result<{ parcelId: string; svg: string; qrPayload: string }>>;
  book: () => Promise<Result<{ items: ParcelBookLine[]; total: number; balance?: number | null }>>;
  callOffPreview: (parcelId: string) => Promise<Result<ParcelCallOff>>;
  callOff: (parcelId: string, reason?: string) => Promise<Result<ParcelCallOff>>;
  shops: () => Promise<Result<NetworkShop[]>>;
  quote: (originDid: string, destDid: string, size: { l: number; w: number; h: number; kg: number }, fragile: boolean) => Promise<Result<ParcelQuote>>;
  /** A photograph of what is inside, kept with us as the business's own. */
  upload: (dataUrl: string, thumbDataUrl?: string) => Promise<Result<{ mediaId: string }>>;
}

export function parcelsApi(sbg: SbgClient): ParcelsApi {
  const call = <T>(fn: Parameters<SbgClient['request']>[0]) => sbg.request(fn) as unknown as Promise<Result<T>>;
  const id = (parcelId: string) => encodeURIComponent(parcelId);
  return {
    account: () => call((c) => c.GET('/v1/sbg/business/me/parcels/account' as never, {} as never) as never),
    open: () => call((c) => c.POST('/v1/sbg/business/me/parcels/account' as never, {} as never) as never),
    topUp: (amount, phone) => call((c) => c.POST('/v1/sbg/business/me/parcels/top-up' as never, { body: { amount, ...(phone?.trim() ? { phone: phone.trim() } : {}) } } as never) as never),
    list: (q = {}) =>
      call((c) =>
        c.GET('/v1/sbg/business/me/parcels' as never, { params: { query: { ...(q.q?.trim() ? { q: q.q.trim() } : {}), ...(q.status ? { status: q.status } : {}), limit: '50', offset: String(q.offset ?? 0) } } } as never) as never,
      ),
    detail: (parcelId) => call((c) => c.GET(`/v1/sbg/business/me/parcels/${id(parcelId)}` as never, {} as never) as never),
    send: (body) => call((c) => c.POST('/v1/sbg/business/me/parcels' as never, { body } as never) as never),
    pay: (parcelId) => call((c) => c.POST(`/v1/sbg/business/me/parcels/${id(parcelId)}/pay` as never, {} as never) as never),
    label: (parcelId) => call((c) => c.GET(`/v1/sbg/business/me/parcels/${id(parcelId)}/label` as never, {} as never) as never),
    book: () => call((c) => c.GET('/v1/sbg/business/me/parcels/book' as never, { params: { query: { limit: '50' } } } as never) as never),
    callOffPreview: (parcelId) => call((c) => c.GET(`/v1/sbg/business/me/parcels/${id(parcelId)}/call-off` as never, {} as never) as never),
    callOff: (parcelId, reason) => call((c) => c.POST(`/v1/sbg/business/me/parcels/${id(parcelId)}/call-off` as never, { body: reason?.trim() ? { reason: reason.trim() } : {} } as never) as never),
    shops: () => call((c) => c.GET('/v1/sbg/network/points' as never, {} as never) as never),
    upload: (dataUrl, thumbDataUrl) => call((c) => c.POST('/v1/sbg/media' as never, { body: { kind: 'content', dataUrl, ...(thumbDataUrl ? { thumbDataUrl } : {}) } } as never) as never),
    quote: (originDid, destDid, s, fragile) =>
      call((c) =>
        c.GET('/v1/sbg/quote' as never, { params: { query: { origin: originDid, dest: destDid, l: String(s.l), w: String(s.w), h: String(s.h), kg: String(s.kg), ...(fragile ? { fragile: 'true' } : {}) } } } as never) as never,
      ),
  };
}

/* ------------------------------------------------------------------ the form -- */

export interface ParcelForm {
  originDid: string;
  destDid: string;
  receiver: string;
  l: string;
  w: string;
  h: string;
  kg: string;
  fragile: boolean;
  reference: string;
  photoRef: string;
}

export const EMPTY_PARCEL: ParcelForm = { originDid: '', destDid: '', receiver: '', l: '', w: '', h: '', kg: '', fragile: false, reference: '', photoRef: '' };

const positive = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The measurements as numbers, once all four are there. */
export function parcelSize(f: ParcelForm): { l: number; w: number; h: number; kg: number } | null {
  const [l, w, h, kg] = [positive(f.l), positive(f.w), positive(f.h), positive(f.kg)];
  return l && w && h && kg ? { l, w, h, kg } : null;
}

/** What is still missing before it can be priced — in the order the form asks for it. */
export function parcelPriceGaps(f: ParcelForm, t: Translate): string[] {
  const gaps: string[] = [];
  if (!f.originDid) gaps.push(t('business.parcels.gap.from'));
  if (!f.destDid) gaps.push(t('business.parcels.gap.to'));
  if (f.originDid && f.originDid === f.destDid) gaps.push(t('business.parcels.gap.sameShop'));
  if (!parcelSize(f)) gaps.push(t('business.parcels.gap.size'));
  return gaps;
}

/** What is still missing before it can be sent. */
export function parcelSendGaps(f: ParcelForm, t: Translate): string[] {
  const gaps = parcelPriceGaps(f, t);
  if (f.receiver.replace(/\D/g, '').length < 9) gaps.push(t('business.parcels.gap.receiver'));
  if (!f.photoRef) gaps.push(t('business.parcels.gap.photo'));
  return gaps;
}

/** The body the server is sent, from a complete form and the price shown. */
export function sendBody(f: ParcelForm, expectedTotal: number | undefined): SendParcel | null {
  const s = parcelSize(f);
  if (!s || !f.originDid || !f.destDid || !f.photoRef) return null;
  return {
    originPudoDid: f.originDid,
    destPudoDid: f.destDid,
    receiverMobile: f.receiver.trim(),
    dimensionsCm: { l: s.l, w: s.w, h: s.h },
    weightKg: s.kg,
    contentPhotoRef: f.photoRef,
    ...(f.fragile ? { fragile: true } : {}),
    ...(f.reference.trim() ? { reference: f.reference.trim() } : {}),
    routeMode: 'flexible',
    ...(expectedTotal != null ? { expectedTotal } : {}),
  };
}

/** The shops a parcel can be handed in at or collected from: open to new parcels, in the business's own country. */
export function shopChoices(shops: NetworkShop[], country: string): NetworkShop[] {
  return shops.filter((s) => s.takesNew !== false && (!s.country || s.country === country)).sort((a, b) => a.shopName.localeCompare(b.shopName));
}

/* ---------------------------------------------------------------- the list -- */

export type ParcelStage = 'unpaid' | 'to_hand_in' | 'on_its_way' | 'to_collect' | 'collected' | 'called_off' | 'problem';

/** Where a parcel stands, in the words its sender reads. */
export function parcelStage(p: Pick<BusinessParcel, 'status' | 'paid'>): ParcelStage {
  if (p.status === 'Voided' || p.status === 'Returned') return 'called_off';
  if (p.status === 'Disputed' || p.status === 'Lost') return 'problem';
  if (!p.paid) return 'unpaid';
  if (p.status === 'Created') return 'to_hand_in';
  if (p.status === 'Ready_For_Pickup' || p.status === 'Unclaimed') return 'to_collect';
  if (p.status === 'Delivered') return 'collected';
  return 'on_its_way';
}

export const STAGE_WORD: Record<ParcelStage, MessageKey> = {
  unpaid: 'business.parcels.stage.unpaid',
  to_hand_in: 'business.parcels.stage.toHandIn',
  on_its_way: 'business.parcels.stage.onItsWay',
  to_collect: 'business.parcels.stage.toCollect',
  collected: 'business.parcels.stage.collected',
  called_off: 'business.parcels.stage.calledOff',
  problem: 'business.parcels.stage.problem',
};

export const STAGE_TONE: Record<ParcelStage, 'ok' | 'warn' | 'info' | 'quiet'> = {
  unpaid: 'warn',
  to_hand_in: 'info',
  on_its_way: 'info',
  to_collect: 'info',
  collected: 'ok',
  called_off: 'quiet',
  problem: 'warn',
};

/** A step of a parcel's journey, in the sender's words. */
export function stepWord(status: string): MessageKey {
  switch (status) {
    case 'CREATED':
      return 'business.parcels.step.made';
    case 'At_PUDO':
      return 'business.parcels.step.handedIn';
    case 'On_Bus':
      return 'business.parcels.step.onTheRoad';
    case 'At_MDP':
      return 'business.parcels.step.atHub';
    case 'Ready_For_Pickup':
      return 'business.parcels.step.ready';
    case 'Unclaimed':
      return 'business.parcels.step.unclaimed';
    case 'Delivered':
      return 'business.parcels.step.collected';
    case 'Voided':
      return 'business.parcels.step.calledOff';
    case 'Returned':
      return 'business.parcels.step.comingBack';
    case 'Disputed':
      return 'business.parcels.step.problem';
    case 'Lost':
      return 'business.parcels.step.lost';
    default:
      return 'business.parcels.step.other';
  }
}

/** A sum of money as the list says it. */
export function money(amount: number | null | undefined, currency: string | undefined): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

/** A line of the book, by what it was. */
export function bookWord(type: string): MessageKey {
  switch (type) {
    case 'TOP_UP':
      return 'business.parcels.book.topUp';
    case 'TOP_UP_FEE':
      return 'business.parcels.book.topUpFee';
    case 'BILLING':
      return 'business.parcels.book.billing';
    case 'REBATE':
      return 'business.parcels.book.rebate';
    case 'CLAIM':
      return 'business.parcels.book.claim';
    default:
      return 'business.parcels.book.other';
  }
}
