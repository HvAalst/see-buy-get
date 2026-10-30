import { isSandbox } from './sandbox';

/**
 * THE OWNER'S STAND-IN CODES — the user, 2026-10-30: "I will give you my phone number and preferred six digit code for
 * confirmation before I wire in twillio so I can go through the live pages. I want you to wire it in as digits that are
 * accepted as if it were twillio."
 *
 * Set on the server only, never in this repository — a code written here would be read by whoever reads the code, and a
 * code to a number is how its person signs in on a new phone and replaces a forgotten PIN:
 *
 *   GLOS_STANDIN_CODES=+31600000000:123456          one or more number:code (or address:code) pairs, commas between
 *   GLOS_STANDIN_CODES_UNTIL=2026-11-30             through the end of that day, UTC
 *
 * For a number named there, every code to the phone — signing up, a new phone or browser, a forgotten PIN, an account
 * giving its first number, a payout number — IS that code, as if Twilio had delivered it; for an address named there,
 * every code to the address. Nothing is sent and nothing is shown on the screen: the person types the code they know.
 * Unlike the review code it opens an account as well as making one — it stands in for the phone itself.
 *
 * It is OFF on a sandbox (a sandbox shows its codes anyway), without a day, after the day, and on each channel the
 * moment that channel really sends: once Twilio is wired in, the number's codes go by text like everybody's, and once
 * mail leaves, the address's go by mail.
 */
export interface StandInEntry {
  /** A number by its digits, an address in lower case. */
  key: string;
  code: string;
}

/** How a number or an address is compared: a number by its digits alone, an address in lower case. */
export function standInKey(phoneOrEmail: string): string {
  const s = (phoneOrEmail ?? '').trim();
  return s.includes('@') ? s.toLowerCase() : s.replace(/\D/g, '');
}

/** The pairs as set. One that is not a number of at least nine digits (or an address) with a code of six digits is no pair. */
export function standInEntries(env: NodeJS.ProcessEnv = process.env): StandInEntry[] {
  const raw = env.GLOS_STANDIN_CODES?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .flatMap((pair) => {
      const at = pair.lastIndexOf(':');
      if (at < 0) return [];
      const who = pair.slice(0, at).trim();
      const code = pair.slice(at + 1).trim();
      const key = standInKey(who);
      const ok = /^\d{6}$/.test(code) && (who.includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(key) : key.length >= 9);
      return ok ? [{ key, code }] : [];
    });
}

/** The end of the day it is set to, UTC — or nothing for a day that is not one. */
export function standInUntil(env: NodeJS.ProcessEnv = process.env): Date | undefined {
  const raw = env.GLOS_STANDIN_CODES_UNTIL?.trim();
  if (!raw) return undefined;
  const end = new Date(`${raw}T23:59:59.999Z`);
  return Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== raw ? undefined : end;
}

function on(now: number, env: NodeJS.ProcessEnv): boolean {
  if (isSandbox()) return false;
  const end = standInUntil(env);
  return Boolean(end && now <= end.getTime());
}

/**
 * The stand-in code for this number or address — while it is on, and only while its channel cannot really send
 * (`channelSends`: Twilio for a number, mail for an address). Otherwise nothing, and the ordinary code is made and sent.
 */
export function standInCode(phoneOrEmail: string, channelSends: boolean, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (channelSends || !on(now, env)) return undefined;
  const key = standInKey(phoneOrEmail);
  return key ? standInEntries(env).find((e) => e.key === key)?.code : undefined;
}

/** For the console and the boot log: how many numbers and addresses stand in, and until when — never which, never a code. */
export function standInState(now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): { numbers: number; addresses: number; until: string } | null {
  if (!on(now, env)) return null;
  const entries = standInEntries(env);
  if (!entries.length) return null;
  const addresses = entries.filter((e) => e.key.includes('@')).length;
  return { numbers: entries.length - addresses, addresses, until: (env.GLOS_STANDIN_CODES_UNTIL as string).trim() };
}
