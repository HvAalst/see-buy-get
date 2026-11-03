import type { NewLoad } from './api';
import { isColdNature, isDangerousNature, loadGaps, nextDay, type LoadForm } from './logic';

/*
 * 2026-11-03 — POSTING A LOAD, ONE STEP AT A TIME (the owner: "the 'post a new load' is a pretty large page. It is in my
 * opinion better if we chunk it up similar to the sign up process. And an indicator shows how far we are before a load
 * goes public. That would enable us to use a slightly larger font size and more white space").
 *
 * What the screens ask is what the one page asked, answer for answer, and the request it sends is the one that page
 * sent (loadBody below is that page's own, moved here so the two can be held side by side in a test). What is new is
 * only the order of asking, the check before it goes out, and a half-filled load kept on the phone so a phone call
 * does not lose it.
 */

/** Every answer a new load has, as the screens hold them: strings as typed, the ticks, and the choices. */
export type PostForm = LoadForm & {
  volumeM3: string;
  truckFlight: boolean;
  flightAwb: string;
  flightNo: string;
  flightAirline: string;
  declaredValue: string;
  specialInterest: string;
  valueCurrency: string;
  noTranshipment: boolean;
  coverRequired: boolean;
  consigneeName: string;
  consigneeAddress: string;
  unNumber: string;
  properShippingName: string;
  hazardClass: string;
  packingGroup: string;
  customsInstructions: string;
  receiverRef: string;
  packaging: string;
  packages: string;
  destCountry: string;
  natureCode: string;
  fragile: boolean;
  commitMode: 'negotiate' | 'instant';
  instructions: string;
  contactName: string;
  contactPhone: string;
  deliveryWindow: string;
  pickupOn: string;
  forClientId: string;
  contractId: string;
  deliverOn: string;
  orderRef: string;
  /** 2026-11-03 — fresh or frozen food: the lowest and the highest it is kept at, in °C, as typed. Both empty is 2–8 °C. */
  tempMinC: string;
  tempMaxC: string;
};

export const EMPTY_POST: PostForm = { volumeM3: '', truckFlight: false, flightAwb: '', flightNo: '', flightAirline: '', declaredValue: '', specialInterest: '', valueCurrency: '', noTranshipment: false, coverRequired: false, consigneeName: '', consigneeAddress: '', unNumber: '', properShippingName: '', hazardClass: '', packingGroup: '', customsInstructions: '', description: '', fromSiteId: '', toSiteId: '', receivingPoint: '', receiverRef: '', weightKg: '', packaging: '', packages: '', destCountry: '', natureCode: 'GEN', fragile: false, commitMode: 'negotiate', instructions: '', contactName: '', contactPhone: '', deliveryWindow: '', pickupOn: '', forClientId: '', contractId: '', deliverOn: '', orderRef: '', tempMinC: '', tempMaxC: '' };

/** A new load's first answers, as the one page had them: going within the business's own country, arriving tomorrow. */
export const startForm = (country: string, now: Date = new Date()): PostForm => ({ ...EMPTY_POST, destCountry: country, deliverOn: nextDay(now) });

/**
 * THE STEPS, in the order they are asked.
 *
 * From and to comes before what it is, unlike the brief's first sketch, for one reason in the rules: across a border the
 * note counts the packages (loadGaps), and whether it crosses is where it goes — asked first, the packages are asked for
 * on the step that has them, never found missing later. It is also the order the page's own lede said it in ("Where it
 * is, where it goes, and what it is") and the help's.
 *
 * `carrier` is there only where there is a choice to make: a contract to order under, or a client to send for. Under a
 * contract there is no `when`: the fleet plans when it collects, and the day it must arrive — with the hours it can be
 * delivered — is asked with the contract, where it decides which contracts can take it.
 */
export type PostStep = 'carrier' | 'route' | 'goods' | 'when' | 'value' | 'day' | 'check';
export type PostAt = PostStep | 'done';

export interface PostKind {
  /** A contract it could be ordered under, or a client it could be sent for: the first step has something to ask. */
  choice: boolean;
  /** Ordered under a contract. */
  contract: boolean;
}

export function postSteps(k: PostKind): PostStep[] {
  return [...(k.choice || k.contract ? (['carrier'] as const) : []), 'route', 'goods', ...(k.contract ? [] : (['when'] as const)), 'value', 'day', 'check'];
}

/** Where Back goes: the step before. None from the first (its way out is leaving the load for now) or from done. */
export function postBack(step: PostAt, steps: PostStep[]): PostStep | null {
  if (step === 'done') return null;
  const at = steps.indexOf(step);
  return at <= 0 ? null : steps[at - 1];
}

/** Where Next goes. */
export function postNext(step: PostStep, steps: PostStep[]): PostStep {
  const at = steps.indexOf(step);
  return steps[Math.min(at + 1, steps.length - 1)] ?? 'check';
}

/** A step kept from earlier that this load no longer has (a contract gone since) opens as the first that it has. */
export function stepIn(step: PostAt | undefined, steps: PostStep[]): PostStep {
  return step && step !== 'done' && steps.includes(step) ? step : steps[0];
}

/**
 * WHICH ANSWER IS ON WHICH STEP. What the screens draw on each — the test fills the steps through this, so an answer the
 * one page had and no step asks for cannot hide. The hours it can be delivered go with the contract's day for an order.
 */
export function postFields(step: PostStep, contract: boolean): Array<keyof PostForm> {
  switch (step) {
    case 'carrier':
      return ['forClientId', 'contractId', 'deliverOn', 'orderRef', ...(contract ? (['deliveryWindow'] as const) : [])];
    case 'route':
      return ['fromSiteId', 'toSiteId', 'receivingPoint', 'receiverRef', 'destCountry', 'consigneeName', 'consigneeAddress', 'customsInstructions'];
    case 'goods':
      return ['description', 'natureCode', 'unNumber', 'hazardClass', 'properShippingName', 'packingGroup', 'tempMinC', 'tempMaxC', 'weightKg', 'packaging', 'packages', 'volumeM3', 'fragile'];
    case 'when':
      return ['pickupOn', 'deliveryWindow'];
    case 'value':
      return ['declaredValue', 'specialInterest', 'valueCurrency', 'noTranshipment', 'coverRequired', 'commitMode', 'truckFlight', 'flightAwb', 'flightNo', 'flightAirline'];
    case 'day':
      return ['instructions', 'contactName', 'contactPhone'];
    case 'check':
      return [];
  }
}

/**
 * WHAT A STEP STILL NEEDS. The page's own rules (loadGaps), each said on the step that asks for it — and those the page
 * left to the browser's own popup or to the server, said here in words beside the field instead: an order's day, missing
 * or gone (the date box's `min`, and the server's "Say which day it must arrive"); the space it takes, more than nothing
 * and at most 150 m³ (the box's `min`/`max`, and the server's); and a collection day gone, which the server would quietly
 * turn into "as soon as a carrier can". With a load kept on the phone for days, a day that has gone is likely.
 */
export type PostGap = keyof LoadForm | 'deliverOn' | 'deliverOnGone' | 'pickupOnGone' | 'volumeM3' | TempGap;

/** 2026-11-03 — a temperature range given for fresh or frozen food: one end without the other, past -30 or 30, or upside down. */
export type TempGap = 'tempRange' | 'tempBounds' | 'tempOrder';

const GAP_STEP: Record<PostGap, PostStep> = {
  description: 'goods',
  fromSiteId: 'route',
  toSiteId: 'route',
  weightKg: 'goods',
  receivingPoint: 'route',
  crossing: 'route',
  consigneeName: 'route',
  consigneeAddress: 'route',
  natureCode: 'goods',
  packaging: 'goods',
  packages: 'goods',
  unNumber: 'goods',
  properShippingName: 'goods',
  hazardClass: 'goods',
  declaredValue: 'value',
  specialInterest: 'value',
  valueCurrency: 'value',
  deliverOn: 'carrier',
  deliverOnGone: 'carrier',
  pickupOnGone: 'when',
  volumeM3: 'goods',
  tempRange: 'goods',
  tempBounds: 'goods',
  tempOrder: 'goods',
};

export interface PostCtx {
  /** It goes to another country than the business's own. */
  crossing: boolean;
  /** Ordered under a contract. */
  contract: boolean;
  /** Today, YYYY-MM-DD, in the reader's own calendar. */
  today: string;
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Everything still needed: the order's day first, then the page's own rules in their order, then what was the browser's. */
export function postGaps(form: PostForm, ctx: PostCtx): PostGap[] {
  const gaps: PostGap[] = [];
  if (ctx.contract) {
    if (!isDay(form.deliverOn)) gaps.push('deliverOn');
    else if (form.deliverOn < ctx.today) gaps.push('deliverOnGone');
  }
  gaps.push(...loadGaps({ ...form, crossing: ctx.crossing }));
  const m3 = Number(form.volumeM3);
  if (form.volumeM3.trim() && !(m3 >= 0.01 && m3 <= 150)) gaps.push('volumeM3');
  gaps.push(...tempGaps(form));
  if (!ctx.contract && form.pickupOn && form.pickupOn < ctx.today) gaps.push('pickupOnGone');
  return gaps;
}

/** The coldest and warmest that can be asked, in °C — the server's own bounds (as the air export and import have them). */
export const TEMP_LIMIT_C = 30;

/**
 * 2026-11-03 — WHAT A TEMPERATURE RANGE STILL NEEDS, said in words beside it rather than by the server: both ends or
 * neither (neither keeps the usual 2–8 °C), each within -30 to 30 °C, and the lowest below the highest — the server's
 * own rules (heavy-cargo.ts, tempRangeGap). Asked of fresh or frozen food only; on other goods nothing is asked or sent.
 */
export function tempGaps(form: Pick<PostForm, 'natureCode' | 'tempMinC' | 'tempMaxC'>): TempGap[] {
  if (!isColdNature(form.natureCode)) return [];
  const lo = form.tempMinC.trim();
  const hi = form.tempMaxC.trim();
  if (!lo && !hi) return [];
  if (!lo || !hi || !Number.isFinite(Number(lo)) || !Number.isFinite(Number(hi))) return ['tempRange'];
  if (Math.abs(Number(lo)) > TEMP_LIMIT_C || Math.abs(Number(hi)) > TEMP_LIMIT_C) return ['tempBounds'];
  if (!(Number(lo) < Number(hi))) return ['tempOrder'];
  return [];
}

/** The range it is kept in, as it is sent: only for fresh or frozen food, only once both ends are given and right. */
export function tempRangeOf(form: Pick<PostForm, 'natureCode' | 'tempMinC' | 'tempMaxC'>): { minC: number; maxC: number } | null {
  if (!isColdNature(form.natureCode) || !form.tempMinC.trim() || !form.tempMaxC.trim() || tempGaps(form).length) return null;
  return { minC: Number(form.tempMinC), maxC: Number(form.tempMaxC) };
}

/** What this step still needs: only its own — a step never stops on another's answer. */
export function stepGaps(step: PostStep, form: PostForm, ctx: PostCtx): PostGap[] {
  return step === 'check' ? postGaps(form, ctx) : postGaps(form, ctx).filter((g) => GAP_STEP[g] === step);
}

export const gapStep = (gap: PostGap): PostStep => GAP_STEP[gap];

/** The words a gap is said in, beside its field. */
export const gapWords = (gap: PostGap): string => (gap === 'deliverOn' || gap === 'deliverOnGone' || gap === 'pickupOnGone' || gap === 'volumeM3' || gap === 'tempRange' || gap === 'tempBounds' || gap === 'tempOrder' ?`business.post.need.${gap}` : `business.loads.need.${gap}`);

/** A place a load is collected from or delivered to, as the board and the consignment note carry it. */
export interface LoadEnd {
  name: string;
  location: { lat: number; lng: number };
}

/** The two ends, from the business's saved places — or, to another business's receiving point, that point. */
export function loadEnds(sites: Array<LoadEnd & { siteId: string }>, form: Pick<PostForm, 'fromSiteId' | 'toSiteId'>, receiving: { name: string; siteName: string; location: { lat: number; lng: number } } | null): { from: LoadEnd; to: LoadEnd } | null {
  const from = sites.find((s) => s.siteId === form.fromSiteId);
  const to = receiving ? { name: `${receiving.name} — ${receiving.siteName}`, location: receiving.location } : sites.find((s) => s.siteId === form.toSiteId);
  return from && to ? { from, to } : null;
}

/**
 * THE REQUEST, as the one page built it — moved here unchanged, key for key in the same order (the test compares the two
 * byte for byte). `receiving` is the receiving point looked up by its code; `contract` the one it is ordered under.
 *
 * 2026-11-03 — one key more than the page sent, and only when it is given: the range fresh or frozen food is kept in.
 * A load without one is the page's request still, byte for byte.
 */
export function loadBody(form: PostForm, at: { country: string; from: LoadEnd; to: LoadEnd; receiving: { code: string } | null; contract: { contractId: string } | null }): NewLoad {
  const { from, to, receiving, contract } = at;
  const packages = Number(form.packages);
  const counted = Number.isInteger(packages) && packages >= 1 && packages <= 500 ? packages : undefined;
  // Across a border the consignment note asks more of the form (the CMR check, 2026-10-28).
  const crossing = Boolean(form.destCountry && form.destCountry !== at.country);
  const dangerous = isDangerousNature(form.natureCode);
  const kept = tempRangeOf(form);
  return {
    description: form.description.trim(),
    pickupLabel: from.name,
    pickupLocation: from.location,
    destLabel: to.name,
    destLocation: to.location,
    // A business sends from its own country; where the goods go is its choice, and a crossing is asked of a known one.
    pickupCountry: at.country,
    destCountry: form.destCountry || at.country,
    weightKg: Number(form.weightKg),
    ...(form.packaging ? { packaging: form.packaging } : {}),
    ...(counted ? { packages: counted } : {}),
    natureCode: form.natureCode,
    ...(form.consigneeName.trim() && !receiving ? { consignee: { name: form.consigneeName.trim(), ...(form.consigneeAddress.trim() ? { address: form.consigneeAddress.trim() } : {}) } } : {}),
    ...(dangerous ? { dangerousGoods: { unNumber: form.unNumber.trim(), properShippingName: form.properShippingName.trim(), hazardClass: form.hazardClass.trim(), ...(form.packingGroup ? { packingGroup: form.packingGroup } : {}) } } : {}),
    ...(kept ? { tempRange: kept } : {}),
    ...(crossing && form.customsInstructions.trim() ? { customsInstructions: form.customsInstructions.trim() } : {}),
    fragile: form.fragile,
    ...(form.coverRequired ? { coverRequired: true } : {}),
    ...(Number(form.declaredValue) > 0 && form.valueCurrency ? { declaredValue: { amount: Number(form.declaredValue), currency: form.valueCurrency } } : {}),
    ...(Number(form.specialInterest) > 0 && form.valueCurrency ? { specialInterest: { amount: Number(form.specialInterest), currency: form.valueCurrency } } : {}),
    ...(form.noTranshipment ? { noTranshipment: true } : {}),
    ...(Number(form.volumeM3) > 0 ? { volumeM3: Number(form.volumeM3) } : {}),
    ...(form.truckFlight && form.flightAwb.trim() && form.flightNo.trim() ? { truckFlight: { awb: form.flightAwb.trim(), flight: form.flightNo.trim(), ...(form.flightAirline.trim() ? { airline: form.flightAirline.trim() } : {}) } } : {}),
    commitMode: form.commitMode,
    ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
    ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
    ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
    ...(form.deliveryWindow.trim() ? { deliveryWindow: form.deliveryWindow.trim() } : {}),
    ...(form.pickupOn && !contract ? { scheduledPickupAt: new Date(`${form.pickupOn}T08:00:00`).toISOString() } : {}),
    ...(form.forClientId ? { forClientId: form.forClientId } : {}),
    // To another business's receiving point: it sees the load coming in, and its own number for the order with it.
    ...(receiving ? { receivingPoint: receiving.code, ...(form.receiverRef.trim() ? { receiverRef: form.receiverRef.trim() } : {}) } : {}),
    // Under a contract: the day it must arrive, and no pickup date of our own — the fleet plans when it collects.
    ...(contract ? { contractId: contract.contractId, deliverOn: form.deliverOn, ...(form.orderRef.trim() ? { orderRef: form.orderRef.trim() } : {}) } : {}),
  };
}

/** How a load is sent: the business's saved places read afresh, and the one request. */
export interface SendIo {
  sites: () => Promise<{ data?: { sites?: Array<LoadEnd & { siteId: string }> } | null; error?: unknown }>;
  post: (body: NewLoad) => Promise<{ data?: { freightId: string; code: string; status: string; scheduledPickupAt?: string } | null; error?: { detail?: string; title?: string } | null }>;
}

export type Sent = { posted: { freightId: string; code: string; status: string; scheduledPickupAt?: string } } | { refused: 'gaps' } | { refused: 'placeGone' } | { refused: 'server'; error: string | null };

/**
 * POST THE LOAD — the one way a load leaves the phone, from the last step's button only. It refuses before it writes
 * anything while an answer is missing; reads the two places afresh (a place deleted since is said so, never sent as
 * nothing); sends the page's own request; and forgets the load kept on the phone once the server has it — not before,
 * so a refusal or a dropped signal leaves it there to try again.
 */
export async function sendLoad(io: SendIo, form: PostForm, at: { country: string; ctx: PostCtx; receiving: (ReceivingAt & { code: string }) | null; contract: { contractId: string } | null; owner: string; store?: Store | null }): Promise<Sent> {
  if (postGaps(form, at.ctx).length) return { refused: 'gaps' };
  // The two ends are saved places: their name and point are what the board and the consignment note carry.
  const r = await io.sites();
  const ends = loadEnds(r.data?.sites ?? [], form, at.receiving);
  if (!ends) return { refused: 'placeGone' };
  const sent = await io.post(loadBody(form, { country: at.country, ...ends, receiving: at.receiving, contract: at.contract }));
  if (sent.error || !sent.data) return { refused: 'server', error: sent.error?.detail || sent.error?.title || null };
  dropLoadDraft(at.owner, at.store === undefined ? local() : at.store);
  return { posted: sent.data };
}

/** A receiving point as its code names it: whose, which of its places, and where. */
type ReceivingAt = { name: string; siteName: string; location: { lat: number; lng: number } };

/** Today, YYYY-MM-DD, in the reader's own calendar — the day a date box offers first. */
export function todayIn(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The collection day given: posted, it waits off the board until 08:00 that day (the server's own scheduled pickup). */
export function waitsUntil(form: Pick<PostForm, 'pickupOn'>, contract: boolean, now: number = Date.now()): string | null {
  if (contract || !form.pickupOn) return null;
  return new Date(`${form.pickupOn}T08:00:00`).getTime() > now ? form.pickupOn : null;
}

/* ------------------------------------------------------------------------------------- the load kept on the phone -- */

/**
 * 2026-11-03 — A HALF-FILLED LOAD IS KEPT ON THE PHONE, so a phone call does not lose it (the owner's brief). Only what
 * the person typed and where they were: never anything the server said — a receiving point's name is looked up again by
 * its code when the load is carried on, so this app still keeps no copy of its data (keeps-no-data.test.ts). Per
 * business and per person; three days at most; dropped once posted, once started again, and at sign-out.
 */
export interface LoadDraft {
  step: PostStep;
  form: PostForm;
  /** Delivered to another business by the code it gave, and the code as typed. */
  toReceiver: boolean;
  typedCode: string;
  savedAt: number;
}

export const DRAFT_KEEP_MS = 3 * 24 * 3600 * 1000;
const PREFIX = 'sbg-load-draft:';
const STEPS: readonly PostStep[] = ['carrier', 'route', 'goods', 'when', 'value', 'day', 'check'];

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function local(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whose load it is: the business, and the person in it. */
export const draftOwner = (entityId: string, memberId: string) => `${entityId}:${memberId}`;

/** Something was typed or chosen: a load nobody has started is not kept. */
export function draftTouched(d: Pick<LoadDraft, 'form' | 'toReceiver' | 'typedCode'>, start: PostForm): boolean {
  if (d.toReceiver || d.typedCode.trim()) return true;
  return (Object.keys(start) as Array<keyof PostForm>).some((k) => d.form[k] !== start[k]);
}

export function keepLoadDraft(owner: string, d: Omit<LoadDraft, 'savedAt'>, now: number = Date.now(), store: Store | null = local()): void {
  if (!store || !owner) return;
  try {
    // The receiving point's code is the person's own typing, kept as typed; what it named is asked again.
    store.setItem(PREFIX + owner, JSON.stringify({ step: d.step, form: { ...d.form, receivingPoint: '' }, toReceiver: d.toReceiver, typedCode: d.typedCode, savedAt: now } satisfies LoadDraft));
  } catch {
    /* full, or blocked: the load is still on the screen */
  }
}

/** The load kept for this person, if one is — and none older than three days, which is forgotten as it is read. */
export function keptLoadDraft(owner: string, now: number = Date.now(), store: Store | null = local()): LoadDraft | null {
  if (!store || !owner) return null;
  try {
    const raw = store.getItem(PREFIX + owner);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<LoadDraft> | null;
    if (!d || typeof d.savedAt !== 'number' || !d.form || typeof d.form !== 'object' || now - d.savedAt > DRAFT_KEEP_MS || d.savedAt > now + 60_000) {
      store.removeItem(PREFIX + owner);
      return null;
    }
    // Only the answers this version asks, each of the kind it is: a load kept by an older version opens with what still fits.
    const form = { ...EMPTY_POST };
    for (const k of Object.keys(EMPTY_POST) as Array<keyof PostForm>) {
      const v = (d.form as unknown as Record<string, unknown>)[k];
      if (typeof v === typeof EMPTY_POST[k]) (form as unknown as Record<string, unknown>)[k] = v;
    }
    if (form.commitMode !== 'negotiate' && form.commitMode !== 'instant') form.commitMode = 'negotiate';
    form.receivingPoint = '';
    return { step: STEPS.includes(d.step as PostStep) ? (d.step as PostStep) : 'route', form, toReceiver: d.toReceiver === true, typedCode: typeof d.typedCode === 'string' ? d.typedCode : '', savedAt: d.savedAt };
  } catch {
    return null;
  }
}

export function dropLoadDraft(owner: string, store: Store | null = local()): void {
  if (!store || !owner) return;
  try {
    store.removeItem(PREFIX + owner);
  } catch {
    /* blocked: nothing was kept */
  }
}

/** At sign-out: every load kept on this phone, whoever's — the next person to sign in here is somebody else. */
export function dropLoadDrafts(store: Store | null = local()): void {
  if (!store) return;
  try {
    const mine: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX)) mine.push(k);
    }
    for (const k of mine) store.removeItem(k);
  } catch {
    /* blocked: nothing was kept */
  }
}
