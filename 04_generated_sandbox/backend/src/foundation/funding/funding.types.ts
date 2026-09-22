/**
 * Money coming IN — the half of the money model that was decided and never built.
 *
 * Rule 5, written down on 2026-08-14 and quoted here because this file is its enforcement: **money is
 * created only by an observed external event, with a provider reference, verified and idempotent. This is
 * why a mobile-money webhook matters: it is the AUTHORITY for creating money, not a convenience.**
 *
 * The outbound half has obeyed it since `da94709`: a payout settles when a rail says the money left, and
 * on nothing else. The inbound half did not. A shop pressed "Top up 5,000" and the books recorded 5,000
 * of cash in custody and 5,000 owed back to that shop, on the strength of a number typed by the party who
 * benefits from it. Nothing outside the building had said anything. The cash figure the operator console
 * shows — the one that decides whether a sister can pay its drivers this afternoon — was a claim.
 *
 * THREE RULES SHAPE EVERYTHING HERE, and two of them are inbound-only.
 *
 * ASKING IS NOT PAYING. Opening a funding intent moves nothing. It hands back a reference and the words
 * to pay against it, and then we wait. This is the mirror of "requesting is a decision and submitting is a
 * handover; neither is a payment", and it is why `awaiting` exists as a state a shop can sit in for days.
 *
 * THE AMOUNT IS THE RAIL'S, NEVER THE PAYER'S. A shop asks to top up 5,000 and pays 500. The books move
 * by 500, because 500 is what arrived. The asked-for amount is kept beside it so that the difference is
 * legible rather than lost — an intent that was half paid is a thing somebody will ring up about.
 *
 * AND OUR OWN BOOKKEEPING STATE NEVER REFUSES MONEY. A confirmation lands against an intent we expired an
 * hour ago because the shop opened another one; the money still arrived. Confirmation is refused for
 * exactly one reason — we have already recorded this provider reference — because a rail that confirms
 * twice has not been paid twice.
 */

/**
 * Where a funding intent stands.
 *
 * Five states, all reachable. There is deliberately no `requested` state ahead of `awaiting`: inbound, the
 * act of asking IS the handover — the payer needs the reference in the same breath, and a state nothing
 * can sit in is a lie a reader has to unlearn.
 */
export type FundingStatus = 'awaiting' | 'confirmed' | 'failed' | 'expired' | 'reversed';

/** The states in which money may still arrive. A payer with one of these open is not asked to open another. */
export const FUNDING_OPEN: FundingStatus[] = ['awaiting'];

/** What the money is FOR. The two are different obligations and must never share an account — a shop's
 *  float is spendable at the counter, an activation deposit is held and refundable and is not. */
export type FundingPurpose = 'float' | 'activation';

/** Who is putting money in. Each kind knows its own sister, its own currency and its own deposit account;
 *  see the registered `FundingPayer` below, which is where that knowledge stays. */
export type FundingPayerKind = 'agent' | 'vendor';

export class Funding {
  fundingId: string;
  /** The sister collecting it — rule 1, collection follows the payer. Its books are where this posts. */
  entityId: string;
  payerKind: FundingPayerKind;
  payerDid: string;
  /**
   * WHO IS PAYING, in the words somebody would use out loud — "Mama Sarah Shop", not a DID.
   *
   * Stamped when the request is opened, because that is the only moment the payer is resolved and because
   * a name that is re-read later is a name that can change under a record it is describing. This console
   * has a standing rule about it: never an id where a name belongs. A row that says
   * `did:glos:ab6ed968206e6…` is a row nobody can act on without a second lookup.
   */
  payerName?: string;
  purpose: FundingPurpose;
  /**
   * What was ASKED for. Never what moved: `confirmedAmount` is what moved, and where the two differ the
   * pair is the whole story. Kept even after confirmation for that reason.
   */
  amount: number;
  currency: string;
  status: FundingStatus;
  /**
   * OUR reference, the thing the payer quotes when they pay — a paybill account number, an airtime
   * top-up memo, the reference line on a transfer. Short and human-typeable on purpose: it is read off a
   * phone screen and typed into another phone, often by somebody standing at a counter.
   */
  reference: string;
  /** Which rail this was opened against. A sister's paybill is not the same as its card acquirer. */
  provider: string;
  /** The words the payer is shown. The RAIL's words, kept with the intent so the screen cannot drift
   *  from what the provider actually needs — the same reason the CL5 consent notice travels with the gate. */
  instructions: string;
  openedAt: string;
  /** The provider's own reference for the money that arrived. The thing you quote when somebody says
   *  they paid and we say we never saw it. */
  providerRef?: string;
  /** What actually arrived, in the currency above. Present only once confirmed. */
  confirmedAmount?: number;
  /** What the rail took to move it. An expense of ours, never netted off the payer's credit — see
   *  the money model: "credit the GROSS at top-up, never net-credit". */
  fee?: number;
  confirmedAt?: string;
  failedAt?: string;
  expiredAt?: string;
  reversedAt?: string;
  failureReason?: string;
  /** The journal entry that created the money. Present ONLY once confirmed — before that nothing moved. */
  entryId?: string;
  /** …and the entry that took it back, if the payment was later recalled. */
  reversalEntryId?: string;
}

/**
 * Money that arrived and that we could not attribute to anybody.
 *
 * Somebody pays the paybill with the reference left blank, or types it wrong. The cash is real and it is
 * in the account. We do NOT post it: we do not know whose book it belongs in, and a guess in the books is
 * worse than a hole in them — it would credit a shop that did not pay and reconcile to a total nobody can
 * take apart afterwards. So it is recorded here, in full, where an operator can see it and chase it, and
 * the books stay silent about money they cannot name.
 *
 * A person can APPLY one — say whose it is and have it credited. That is the only way out of this list,
 * it is deliberately a judgement rather than a rule, and the record keeps who made it: see `appliedAt`.
 */
export class UnmatchedPayment {
  id: string;
  provider: string;
  providerRef: string;
  /** The reference the payer quoted, if they quoted one at all. Usually the whole mystery. */
  reference?: string;
  amount: number;
  currency: string;
  /** Whatever the rail can tell us about who sent it — a masked phone number, a till name. Never PII
   *  we chose to store: it is what the provider put in the callback. */
  payerLabel?: string;
  at: string;
  /** Why it could not be attributed, in words an operator can act on. */
  reason: string;
  /**
   * WHEN SOMEBODY WORKED OUT WHOSE IT WAS.
   *
   * Kept rather than deleted, and this is the whole point of the record: the money arrived unattributed
   * and was later attributed BY A PERSON, on their judgement, and that is a different fact from a payment
   * the rail matched itself. An auditor asking "why is this shop's float 400 higher" gets the payment,
   * the person, and the moment — instead of a credit that looks exactly like every other one.
   */
  appliedAt?: string;
  /** The funding record the applied payment became, so the books can be walked to from here. */
  appliedTo?: string;
  /** Who decided. Never a role — a name. */
  appliedBy?: string;
}

/** What the rail is asked to set up. Deliberately tiny, like its outbound twin. */
export interface FundingInstruction {
  fundingId: string;
  payerDid: string;
  purpose: FundingPurpose;
  amount: number;
  currency: string;
}

/**
 * A confirmed payment, normalised.
 *
 * Every rail says this differently — Daraja's C2B callback, an airtime distributor's POST, a card
 * acquirer's webhook — and every one of them says it in its own envelope with its own signature scheme.
 * Translating to this shape is the ADAPTER's job, which is why verification lives on the rail: the thing
 * that knows M-Pesa's signature is the thing that speaks M-Pesa.
 */
export interface RailPayment {
  provider: string;
  /** The provider's transaction id. The IDEMPOTENCY KEY: the same one twice credits nobody twice. */
  providerRef: string;
  /** Our reference, as the payer quoted it. Absent or wrong is the unmatched case above. */
  reference?: string;
  /** What actually arrived. The authority on the amount — see the header. */
  amount: number;
  currency: string;
  /** What the rail took. Zero where the provider does not tell us, which is honest: an unknown fee is
   *  not a zero fee, and the reconciliation gap it leaves is the thing that makes somebody go and ask. */
  fee?: number;
  paidAt?: string;
  payerLabel?: string;
}

/**
 * A funding rail.
 *
 * The same seam as the payout rail, the geocoder and the router — the thing outside our walls is the
 * thing most likely to be swapped. Two jobs: tell a payer how to pay, and verify what comes back.
 */
export interface FundingRail {
  /** The provider this adapter speaks for, as it appears in the callback path. */
  readonly provider: string;
  /** Set up a way to be paid. Returns our reference and the words the payer is shown. */
  open(instruction: FundingInstruction): { reference: string; instructions: string };
  /**
   * Is this callback really from the provider, and what does it say?
   *
   * Returns the normalised payment, or throws. It must refuse an unsigned body, a bad signature and a
   * replayed one — a webhook anybody can post to is not better than the shop's own word, it is worse:
   * it is *everybody's* word.
   */
  verify(headers: Record<string, string | undefined>, body: unknown): RailPayment;
  /**
   * SANDBOX ONLY: build a signed callback exactly as the provider would send one.
   *
   * So that pressing "confirm" in a sandbox demo goes through the real door — signature, replay window
   * and all — rather than around it. A stub that bypassed verification would leave the one piece of this
   * that protects the books untested until the day it carries real money. A live rail does not implement
   * it: a provider signs its own callbacks, and we have no business being able to.
   */
  simulate?(payment: Omit<RailPayment, 'provider'>): { headers: Record<string, string>; body: Record<string, unknown> };
}

export const FUNDING_RAIL = 'FUNDING_RAIL';

/**
 * How one kind of payer is resolved and credited.
 *
 * Registered once at boot rather than injected, for the reason the payee gate gives: `foundation` must
 * not reach into `modules`, and the knowledge of which account a shop's float lives in belongs beside the
 * shop, not here. The service owns the lifecycle; this owns the posting.
 */
export interface FundingPayer {
  /** Which sister collects for this payer, and in what money. Throws where we hold no money in their
   *  country — an intent we could never post is not worth opening. */
  resolve(payerDid: string): { entityId: string; currency: string; label: string };
  /** The rail confirmed. Post it and hand back the journal entry that created the money. */
  credit(payerDid: string, credit: { purpose: FundingPurpose; gross: number; fee: number; reference: string; fundingId: string }): { entryId: string };
  /** It bounced. Post the exact mirror — the money did leave and did come back, and a book showing
   *  neither cannot be reconciled against a statement showing both. */
  reverse(payerDid: string, credit: { purpose: FundingPurpose; gross: number; fee: number; reference: string; fundingId: string }): { entryId: string };
}
