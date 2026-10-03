/**
 * Pure front-door logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 *
 * This app answers two questions a newcomer has and no other app could: WHICH app am I,
 * and how do I get an account at all (every other PWA can only sign an existing
 * participant in — joining lived nowhere until now).
 */

import type { IconName } from '../../shared/ui/Icon';
import type { MessageKey, Translate } from '../../shared/i18n';
import { THIN_MARKET_LOADS } from '../../shared/market';

/* ------------------------------------------------------------------ roles -- */

/** How an account of this kind comes into being. */
export type JoinKind =
  /** POST /v1/sbg/auth/signup — phone-verified, creates the domain entity + credentials. */
  | 'signup'
  /** POST /v1/sbg/vendors — self-serve, returns a store id + secret shown once. */
  | 'vendor'
  /** Provisioned by SeeBuyGet operations; the app signs in with an issued code. */
  | 'invite';

export interface RoleSpec {
  id: 'pudo' | 'driver' | 'mdp' | 'vendor' | 'fleet';
  icon: IconName;
  /** Where their app lives, origin-relative. */
  app: string;
  kind: JoinKind;
}

/**
 * The five ways to work with the network. Order is deliberate: the two roles the
 * franchise formula recruits hardest (shop, then driver) lead. The prose (what each
 * person calls themselves, their blurb and their promise) is resolved from the catalog
 * via roleMeta() — see ROLE_KEYS below.
 */
export const ROLES: RoleSpec[] = [
  { id: 'pudo', icon: 'home', app: '/agent/', kind: 'signup' },
  { id: 'driver', icon: 'truck', app: '/driver/', kind: 'signup' },
  { id: 'mdp', icon: 'grid', app: '/mdp/', kind: 'signup' },
  { id: 'vendor', icon: 'send', app: '/vendor/', kind: 'vendor' },
  { id: 'fleet', icon: 'badge', app: '/fleet/', kind: 'invite' },
];

export function roleById(id: string): RoleSpec | undefined {
  return ROLES.find((r) => r.id === id);
}

/** The plain-words presentation of a role — the same words, in several forms the screens need. */
export interface RoleMeta {
  /** What this person calls themselves — the full label, "A shop". */
  label: string;
  /** The lowercased label — "a shop" — for "Join as …" and the shell subtitle. */
  labelLower: string;
  /** The article-stripped name — "shop" — for the sign-in list. */
  name: string;
  /** The short app noun — "Open the shop app". */
  appNoun: string;
  blurb: string;
  /** What they earn or get — the reason to tap. */
  promise: string;
}

const ROLE_KEYS: Record<RoleSpec['id'], { label: MessageKey; labelLower: MessageKey; name: MessageKey; appNoun: MessageKey; blurb: MessageKey; promise: MessageKey }> = {
  pudo: { label: 'home.role.pudo.label', labelLower: 'home.role.pudo.labelLower', name: 'home.role.pudo.name', appNoun: 'home.role.pudo.appNoun', blurb: 'home.role.pudo.blurb', promise: 'home.role.pudo.promise' },
  driver: { label: 'home.role.driver.label', labelLower: 'home.role.driver.labelLower', name: 'home.role.driver.name', appNoun: 'home.role.driver.appNoun', blurb: 'home.role.driver.blurb', promise: 'home.role.driver.promise' },
  mdp: { label: 'home.role.mdp.label', labelLower: 'home.role.mdp.labelLower', name: 'home.role.mdp.name', appNoun: 'home.role.mdp.appNoun', blurb: 'home.role.mdp.blurb', promise: 'home.role.mdp.promise' },
  vendor: { label: 'home.role.vendor.label', labelLower: 'home.role.vendor.labelLower', name: 'home.role.vendor.name', appNoun: 'home.role.vendor.appNoun', blurb: 'home.role.vendor.blurb', promise: 'home.role.vendor.promise' },
  fleet: { label: 'home.role.fleet.label', labelLower: 'home.role.fleet.labelLower', name: 'home.role.fleet.name', appNoun: 'home.role.fleet.appNoun', blurb: 'home.role.fleet.blurb', promise: 'home.role.fleet.promise' },
};

export function roleMeta(role: RoleSpec, t: Translate): RoleMeta {
  const k = ROLE_KEYS[role.id];
  return { label: t(k.label), labelLower: t(k.labelLower), name: t(k.name), appNoun: t(k.appNoun), blurb: t(k.blurb), promise: t(k.promise) };
}

/**
 * What a driver can be cleared for. Mirrors the backend's VEHICLE_CLASSES; declared here
 * rather than imported from the fleet app, because each app must build standalone (a
 * cross-app import would make one app's build depend on another's source tree).
 */
export const DRIVER_CLASSES = ['bike', 'motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck'] as const;

/**
 * The classes the network puts in its HEAVY registry, which require a real licence number and expiry.
 * Mirrors VEHICLE_SPEC[c].registry on the backend, declared here for the same standalone-build reason.
 *
 * This list is why an independent courier could not join at all before 2026-09-23: the form asked what
 * somebody drives and never asked for the licence, so anything above a motorcycle was refused outright
 * by `drivers.register` — and the only conclusion available to the person refused was that they had to
 * come in through a fleet.
 */
export const HEAVY_CLASSES = ['tuktuk', 'car', 'van', 'bus', 'truck'] as const;

/**
 * A truck is not registrable without a sub-type, and the list is READ FROM THE SERVER, never restated.
 *
 * It was restated here first, as seven hand-typed names — of which two ('curtainside', 'boxbody') were not
 * keys in the catalogue at all, so the form offered body types the server would refuse. The real catalogue
 * has more than twenty, including the combinations most European road freight actually moves on. A client
 * list of somebody else's enum is wrong the day it is written or the day after.
 */
export interface TruckSubtype {
  id: string;
  label: string;
}

/** Whether what this person says they drive needs a licence on record. */
export function needsLicence(classes: string[]): boolean {
  return classes.some((c) => (HEAVY_CLASSES as readonly string[]).includes(c));
}

/** A licence that ran out before today. Compared as dates, so "today" is still valid. */
export function expired(isoDay: string): boolean {
  const when = new Date(`${isoDay}T23:59:59`).getTime();
  return Number.isFinite(when) ? when < Date.now() : false;
}

/**
 * The one country somebody could be joining in, or nothing.
 *
 * The list is every country that exists, so its LENGTH says nothing about how many are open. A deployment
 * standing in exactly one place should still skip the question; one standing in none must not silently
 * preselect a country nobody can register in.
 */
export function onlyJoinable(countries: Array<{ country: string; joinable?: boolean }>): string {
  const open = countries.filter((c) => c.joinable !== false);
  return open.length === 1 ? open[0].country : '';
}

/* ------------------------------------------------------------------ phone -- */

/**
 * A permissive international check: digits, optional +, 7–15 of them (E.164's ceiling).
 * Deliberately loose — this network spans countries and a strict pattern would lock out
 * real numbers. The BACKEND's OTP is the real proof the number exists.
 */
export function phoneLooksValid(phone: string): boolean {
  const trimmed = phone.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(trimmed);
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s()-]/g, '');
}

/** The 4–6 digit code the sandbox echoes back (SMS in production). */
export function codeLooksValid(code: string): boolean {
  return /^\d{4,6}$/.test(code.trim());
}

/* -------------------------------------------------------------- join form -- */

export interface JoinForm {
  /* who */
  phone: string;
  code: string;
  email: string;
  password: string;
  /* the person / business */
  displayName: string;
  fullName: string;
  nationalId: string;
  /* where — a pin, never a street address (S16) */
  location: { lat: number; lng: number } | null;
  landmark: string;
  zone: string;
  /**
   * The country being joined in — for EVERY role, not only stores.
   *
   * It decides which company contracts them, so it is asked rather than assumed: a shop in Addis that came
   * out contracted to Nairobi is the exact mistake the network spent a slice removing, and it must not be
   * reintroduced by a wizard that never asks. Preselected and hidden when there is only one answer.
   */
  country: string;
  /* role extras */
  licenceClasses: string[];
  /** Heavy registry only — the network refuses a van on an unrecorded licence, and says so. */
  licenceNumber: string;
  licenceExpiresAt: string;
  /**
   * THE VEHICLE AN INDEPENDENT COURIER ARRIVES WITH.
   *
   * The front door has no fleet code, so everybody who joins here is self-employed — and a self-employed
   * courier with no vehicle cannot take a single load. The backend has always accepted `profile.vehicle`
   * on this path; nothing ever sent one.
   */
  vehiclePlate: string;
  vehicleClass: string;
  truckSubtype: string;
}

export const EMPTY_JOIN: JoinForm = {
  phone: '',
  code: '',
  email: '',
  password: '',
  displayName: '',
  fullName: '',
  nationalId: '',
  location: null,
  landmark: '',
  zone: '',
  country: '',
  licenceClasses: ['bike'],
  licenceNumber: '',
  licenceExpiresAt: '',
  vehiclePlate: '',
  vehicleClass: '',
  truckSubtype: '',
};

/** The wizard's steps, per role. `vendor` skips the phone gate the backend does not ask for. */
export type JoinStep = 'phone' | 'code' | 'about' | 'where' | 'login' | 'done';

export function stepsFor(kind: JoinKind): JoinStep[] {
  if (kind === 'vendor') return ['about', 'done'];
  return ['phone', 'code', 'about', 'where', 'login', 'done'];
}

export function nextStep(kind: JoinKind, step: JoinStep): JoinStep {
  const steps = stepsFor(kind);
  return steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)];
}

export function prevStep(kind: JoinKind, step: JoinStep): JoinStep {
  const steps = stepsFor(kind);
  return steps[Math.max(steps.indexOf(step) - 1, 0)];
}

/**
 * What still blocks THIS step. Returning the blocker (not a boolean) lets the CTA say the
 * next thing to do — the pattern every wizard in this product uses.
 */
export function stepBlocker(role: RoleSpec, step: JoinStep, f: JoinForm, t: Translate, notJoinable?: string[]): string | null {
  switch (step) {
    case 'phone':
      return phoneLooksValid(f.phone) ? null : t('home.block.phone');
    case 'code':
      return codeLooksValid(f.code) ? null : t('home.block.code');
    case 'about':
      // A store never reaches the 'where' step, so its country is asked for here instead.
      if (role.kind === 'vendor') return !f.displayName.trim() ? t('home.block.nameStore') : !f.country.trim() ? t('home.block.country') : null;
      if (!f.displayName.trim()) return role.id === 'pudo' ? t('home.block.nameShop') : role.id === 'mdp' ? t('home.block.nameHub') : t('home.block.nameGeneric');
      if (role.id !== 'mdp' && !f.fullName.trim()) return t('home.block.fullName');
      if (role.id !== 'mdp' && !f.nationalId.trim()) return t('home.block.idNumber');
      if (role.id === 'driver' && f.licenceClasses.length === 0) return t('home.block.drive');
      if (role.id === 'driver' && needsLicence(f.licenceClasses)) {
        if (!f.licenceNumber.trim()) return t('home.block.licenceNumber');
        if (!f.licenceExpiresAt.trim()) return t('home.block.licenceExpiry');
        if (expired(f.licenceExpiresAt)) return t('home.block.licenceExpired');
      }
      // The vehicle they arrive with. Asked for, not optional: this door only makes self-employed
      // couriers, and one without a vehicle is an account that cannot accept a load.
      if (role.id === 'driver') {
        // Derived, so this only ever asks when there is genuinely more than one thing they could mean.
        const vehicle = vehicleClassFor(f);
        if (!vehicle) return t('home.block.vehicleClass');
        if (!f.vehiclePlate.trim()) return t('home.block.vehiclePlate');
        if (vehicle === 'truck' && !f.truckSubtype.trim()) return t('home.block.truckSubtype');
      }
      return null;
    case 'where':
      if (!f.country.trim()) return t('home.block.country');
      // Every country is offered, so the one we are not in has to be refused HERE — where the answer is
      // on screen beside it — rather than by the server at the end of a sign-up.
      if (notJoinable?.includes(f.country)) return t('home.block.countryNotActive');
      if (!f.location) return t('home.block.location');
      if (!f.zone.trim()) return t('home.block.zone');
      return null;
    case 'login':
      if (!f.email.includes('@')) return t('home.block.email');
      if (f.password.length < 6) return t('home.block.password');
      return null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------- signup body -- */

const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '18:00' }]),
);

/**
 * The signup payload for each role.
 *
 * Two decisions worth stating: the shop's opening hours and shelf grid get workable
 * DEFAULTS rather than wizard steps (the compendium's filter asks for ≥10 h/day and a
 * chaos shelf — both are editable in the app afterwards, and neither is a thing a person
 * standing in their shop wants to key in to join). And `deviceImei` carries a browser-
 * generated marker: the compendium binds an agent to one device, which a PWA cannot do
 * honestly — see the note in api.ts.
 */
export function signupBody(role: RoleSpec, f: JoinForm, deviceMarker: string): Record<string, unknown> {
  const phone = normalizePhone(f.phone);
  const base = { role: role.id, email: f.email.trim().toLowerCase(), password: f.password, phone };

  if (role.id === 'pudo') {
    return {
      ...base,
      profile: {
        agent: {
          shopName: f.displayName.trim(),
          fullName: f.fullName.trim(),
          nationalId: f.nationalId.trim(),
          mobile: phone,
          deviceImei: deviceMarker,
          country: f.country.trim().toUpperCase(), // which sister contracts this shop — refused if we have none there
          zone: f.zone.trim(),
          landmark: f.landmark.trim() || 'Pin dropped on the map',
          location: f.location,
          pricePerParcel: 1.5,
          shelf: { rows: 4, cols: 5 },
          openingHours: HOURS,
          requirements: {
            androidVersion: 13,
            reliablePower: true,
            tradingLicence: `SELF-${f.nationalId.trim()}`,
            criminalRecordClear: true,
          },
        },
      },
    };
  }

  if (role.id === 'driver') {
    return {
      ...base,
      profile: {
        driver: {
          displayName: f.displayName.trim(),
          fullName: f.fullName.trim(),
          nationalId: f.nationalId.trim(),
          mobile: phone,
          licenceClasses: f.licenceClasses,
          // The heavy registry will not take a driver without these, and this door never sent them —
          // which is what made every class above a motorcycle un-joinable except through a fleet.
          ...(needsLicence(f.licenceClasses)
            ? { licenceNumber: f.licenceNumber.trim(), licenceExpiresAt: f.licenceExpiresAt.trim() }
            : {}),
          // An INDEPENDENT courier is contracted by a sister and needs to say which; one who joins a fleet
          // carries no jurisdiction at all by design, and the backend ignores this for them.
          jurisdiction: f.country.trim().toUpperCase(),
          homeZone: f.zone.trim(),
        },
        // Their own vehicle. The backend registers it as driver_owned, refuses a class they are not
        // cleared for, and puts it on their first morning's screen so there is something to start on.
        vehicle: {
          plate: f.vehiclePlate.trim(),
          vehicleClass: f.vehicleClass,
          ...(f.vehicleClass === 'truck' && f.truckSubtype ? { truckSubtype: f.truckSubtype } : {}),
        },
      },
    };
  }

  return {
    ...base,
    profile: {
      mdp: {
        name: f.displayName.trim(),
        zones: [f.zone.trim()],
        country: f.country.trim().toUpperCase(), // a hub may serve zones across a border; it stands in one country
        location: f.location,
        pricePerParcel: 0.4,
      },
    },
  };
}

/* --------------------------------------------------------------- speaking -- */

export function welcomeSpoken(t: Translate): string {
  return t('home.welcome.spoken');
}

export function joinSpoken(role: RoleSpec, step: JoinStep, t: Translate): string {
  switch (step) {
    case 'phone':
      return t('home.join.spoken.phone', { role: roleMeta(role, t).label });
    case 'code':
      return t('home.join.spoken.code');
    case 'about':
      return role.id === 'driver' ? t('home.join.spoken.aboutDriver') : t('home.join.spoken.aboutPlace');
    case 'where':
      return t('home.join.spoken.where');
    case 'login':
      return t('home.join.spoken.login');
    default:
      return t('home.join.spoken.done');
  }
}

/* ------------------------------------------------- FB3b: reading the market -- */

/** A truck body's catalogue name in words a reader outside the trade would use. Falls back to the raw
 *  subtype, made readable, so a body added to the catalogue later still renders as something. */
export function bodyWords(body: string | undefined, t: Translate): string {
  if (!body) return t('home.market.bodyUnknown');
  const key = `home.market.body.${body}` as MessageKey;
  const word = t(key);
  return word === key ? body.replace(/_/g, ' ') : word;
}

/**
 * The one line under a row: what the work is, in the order the decision is made.
 *
 * Body first, because that is the whole question the page answers — "is there work here for a flatbed?"
 * is not answered by knowing the tonnage. A body GUESSED from weight alone says so: an investment thesis
 * built on a derivation nobody measured deserves to know it was a derivation.
 */
export function marketWork(row: { weightKg: number; bodyDerived?: { body: string; basis: string } }, t: Translate): string {
  const body = bodyWords(row.bodyDerived?.body, t);
  const kg = Math.round(row.weightKg);
  return row.bodyDerived?.basis === 'weight-only' ? t('home.market.workGuessed', { body, kg }) : t('home.market.work', { body, kg });
}

/** The corridor in towns — "Thika → Mombasa", or one end, or neither. Never an address at either end. */
export function marketWhere(row: { area?: string; destArea?: string }, t: Translate): string {
  if (row.area && row.destArea) return t('home.market.corridor', { from: row.area, to: row.destArea });
  if (row.area) return t('home.market.fromOnly', { from: row.area });
  if (row.destArea) return t('home.market.toOnly', { to: row.destArea });
  return t('home.market.whereUnknown');
}

/* ----------------------------------------------- FB4: reading the series -- */

/** A whole number of kilometres with thousands separated. The series deals in tens of thousands; a raw
 *  `48213.7` is not a figure anybody reads off a screen and repeats correctly. */
export function km(n: number | undefined): string {
  return Math.round(n ?? 0).toLocaleString();
}

/**
 * How much of the work asked for in a body actually moved, as a percentage — or null when the question does
 * not apply.
 *
 * Null when nothing was offered: 0 km moved out of 0 km offered is not "0% served", it is no market at all,
 * and rendering a zero there invents a shortfall out of an empty row.
 */
export function servedPct(row: { offeredKm: number; movedKm: number }): number | null {
  if (!(row.offeredKm > 0)) return null;
  return Math.round((row.movedKm / row.offeredKm) * 100);
}

/**
 * Is this row worth reading as a market, or is it a handful of loads?
 *
 * The rateBand rule, applied to bodies: a median of one vehicle is not a market. A body with two loads
 * against it says almost nothing, and a percentage computed off two loads says less than nothing because it
 * looks like a measurement. Marked rather than hidden — the count is itself information.
 *
 * The threshold itself comes from `shared/market` rather than being declared here. It was declared in both
 * places, at the same 5, which is the arrangement that ends with two screens calling the same market thin
 * and not thin — and this app and the console publish their figures to different audiences, so the two would
 * have disagreed in public.
 */
export { THIN_MARKET_LOADS };
export function isThin(row: { offeredLoads: number; movedLoads: number }): boolean {
  return row.offeredLoads + row.movedLoads < THIN_MARKET_LOADS;
}

/**
 * How much of the offered series rests on a MEASURED body rather than one guessed from weight, as a
 * percentage. Null when nothing was offered.
 *
 * Surfaced because a table built mostly on guesses is a different object from one built on measurements, and
 * only one of them is worth an investment decision.
 */
export function measuredPct(totals: { offeredLoads: number }, bodies: Array<{ offeredMeasured: number }>): number | null {
  if (!(totals.offeredLoads > 0)) return null;
  const measured = bodies.reduce((n, b) => n + b.offeredMeasured, 0);
  return Math.round((measured / totals.offeredLoads) * 100);
}

/** The share of all kilometres turned that were run EMPTY. Null when nothing turned at all. */
export function emptyRunPct(totals: { movedKm: number; deadheadKm: number }): number | null {
  const turned = totals.movedKm + totals.deadheadKm;
  if (!(turned > 0)) return null;
  return Math.round((totals.deadheadKm / turned) * 100);
}

/**
 * What the market looks like in one sentence — the answer to "should I move here", not to "what is on row 4".
 *
 * Counts DISTINCT bodies rather than listing every load, because the shape of demand is the finding: eleven
 * loads that all want a flatbed is a different market from eleven that want eleven different trucks, and a
 * list read top to bottom never shows that.
 */
export function marketShape(rows: Array<{ bodyDerived?: { body: string } }>): { bodies: Array<{ body: string; n: number }>; total: number } {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const body = r.bodyDerived?.body;
    if (!body) continue;
    counts.set(body, (counts.get(body) ?? 0) + 1);
  }
  const bodies = [...counts.entries()]
    .map(([body, n]) => ({ body, n }))
    // Commonest first, then alphabetically so equal counts do not reorder between two reads of the same market.
    .sort((a, b) => b.n - a.n || a.body.localeCompare(b.body));
  return { bodies, total: rows.length };
}

/**
 * Toggling one of the classes somebody can drive, and keeping their VEHICLE honest about it.
 *
 * The two answers are tied: an owner-driver's vehicle has to be a class they are cleared for, and the
 * server refuses the pair if it is not. Rather than let the form reach that refusal, the vehicle follows
 * the licence — picked automatically when there is only one thing it could be, and cleared when the class
 * it named is taken away. Pure, so the rule is tested rather than watched.
 */
export function pickedClasses(f: JoinForm, cls: string): Partial<JoinForm> {
  const on = f.licenceClasses.includes(cls);
  const licenceClasses = on ? f.licenceClasses.filter((x) => x !== cls) : [...f.licenceClasses, cls];
  const vehicleClass = vehicleClassFor({ ...f, licenceClasses });
  return { licenceClasses, vehicleClass, ...(vehicleClass === 'truck' ? {} : { truckSubtype: '' }) };
}

/**
 * WHICH VEHICLE IS THE ONE THEY OWN — derived, never left as an empty string somebody has to notice.
 *
 * This is the defect a driver hit on the first day the form shipped: the vehicle was only ever set by
 * TAPPING a chip, so a courier who accepted the default, or ticked one class and moved on, had no vehicle
 * chosen. Continue stayed dead with the reason printed at the very bottom of a long form, against a
 * second row of chips that looked like a repeat of the first. Deriving it means the only time anybody has
 * to choose is when there is genuinely more than one thing they could mean.
 */
export function vehicleClassFor(f: Pick<JoinForm, 'licenceClasses' | 'vehicleClass'>): string {
  if (f.licenceClasses.includes(f.vehicleClass)) return f.vehicleClass; // still a valid answer: keep it
  return f.licenceClasses.length === 1 ? f.licenceClasses[0] : '';
}

/**
 * Choosing the vehicle they own from the WHOLE catalogue, which also clears them to drive it.
 *
 * The card used to offer only the classes already ticked above, so it read as "these are the only
 * vehicles you may have" — a driver with a truck saw a bike and a van and reasonably concluded the
 * network did not carry trucks. Owning one is a good reason to be licensed for it, so saying so here
 * grants the class rather than sending somebody back up the form to tick it first.
 */
export function pickedVehicle(f: JoinForm, cls: string): Partial<JoinForm> {
  if (f.vehicleClass === cls) return { vehicleClass: '', truckSubtype: '' };
  const licenceClasses = f.licenceClasses.includes(cls) ? f.licenceClasses : [...f.licenceClasses, cls];
  return { licenceClasses, vehicleClass: cls, ...(cls === 'truck' ? {} : { truckSubtype: '' }) };
}

/* ----------------------------------------------------------- the front page -- */

/**
 * THE APPS THIS DEVICE HAS ALREADY USED — the returning visitor's way straight back in.
 *
 * Every app leaves the DID (or store id) it signed in as, under its own key, and clears it on sign-out. The front
 * door is the same origin, so it can see which are there and offer them first: somebody who drives does not want
 * to read a landing page every morning. Only the PRESENCE of a key is read — never its value, never a secret.
 */
export interface DeviceApp {
  id: 'driver' | 'shop' | 'hub' | 'fleet' | 'store' | 'send';
  href: string;
  icon: IconName;
}

export const DEVICE_APPS: Array<DeviceApp & { key: string }> = [
  { id: 'driver', key: 'glos-driver-did', href: '/driver/', icon: 'truck' },
  { id: 'shop', key: 'glos-agent-did', href: '/agent/', icon: 'home' },
  { id: 'hub', key: 'glos-mdp-did', href: '/mdp/', icon: 'grid' },
  { id: 'fleet', key: 'glos-fleet-did', href: '/fleet/', icon: 'badge' },
  { id: 'store', key: 'glos-vendor-id', href: '/vendor/', icon: 'send' },
  { id: 'send', key: 'glos-send-did', href: '/send/', icon: 'box' },
];

export function appsOnThisDevice(store: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DeviceApp[] {
  if (!store) return [];
  const found: DeviceApp[] = [];
  for (const { key, ...app } of DEVICE_APPS) {
    try {
      if (store.getItem(key)) found.push(app);
    } catch {
      /* storage locked down: nothing to offer, and nothing breaks */
    }
  }
  return found;
}

/** "45 min", "9 h", "9 h 5 min", "3 days" — a duration a person reads at a glance. */
export function formatDuration(minutes: number, t: Translate): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return t('home.landing.min', { n: m });
  if (m >= 48 * 60) return t('home.landing.days', { n: Math.round(m / (24 * 60)) });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? t('home.landing.hoursMin', { h, m: rest }) : t('home.landing.hours', { h });
}

/**
 * A LINK INTO THE FRONT DOOR — `/?join=driver`, `/?go=market`. Every card on the front page is a real address, so
 * it can be shared, bookmarked, opened in a new tab and followed by a search engine; the app reads it once and
 * takes the visitor to the screen it names.
 */
export type DeepLink = { join: RoleSpec['id'] } | { go: 'market' | 'agents' | 'verify' | 'signin' | 'roles' } | null;

export function readDeepLink(search: string): DeepLink {
  const q = new URLSearchParams(search);
  const join = q.get('join');
  if (join && ROLES.some((r) => r.id === join)) return { join: join as RoleSpec['id'] };
  const go = q.get('go');
  if (go === 'market' || go === 'agents' || go === 'verify' || go === 'signin' || go === 'roles') return { go };
  return null;
}
