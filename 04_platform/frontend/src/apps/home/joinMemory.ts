import type { JoinForm, JoinKind, JoinStep } from './logic';

/**
 * WHERE SOMEBODY SIGNING UP WAS, KEPT THROUGH A RELOAD (the owner, 2026-11-01: "when I have to switch apps, from chrome on
 * mobile to mail, to fetch the security code to confirm my email, the sbg page is refreshed and I can't write the code from
 * the earlier email"). A phone's browser drops a page it put in the background and loads it again on return; the sign-up
 * lived in memory, so it started over. Now the step and what was typed are kept in this tab's session storage — gone when
 * the tab is closed, and after half an hour — and put back when the page loads again.
 *
 * NEVER KEPT: the PIN, a password, and the codes typed. Those are typed again; a code asked for again is the same one
 * while it is still good (the server keeps it), so the one in the inbox still works.
 */

const KEY = 'sbg.join.v1';
export const JOIN_KEPT_MS = 30 * 60 * 1000;

const SECRET: ReadonlyArray<keyof JoinForm> = ['pin', 'password', 'code', 'recoveryCode'];

export interface JoinMemory {
  roleId: string;
  step: JoinStep;
  form: Partial<JoinForm>;
  pinEmail: 'first' | 'reset' | null;
  at: number;
}

/** What is kept of a sign-up under way; nothing once it is done or left. */
export function joinSnapshot(input: { screen: string; roleId?: string; step: JoinStep; form: JoinForm; pinEmail: 'first' | 'reset' | null }, now: number): JoinMemory | null {
  if (input.screen !== 'join' || !input.roleId || input.step === 'done') return null;
  const form: Partial<JoinForm> = { ...input.form };
  for (const key of SECRET) delete form[key];
  return { roleId: input.roleId, step: input.step, form, pinEmail: input.pinEmail, at: now };
}

/**
 * Where to put somebody back. A step that needs them signed in (after the PIN, for a fleet and for a driver's papers)
 * starts at the PIN again: the sign-in lived in memory only, and is never kept.
 */
export function joinRestored(saved: JoinMemory | null, kind: (roleId: string) => JoinKind | null, now: number): { roleId: string; step: JoinStep; form: Partial<JoinForm>; pinEmail: 'first' | 'reset' | null } | null {
  if (!saved || now - saved.at > JOIN_KEPT_MS || now < saved.at) return null;
  const k = kind(saved.roleId);
  if (!k) return null;
  const afterPin = (k === 'fleet' && ['about', 'where', 'papers'].includes(saved.step)) || (k === 'driver' && saved.step === 'papers');
  return { roleId: saved.roleId, step: afterPin ? 'pin' : saved.step, form: saved.form, pinEmail: saved.pinEmail };
}

/** Read and write this tab's copy — quietly nothing where storage is not to be had (a private window, a build). */
export function readJoinMemory(): JoinMemory | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as JoinMemory) : null;
  } catch {
    return null;
  }
}
export function writeJoinMemory(memory: JoinMemory | null): void {
  try {
    if (memory) globalThis.sessionStorage?.setItem(KEY, JSON.stringify(memory));
    else globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // No storage: the sign-up simply is not kept.
  }
}
