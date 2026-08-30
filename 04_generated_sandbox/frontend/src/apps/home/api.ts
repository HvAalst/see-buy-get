import { makeConfig, publicRequest, type Result, type SbgConfig } from '../../lib/sbg';

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
}

export function registerStore(body: { name: string; country?: string }): Promise<Result<VendorRegisteredView>> {
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

/** One country the network actually operates in — a real company, and the money it settles in. */
export interface OperatingCountry {
  country: string;
  name: string;
  currency?: string;
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

/* ------------------------------------------------------- FB3b: the market -- */

/** One load as the public market publishes it. Mirrors backend MarketRow — note what is NOT here: no
 *  freight id, no code, no shop name, no description, and no exact pin. */
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
