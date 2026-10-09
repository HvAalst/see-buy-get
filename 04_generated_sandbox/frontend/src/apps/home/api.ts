import { makeConfig, publicDownload, publicRequest, type Result, type SbgConfig } from '../../lib/sbg';
import type { DocumentLinkView, LinkAnswer } from '../../shared/archive/documentLink';
import type { ProofAnswer } from '../../lib/sbg/personas/archive';

const APP_VERSION = '1.0.0';

/**
 * The front door talks ONLY to @Public endpoints — it has no session and needs none:
 * phone verification, signup, store registration, and the network directory. Whatever
 * account it creates is handed to the role's own app, which owns the session from there.
 */
export function homeConfig(): SbgConfig {
  return makeConfig('home', APP_VERSION);
}

export interface OtpRequestView {
  /** The sandbox echoes the code back (SMS in production) — surfaced so a demo can finish. */
  code?: string;
  otp?: string;
  verificationCode?: string;
  sent?: boolean;
}

export function requestCode(phone: string): Promise<Result<OtpRequestView>> {
  return publicRequest<OtpRequestView>(homeConfig(), '/v1/sbg/auth/phone/request', { body: { phone } });
}

/**
 * IS THIS THE DOCUMENT SEEBUYGET ISSUED? — the one call on the front door that is not about joining.
 *
 * Public because the people who need it have no account and never will: an insurer, a forwarder, a
 * magistrate, the other side's lawyer. It answers about the fingerprint alone.
 */
export function verifyNote(sha256: string): Promise<Result<ProofAnswer>> {
  return publicRequest<ProofAnswer>(homeConfig(), '/v1/sbg/consignment-notes/verify', { body: { sha256 } });
}

/**
 * A LINK TO A DOCUMENT, opened from an email with nobody signed in. Public for the reason the check above is: the
 * person holding the link was sent a document, not an invitation. The key goes in the BODY of both calls — a key
 * in an address is a key in every log the address passes through.
 */
export async function lookAtDocumentLink(token: string): Promise<LinkAnswer> {
  const r = await publicRequest<DocumentLinkView>(homeConfig(), '/v1/sbg/document-links/look', { body: { token } });
  if (r.data && !r.error) return { view: r.data };
  // Not found, or not even shaped like a key: either way it is not a link of ours, and that is all there is to say.
  if (r.status === 404 || r.status === 400) return { failed: 'not_ours' };
  return { failed: r.status === 429 ? 'busy' : 'unreachable' };
}

/** The file. Null when it could not be had — the page then asks what the link is now, which says why. */
export async function takeDocumentLink(token: string): Promise<Blob | null> {
  const r = await publicDownload(homeConfig(), '/v1/sbg/document-links/fetch', { body: { token } });
  return r.error || !r.data ? null : r.data;
}

export function verifyCode(phone: string, code: string): Promise<Result<{ verified?: boolean }>> {
  return publicRequest(homeConfig(), '/v1/sbg/auth/phone/verify', { body: { phone, code } });
}

export interface SignupView {
  accountId: string;
  role: 'pudo' | 'driver' | 'mdp';
  did: string;
  email: string;
  entityStatus?: string;
  token: { access_token: string; expires_in?: number };
}

export function signup(body: Record<string, unknown>): Promise<Result<SignupView>> {
  return publicRequest<SignupView>(homeConfig(), '/v1/sbg/auth/signup', { body });
}

export interface VendorRegisteredView {
  vendorId: string;
  did: string;
  name: string;
  secret: string;
  country: string;
  /** The account made with the store: how it signs in. */
  email?: string;
}

/** A store is registered WITH its account: the email and password its people sign in to the Store app with. */
export function registerStore(body: { name: string; country?: string; email: string; password: string }): Promise<Result<VendorRegisteredView>> {
  return publicRequest<VendorRegisteredView>(homeConfig(), '/v1/sbg/vendors', { body });
}

export interface NetworkPoint {
  did: string;
  shopName: string;
  zone: string;
  country?: string;
  location?: { lat: number; lng: number };
  openState: 'open' | 'closed';
}

/** The public directory — the join map's bearings, and where the zone list comes from. */
export function fetchPoints(): Promise<Result<NetworkPoint[]>> {
  return publicRequest<NetworkPoint[]>(homeConfig(), '/v1/sbg/network/points');
}

/** One real parcel's journey between two public shops — no person, no parcel id. */
export interface PulseJourney {
  fromShop: string;
  fromTown: string;
  toShop: string;
  toTown: string;
  toReadyMinutes: number;
  toCollectedMinutes: number;
  collectedAt: string;
}

/**
 * The network, measured — the front page's proof. Every figure is counted by the server; a median or an average
 * is absent until there are enough cases for it to mean anything, and the page then simply does not show it.
 */
export interface NetworkPulse {
  shops: number;
  shopsOpen: number;
  towns: number;
  townList: Array<{ town: string; slug: string; shops: number }>;
  countries: string[];
  collected30d: number;
  medianHoursToReady?: number;
  shopRating?: { average: number; count: number };
  journey?: PulseJourney;
  windowDays: number;
  at: string;
}

/** One trading shop on a town page — what anybody outside it could see. */
export interface TownShop {
  shopName: string;
  landmark: string;
  openState: 'open' | 'closed';
  rating?: { average: number; count: number };
  handle?: string;
  location?: { lat: number; lng: number };
}

/** A town's page, at `/towns/<slug>`. */
export interface TownPage {
  town: string;
  slug: string;
  country: string;
  shops: TownShop[];
}

export function fetchTowns(): Promise<Result<{ items: TownPage[] }>> {
  return publicRequest<{ items: TownPage[] }>(homeConfig(), '/v1/sbg/network/towns');
}

export function fetchPulse(): Promise<Result<NetworkPulse>> {
  return publicRequest<NetworkPulse>(homeConfig(), '/v1/sbg/network/pulse');
}

/** One country the network actually operates in — a real company, and the money it settles in. */
export interface OperatingCountry {
  country: string;
  name: string;
  currency?: string;
  /** False where the network operates but no company of ours handles money: you settle with the carrier. */
  settles?: boolean;
  /** The company that would contract and pay you, where there is one. */
  settlesAs?: string;
  /**
   * Whether anybody may register here at all — false for most of the world.
   *
   * Every country is listed now. One that is simply ABSENT teaches nobody anything: you cannot tell "we
   * are not there yet" from "this form is broken", and a driver in the Netherlands read it as the second.
   */
  joinable?: boolean;
}

/**
 * Where the network can lawfully take somebody on.
 *
 * Asked at the front door rather than guessed, because joining from a country with no company behind it
 * is refused by the backend — and being told that at the end of a sign-up wizard is the worst moment to
 * find out. The list is derived from the sisters, so it cannot offer somewhere we could not invoice.
 */
export function fetchCountries(): Promise<Result<OperatingCountry[]>> {
  return publicRequest<OperatingCountry[]>(homeConfig(), '/v1/sbg/countries');
}

/** The truck body types the network actually knows, READ rather than restated. Public, because a join
 *  form has no token yet and a list of body types is a catalogue rather than anybody's data. */
export function fetchTruckSubtypes(): Promise<Result<Array<{ id: string; label: string }>>> {
  return publicRequest<Array<{ id: string; label: string }>>(homeConfig(), '/v1/sbg/vehicles/truck-subtypes');
}

/** What somebody would be, if the network reached them. Mirrors INTEREST_KINDS on the server. */
export const INTEREST_KINDS = ['carrier', 'shop', 'hub', 'store', 'other'] as const;
export type InterestKind = (typeof INTEREST_KINDS)[number];
export const MAX_INTEREST_MESSAGE = 600;

/**
 * Ask to be told when the network reaches a country it does not.
 *
 * Public and unverified on purpose: this is evidence for a decision, not an account. The only thing it
 * promises back is the switch-on itself, which is automatic — see the interest-received mail.
 */
export function leaveInterest(country: string, body: { kind: string; email: string; message: string }): Promise<Result<{ noteId: string; name: string }>> {
  return publicRequest<{ noteId: string; name: string }>(homeConfig(), `/v1/sbg/countries/${encodeURIComponent(country)}/interest`, { body });
}

/* ------------------------------------------------------- FB3b: the market -- */

/** One load as the public market publishes it. Mirrors backend MarketRow — note what is NOT here: no
 *  freight id, no code, no shop name, no description, and no exact pin. */
/**
 * A store's public reputation — no key, no account, no sign-in.
 *
 * PUBLIC by design and the design does not survive it being anything else: if the profile existed only
 * inside the widget a merchant chooses to install, every badly-behaved merchant would suppress it by not
 * installing, and a score the badly-behaved can opt out of is not a score.
 */
export interface StoreReputation {
  vendorId: string;
  name: string;
  shipments: number;
  shipsNextDayRate?: number;
  medianHoursToHandover?: number;
  neverDroppedRate?: number;
  upheldDisputeRate?: number;
  tags: Array<{ tag: string; count: number; positive: boolean }>;
  rating: { average: number; count: number; isNew: boolean };
}

export function fetchStoreReputation(vendorId: string): Promise<Result<StoreReputation>> {
  return publicRequest<StoreReputation>(homeConfig(), `/v1/sbg/stores/${encodeURIComponent(vendorId)}/reputation`);
}

/** One participant's public profile — `seebuyget.com/@fedex`. Handle with or without the '@'. */
export interface ProfileView {
  handle: string;
  kind: 'shop' | 'hub' | 'fleet' | 'company';
  name: string;
  formerly?: string;
  country?: string;
  at?: { lat: number; lng: number };
  area?: string;
  since: string;
  /** Absent when no country is recorded — the ladder answers 'observed' for an unknown jurisdiction,
   *  which would render as a confident claim about a country nobody named. */
  presence?: { level: string; says: string };
  does: string;
  verified: Array<{ what: string; at: string }>;
  /** What the company put on record itself since it was switched on. It counts; nobody at SeeBuyGet checked it. */
  onRecord?: Array<{ what: string; at: string }>;
  /** CL4 — what they did with the loads they took. Absent for a kind that mobilises nothing. */
  moves?: {
    claimed: number;
    handedBack: number;
    kept: number;
    delivered: number;
    inFlight: number;
    tightKept: number;
    tightDelivered: number;
    keptRate?: number | null;
    deliveredRate?: number | null;
    thin: boolean;
    ratesNeed: number;
    lanes: Array<{ key: string; claimed: number; handedBack: number; kept: number; delivered: number }>;
    classes: Array<{ key: string; claimed: number; handedBack: number; kept: number; delivered: number }>;
  };
  /** What we measured and what we did NOT — carried so no screen can show the figures without it. */
  movesMeasured?: string;
  /**
   * CL4 item 1 — the clearance record, for a company that has been appointed to clear a container.
   *
   * Two halves that must never be added together. Everything before `holds` is what this agent did with
   * the work in front of them; `holds` is what the STATE did, counted apart and labelled, because
   * scoring an agent on time at a border systematically advertises whoever pays bribes. There is
   * deliberately no field here for a border time, and there must not be one.
   */
  clears?: {
    appointed: number;
    listed: number;
    quoted: number;
    cleared: number;
    inFlight: number;
    /** Containers whose list of papers GREW after the importer had started supplying. The two-week story. */
    listedLate: number;
    latePapers: number;
    listHours?: number | null;
    checkHours?: number | null;
    quoteHours?: number | null;
    thin: boolean;
    ratesNeed: number;
    ports: Array<{ key: string; appointed: number; listed: number; cleared: number }>;
    /** What they have been SEEN clearing, by mode — beside what they say they clear. */
    modes: Array<{ key: string; appointed: number; listed: number; cleared: number }>;
    holds: { containers: number; recorded: number; disputed: number; kinds: Array<{ key: string; times: number }> };
  };
  clearsMeasured?: string;
  /**
   * What they SAY they clear — their own advertisement, and the only asserted thing on the page.
   *
   * Everything else is derived from the record, which is what makes a page worth reading; this is not,
   * and the screen has to show it as what it is. It exists because nobody else could know it: an agent
   * whose speciality is air freight or vehicles cannot be discovered by observation until somebody has
   * already hired them for it.
   */
  offer?: ClearanceOffer;
  /** Why an empty record is not a bad record — we only count what came through this network. */
  recordSays?: string;
}

/** The things a clearing agent can say they clear. A vocabulary, so a finder can match it. */
export const CLEARANCE_SPECIALISMS = [
  'sea_container',
  'air_freight',
  'vehicles',
  'bulk_breakbulk',
  'project_heavy_lift',
  'perishables',
  'livestock',
  'pharma_cold_chain',
  'dangerous_goods',
  'personal_effects',
  'courier_express',
  'bonded_transit',
] as const;
export type ClearanceSpecialism = (typeof CLEARANCE_SPECIALISMS)[number];

export interface ClearanceOffer {
  specialisms: ClearanceSpecialism[];
  places: string[];
  words?: string;
  saidAt: string;
  saidBy: string;
}

/** One agent as the finder lists them: what they say, beside what we have seen. Never a rank. */
export interface AgentCard {
  entityId: string;
  handle?: string;
  name: string;
  country?: string;
  offer?: ClearanceOffer;
  appointed: number;
  cleared: number;
  thin: boolean;
}

/**
 * FINDING AN AGENT — public, because this is market dynamics and a directory nobody can read is not one.
 *
 * `basis` says the ordering out loud. It is alphabetical so that advertising more cannot move anybody up,
 * and there is no relevance score, because a relevance score is a league table under a name that hides it.
 */
export function findAgents(q: { specialism?: string; place?: string; country?: string }): Promise<Result<{ items: AgentCard[]; total: number; basis: string }>> {
  const search = new URLSearchParams();
  if (q.specialism) search.set('specialism', q.specialism);
  if (q.place?.trim()) search.set('place', q.place.trim());
  if (q.country?.trim()) search.set('country', q.country.trim().toUpperCase());
  const qs = search.toString();
  return publicRequest(homeConfig(), `/v1/sbg/agents/find${qs ? `?${qs}` : ''}`);
}

/**
 * The profile page's read. PUBLIC by design and by necessity: the gap this closes is that appointing a
 * clearing agent meant typing a company id somebody had to send you out of band, so a page nobody can
 * read without an account would close nothing at all.
 */
export function fetchProfile(handle: string): Promise<Result<ProfileView>> {
  return publicRequest<ProfileView>(homeConfig(), `/v1/sbg/profiles/${encodeURIComponent(handle.replace(/^@/, ''))}`);
}

export interface MarketRow {
  area?: string;
  destArea?: string;
  pickupAbout: { lat: number; lng: number };
  weightKg: number;
  cargoClass: string;
  natureCode: string;
  indivisible?: boolean;
  bodyDerived?: { body: string; basis: 'measured' | 'weight-only' };
  requiredEquipment?: string[];
  requiredCapabilities?: string[];
  deadheadKm: number;
  loadedKm: number;
  totalKm: number;
  scheduledPickupAt?: string;
  indicativeTotal?: number;
  indicativePerKm?: number | null;
}

export interface MarketView {
  items: MarketRow[];
  total: number;
  /** The server saying, in the payload, that these prices are not offers. Carried through rather than
   *  dropped, so a screen cannot render the money without stepping over the word. */
  basis?: string;
}

/**
 * The freight market around a point, to a caller with no account.
 *
 * The one endpoint in this app that is not part of joining. It is here because it is the only app that
 * serves strangers, and the people who most need to know what moves on a corridor are the ones who do not
 * yet own a truck to move it with.
 */
export function fetchMarket(at: { lat: number; lng: number }, radiusKm?: number): Promise<Result<MarketView>> {
  const q = new URLSearchParams({ lat: String(at.lat), lng: String(at.lng) });
  if (radiusKm != null) q.set('radiusKm', String(radiusKm));
  return publicRequest<MarketView>(homeConfig(), `/v1/sbg/market?${q.toString()}`);
}

/** One body's two lines in the market series. Mirrors backend BodySeries. */
export interface BodySeries {
  body: string;
  offeredLoads: number;
  offeredKm: number;
  offeredMeasured: number;
  movedLoads: number;
  movedKm: number;
  deadheadKm: number;
}

export interface MarketSeriesView {
  from: string;
  to: string;
  bodies: BodySeries[];
  totals: {
    offeredLoads: number;
    offeredKm: number;
    movedLoads: number;
    movedKm: number;
    deadheadKm: number;
    unmetLoads: number;
    unmetKm: number;
  };
}

/**
 * The market series — kilometres of each body asked for, against kilometres actually moved.
 *
 * The point is optional, unlike the board's: "how much flatbed work is there on this network" is a real
 * question with no natural centre, and it has to stay askable without naming a city.
 */
export function fetchMarketSeries(at: { lat: number; lng: number } | null, radiusKm?: number): Promise<Result<MarketSeriesView>> {
  const q = new URLSearchParams();
  if (at) {
    q.set('lat', String(at.lat));
    q.set('lng', String(at.lng));
  }
  if (radiusKm != null) q.set('radiusKm', String(radiusKm));
  const qs = q.toString();
  return publicRequest<MarketSeriesView>(homeConfig(), `/v1/sbg/market/series${qs ? `?${qs}` : ''}`);
}

export interface GeocodeView {
  location: { lat: number; lng: number };
  confidence: 'exact' | 'approx' | 'fallback';
  matched?: string;
}

/** Resolve a typed place — the same public gazetteer the rest of the network geocodes against. */
export function geocode(q: string): Promise<Result<GeocodeView>> {
  return publicRequest<GeocodeView>(homeConfig(), `/v1/sbg/geocode?q=${encodeURIComponent(q)}`);
}

/* ---------------------------------------------------------------- handoff -- */

/**
 * Hand the new account to its app.
 *
 * Each participant app reads its identity from ITS OWN localStorage key on first run
 * (driver: `glos-driver-did`, agent/hub: the saved email prefill). Writing those keys here
 * is what makes "you are in — open your app" land on a working screen instead of an empty
 * sign-in. Same-origin, so the keys are the same storage the app will read.
 *
 * The one thing NOT written is a token: sessions are the app's business, and the agent and
 * hub apps re-mint from the real login anyway.
 */
export function handOff(role: 'pudo' | 'driver' | 'mdp', did: string, email: string): void {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    if (role === 'driver') ls.setItem('glos-driver-did', did);
    if (role === 'pudo') {
      ls.setItem('glos-agent-did', did);
      ls.setItem('glos-agent-email', email);
    }
    if (role === 'mdp') {
      ls.setItem('glos-mdp-did', did);
      ls.setItem('glos-mdp-email', email);
    }
  } catch {
    /* storage unavailable — the app will simply ask them to sign in */
  }
}

/** The same for a store: the address it signs in with, already in the Store app's sign-in. Never the password. */
export function handOffStore(email: string): void {
  try {
    globalThis.localStorage?.setItem('glos-vendor-email', email);
  } catch {
    /* storage unavailable — the Store app will simply ask for the address */
  }
}

/**
 * A stable-ish marker for this browser, standing in for the compendium's IMEI device bind
 * (Ch 18.6). A web app CANNOT read a device id, so this is honestly a browser marker, not
 * a device lock: it survives on this browser profile and identifies it to the backend's
 * dedup check. Real device binding needs the native shell the starter kit's tablet ships
 * with — recorded as a gap rather than faked.
 */
const MARKER_KEY = 'sbg-device-marker';

export function deviceMarker(): string {
  try {
    const ls = globalThis.localStorage;
    const existing = ls?.getItem(MARKER_KEY);
    if (existing) return existing;
    const made = `web-${Math.round(performance.now())}-${Math.random().toString(36).slice(2, 10)}`;
    ls?.setItem(MARKER_KEY, made);
    return made;
  } catch {
    return `web-${Math.round(performance.now())}`;
  }
}
