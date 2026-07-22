/**
 * Pure front-door logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 *
 * This app answers two questions a newcomer has and no other app could: WHICH app am I,
 * and how do I get an account at all (every other PWA can only sign an existing
 * participant in — joining lived nowhere until now).
 */

import type { IconName } from '../../shared/ui/Icon';

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
  /** What this person calls themselves, not what the schema calls them. */
  label: string;
  blurb: string;
  /** What they earn or get — the reason to tap. */
  promise: string;
  icon: IconName;
  /** Where their app lives, origin-relative. */
  app: string;
  kind: JoinKind;
}

/**
 * The five ways to work with the network. Order is deliberate: the two roles the
 * franchise formula recruits hardest (shop, then driver) lead.
 */
export const ROLES: RoleSpec[] = [
  {
    id: 'pudo',
    label: 'A shop',
    blurb: 'Take in and hand out parcels from your counter.',
    promise: 'Earn on every parcel. Connect your community.',
    icon: 'home',
    app: '/agent/',
    kind: 'signup',
  },
  {
    id: 'driver',
    label: 'A driver',
    blurb: 'Carry parcels on the road you already drive.',
    promise: 'Fill your empty space. Get paid per load.',
    icon: 'truck',
    app: '/driver/',
    kind: 'signup',
  },
  {
    id: 'mdp',
    label: 'A sort hub',
    blurb: 'Sort parcels between routes for the network.',
    promise: 'Earn a fee on every parcel you sort.',
    icon: 'grid',
    app: '/mdp/',
    kind: 'signup',
  },
  {
    id: 'vendor',
    label: 'An online store',
    blurb: 'Ship your orders to a shop the buyer picks.',
    promise: 'Click-and-collect without your own couriers.',
    icon: 'send',
    app: '/vendor/',
    kind: 'vendor',
  },
  {
    id: 'fleet',
    label: 'A fleet office',
    blurb: 'Run vehicles and drivers on the network.',
    promise: 'Dispatch, shifts and cargo in one console.',
    icon: 'badge',
    app: '/fleet/',
    kind: 'invite',
  },
];

export function roleById(id: string): RoleSpec | undefined {
  return ROLES.find((r) => r.id === id);
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
export function stepBlocker(role: RoleSpec, step: JoinStep, f: JoinForm): string | null {
  switch (step) {
    case 'phone':
      return phoneLooksValid(f.phone) ? null : 'Type the phone number you use every day.';
    case 'code':
      return codeLooksValid(f.code) ? null : 'Type the code we sent you.';
    case 'about':
      if (role.kind === 'vendor') return f.displayName.trim() ? null : 'Name your store.';
      if (!f.displayName.trim()) return role.id === 'pudo' ? 'Name your shop.' : role.id === 'mdp' ? 'Name your hub.' : 'Type the name people will see.';
      if (role.id !== 'mdp' && !f.fullName.trim()) return 'Type your full name.';
      if (role.id !== 'mdp' && !f.nationalId.trim()) return 'Type your ID number.';
      if (role.id === 'driver' && f.licenceClasses.length === 0) return 'Pick what you drive.';
      return null;
    case 'where':
      if (!f.location) return 'Tap the map to drop a pin where you are.';
      if (!f.zone.trim()) return 'Pick the area you serve.';
      return null;
    case 'login':
      if (!f.email.includes('@')) return 'Type an email you can open.';
      if (f.password.length < 6) return 'Use at least 6 characters.';
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

export function welcomeSpoken(): string {
  return 'Welcome to SeeBuyGet. Send a parcel, track one, or join the network as a shop, a driver, a hub or a store.';
}

export function joinSpoken(role: RoleSpec, step: JoinStep): string {
  switch (step) {
    case 'phone':
      return `Joining as ${role.label}. Type the phone number you use every day — we send a code to it.`;
    case 'code':
      return 'Type the code we just sent to your phone.';
    case 'about':
      return `Tell us about ${role.id === 'driver' ? 'yourself' : 'your place'}.`;
    case 'where':
      return 'Tap the map to show where you are. No street address needed.';
    case 'login':
      return 'Last step. Pick an email and a password to sign in with.';
    default:
      return 'You are in.';
  }
}
