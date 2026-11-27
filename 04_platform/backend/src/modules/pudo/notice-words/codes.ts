import { NOTICE_EN, type NoticeKey } from './catalog';
import { said, type SayValue } from './say';

/**
 * 2026-11-27 — A CODE SAID IN WORDS (the owner: "continue"). A refusal that says a status back ("The load is in_transit") said
 * it in English whatever the app's language. Said through here, a code with a phrase (notice-words/en/codes.ts) is told in the
 * reader's language — its English the code itself, word for word as before — and a code with none is said as it is.
 */
export type CodeKind = 'payout' | 'funding' | 'fundingOutcome' | 'freight' | 'parcel' | 'role';

export function codeSaid(kind: CodeKind, code: string | undefined): SayValue {
  if (code === undefined) return code;
  const key = `code.${kind}.${code}`;
  return key in NOTICE_EN ? said(key as NoticeKey) : code;
}
