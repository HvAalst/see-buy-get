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
  /** Where drivers collect its parcels: one of its own places (2026-10-29). */
  collection?: ParcelCollection;
}

export interface ParcelCollection {
  siteId?: string;
  label: string;
  zone: string;
  bays: number;
  since: string;
}

/** The day's bagging at its own place. */
export interface DockView {
  collection: ParcelCollection;
  groups: Array<{ zone: string; parcels: BusinessParcel[]; openBagCode?: string }>;
  bags: Array<{ code: string; destination?: string; parcelIds: string[]; fillPct: number; status: string }>;
  capacity: number;
  used: number;
}

/** The form's way of saying "collected from its own place" where a shop would be chosen. */
export const OWN_PLACE = 'own';

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
  /** Collected by a driver from its own place. */
  fromOwnPlace?: boolean;
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
  /** pick: its own place, which it can come back to. */
  door?: string;
  /** to_door: the most we suggest allowing a driver. */
  suggestedMax?: number;
  loadCode?: string;
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
  originPudoDid?: string;
  fromOwnPlace?: boolean;
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
  callOffPreview: (parcelId: string, backTo?: 'door') => Promise<Result<ParcelCallOff>>;
  callOff: (parcelId: string, reason?: string, choice?: { backTo?: 'door'; maxSpend?: number }) => Promise<Result<ParcelCallOff>>;
  /** What it costs from a shop or from its own place (`own`), before anything is sent. */
  price: (origin: string, dest: string, size: { l: number; w: number; h: number; kg: number }, fragile: boolean) => Promise<Result<{ flexible: number; locked: number; currency: string; crossesBorder: boolean }>>;
  collectFrom: (siteId: string, bays?: number) => Promise<Result<ParcelAccount>>;
  stopCollecting: () => Promise<Result<ParcelAccount>>;
  dock: () => Promise<Result<DockView>>;
  openBag: (destZone: string) => Promise<Result<DockView>>;
  fillBag: (code: string, parcelId: string) => Promise<Result<DockView>>;
  sealBag: (code: string, closure: { seal?: string; photoRef: string }) => Promise<Result<DockView>>;
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
    callOffPreview: (parcelId, backTo) => call((c) => c.GET(`/v1/sbg/business/me/parcels/${id(parcelId)}/call-off` as never, { params: { query: backTo ? { backTo } : {} } } as never) as never),
    callOff: (parcelId, reason, choice = {}) =>
      call((c) => c.POST(`/v1/sbg/business/me/parcels/${id(parcelId)}/call-off` as never, { body: { ...(reason?.trim() ? { reason: reason.trim() } : {}), ...(choice.backTo ? { backTo: choice.backTo } : {}), ...(choice.maxSpend != null ? { maxSpend: choice.maxSpend } : {}) } } as never) as never),
    price: (origin, dest, s, fragile) =>
      call((c) => c.GET('/v1/sbg/business/me/parcels/price' as never, { params: { query: { origin, dest, l: String(s.l), w: String(s.w), h: String(s.h), kg: String(s.kg), ...(fragile ? { fragile: 'true' } : {}) } } } as never) as never),
    collectFrom: (siteId, bays) => call((c) => c.POST('/v1/sbg/business/me/parcels/collect-from' as never, { body: { siteId, ...(bays ? { bays } : {}) } } as never) as never),
    stopCollecting: () => call((c) => c.DELETE('/v1/sbg/business/me/parcels/collect-from' as never, {} as never) as never),
    dock: () => call((c) => c.GET('/v1/sbg/business/me/parcels/dock' as never, {} as never) as never),
    openBag: (destZone) => call((c) => c.POST('/v1/sbg/business/me/parcels/dock/bags' as never, { body: { destZone } } as never) as never),
    fillBag: (code, parcelId) => call((c) => c.POST(`/v1/sbg/business/me/parcels/dock/bags/${encodeURIComponent(code)}/parcels` as never, { body: { parcelId } } as never) as never),
    sealBag: (code, closure) => call((c) => c.POST(`/v1/sbg/business/me/parcels/dock/bags/${encodeURIComponent(code)}/seal` as never, { body: { closure } } as never) as never),
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
  if (f.originDid && f.originDid !== OWN_PLACE && f.originDid === f.destDid) gaps.push(t('business.parcels.gap.sameShop'));
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
    // Collected from its own place, or handed in at a shop.
    ...(f.originDid === OWN_PLACE ? { fromOwnPlace: true } : { originPudoDid: f.originDid }),
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

export type ParcelStage = 'unpaid' | 'to_hand_in' | 'at_your_place' | 'on_its_way' | 'to_collect' | 'collected' | 'called_off' | 'problem';

/** Where a parcel stands, in the words its sender reads. */
export function parcelStage(p: Pick<BusinessParcel, 'status' | 'paid' | 'fromOwnPlace'>): ParcelStage {
  if (p.status === 'Voided' || p.status === 'Returned') return 'called_off';
  if (p.status === 'Disputed' || p.status === 'Lost') return 'problem';
  if (!p.paid) return 'unpaid';
  // Collected from its own place: it waits there for its bag and a driver, not for a trip to a shop.
  if (p.status === 'Created') return p.fromOwnPlace ? 'at_your_place' : 'to_hand_in';
  if (p.status === 'Ready_For_Pickup' || p.status === 'Unclaimed') return 'to_collect';
  if (p.status === 'Delivered') return 'collected';
  return 'on_its_way';
}

export const STAGE_WORD: Record<ParcelStage, MessageKey> = {
  unpaid: 'business.parcels.stage.unpaid',
  to_hand_in: 'business.parcels.stage.toHandIn',
  at_your_place: 'business.parcels.stage.atYourPlace',
  on_its_way: 'business.parcels.stage.onItsWay',
  to_collect: 'business.parcels.stage.toCollect',
  collected: 'business.parcels.stage.collected',
  called_off: 'business.parcels.stage.calledOff',
  problem: 'business.parcels.stage.problem',
};

export const STAGE_TONE: Record<ParcelStage, 'ok' | 'warn' | 'info' | 'quiet'> = {
  unpaid: 'warn',
  to_hand_in: 'info',
  at_your_place: 'info',
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
