/**
 * The drop-in shipping-quote widget — everything about it that is not the DOM.
 *
 * This code runs on somebody else's product page, which changes what "correct" means. It cannot assume our
 * fonts, our CSS, our framework or our error conventions are present, and it must not drag any of them in:
 * a merchant should not pay for a UI runtime to render one price. So the widget is a custom element around
 * these pure functions, and the functions are where the thinking lives.
 *
 * Kept separate from the element for the ordinary reason — a shadow-DOM component is awkward to assert
 * against, and none of the decisions below need a DOM to be checked.
 */

/** What the merchant configured, read off the element's attributes. All strings, as HTML gives them. */
export interface WidgetAttrs {
  api?: string | null;
  /** A PUBLISHABLE key (`pk_…`). Optional — the quote works without one. */
  key?: string | null;
  fromPoint?: string | null;
  fromCountry?: string | null;
  fromArea?: string | null;
  weightKg?: string | null;
  lengthCm?: string | null;
  widthCm?: string | null;
  heightCm?: string | null;
  size?: string | null;
}

/** Where the buyer said they want it. */
export interface Destination {
  country: string;
  area: string;
}

export interface QuoteEndpointBody {
  pointId?: string;
  country?: string;
  area?: string;
}

export interface QuoteRequestBody {
  from: QuoteEndpointBody;
  to: QuoteEndpointBody;
  dimensionsCm?: { l: number; w: number; h: number };
  weightKg?: number;
  size?: 'S' | 'M' | 'L';
}

/** The shape the public API answers with — the fields this widget reads, and no more. */
export interface QuoteResponse {
  to: { name: string; area: string; country: string; landmark?: string };
  parcel: { size: string; weightKg: number };
  price: { currency: string; amount: number; minimum: number };
  eta: { readyAt: string; hours: number; arrivesWhileOpen: boolean };
  route: { hops: string[]; km: number; crossesBorder: boolean };
  requires: string[];
  expiresAt?: string;
}

/** RFC 9457, as the API sends it. `code` is the stable part; `detail` is for a log. */
export interface Problem {
  code?: string;
  title?: string;
  detail?: string;
  status?: number;
}

const num = (v?: string | null): number | undefined => {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The API root this widget talks to. Baked at build time, overridable per embed. */
export function apiBase(attrs: WidgetAttrs, baked: string): string {
  const raw = (attrs.api ?? '').trim() || baked;
  return raw.replace(/\/+$/, '');
}

/**
 * What the merchant still has to put on the tag, as a sentence a developer reads in their console.
 *
 * Configuration errors are shown to the DEVELOPER, never to the buyer: a shopper who sees "from-area is
 * missing" learns nothing and distrusts the shop. The widget renders nothing at all until it is set up.
 */
export function configProblem(attrs: WidgetAttrs): string | null {
  const key = attrs.key?.trim();
  // A SECRET key in a page is not a configuration preference, it is a credential published to the world.
  // Refusing to render is the only response that cannot be ignored — and the console says to revoke it,
  // because by the time a developer reads this the key is already in somebody's browser history.
  if (key?.startsWith('sk_')) return 'that is a SECRET key and it is now public — revoke it and use the pk_ key instead';
  if (key && !key.startsWith('pk_')) return `"${key.slice(0, 8)}…" is not a publishable key — it should start with pk_`;
  if (attrs.fromPoint?.trim()) return null;
  if (attrs.fromCountry?.trim() && attrs.fromArea?.trim()) return null;
  return 'set from-point, or both from-country and from-area — the widget cannot guess where you ship from';
}

/** The headers every call carries. The key rides in a header, never a query string — those reach logs. */
export function headers(attrs: WidgetAttrs): Record<string, string> {
  const key = attrs.key?.trim();
  return { accept: 'application/json', ...(key?.startsWith('pk_') ? { 'x-sbg-key': key } : {}) };
}

/** Where the shipment starts, in the shape the API takes. */
export function origin(attrs: WidgetAttrs): QuoteEndpointBody {
  const pointId = attrs.fromPoint?.trim();
  if (pointId) return { pointId };
  return { country: (attrs.fromCountry ?? '').trim().toUpperCase(), area: (attrs.fromArea ?? '').trim() };
}

/**
 * The request body for one quote.
 *
 * Measurements win over `size` when both are given, because the API derives the tier from them anyway —
 * sending both and hoping they agree is how a quote and the shipment it becomes end up different sizes.
 */
export function quoteRequest(attrs: WidgetAttrs, to: Destination): QuoteRequestBody {
  const l = num(attrs.lengthCm);
  const w = num(attrs.widthCm);
  const h = num(attrs.heightCm);
  const measured = l !== undefined && w !== undefined && h !== undefined;
  const size = (attrs.size ?? '').trim().toUpperCase();
  return {
    from: origin(attrs),
    to: { country: to.country, area: to.area },
    ...(measured ? { dimensionsCm: { l: l!, w: w!, h: h! } } : {}),
    ...(num(attrs.weightKg) !== undefined ? { weightKg: num(attrs.weightKg)! } : {}),
    ...(!measured && (size === 'S' || size === 'M' || size === 'L') ? { size: size as 'S' | 'M' | 'L' } : {}),
  };
}

/* ------------------------------------------------------------------ copy -- */

/**
 * Every word the widget can say.
 *
 * One object rather than strings scattered through the render, so a merchant can localise it without a
 * build: `window.SBG_QUOTE_STRINGS = { cta: 'Bereken verzendkosten' }` before the script loads. It is not
 * wired to the network's own i18n catalogues on purpose — pulling a translation runtime into somebody
 * else's product page to render six labels is a cost they did not ask for.
 */
export interface Strings {
  cta: string;
  panelTitle: string;
  country: string;
  area: string;
  choose: string;
  submit: string;
  working: string;
  collectAt: string;
  readyBy: string;
  asLowAs: string;
  crossesBorder: string;
  noAreas: string;
  offline: string;
  retry: string;
  close: string;
}

export const EN: Strings = {
  cta: 'Calculate your shipping fee',
  panelTitle: 'Where should we send it?',
  country: 'Country',
  area: 'Area',
  choose: 'Choose…',
  submit: 'Get the price',
  working: 'Working it out…',
  collectAt: 'Collect at',
  readyBy: 'Ready by',
  asLowAs: 'as little as {amount} if the seller picks the route',
  crossesBorder: 'Crosses a border — a contents list and value are needed to send it.',
  noAreas: 'We do not deliver anywhere yet.',
  offline: 'We could not reach the shipping service. Check your connection.',
  retry: 'Try again',
  close: 'Close',
};

/** Merge a merchant's overrides over the defaults, ignoring anything that is not a string. */
export function strings(overrides?: unknown): Strings {
  const out = { ...EN };
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      if (k in out && typeof v === 'string' && v.trim()) out[k as keyof Strings] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------- rendering -- */

/** The price a buyer is shown: the ceiling, formatted in the currency the API named. */
export function priceLine(q: QuoteResponse, locale?: string): string {
  return money(q.price.amount, q.price.currency, locale);
}

/**
 * The second line, when there is one worth saying.
 *
 * Only when the two figures actually differ — "as little as 32.13" under a headline of 32.13 is noise, and
 * a sandbox with one carrier rate produces exactly that.
 */
export function savingLine(q: QuoteResponse, s: Strings, locale?: string): string | null {
  if (!(q.price.minimum < q.price.amount)) return null;
  return s.asLowAs.replace('{amount}', money(q.price.minimum, q.price.currency, locale));
}

export function money(amount: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    // An unknown or malformed currency code must not blank the price — the number is the point.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "Ready by Fri 28 Aug" — a date a person can plan around, not an ISO timestamp. */
export function readyLine(q: QuoteResponse, locale?: string): string {
  const at = new Date(q.eta.readyAt);
  if (Number.isNaN(at.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Where they would collect it, named the way they would look for it. */
export function collectLine(q: QuoteResponse): string {
  return [q.to.name, q.to.landmark, q.to.area].filter(Boolean).join(' · ');
}

/**
 * What to tell a BUYER when a quote fails.
 *
 * Deliberately not the server's `detail`, which is written for a developer and can name our internals. The
 * stable `code` is mapped to a sentence about their situation; anything unrecognised falls back to the
 * server's title, and a dead network falls back to the one thing that is certainly true.
 */
export function errorLine(problem: Problem | null, s: Strings): string {
  if (!problem) return s.offline;
  switch (problem.code) {
    case 'NOT_FOUND':
      return 'We have no collection point there yet — try a nearby area.';
    case 'NO_CAPACITY_AVAILABLE':
      return 'Every collection point there is full right now — try a nearby area.';
    case 'CARGO_REQUIRES_DEDICATED':
      return 'This is too big for our pick-up network. The seller can arrange freight for it.';
    case 'FX_REQUIRED':
      return 'We cannot price that route yet. Please ask the seller.';
    case 'RATE_LIMITED':
      return 'One moment — too many requests just now. Try again shortly.';
    default:
      return problem.title || s.offline;
  }
}

/** Countries and their areas, sorted the way a picker should read. Anything malformed is dropped. */
export function parseAreas(raw: unknown): Array<{ country: string; areas: string[] }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is { country: string; areas: string[] } => Boolean(r) && typeof (r as { country?: unknown }).country === 'string' && Array.isArray((r as { areas?: unknown }).areas))
    .map((r) => ({ country: r.country, areas: [...r.areas].filter((a) => typeof a === 'string').sort() }))
    .filter((r) => r.areas.length > 0)
    .sort((a, b) => a.country.localeCompare(b.country));
}
