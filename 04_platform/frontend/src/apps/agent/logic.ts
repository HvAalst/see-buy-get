/**
 * Pure agent domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested,
 * because these lines decide whether a shopkeeper may take a parcel (and someone's money).
 *
 * The gate messaging and the price-vs-market maths are harvested from the legacy agent.js
 * so the PWA and the old page can never disagree about what "locked" or "12% above" means.
 *
 * Prose is threaded through `t` (the translate function from useT()/the plain t) so this module
 * stays pure and testable — English is the base catalog, so a test passing the real `t` sees the
 * English literals. Enumerated presentation (status/size/nature/…) resolves catalog keys via `t`.
 */

import { distanceLabel, haversineKm, type GeoPoint } from '../../shared/geo';
import type { MessageKey, Translate } from '../../shared/i18n';
import { cash } from '../../shared/money';
import type { AgentStatus, AgentView, Benchmark, CorridorRow, GateView, NetworkPoint, ParcelSize, ParcelStatus, ParcelView, TakeInTerms } from './types';

/* ---------------------------------------------------------- take-in terms -- */

export interface TermsNotice {
  tone: 'info' | 'warn' | 'danger';
  icon: 'wallet' | 'warning';
  title: string;
  detail: string;
}

/**
 * P3 — the words the counter reads out BEFORE the goods are accepted: whose promise, who answers, the cover.
 * Worded from the server's answer, never recomputed here, so the screen and the claim that may follow
 * cannot name two different promises.
 */
export function takeInTermsNotice(terms: TakeInTerms, t: Translate): TermsNotice {
  const country = terms.jurisdiction || '—';
  if (terms.promise === 'none') {
    return { tone: 'danger', icon: 'warning', title: t('agent.accept.termsNoneTitle'), detail: t('agent.accept.termsNoneDetail', { country }) };
  }
  if (terms.promise === 'theirs') {
    return { tone: 'warn', icon: 'warning', title: t('agent.accept.termsTheirsTitle'), detail: t('agent.accept.termsTheirsDetail', { country }) };
  }
  const sister = terms.answeredBy ?? t('agent.accept.termsOursUs');
  // P4 — said in the same breath: the work is owed, but it cannot be paid out in this country yet.
  const unpaid = terms.paidOut ? '' : ` ${t('agent.accept.termsOwedNotPaid', { country })}`;
  // NOTHING COVERS IT. The company carries the parcel and keeps the record; it pays no claim from its own books
  // (the user, 2026-10-12). That is a risk the CUSTOMER takes, so it is said as a warning and has to be said to them
  // — before the goods are accepted, not on the day something breaks. It used to read "Covered by …, a claim is
  // decided case by case", which promised a decision nobody will make.
  if (terms.coverBasis === 'no-stated-limit') {
    return { tone: 'warn', icon: 'warning', title: t('agent.accept.termsNoCoverTitle', { sister }), detail: t('agent.accept.termsOursNoLimit', { sister }) + unpaid };
  }
  const money = { sister, amount: terms.coverLimit.toFixed(2), currency: terms.currency };
  const detail = terms.coverBasis === 'declared' ? t('agent.accept.termsOursDeclared', money) : t('agent.accept.termsOursLimit', money);
  return { tone: 'info', icon: 'wallet', title: t('agent.accept.termsOursTitle', { sister }), detail: detail + unpaid };
}

/**
 * Whether the customer has to be TOLD the terms before the goods are accepted, and the shopkeeper has to say they
 * were: where the carrier answers and not us, and where a company of ours carries the parcel and covers nothing.
 */
export function termsNeedTelling(terms: TakeInTerms | null): boolean {
  if (!terms) return false;
  return terms.promise === 'theirs' || (terms.promise === 'ours' && terms.coverBasis === 'no-stated-limit');
}

/**
 * Why a take-in may not be confirmed YET on account of its terms — or null. A shopkeeper cannot consent to a
 * risk the screen never named, so terms still loading or failed to load block exactly like a refusal does,
 * and the carrier's promise needs the customer told, not just the screen shown.
 */
export function termsBlock(terms: TakeInTerms | null, loadState: 'idle' | 'loading' | 'ready' | 'error', told: boolean, t: Translate): string | null {
  if (loadState === 'error') return t('agent.accept.termsFailed');
  if (!terms || loadState !== 'ready') return t('agent.accept.termsChecking');
  if (terms.promise === 'none') return t('agent.accept.termsNoneTitle');
  if (terms.promise === 'theirs' && !told) return t('agent.accept.termsTickFirst');
  // Nothing of ours covers it: the customer is told before the goods change hands, as for the carrier's promise.
  if (termsNeedTelling(terms) && !told) return t('agent.accept.termsTickFirst');
  return null;
}

/* ------------------------------------------------------------------- gate -- */

export interface GateNotice {
  tone: 'warn' | 'danger';
  title: string;
  detail: string;
}

/**
 * What the shopkeeper is told when the wallet gate says no. The legacy page had one
 * sentence for both cases; the S4 error contract gives us the machine code, so a locked
 * account and a thin wallet get their own words (and their own icons upstream).
 */
export function gateNotice(agent: Pick<AgentView, 'status' | 'kycRejection'> | null, gate: GateView | null, t: Translate): GateNotice | null {
  if (!agent || !gate || gate.ok) return null;
  // Held over its national ID: said as what it is. Topping up would not open the counter, so it must not be asked for.
  if (gate.code === 'ID_HELD') return { tone: 'danger', title: t('agent.logic.gateIdHeldTitle'), detail: t('agent.logic.gateIdHeldDetail') };
  // NOT YET THROUGH THE DOOR IS NOT "LOCKED". A new shop was shown "Account locked — top up your wallet to start
  // accepting parcels AGAIN" under the request for its papers: money asked for before anybody had agreed to anything,
  // in words for a shop that had been open. What it is waiting on is said once, by papersStep.
  if (papersStep(agent)) return null;
  if (agent.status === 'LOCKED' || gate.code === 'AGENT_LOCKED') {
    return {
      tone: 'danger',
      title: t('agent.logic.gateLockedTitle'),
      detail: t('agent.logic.gateLockedDetail'),
    };
  }
  return {
    tone: 'warn',
    title: t('agent.logic.gateLowTitle'),
    detail:
      gate.shortfall && gate.shortfall > 0
        ? t('agent.logic.gateLowShortfall', { amount: money(gate.shortfall, gate.currency) })
        : t('agent.logic.gateLowDetail'),
  };
}

/** Accepting is possible only when the gate says so — every accept costs wallet money. */
export function canAccept(gate: GateView | null): boolean {
  return Boolean(gate?.ok);
}

/**
 * WHERE A SHOP STANDS BEFORE IT CAN TAKE A PARCEL, AND WHOSE MOVE IT IS.
 *
 * A new shop was shown "Your shop is draft. SeeBuyGet must activate it" — the name of a state, and a sentence that
 * put the next step on us. It was the shop's: three photographs nobody had asked it for, on a screen that had no way
 * to send them. So each step here says who acts: `send` (the shop, with the reason when its papers came back),
 * `with_staff` (us — and nothing for the shop to do), `pay_in` (the shop again). Null once it is through.
 */
export type PapersStep = { kind: 'send'; refusedWhy?: string } | { kind: 'with_staff' } | { kind: 'pay_in' };
export function papersStep(agent: { status: AgentStatus; kycRejection?: { reason: string } } | null | undefined): PapersStep | null {
  if (!agent) return null;
  if (agent.status === 'DRAFT') {
    // Quoted inside a sentence on the screen, so without the full stop its writer may have ended it on.
    const why = agent.kycRejection?.reason?.trim().replace(/[.\s]+$/, '');
    return why ? { kind: 'send', refusedWhy: why } : { kind: 'send' };
  }
  if (agent.status === 'KYC_PENDING') return { kind: 'with_staff' };
  if (agent.status === 'APPROVED_UNFUNDED') return { kind: 'pay_in' };
  return null;
}

/** Nothing is sent until all three are there: a shop told "something is missing" has to guess which. */
export function papersReady(papers: { idCopy: string; licence: string; shopFront: string }): boolean {
  return Boolean(papers.idCopy && papers.licence && papers.shopFront);
}

/* ------------------------------------------------------------------ money -- */

/**
 * Money is always shown with two decimals — a shopkeeper reconciles against this figure — and in the money the
 * server named for it (the shop's company's, or the books a line was posted to). Without one, the bare number: what
 * a price box holds, and what is shown where nothing says which money it is.
 */
export function money(v: number | null | undefined, currency?: string): string {
  return cash(v, currency);
}

/* ------------------------------------------------------------------ shelf -- */

/** Mirror of the backend SHELF_COLORS (pudo.config.ts) — the colour a column gets, so the client draws the
 *  same "Green-3" grid the server labels. Presentation only; the server stays authoritative on real slots. */
export const SHELF_COLORS = ['Red', 'Orange', 'Amber', 'Green', 'Teal', 'Blue', 'Indigo', 'Violet', 'Pink', 'Brown'];

/**
 * WHERE EACH PARCEL OUT OF A BAG GOES — one line per slot, in the order somebody walks a shelf: column by
 * column (a column is a colour), top row first. Several small parcels given the same slot share a line.
 *
 * A bag is opened with five parcels in it and the app said "5 parcels shelved". Which of them in which slot was
 * known to the server and shown to nobody, and a parcel in the wrong slot is a customer sent to an empty one.
 */
export function putAwayList(shelved: Array<{ parcelId: string; slot: string }>): Array<{ slot: string; parcelIds: string[] }> {
  const place = (slot: string) => {
    const [colour, row] = slot.split('-');
    const column = SHELF_COLORS.indexOf(colour);
    return (column < 0 ? SHELF_COLORS.length : column) * 1000 + (Number(row) || 0);
  };
  const bySlot = new Map<string, string[]>();
  for (const s of shelved) if (s.slot) bySlot.set(s.slot, [...(bySlot.get(s.slot) ?? []), s.parcelId]);
  return [...bySlot.entries()].sort((a, b) => place(a[0]) - place(b[0])).map(([slot, parcelIds]) => ({ slot, parcelIds }));
}

/** The put-away list, read out: "Red 2: parcel …. Amber 1: parcels … and …." */
export function putAwayAloud(list: Array<{ slot: string; parcelIds: string[] }>, t: Translate): string {
  return [t('agent.receivebag.putAwayTitle') + '.', ...list.map((row) => `${row.slot.replace('-', ' ')}: ${row.parcelIds.join(', ')}.`)].join(' ');
}

/** A shelf must hold at least this many slots (mirrors the backend MIN_SLOTS). */
export const MIN_SHELF_SLOTS = 6;

/** Floor room for outbound BAGS — what a shop that has never said gets, and the ceiling it can declare
 *  (mirrors the backend DEFAULT_BAG_BAYS / MAX_BAG_BAYS). The server stays authoritative. */
export const DEFAULT_BAG_BAYS = 2;
export const MAX_BAG_BAYS = 20;

/** The current grid's dimensions, read back from its slots (max row/col), or null for an empty grid. */
export function gridDims(slots: ReadonlyArray<{ row: number; col: number }> | undefined): { rows: number; cols: number } | null {
  if (!slots || !slots.length) return null;
  return { rows: Math.max(...slots.map((s) => s.row)), cols: Math.max(...slots.map((s) => s.col)) };
}

/* ------------------------------------------------------------------ zones -- */

/** Destinations this shop can send toward: active corridors leaving the shop's zone. */
export function destinationZones(corridors: CorridorRow[] | null, myZone: string | undefined): string[] {
  if (!corridors || !myZone) return [];
  return [...new Set(corridors.filter((c) => c.originZone === myZone && c.status === 'active').map((c) => c.destZone))];
}

/* ----------------------------------------------------------------- accept -- */

/** Plain-language size tiers for a low-literacy counter, resolved through `t`. */
const SIZE_KEYS: Record<ParcelSize, { labelKey: MessageKey; hintKey: MessageKey }> = {
  S: { labelKey: 'agent.size.s.label', hintKey: 'agent.size.s.hint' },
  M: { labelKey: 'agent.size.m.label', hintKey: 'agent.size.m.hint' },
  L: { labelKey: 'agent.size.l.label', hintKey: 'agent.size.l.hint' },
  HEAVY: { labelKey: 'agent.size.heavy.label', hintKey: 'agent.size.heavy.hint' },
};

/** The commodity's primary cargo nature (S30). Plain-language labels for a low-literacy counter; the code
 *  drives the backend compatibility matrix (e.g. cement powder never rides with fresh food). GEN is default. */
export type CargoNature = 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
export const NATURES: Array<{ key: CargoNature; labelKey: MessageKey; detailKey: MessageKey }> = [
  { key: 'GEN', labelKey: 'agent.nature.gen', detailKey: 'agent.nature.genWhy' },
  { key: 'FOD', labelKey: 'agent.nature.fod', detailKey: 'agent.nature.fodWhy' },
  { key: 'FOP', labelKey: 'agent.nature.fop', detailKey: 'agent.nature.fopWhy' },
  { key: 'FRG', labelKey: 'agent.nature.frg', detailKey: 'agent.nature.frgWhy' },
  { key: 'ODR', labelKey: 'agent.nature.odr', detailKey: 'agent.nature.odrWhy' },
  { key: 'HUM', labelKey: 'agent.nature.hum', detailKey: 'agent.nature.humWhy' },
  { key: 'HAZ-CHEM', labelKey: 'agent.nature.hazChem', detailKey: 'agent.nature.hazChemWhy' },
  { key: 'HAZ-DUST', labelKey: 'agent.nature.hazDust', detailKey: 'agent.nature.hazDustWhy' },
  { key: 'HAZ-BIO', labelKey: 'agent.nature.hazBio', detailKey: 'agent.nature.hazBioWhy' },
  { key: 'HAZ-FLAM', labelKey: 'agent.nature.hazFlam', detailKey: 'agent.nature.hazFlamWhy' },
];

/** Plain words for a cargo nature code (falls back to the raw code for an unknown one). */
export function natureLabel(code: string, t: Translate): string {
  const n = NATURES.find((x) => x.key === code);
  return n ? t(n.labelKey) : code;
}

/** F3 — the durable dry commodities a consolidation lot may hold (grain/dry food, general goods, cement/
 *  powder). Perishables are excluded — they book freight directly; the backend enforces the same via tempBand,
 *  this is the curated on-screen subset. */
export const DURABLE_NATURES: CargoNature[] = ['GEN', 'FOD', 'HAZ-DUST'];

/** F3 — a lot's fill progress for the UI: the accumulated vs target weight with a clamped percentage. */
export function consignmentProgress(lot: { weightKg: number; targetKg: number }): { pct: number; label: string } {
  const pct = lot.targetKg > 0 ? Math.min(100, Math.max(0, Math.round((lot.weightKg / lot.targetKg) * 100))) : 0;
  return { pct, label: `${lot.weightKg} / ${lot.targetKg} kg` };
}

/** REP2 — the driver failings an agent can flag alongside the star rating, in plain words (the movement
 *  leg the shop actually witnesses). Keys mirror the backend DRIVER_ISSUES. */
export const DRIVER_ISSUE_LABELS: Array<{ key: string; labelKey: MessageKey }> = [
  { key: 'LATE_PICKUP', labelKey: 'agent.driverIssue.latePickup' },
  { key: 'LATE_ARRIVAL', labelKey: 'agent.driverIssue.lateArrival' },
  { key: 'KEPT_OVERNIGHT', labelKey: 'agent.driverIssue.keptOvernight' },
  { key: 'AFTER_HOURS', labelKey: 'agent.driverIssue.afterHours' },
  { key: 'EQUIPMENT_FAILURE', labelKey: 'agent.driverIssue.equipment' },
  { key: 'ROUGH_HANDLING', labelKey: 'agent.driverIssue.roughHandling' },
];

/** The measure-your-parcel fields (free-typed strings until they parse). */
export interface DimsForm {
  l: string;
  w: string;
  h: string;
  kg: string;
}

/** The redesigned walk-up intake: MEASURE the parcel (tier derived), pick a destination PUDO by Map or
 *  Address, plus nature, phones and a photo. No manual S/M/L/HEAVY, no typed zone. */
export interface AcceptForm {
  parcelId: string;
  dims: DimsForm;
  fragile: boolean;
  natureCode: CargoNature;
  /** How the counter is picking the destination: on a map, or by typing an area. */
  destMode: 'map' | 'address';
  destPudoDid: string;
  destZone: string; // the picked shop's zone (carried to accept())
  destShopName: string; // for display
  addressText: string; // the Address-mode query
  senderMobile: string;
  receiverMobile: string;
  photoRef: string;
  // F2 — the counter-freight fields (only used when the DERIVED class is dedicated/P4+; a bus-sized load
  // ignores them). A too-big walk-up is booked as freight instead of refused: a cash budget cap, immediate or
  // planned pickup, and an optional customer phone.
  budgetCap: string; // the cash cap the customer prepays → the freight's maxSpend ceiling
  freightWhen: 'now' | 'planned';
  freightDate: string; // a datetime-local value (local time), when planned
  allowEarlyClaim: boolean; // planned: may a driver reserve it before its date (default true)
  customerMobile: string; // optional — the walk-in customer's phone (joins it to their "my shipments")
  // FB2b — post the load for drivers to NAME A PRICE the counter then accepts, rather than the first fit
  // truck taking it at the computed rate. The cash cap still binds: a price above what the customer agreed
  // cannot be accepted, whoever named it.
  negotiate: boolean;
  // FB2c — the two facts only a person standing at the load can supply, and that no measurement implies.
  // `indivisible` is the one that flips a heavy load from an open deck to a low-loader; `bodyHint` is what
  // the shop thinks it needs, recorded and shown but never matched on (a clerk cannot reliably tell a
  // skeletal from a flatbed, and a binding wrong pick would exclude the operator who could have carried it).
  indivisible: boolean;
  bodyHint: BodyHint; // '' = no opinion
  // FB5 — how it is PACKED. Asked outright and required, because it is the one thing here the clerk can see
  // rather than judge, and the one whose default silently decides both the body and what has to lift it.
  packaging: PackagingChoice; // '' = not yet answered, which blocks the booking
  // FB2d — the bodies the CUSTOMER rules out. The opposite direction of travel from `bodyHint`, and a
  // different kind of fact: the hint is the shop's guess at what would work and binds nothing, while this is
  // the shipper's own refusal and binds a claim. At a counter the walk-in customer IS the shipper, so it is
  // theirs to say and the clerk's only to record. Empty = they ruled out nothing, which is the normal case.
  excludedBodies: ExcludedBody[];
  // FP7 — CMR box 13 at the counter: what the driver needs at the door, a contact to dial, a delivery window.
  instructions: string;
  contactName: string;
  contactPhone: string;
  deliveryWindow: string;
  // CL1 — the trade term the customer agreed with their buyer, and the place it names.
  incoterm: IncotermChoice;
  namedPlace: string;
}

/**
 * FB5 — how the goods are PRESENTED for handling, which is the fact that decides the body and the kit.
 *
 * Unlike the body hint below, this is an OBSERVATION, not a guess: the clerk is looking at the load, and
 * "sacks or pallets?" is answerable by anyone who can see it. That is why it is asked here at all — the same
 * commodity is handled completely differently from place to place (sugar is poured into a food-grade tanker
 * in Holland and stacked in sacks on a flatbed in Kenya), so no rule keyed on WHAT it is can get both right.
 *
 * All seven the API accepts, because each one lifts and secures differently and the clerk can tell them
 * apart by sight — this is not the body picker's problem, where twenty-five options invite a confident
 * wrong answer.
 */
export const PACKAGING_OPTIONS = [
  { value: '', labelKey: 'agent.accept.packagingChoose', detailKey: 'agent.accept.packagingChoose' },
  { value: 'bagged', labelKey: 'agent.accept.packBagged', detailKey: 'agent.accept.packBaggedWhy' },
  { value: 'palletised', labelKey: 'agent.accept.packPalletised', detailKey: 'agent.accept.packPalletisedWhy' },
  { value: 'loose', labelKey: 'agent.accept.packLoose', detailKey: 'agent.accept.packLooseWhy' },
  { value: 'drummed', labelKey: 'agent.accept.packDrummed', detailKey: 'agent.accept.packDrummedWhy' },
  { value: 'baled', labelKey: 'agent.accept.packBaled', detailKey: 'agent.accept.packBaledWhy' },
  { value: 'ibc', labelKey: 'agent.accept.packIbc', detailKey: 'agent.accept.packIbcWhy' },
  { value: 'piece', labelKey: 'agent.accept.packPiece', detailKey: 'agent.accept.packPieceWhy' },
] as const;

/** The real packagings, in picker order — what the help sheet illustrates. "Choose…" is not a packaging. */
export const PACKAGING_HELP = PACKAGING_OPTIONS.filter(
  (p): p is (typeof PACKAGING_OPTIONS)[number] & { value: Packaging } => p.value !== '',
);

/** The picker's values as literals — so a packaging this form offers can never drift from one the API takes. */
export type PackagingChoice = (typeof PACKAGING_OPTIONS)[number]['value'];

/** A real packaging — every option except the "choose…" that heads the list. */
export type Packaging = Exclude<PackagingChoice, ''>;

/**
 * REQUIRED, unlike the body hint: an unanswered hint is honest ("I don't know what body it needs"), but an
 * unanswered packaging silently falls back to the deployment default and STAMPS a body on the load. Getting
 * it wrong is not cosmetic — it is what told eighteen tonnes of sacks it needed no handling equipment.
 */
export function packagingValue(p: PackagingChoice): Packaging | undefined {
  return p === '' ? undefined : p;
}

/**
 * The truck bodies a counter can sensibly name, with words a shop clerk would use.
 *
 * A deliberate SHORT list, not the full 25-body catalogue: this is an advisory hint from someone who has a
 * crate in front of them, and a picker with twenty-five options invites a confident wrong answer where "no
 * opinion" was the honest one. Anything not here is left blank and derived from the load's own facts.
 */
export const BODY_HINTS = [
  { value: '', labelKey: 'agent.accept.bodyAny', detailKey: 'agent.accept.bodyAnyWhy' },
  { value: 'flatbed', labelKey: 'agent.accept.bodyFlatbed', detailKey: 'agent.accept.bodyFlatbedWhy' },
  { value: 'box', labelKey: 'agent.accept.bodyBox', detailKey: 'agent.accept.bodyBoxWhy' },
  { value: 'curtain_side', labelKey: 'agent.accept.bodyCurtain', detailKey: 'agent.accept.bodyCurtainWhy' },
  { value: 'refrigerated', labelKey: 'agent.accept.bodyReefer', detailKey: 'agent.accept.bodyReeferWhy' },
  { value: 'tipper', labelKey: 'agent.accept.bodyTipper', detailKey: 'agent.accept.bodyTipperWhy' },
  { value: 'lowboy', labelKey: 'agent.accept.bodyLowboy', detailKey: 'agent.accept.bodyLowboyWhy' },
  { value: 'skeletal', labelKey: 'agent.accept.bodyContainer', detailKey: 'agent.accept.bodyContainerWhy' },
] as const;

/** The picker's values as literals — so a body this form offers can never drift from one the API accepts. */
export type BodyHint = (typeof BODY_HINTS)[number]['value'];

/** A real body — every BODY_HINTS value except the "I don't know" that heads the list. */
export type ExcludedBody = Exclude<BodyHint, ''>;

/** The same short list as the hint picker, minus "I don't know" — you cannot rule out not knowing. */
export const EXCLUDABLE_BODIES = BODY_HINTS.filter((b): b is (typeof BODY_HINTS)[number] & { value: ExcludedBody } => b.value !== '');

/** "No opinion" is an ABSENT hint, not an empty one: sending '' would record a body nobody named. */
export function bodyHintValue(hint: BodyHint): ExcludedBody | undefined {
  return hint === '' ? undefined : hint;
}

/**
 * CL1 — the eleven trade terms, plus the empty choice that means the customer agreed none.
 *
 * The union rather than a string, for the same reason packaging is a union: the server takes exactly these
 * eleven and a typo would be refused at the counter with nothing useful to say about it.
 */
export type Incoterm = 'EXW' | 'FCA' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP' | 'FAS' | 'FOB' | 'CFR' | 'CIF';
export type IncotermChoice = Incoterm | '';

export const INCOTERM_CHOICES: readonly Incoterm[] = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];

/** No term agreed is an ABSENT field, not an empty string — absent is what leaves standing where it was. */
export function incotermValue(choice: IncotermChoice): Incoterm | undefined {
  return choice === '' ? undefined : choice;
}

/** Likewise: ruling nothing out is an ABSENT list, not an empty one. An empty array would post a shipper
 *  preference that the shipper never expressed. */
export function excludedBodiesValue(bodies: ExcludedBody[]): ExcludedBody[] | undefined {
  return bodies.length ? bodies : undefined;
}

/**
 * Add or remove one body from the customer's exclusions — and keep the two body questions from contradicting.
 *
 * A load cannot both be the kind that needs a flatbed and be one the customer refuses to put on a flatbed.
 * When the two collide the NEWEST answer wins in either direction, because the person is standing there
 * revising what they said; a form that silently discarded their latest word would be arguing with them.
 *
 * Order follows EXCLUDABLE_BODIES, not the order they were tapped, so the same three refusals always read and
 * post the same way.
 */
export function toggleExcludedBody(form: AcceptForm, body: ExcludedBody): Pick<AcceptForm, 'excludedBodies' | 'bodyHint'> {
  const on = form.excludedBodies.includes(body);
  const next = EXCLUDABLE_BODIES.map((b) => b.value).filter((v) => (v === body ? !on : form.excludedBodies.includes(v)));
  return { excludedBodies: next, bodyHint: !on && form.bodyHint === body ? '' : form.bodyHint };
}

/** Naming the body it needs withdraws any refusal of that same body — the other half of the rule above. */
export function chooseBodyHint(form: AcceptForm, hint: BodyHint): Pick<AcceptForm, 'excludedBodies' | 'bodyHint'> {
  return { bodyHint: hint, excludedBodies: form.excludedBodies.filter((b) => b !== hint) };
}

export const EMPTY_ACCEPT: AcceptForm = {
  parcelId: '',
  dims: { l: '', w: '', h: '', kg: '' },
  fragile: false,
  natureCode: 'GEN',
  destMode: 'map',
  destPudoDid: '',
  destZone: '',
  destShopName: '',
  addressText: '',
  senderMobile: '',
  receiverMobile: '',
  photoRef: '',
  budgetCap: '',
  freightWhen: 'now',
  freightDate: '',
  allowEarlyClaim: true,
  customerMobile: '',
  negotiate: false,
  indivisible: false,
  bodyHint: '',
  packaging: '', // asked, never assumed — a fresh booking has no answer yet
  excludedBodies: [],
  instructions: '',
  contactName: '',
  contactPhone: '',
  deliveryWindow: '',
  incoterm: '',
  namedPlace: '',
};

/** The smallest measurement we accept, in cm — 1 mm, so a thin item (a letter ~0.5 cm) is shippable.
 *  Mirrors the backend @Min. */
export const MIN_DIM_CM = 0.1;

/** Accept a European decimal comma ("0,5") as well as a dot before parsing. */
function num(s: string): number {
  return Number(String(s).trim().replace(',', '.'));
}

/** Parse the measured dims, or null while anything is missing/invalid (explicit range checks — never a
 *  `Number(x) || fallback` that lets a truthy negative slip through). */
export function parseDims(d: DimsForm): { l: number; w: number; h: number; kg: number } | null {
  const l = num(d.l);
  const w = num(d.w);
  const h = num(d.h);
  const kg = num(d.kg);
  const cm = (v: number) => Number.isFinite(v) && v >= MIN_DIM_CM;
  if (!cm(l) || !cm(w) || !cm(h)) return null;
  if (!Number.isFinite(kg) || kg < 0.01) return null;
  return { l, w, h, kg };
}

/** The plain-words presentation of a DERIVED tier. */
export function sizeMeta(size: ParcelSize, t: Translate): { label: string; hint: string } {
  const k = SIZE_KEYS[size];
  return k ? { label: t(k.labelKey), hint: t(k.hintKey) } : { label: size, hint: '' };
}

/**
 * Destination PUDOs the counter can pick: open ones first; with a reference point (a geocoded address),
 * NEAREST first; otherwise A→Z. Mirrors the Send app's picker so a shop and a sender rank shops the same.
 */
export function selectablePoints(points: NetworkPoint[] | null, excludeDid?: string, near?: GeoPoint | null, country?: string): NetworkPoint[] {
  return (points ?? [])
    .filter((p) => p.did !== excludeDid) // never offer the accepting shop as its own destination (origin ≠ dest)
    // A counter walk-up declares no contents or value, so it cannot cross a border — the server refuses it
    // (CUSTOMS_INCOMPLETE). Found in the browser: a Nairobi counter was offered shops in Dar es Salaam.
    // Unknown on either side is kept rather than hidden; the server still says no where it must.
    .filter((p) => !country || !p.country || p.country === country)
    .sort((a, b) => {
      if (a.openState !== b.openState) return a.openState === 'open' ? -1 : 1;
      if (near) {
        const da = a.location ? haversineKm(near, a.location) : Number.POSITIVE_INFINITY;
        const db = b.location ? haversineKm(near, b.location) : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return a.shopName.localeCompare(b.shopName);
    });
}

/** The "400 m away" suffix for a destination row, when both ends are known. */
export function pointDistance(p: NetworkPoint, near: GeoPoint | null | undefined): string | null {
  if (!near || !p.location) return null;
  return distanceLabel(haversineKm(near, p.location));
}

/**
 * What still blocks the accept. Ordered by the physical flow at the counter, so the first
 * missing thing is the next thing to do — the CTA subtitle reads it out.
 */
export function acceptMissing(f: AcceptForm, t: Translate): string | null {
  if (!f.parcelId.trim()) return t('agent.logic.acceptScanFirst');
  if (!parseDims(f.dims)) return t('agent.logic.acceptMeasure');
  if (!f.destPudoDid) return t('agent.logic.acceptPickDest');
  if (!f.photoRef) return t('agent.logic.acceptPhoto');
  return null;
}

/* ----------------------------------------------------------- book freight (F2) -- */

/** Parse the cash budget cap (accepts a decimal comma), or null while it's missing / not a positive amount. */
export function parseBudget(s: string): number | null {
  const v = num(s);
  return Number.isFinite(v) && v > 0 ? roundMoney(v) : null;
}

/**
 * Convert the planned-pickup datetime-local value → a canonical ISO instant WITH a timezone offset (what the
 * API's @Matches guard requires), or undefined for an immediate booking / an empty or unparseable date. A
 * datetime-local string carries no offset, so it is read as LOCAL time and normalised to a UTC instant here.
 */
export function plannedPickupIso(f: Pick<AcceptForm, 'freightWhen' | 'freightDate'>): string | undefined {
  if (f.freightWhen !== 'planned' || !f.freightDate) return undefined;
  const t = Date.parse(f.freightDate);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/**
 * What still blocks a counter FREIGHT booking (the dedicated/P4+ branch), ordered by the counter flow so the
 * first missing thing is the next thing to do. No sticker and no proof photo — freight isn't scanned onto a
 * shelf; the tracking code IS the artefact. `now` is injected so this stays pure and testable.
 */
export function bookFreightMissing(f: AcceptForm, now: number, t: Translate): string | null {
  if (!parseDims(f.dims)) return t('agent.logic.freightMeasure');
  if (!f.destPudoDid) return t('agent.logic.acceptPickDest');
  if (parseBudget(f.budgetCap) == null) return t('agent.logic.freightBudget');
  // FB5 — the one freight fact this form REFUSES to guess. Left unanswered the server falls back to the
  // deployment default and stamps a body from it, so an unasked question becomes a recorded claim about a
  // load nobody looked at. The clerk is looking at it.
  if (!packagingValue(f.packaging)) return t('agent.logic.freightPackaging');
  if (f.freightWhen === 'planned') {
    const at = Date.parse(f.freightDate);
    if (!f.freightDate || Number.isNaN(at)) return t('agent.logic.freightPlannedDate');
    if (at <= now) return t('agent.logic.freightFutureDate');
  }
  return null;
}

/* ---------------------------------------------------------------- release -- */

export type ReleaseStage = 'arrive' | 'otp' | 'rate' | 'blocked';

/**
 * Which release step a found parcel is on. The legacy page buried this in render branches;
 * making it a value keeps the screen a dumb switch and makes the state machine testable.
 */
export function releaseStage(status: ParcelStatus): ReleaseStage {
  if (status === 'On_Bus') return 'arrive';
  // Unclaimed releases exactly like ready. If this ever returns 'blocked' the counter has become a way
  // of refusing somebody their own parcel for being late, which is the opposite of what the status is for.
  if (status === 'Ready_For_Pickup' || status === 'Unclaimed') return 'otp';
  if (status === 'Delivered') return 'rate';
  return 'blocked';
}

/**
 * Which hand-over a customer's code is asking for.
 *
 * WHY THIS EXISTS. The counter used to have two screens for one situation — "Collect an order" and
 * "Hand to a customer" — and a shopkeeper had to decide which kind of customer they were facing before
 * they could serve them. A person walking in holding a code looks identical either way, so the first
 * question the app asked was one only the SHOPKEEPER could answer, about a parcel they had not found yet.
 * Now the code is the first question, because it is the one thing the customer definitely has.
 *
 * The two release secrets are shaped differently, and the difference is not cosmetic:
 *
 *  - an ORDER code is COL- plus 8 hex, unique across the whole network, so it RESOLVES a parcel by itself
 *  - a PEER-SEND code is FOUR DIGITS. There are nine thousand of them and a shop may hold nine parcels,
 *    so it cannot identify anything. It is a second factor, checked against a parcel already in hand —
 *    which is exactly why that path still has to ask for the label or sticker afterwards.
 *
 * Anything else is 'unknown', deliberately: a typo'd order code that fell through to a lookup would come
 * back "no parcel for that code", which reads like the parcel is missing rather than the code is wrong.
 */
export type HandoverRoute = 'order' | 'peer' | 'unknown';

export function handoverRoute(code: string): HandoverRoute {
  const c = (code ?? '').trim().toUpperCase();
  if (c.startsWith('COL-')) return 'order';
  if (/^\d{4}$/.test(c)) return 'peer';
  return 'unknown';
}

export function releaseBlockedDetail(status: ParcelStatus, t: Translate): string {
  return t('agent.logic.releaseBlocked', { status: status.replace(/_/g, ' ').toLowerCase() });
}

/** The pickup code: exactly four digits, as the backend issues them. */
export function otpValid(otp: string): boolean {
  return /^\d{4}$/.test(otp.trim());
}

/* ------------------------------------------------------------------ rates -- */

export interface PriceBand {
  pct: number;
  headline: string;
  detail: string;
  showMatch: boolean;
  matchPrice: number;
  matchLabel: string;
}

/** Prices per parcel carry two decimals end-to-end (display AND the PATCH body). */
export function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The shop's handling fee against nearby shops. Same shape and dead zone as the driver's
 * per-km band, but 2-decimal money and "shops" wording. Null without a usable benchmark —
 * a median of one shop would talk an agent into repricing against themselves — and null without
 * the money the benchmark is in: a comparison that cannot say its money is not shown at all.
 */
export function priceBand(pricePerParcel: number | null | undefined, benchmark: Benchmark | null | undefined, t: Translate, currency?: string): PriceBand | null {
  if (!benchmark || !benchmark.count || !currency) return null;

  const mine = Number(pricePerParcel ?? 0);
  const pct = benchmark.median > 0 ? Math.round(((mine - benchmark.median) / benchmark.median) * 100) : 0;

  const headline =
    pct > 1
      ? t('agent.logic.priceMore', { pct })
      : pct < -1
        ? t('agent.logic.priceLess', { pct: -pct })
        : t('agent.logic.priceSame');

  const detail = t('agent.logic.priceDetail', {
    mine: money(mine, currency),
    median: money(benchmark.median, currency),
    min: money(benchmark.min, currency),
    max: money(benchmark.max, currency),
    count: benchmark.count,
  });

  return {
    pct,
    headline,
    detail,
    showMatch: Math.abs(pct) > 1,
    matchPrice: roundMoney(benchmark.median),
    matchLabel: t('agent.logic.priceMatch', { price: money(benchmark.median, currency) }),
  };
}

/* --------------------------------------------------------------- speaking -- */

export function homeSummary(agent: AgentView | null, gate: GateView | null, t: Translate): string {
  if (!agent) return t('agent.logic.homeConnecting');
  const canScan = Boolean(gate?.ok);
  const bits = [t('agent.logic.homeWallet', { balance: money(agent.balance, agent.currency) })];
  bits.push(canScan ? t('agent.logic.homeCanAccept') : t('agent.logic.homeTopUp'));
  if (agent.openState === 'closed') bits.push(t('agent.logic.homeClosed'));
  return bits.join(' ');
}

export function handoverSummary(count: number, selected: number, missed: number, t: Translate): string {
  if (count === 0) return t('agent.logic.handoverNone');
  const base = t('agent.logic.handoverBase', { count, selected });
  // S25: after the gate refuses a short load, speak the number still owed to this bus.
  if (missed > 0) return `${base} ${t('agent.logic.handoverMissed', { missed })}`;
  return `${base} ${t('agent.logic.handoverScan')}`;
}

/* -------------------------------------------------------------------- void -- */

/**
 * Reverse-logistics window — must match backend VOID_WINDOW_MS (pudo.config.ts). The client
 * computes the countdown so the list drops a parcel the moment its window closes; the server
 * is still the authority and rejects a late void with WINDOW_EXPIRED.
 */
export const VOID_WINDOW_MS = 5 * 60 * 1000;

/** Milliseconds left to undo this drop-off, clamped to zero (never negative). */
export function voidRemainingMs(acceptedAt: string | undefined, now: number): number {
  if (!acceptedAt) return 0;
  const t = Date.parse(acceptedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, VOID_WINDOW_MS - (now - t));
}

/** Only an At_PUDO parcel still inside its window can be voided — mirrors the server's guard. */
export function isVoidable(p: Pick<ParcelView, 'status' | 'acceptedAt'>, now: number): boolean {
  return p.status === 'At_PUDO' && voidRemainingMs(p.acceptedAt, now) > 0;
}

/** The recent drop-offs a shop may still undo, soonest-to-expire first. */
export function voidableParcels(parcels: ParcelView[] | null, now: number): ParcelView[] {
  return (parcels ?? [])
    .filter((p) => isVoidable(p, now))
    .sort((a, b) => voidRemainingMs(a.acceptedAt, now) - voidRemainingMs(b.acceptedAt, now));
}

/** "3 min left to undo" / "45 sec left to undo" — never a bare number. */
export function voidCountdownLabel(ms: number, t: Translate): string {
  if (ms <= 0) return t('agent.logic.voidWindowClosed');
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return t('agent.logic.voidSecLeft', { seconds });
  return t('agent.logic.voidMinLeft', { minutes: Math.ceil(seconds / 60) });
}

/* --------------------------------------------------------------- registers (R4) -- */

/** The word the SHOP reads for a parcel's status in its history register. */
export function parcelStatusWord(status: ParcelStatus, t: Translate): string {
  switch (status) {
    case 'Created':
      return t('agent.status.created');
    case 'At_PUDO':
      return t('agent.status.atPudo');
    case 'On_Bus':
      return t('agent.status.onBus');
    case 'At_MDP':
      return t('agent.status.atMdp');
    case 'Ready_For_Pickup':
      return t('agent.status.ready');
    case 'Unclaimed':
      return t('agent.status.unclaimed');
    case 'Delivered':
      return t('agent.status.delivered');
    case 'Disputed':
      return t('agent.status.disputed');
    case 'Voided':
      return t('agent.status.voided');
  }
}

/** The shop's role in a parcel's journey — it took the parcel IN, or handed it OUT. */
export function parcelRoleWord(role: 'origin' | 'dest', t: Translate): string {
  return role === 'origin' ? t('agent.logic.roleOrigin') : t('agent.logic.roleDest');
}

/** The shop's word for an earnings-ledger entry type. */
export function agentLedgerTypeWord(type: string, t: Translate): string {
  switch (type) {
    case 'TOP_UP':
      return t('agent.logic.ledgerTopUp');
    case 'TOP_UP_FEE':
      return t('agent.logic.ledgerTopUpFee');
    case 'FEE':
      return t('agent.logic.ledgerFee');
    case 'LABOR_PAYOUT':
      return t('agent.logic.ledgerPayout');
    case 'REFUND':
      return t('agent.logic.ledgerRefund');
    default:
      // Historical 'OVERDRAFT' rows land here and render as their raw type — the concept was removed
      // with the trade-credit line, so nothing new can carry it.
      return type;
  }
}

/**
 * THE LIVE LINE in the top bar — what is on this counter right now.
 *
 * It replaced the shop's own name, which was fixed for the whole session and so spent the bar's one
 * moving slot on the one thing that never moved. The name is still a hover away (TopBar's
 * `subtitleHint`), where a name belongs: you look it up, you do not watch it.
 *
 * Reads the shop's ALREADY-LOADED parcels — no extra fetch for a header — and reports the two piles
 * a shopkeeper actually has to clear: what is waiting to go on a bus, and what a customer is coming
 * to collect. Closed comes first and alone, because a closed shop taking parcels is the problem.
 */
export function agentWorkLine(
  agent: { openState?: string } | null,
  parcels: Array<{ status: string; overdue?: boolean }>,
  t: Translate,
): string | undefined {
  if (!agent) return undefined;
  if (agent.openState === 'closed') return t('agent.bar.closed');
  const handOver = parcels.filter((p) => p.status === 'At_PUDO').length;
  const waiting = parcels.filter((p) => p.status === 'Ready_For_Pickup' || p.status === 'Unclaimed');
  const collect = waiting.length;
  // The pile that is not moving. A shelf slot is what decides whether this shop can take anything new, so
  // an overdue parcel is not somebody else's problem being reported for information — it is this counter's
  // capacity, sitting there. Called out separately rather than folded into the count, because "3 to
  // collect" and "3 to collect, 2 of them overdue" ask the shopkeeper to do different things.
  const overdue = waiting.filter((p) => p.overdue).length;
  const bits = [
    handOver > 0 ? t('agent.bar.handOver', { count: handOver }) : null,
    collect > 0 ? t('agent.bar.collect', { count: collect }) : null,
    overdue > 0 ? t('agent.bar.overdue', { count: overdue }) : null,
  ].filter(Boolean);
  // An empty counter says so rather than showing an empty bar: "nothing waiting" is a real and
  // welcome answer, and a blank line would read as "not loaded yet".
  return bits.length ? bits.join(' · ') : t('agent.bar.clear');
}
