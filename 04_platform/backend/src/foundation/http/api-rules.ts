import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 2026-11-03 — A NEW RULE INSIDE A VERSION OF THE API COMES WITH NOTICE (the user: "Notice first, build now").
 *
 * A version that changes what a call means is a new path (api-versions.ts). But a version can also gain a rule — a field
 * now required, a refusal it did not make — and that breaks a company's system as surely as retiring the version. So a
 * rule change is written here first: what it refuses, when it was announced, and from when it refuses. Until then a
 * company's system is answered as before, with a header saying which rule will refuse this call and from when
 * (`Sbg-Rule-Change`), and every company holding a live key is told in its bell and by email when it is announced and again
 * shortly before (ApiVersionNoticeService). A person in an app is refused from the day a rule ships: they read the
 * refusal and answer it; only a system needs time to be changed.
 *
 * The notice: 90 days, or 30 for a rule that keeps people safe (dangerous goods, a seal, the cold chain).
 */
export interface ApiRuleChange {
  /** Stable, in the header and the list: never reused. */
  id: string;
  /** The version of the API it applies to. */
  version: string;
  /** What it refuses, in words, for the list of changes and the notices. */
  summary: string;
  announcedAt: string;
  /** From when a system's call is refused. */
  enforcedFrom: string;
  /** A rule that keeps people safe: 30 days' notice instead of 90. */
  safety?: boolean;
  /** In force from the day it shipped, before the notice promise and before any company's system was connected. */
  fromRelease?: true;
}

export const RULE_NOTICE_DAYS = 90;
export const SAFETY_RULE_NOTICE_DAYS = 30;
/** The second notice: a month before an ordinary rule refuses, a week before a safety rule. */
export const RULE_LAST_NOTICE_DAYS = 30;
export const SAFETY_RULE_LAST_NOTICE_DAYS = 7;
/** The day the notice promise began. A rule in force before it shipped when no company's system was connected. */
export const RULE_NOTICE_SINCE = '2026-11-03';

export const API_RULE_CHANGES: readonly ApiRuleChange[] = [
  {
    id: 'dangerous-goods-un-number',
    version: '1',
    summary: 'A load of dangerous goods (chemical, biological or flammable) is refused without its UN number, proper shipping name and class.',
    announcedAt: '2026-10-29',
    enforcedFrom: '2026-10-29',
    safety: true,
    fromRelease: true,
  },
  {
    // 2026-11-03 — the emissions of a trip start from what the vehicle runs on (EN ISO 14083); fleet.config VEHICLE_ENERGIES.
    id: 'vehicle-energy',
    version: '1',
    summary: 'A vehicle is registered with what it runs on (energy: petrol, diesel, electric, hybrid, gas, or pedal for a bicycle).',
    announcedAt: '2026-11-03',
    enforcedFrom: '2027-02-01',
  },
];

const DAY = 86_400_000;

/** The notice a rule must be given, in days. */
export const noticeDaysOf = (rule: Pick<ApiRuleChange, 'safety'>): number => (rule.safety ? SAFETY_RULE_NOTICE_DAYS : RULE_NOTICE_DAYS);
/** When the second notice is due: a month (or a week) before it refuses. */
export const lastNoticeAt = (rule: Pick<ApiRuleChange, 'safety' | 'enforcedFrom'>): number => Date.parse(rule.enforcedFrom) - (rule.safety ? SAFETY_RULE_LAST_NOTICE_DAYS : RULE_LAST_NOTICE_DAYS) * DAY;

/** Every rule change that breaks the promise, in words. Empty when all keep it. */
/** `versions`: the API's versions (API_VERSIONS), handed in so the two files do not import each other. */
export function checkRuleSchedules(rules: readonly ApiRuleChange[], versions: readonly { version: string }[]): string[] {
  const broken: string[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) broken.push(`${r.id} is listed twice`);
    seen.add(r.id);
    if (!versions.some((v) => v.version === r.version)) broken.push(`${r.id} names version ${r.version}, which does not exist`);
    if (Number.isNaN(Date.parse(r.announcedAt)) || Number.isNaN(Date.parse(r.enforcedFrom))) {
      broken.push(`${r.id} has a date that is not a date`);
      continue;
    }
    if (r.fromRelease) {
      if (Date.parse(r.enforcedFrom) >= Date.parse(RULE_NOTICE_SINCE)) broken.push(`${r.id} is in force from release, but came after the notice promise (${RULE_NOTICE_SINCE})`);
    } else if (Date.parse(r.enforcedFrom) - Date.parse(r.announcedAt) < noticeDaysOf(r) * DAY) {
      broken.push(`${r.id} refuses less than ${noticeDaysOf(r)} days after it was announced`);
    }
  }
  return broken;
}

/** The rules a company's system is warned of in this call — set by ApiVersionInterceptor around every call. */
const systemsCall = new AsyncLocalStorage<{ warned: ApiRuleChange[] }>();

/** The store of the call in progress, for the interceptor to read once the call is answered. */
export function systemsCallStore(): { warned: ApiRuleChange[] } | undefined {
  return systemsCall.getStore();
}
export function runAsSystemsCall<T>(store: { warned: ApiRuleChange[] }, fn: () => T): T {
  return systemsCall.run(store, fn);
}

/**
 * Whether the rule refuses this call now. A person in an app: from the day it ships. A company's system: from the day it
 * is in force — before that the call is answered as before, and the rule is named in the answer's headers.
 */
export function ruleRefuses(id: string, now: number = Date.now(), rules: readonly ApiRuleChange[] = API_RULE_CHANGES): boolean {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`No API rule change is called ${id}: write it in API_RULE_CHANGES first`);
  const call = systemsCall.getStore();
  if (!call) return true;
  if (now >= Date.parse(rule.enforcedFrom)) return true;
  if (!call.warned.includes(rule)) call.warned.push(rule);
  return false;
}

/** The header naming the rules that will refuse this call: `id; enforced-from=YYYY-MM-DD`, comma-separated. */
export function ruleWarningHeader(warned: readonly ApiRuleChange[]): string | undefined {
  if (!warned.length) return undefined;
  return warned.map((r) => `${r.id}; enforced-from=${r.enforcedFrom.slice(0, 10)}`).join(', ');
}
