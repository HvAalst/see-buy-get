import type { Freight, ReceivingExceptionKind, ReceivingExceptionView } from './dispatch.types';

/*
 * D9 (assessment.html; the user, 2026-10-25: "Yes, A then B") — WHAT THE RECEIVER FOUND AT THE HANDOVER, said one way
 * everywhere it is said: on the note beside the receiver's name, in the sender's notice and email, in the receiver's bell.
 * Kept dependency-free, so all of them read the same words.
 */

const PACKAGES = (n: number) => `${n} ${n === 1 ? 'package' : 'packages'}`;

const WORDS: Record<ReceivingExceptionKind, (n: number) => string> = {
  short: (n) => `${PACKAGES(n)} short`,
  over: (n) => `${PACKAGES(n)} more than the note says`,
  damaged: (n) => `${PACKAGES(n)} damaged`,
  wrong: (n) => `${PACKAGES(n)} not the goods the note describes`,
};

/** "3 packages short, 2 packages damaged" — in the note's order, as they are kept. Empty where nothing was found. */
export function exceptionsInWords(list: ReadonlyArray<{ kind: ReceivingExceptionKind; count: number }> | undefined): string {
  return (list ?? []).map((e) => WORDS[e.kind](e.count)).join(', ');
}

/**
 * WHAT STAYS EXPECTED after the handover: what did not come, and what came and is not the goods — until the receiver
 * closes it. Damaged goods came, and what more happens to them is a claim's; more than the note says is nothing owed.
 */
export function stillExpectedOf(list: ReadonlyArray<{ kind: ReceivingExceptionKind; count: number }> | undefined): number {
  return (list ?? []).filter((e) => e.kind === 'short' || e.kind === 'wrong').reduce((n, e) => n + e.count, 0);
}

/** What the receiver found, as a party to the load reads it: how many photographs are on the note, never their references. */
export function exceptionViewsOf(f: Pick<Freight, 'proofOfDelivery'>): ReceivingExceptionView[] {
  return (f.proofOfDelivery?.exceptions ?? []).map((e) => ({ kind: e.kind, count: e.count, photos: e.photoRefs?.length ?? 0 }));
}
