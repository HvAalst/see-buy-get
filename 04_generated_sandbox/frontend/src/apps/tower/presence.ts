import type { MessageKey } from '../../shared/i18n';

/**
 * HOW ESTABLISHED THE NETWORK IS, COUNTRY BY COUNTRY — the operator's map of its own reach.
 *
 * The ladder is a privilege level, not a launch status. A country low on it still matches, carries and
 * proves; what it cannot do is spend, charge, hold or promise. The screen's whole job is to make that
 * difference impossible to misread, because every way of getting this wrong looks like generosity:
 * a country inheriting a neighbour's permissions, a cover limit surviving where nothing can pay it, an
 * "established" flag standing in for a company that was never registered.
 */

export const PRESENCE_LEVELS = ['observed', 'matched', 'partnered', 'established'] as const;
export type PresenceLevel = (typeof PRESENCE_LEVELS)[number];

/*
 * A SECOND COPY, KEPT DELIBERATELY AND NOW POLICED.
 *
 * The order here is the CONSOLE's — most-consequential first — which the server has no opinion about, so
 * this list cannot simply be the contract's. What it must not be is a different SET: adding a capability
 * on the server and forgetting this line means the console silently never shows it, which is exactly what
 * happened when fieldEvidence arrived. presence.test.ts now compares the two.
 */
export const PRESENCE_CAPABILITIES = ['takeIn', 'merchantOfRecord', 'holdFloat', 'cashOnDelivery', 'claims', 'tax', 'payouts', 'fieldEvidence'] as const;
export type PresenceCapability = (typeof PRESENCE_CAPABILITIES)[number];

export interface PresenceRow {
  jurisdiction: string;
  level: PresenceLevel;
  capabilities: Record<PresenceCapability, boolean>;
  /** Whether a transacting sister actually exists there. Established is derived from this, never typed. */
  hasEntity: boolean;
  /** False for a country that only appears because it has a company — nobody has decided anything yet. */
  recorded: boolean;
  note?: string;
  setBy?: string;
  /** CA2 — the second person who approved the change that raised this country. */
  approvedBy?: string;
  setAt?: string;
  /** CA3/CA7 — the companies standing (or being prepared) in this country, and whether each is ready. */
  companies?: Array<{ entityId: string; name: string; kind: 'sister' | 'partner'; status: 'draft' | 'active'; ready: boolean }>;
  /** CL1 — the trade terms switched on here, per direction. Empty everywhere until somebody selects one. */
  incoterms?: { origin: string[]; destination: string[] };
  /** CA5 — capabilities switched off by a lapsed licence or policy. */
  lapses?: Array<{ capability: PresenceCapability; entityId: string; source: 'licence' | 'insurance'; kind: string; reference: string; expiredAt: string }>;
}

/** What each level grants before anyone overrides anything — the same table the server derives from. */
export const LEVEL_DEFAULTS: Record<PresenceLevel, Record<PresenceCapability, boolean>> = {
  observed: { takeIn: false, merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, fieldEvidence: false },
  matched: { takeIn: true, merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, fieldEvidence: false },
  partnered: { takeIn: true, merchantOfRecord: false, holdFloat: false, cashOnDelivery: false, claims: false, tax: false, payouts: false, fieldEvidence: false },
  // CL5 — off HERE too. No level grants it; only a deliberate override for a named country does.
  established: { takeIn: true, merchantOfRecord: true, holdFloat: true, cashOnDelivery: true, claims: true, tax: true, payouts: true, fieldEvidence: false },
};

export const LEVEL_LABEL: Record<PresenceLevel, MessageKey> = {
  observed: 'tower.presence.level.observed',
  matched: 'tower.presence.level.matched',
  partnered: 'tower.presence.level.partnered',
  established: 'tower.presence.level.established',
};

export const CAPABILITY_LABEL: Record<PresenceCapability, MessageKey> = {
  takeIn: 'tower.presence.cap.takeIn',
  merchantOfRecord: 'tower.presence.cap.merchantOfRecord',
  holdFloat: 'tower.presence.cap.holdFloat',
  cashOnDelivery: 'tower.presence.cap.cashOnDelivery',
  claims: 'tower.presence.cap.claims',
  tax: 'tower.presence.cap.tax',
  payouts: 'tower.presence.cap.payouts',
  fieldEvidence: 'tower.presence.cap.fieldEvidence',
};

/**
 * The map, strongest first.
 *
 * Where the network can do everything is where most of the work is, and a country that has slipped DOWN
 * the ladder rises to the top of its band rather than hiding in an alphabet.
 */
export function presenceRows(rows: PresenceRow[]): PresenceRow[] {
  return [...rows].sort((a, b) => PRESENCE_LEVELS.indexOf(b.level) - PRESENCE_LEVELS.indexOf(a.level) || a.jurisdiction.localeCompare(b.jurisdiction));
}

/** One capability, and whether it stands where its level put it or was deliberately moved. */
export interface CapabilityState {
  capability: PresenceCapability;
  on: boolean;
  /** True where this differs from the level's default — a decision somebody made about this capability. */
  overridden: boolean;
}

/**
 * What a country may actually do, with the deliberate exceptions marked.
 *
 * Marking them matters: "this country cannot hold float" reads very differently from "this country
 * cannot hold float BECAUSE SOMEBODY TURNED IT OFF", and only one of those is worth asking about.
 */
export function capabilityStates(row: PresenceRow): CapabilityState[] {
  return PRESENCE_CAPABILITIES.map((capability) => ({
    capability,
    on: row.capabilities[capability],
    overridden: row.capabilities[capability] !== LEVEL_DEFAULTS[row.level][capability],
  }));
}

/** The capabilities deliberately moved off their level's default, as a patch to send back. */
export function overridesOf(row: PresenceRow): Partial<Record<PresenceCapability, boolean>> {
  const patch: Partial<Record<PresenceCapability, boolean>> = {};
  for (const state of capabilityStates(row)) if (state.overridden) patch[state.capability] = state.on;
  return patch;
}

/**
 * What stops this country being moved to this level — said before the server has to say it.
 *
 * Only one rule, and it is the one that matters: ESTABLISHED IS DERIVED. A flag must never be the thing
 * that creates a Merchant of Record, a float and a claims provision that do not exist, so the screen
 * refuses to offer it rather than letting somebody press it and read a 400.
 */
export function levelBlocker(row: PresenceRow, level: PresenceLevel): MessageKey | null {
  // CA3 — a company of ours still in draft may be proposed up to Established once its record is READY; the
  // approval switches it on. A draft that is not ready, or no company at all, is refused here first.
  if (level === 'established' && !row.hasEntity && !(row.companies ?? []).some((c) => c.kind === 'sister' && c.ready)) return 'tower.presence.needsCompany';
  // CA7 — Partnered means a recorded partner: active, or a draft whose record is ready.
  if (level === 'partnered' && !(row.companies ?? []).some((c) => c.kind === 'partner' && (c.status === 'active' || c.ready))) return 'tower.presence.needsPartner';
  return null;
}

/**
 * What MOVING to this level would change, as the capabilities gained and lost.
 *
 * A level is a word, and the word is not the consequence. Dropping a country from established to
 * matched stops it charging anybody, stops the float and takes the cover to zero — and an operator
 * should read that list before they press it, not discover it in a claim.
 */
export function levelEffect(row: PresenceRow, level: PresenceLevel): { gained: PresenceCapability[]; lost: PresenceCapability[] } {
  const next = LEVEL_DEFAULTS[level];
  const gained: PresenceCapability[] = [];
  const lost: PresenceCapability[] = [];
  for (const capability of PRESENCE_CAPABILITIES) {
    const now = row.capabilities[capability];
    if (next[capability] && !now) gained.push(capability);
    if (!next[capability] && now) lost.push(capability);
  }
  return { gained, lost };
}

/**
 * WHO WOULD ANSWER for goods taken in here — the sentence the counter has to say out loud.
 *
 * Mirrored from the server so the console can show an operator what a shop in that country is being
 * told. `ours` means a sister carries it; `theirs` means a carrier prices it, is paid for it and
 * answers for it while we record custody; `none` means nothing may be taken in at all.
 */
export function takeInPromise(row: PresenceRow): 'ours' | 'theirs' | 'none' {
  if (!row.capabilities.takeIn) return 'none';
  return row.capabilities.merchantOfRecord ? 'ours' : 'theirs';
}

export const PROMISE_LABEL: Record<'ours' | 'theirs' | 'none', MessageKey> = {
  ours: 'tower.presence.promise.ours',
  theirs: 'tower.presence.promise.theirs',
  none: 'tower.presence.promise.none',
};

export interface NewCountryForm {
  jurisdiction: string;
  level: PresenceLevel;
  note: string;
}

export const EMPTY_COUNTRY_FORM: NewCountryForm = { jurisdiction: '', level: 'matched', note: '' };

/** CA1 — one country from the catalogue: what the network knows of it, and whether it can price in its money. */
export interface CatalogueCountry {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
  drivingSide: 'left' | 'right';
  languages: string[];
  postalCode: boolean;
  idDocuments: string[];
  /** Whether the rate book can convert its currency — switching a country on requires it. */
  priceable: boolean;
  level: PresenceLevel;
}

/** CA2 — a change that raises a country, waiting for (or decided by) a second person. */
export interface PresenceProposalRow {
  proposalId: string;
  jurisdiction: string;
  level: PresenceLevel;
  overrides?: Partial<Record<PresenceCapability, boolean>>;
  note?: string;
  gains: PresenceCapability[];
  proposedBy: string;
  proposedAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
}

/**
 * What stops a country being recorded — said before the server has to say it.
 *
 * CA1: a country is CHOSEN from the catalogue, never typed, so ZM and ZMB can never become two countries that
 * never meet — and switching one on waits until the rate book can convert its money.
 */
export function newCountryBlocker(form: NewCountryForm, rows: PresenceRow[], catalogue: CatalogueCountry[] = []): MessageKey | null {
  const code = form.jurisdiction.trim().toUpperCase();
  if (!code) return 'tower.presence.needCode';
  const country = catalogue.find((c) => c.code === code);
  if (!country) return 'tower.presence.badCode';
  const listed = rows.find((r) => r.jurisdiction === code);
  if (form.level === 'established' || form.level === 'partnered') {
    const blocked = levelBlocker(listed ?? { jurisdiction: code, level: 'observed', capabilities: { ...LEVEL_DEFAULTS.observed }, hasEntity: false, recorded: false }, form.level);
    if (blocked) return blocked;
  }
  const switchingOn = form.level !== 'observed' && !listed?.capabilities.takeIn;
  if (switchingOn && !country.priceable) return 'tower.presence.needsRate';
  return null;
}

/** Two names are one person when they differ only in case and spacing — the same rule the server applies. */
export function samePerson(a: string | undefined, b: string | undefined): boolean {
  const n = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return Boolean(n(a)) && n(a) === n(b);
}

/**
 * CA2 — may this person approve this change? Never the one who proposed it: two people switch a country on.
 * Returns the reason they may not, or null.
 */
export function approvalBlocker(proposal: PresenceProposalRow, who: string | undefined): MessageKey | null {
  if (proposal.status !== 'pending') return 'tower.presence.alreadyDecided';
  if (!who?.trim()) return 'tower.presence.needName';
  if (samePerson(who, proposal.proposedBy)) return 'tower.presence.ownProposal';
  return null;
}

/** Does moving this country to this level need a second person? Only a change that GIVES it something does. */
export function needsSecondPerson(row: PresenceRow, level: PresenceLevel): boolean {
  return levelEffect(row, level).gained.length > 0;
}

/** The waiting change for a country, if there is one — the table marks the row rather than hiding it. */
export function pendingFor(proposals: PresenceProposalRow[] | null, jurisdiction: string): PresenceProposalRow | undefined {
  return (proposals ?? []).find((p) => p.status === 'pending' && p.jurisdiction === jurisdiction);
}

/** CA9 — `GET presence/:jurisdiction/impact`: what lowering or closing a country would leave behind. */
export interface CountryImpactView {
  jurisdiction: string;
  toLevel: PresenceLevel;
  lost: PresenceCapability[];
  gained: PresenceCapability[];
  closing: boolean;
  shelves: { total: number; ours: number; theirs: number; unstamped: number };
  inTransit: number;
  freight: { open: number; claimed: number };
  owed: Array<{ entityId: string; name: string; currency: string; amount: number; suppliers: number }>;
  registered: { shops: number; stores: number; hubs: number; fleets: number; couriers: number };
}

/** Nothing left behind at all — no closing, no parcels, loads, debts or participants. Said as such, not as a blank. */
export function impactIsEmpty(impact: CountryImpactView): boolean {
  return (
    !impact.closing &&
    impact.shelves.total === 0 &&
    impact.inTransit === 0 &&
    impact.freight.open === 0 &&
    impact.freight.claimed === 0 &&
    impact.owed.length === 0 &&
    Object.values(impact.registered).every((n) => n === 0)
  );
}

/** A country's name from the catalogue, or its code where the catalogue has not been read yet. */
export function countryNameOf(code: string, catalogue: CatalogueCountry[] | null): string {
  return catalogue?.find((c) => c.code === code)?.name ?? code;
}

/** The country this form would act on, normalised the way the server stores it. */
export function newCountryCode(form: NewCountryForm): string {
  return form.jurisdiction.trim().toUpperCase();
}

/** True where recording this would CHANGE a country already on the map rather than add one. */
export function alreadyListed(form: NewCountryForm, rows: PresenceRow[]): boolean {
  const code = newCountryCode(form);
  return Boolean(code) && rows.some((r) => r.jurisdiction === code);
}

/* ------------------------------------------------------------------ CL1: the trade terms -- */

/**
 * The eleven, for the picker. The BACKEND catalogue is the authority and refuses anything not in it; this
 * list only decides what a person can tick, and carries the one sentence that stops the two dangerous
 * choices being made by accident.
 */
export const INCOTERMS: ReadonlyArray<{ code: string; name: string; sea?: boolean; care?: boolean }> = [
  { code: 'EXW', name: 'Ex Works', care: true },
  { code: 'FCA', name: 'Free Carrier' },
  { code: 'CPT', name: 'Carriage Paid To' },
  { code: 'CIP', name: 'Carriage and Insurance Paid To' },
  { code: 'DAP', name: 'Delivered At Place' },
  { code: 'DPU', name: 'Delivered at Place Unloaded' },
  { code: 'DDP', name: 'Delivered Duty Paid', care: true },
  { code: 'FAS', name: 'Free Alongside Ship', sea: true },
  { code: 'FOB', name: 'Free On Board', sea: true },
  { code: 'CFR', name: 'Cost and Freight', sea: true },
  { code: 'CIF', name: 'Cost, Insurance and Freight', sea: true },
];

/** The sets as they stand, with the defaults filled in — "none are on here" is an answer, not a blank. */
export function termsOf(row: PresenceRow): { origin: string[]; destination: string[] } {
  return { origin: row.incoterms?.origin ?? [], destination: row.incoterms?.destination ?? [] };
}

/** Tick or untick one code, keeping the catalogue order so the list never reshuffles under somebody. */
export function toggleTerm(list: string[], code: string): string[] {
  const next = list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
  return INCOTERMS.map((t) => t.code).filter((c) => next.includes(c));
}

/**
 * WHO IS WAITING FOR A COUNTRY THE NETWORK HAS NOT REACHED — one row per country, not per message.
 *
 * The question this screen asks is "should we switch on the Netherlands", never "should I reply to this
 * person". A flat list of messages makes staff do the counting, and counting is the part a computer
 * should already have done — so the row arrives decided-shaped: how many, what they would be, what the
 * country speaks (which is the translation this would imply) and what it settles in.
 *
 * The messages come with it, underneath, because the motivation is the evidence. A count alone says only
 * that ten people tapped a button.
 */
export interface InterestCountry {
  country: string;
  name: string;
  languages: string[];
  currency: string;
  /** Still waiting — the ones a switch-on has not yet reached. */
  waiting: number;
  kinds: Record<string, number>;
  notes: Array<{ noteId: string; kind: string; email: string; message: string; at: string; toldAt?: string; toldLevel?: string }>;
}
