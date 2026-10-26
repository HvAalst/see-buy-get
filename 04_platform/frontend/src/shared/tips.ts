/**
 * TEACHING TEXT SOMEBODY HAS FINISHED READING.
 *
 * A driver learns this app once. The sentence that told them we only offer loads on their route is worth
 * a great deal on day one and costs them screen space every day after — and on a phone, screen space is
 * the scarcest thing an app has. So an explainer can be read and then put away for good, the way a chat
 * app lets you dismiss the notice about its own encryption.
 *
 * WHAT MAY BE PUT AWAY, AND WHAT MAY NOT. This is the whole of it, and `TipId` below is the list that
 * enforces it: a tip is text that TEACHES HOW THE APP WORKS and is equally true tomorrow, for everybody.
 * Anything that reports a live condition — an hours limit reached, a licence about to lapse, a location
 * we do not have, a refusal, any number about this person right now — is NOT a tip and never gets one of
 * these ids. Hiding those would be closing an eye and waiting for trouble, which is the opposite of what
 * this is for. Adding an id is therefore a deliberate act with that question already asked.
 *
 * SCOPED TO THE PERSON, not the device — the same rule the read cache keeps. Two drivers share a phone
 * in a fleet more often than either of them owns one, and the second driver has learned nothing yet.
 *
 * AND THERE IS A WAY BACK. Everything dismissed here is restored by one control, because a dismissal
 * that cannot be undone turns a mis-tap into information somebody can never see again.
 */

/**
 * Every explainer that may be dismissed. One list, so that "is this teaching or is this a live fact?"
 * is answered once, in review, rather than screen by screen. See the rule above before adding one.
 */
export type TipId =
  /** Find work — that we filter offers to the driver's own route and remaining space. */
  | 'driver.route.how'
  /** The market — that the reach is theirs to set and we do not narrow the list ourselves. */
  | 'driver.board.how'
  | 'driver.board.reach'
  /** Off shift — that a shift starts by scanning the sticker on the dashboard. */
  | 'driver.shift.how'
  /** Off shift — the three things scanning one actually does. The tallest teaching block in the app. */
  | 'driver.shift.what'
  /** My loads — that the two gate taps ARE the record, so nobody has to remember a time afterwards. */
  | 'driver.run.what'
  /* THE SHOP'S COUNTER. Four screens a shopkeeper works every day, each opening with the same sentence
     about how that counter job goes. Learned in a week; paid for in screen space for years. */
  | 'agent.accept.how'
  | 'agent.bag.how'
  | 'agent.tamper.how'
  | 'agent.freight.how'
  | 'agent.lots.how'
  /* THE HUB. Five screens, and every one of them is a scan-and-be-told loop that never changes. */
  | 'mdp.sort.how'
  | 'mdp.arrivals.how'
  | 'mdp.drop.how'
  | 'mdp.load.how'
  | 'mdp.tote.how'
  | 'mdp.rates.how'
  /* THE FLEET OFFICE — read on a desk, all day, by somebody who knows what a line is by Tuesday. */
  | 'fleet.lines.how'
  /** Runs — that a departure sells the space a line is already carrying empty, on the fleet's own terms. */
  | 'fleet.runs.how'
  | 'fleet.orders.how'
  | 'fleet.dispatch.how'
  | 'fleet.earnings.how'
  /* THE STORE. Only the dock: what a collection from your own address IS. The rest of the store's
     ledes carry a live value — a zone, a balance — and a fact about today is not teaching. */
  | 'vendor.dock.how';

const PREFIX = 'sbg.tips.v1:';

/** Re-render anything showing a tip when one is dismissed or all are restored, wherever that happened. */
const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(): void {
  for (const fn of [...listeners]) fn();
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage blocked: every tip simply keeps showing. A tip that will not go away is a nuisance; one
    // that cannot be read is a person stuck, so this is the right way to fail.
    return null;
  }
}

/** Anonymous is its own bucket rather than an error — the sign-in screen has no person yet. */
function keyFor(who: string | null | undefined): string {
  return PREFIX + (who && who.trim() ? who.trim() : 'anon');
}

function read(who: string | null | undefined): string[] {
  try {
    const raw = storage()?.getItem(keyFor(who));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // Corrupt or unparseable: treat it as nothing dismissed. Showing a tip again is recoverable.
    return [];
  }
}

export function isHidden(who: string | null | undefined, id: TipId): boolean {
  return read(who).includes(id);
}

export function hide(who: string | null | undefined, id: TipId): void {
  const now = read(who);
  if (now.includes(id)) return;
  try {
    storage()?.setItem(keyFor(who), JSON.stringify([...now, id]));
  } catch {
    /* not remembering it is survivable; not honouring the tap right now is not */
  }
  announce();
}

/** How many this person has put away — the restore control says the number, or does not appear at all. */
export function hiddenCount(who: string | null | undefined): number {
  return read(who).length;
}

export function restoreAll(who: string | null | undefined): void {
  try {
    storage()?.removeItem(keyFor(who));
  } catch {
    /* nothing to do: the list was unreachable, so nothing was hidden by it either */
  }
  announce();
}
