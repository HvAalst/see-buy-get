/**
 * Pure front-door logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 *
 * This app answers two questions a newcomer has and no other app could: WHICH app am I,
 * and how do I get an account at all (every other PWA can only sign an existing
 * participant in — joining lived nowhere until now).
 */

import type { IconName } from '../../shared/ui/Icon';
import type { MessageKey, Translate } from '../../shared/i18n';

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
  /* role extras */
  licenceClasses: string[];
  vendorCountry: string;
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
  licenceClasses: ['bike'],
  vendorCountry: '',
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
export function stepBlocker(role: RoleSpec, step: JoinStep, f: JoinForm, t: Translate): string | null {
  switch (step) {
    case 'phone':
      return phoneLooksValid(f.phone) ? null : t('home.block.phone');
    case 'code':
      return codeLooksValid(f.code) ? null : t('home.block.code');
    case 'about':
      if (role.kind === 'vendor') return f.displayName.trim() ? null : t('home.block.nameStore');
      if (!f.displayName.trim()) return role.id === 'pudo' ? t('home.block.nameShop') : role.id === 'mdp' ? t('home.block.nameHub') : t('home.block.nameGeneric');
      if (role.id !== 'mdp' && !f.fullName.trim()) return t('home.block.fullName');
      if (role.id !== 'mdp' && !f.nationalId.trim()) return t('home.block.idNumber');
      if (role.id === 'driver' && f.licenceClasses.length === 0) return t('home.block.drive');
      return null;
    case 'where':
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
          homeZone: f.zone.trim(),
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
