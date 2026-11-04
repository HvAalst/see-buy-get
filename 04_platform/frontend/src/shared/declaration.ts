import type { Result, SbgClient } from '../lib/sbg';
import type { Translate } from './i18n';

/**
 * Round 39 — THE SECURITY DECLARATION (the user: "At joining and yearly (Recommended)"). A shop, a hub, a fleet's office and
 * a rider in no fleet each sign one short declaration of how they keep what is in their care — at joining, and again every
 * year; a new wording is signed again. Not in force, nothing new is taken on: the server refuses it, and says where to sign.
 * A fleet's driver signs nothing of their own: the fleet does. The wording is the server's — this only shows it.
 */
export type DeclarationState = 'signed' | 'due' | 'missing' | 'lapsed' | 'outdated';

export interface DeclarationView {
  /** False for a fleet's driver: their fleet signs, and answers for them. */
  required: boolean;
  kind?: 'shop' | 'hub' | 'fleet' | 'driver';
  version?: number;
  title?: string;
  lines?: string[];
  state?: DeclarationState;
  signedAt?: string;
  signedBy?: string;
  until?: string;
  daysLeft?: number;
  coveredBy?: string;
}

/** The caller's own: theirs to read and sign. */
export function readDeclaration(sbg: SbgClient): Promise<Result<DeclarationView>> {
  return sbg.request((c) => c.GET('/v1/sbg/declarations/mine', {})) as Promise<Result<DeclarationView>>;
}

/** Signed — the wording they were shown, each of its lines ticked (by its number from 0). */
export function signDeclaration(sbg: SbgClient, version: number, confirmed: number[]): Promise<Result<DeclarationView>> {
  return sbg.request((c) => c.POST('/v1/sbg/declarations/mine/sign', { body: { version, confirmed } })) as Promise<Result<DeclarationView>>;
}

/**
 * 2026-11-04 — HOW MANY LINES ARE STILL TO TICK (the owner: "i want them to tick them individually, it's a small step but it
 * keeps the eyes a little longer on the text"). Only the lines of the wording shown count: a tick kept from an older one does not.
 */
export function declarationLeft(lines: readonly string[] | undefined, ticked: readonly string[]): number {
  const n = lines?.length ?? 0;
  const on = new Set(ticked.filter((k) => /^\d+$/.test(k) && Number(k) < n));
  return n - on.size;
}

/** Does it ask for their hand now: none signed, lapsed, a new wording, or due within the month. Signed and quiet: no. */
export function declarationAsks(v: DeclarationView | null | undefined): boolean {
  return Boolean(v?.required && v.state && v.state !== 'signed' && v.lines?.length && v.version);
}

/** Why it is shown, and how much it matters: a stop (nothing new until it is signed), or a warning (due soon). */
export function declarationWhy(v: DeclarationView, t: Translate, day: (iso: string) => string): { tone: 'warn' | 'danger'; title: string } | null {
  if (!declarationAsks(v)) return null;
  if (v.state === 'due') return { tone: 'warn', title: t('common.declaration.due', { day: day(v.until ?? '') }) };
  if (v.state === 'lapsed') return { tone: 'danger', title: t('common.declaration.lapsed', { day: day(v.until ?? '') }) };
  if (v.state === 'outdated') return { tone: 'danger', title: t('common.declaration.outdated') };
  return { tone: 'danger', title: t('common.declaration.missing') };
}
