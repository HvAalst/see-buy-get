/**
 * FP7 — the sender's instructions (CMR box 13) as every app reads them: the free note, a contact to dial, a
 * delivery window, and every subsequent instruction with its time. One shape, so the shop that wrote it and
 * the driver who acts on it cannot read it two ways.
 */
export interface InstructionsView {
  text?: string;
  contactName?: string;
  contactPhone?: string;
  deliveryWindow?: string;
  at?: string;
  amendments?: Array<{ text: string; at: string }>;
}

/** True when there is anything at all to show. */
export function hasInstructions(i: InstructionsView | undefined | null): i is InstructionsView {
  return Boolean(i && (i.text || i.contactName || i.contactPhone || i.deliveryWindow || i.amendments?.length));
}

/** A tel: link for the contact, or null when there is no phone to dial. Digits, plus and spaces only. */
export function telHref(phone: string | undefined): string | null {
  const p = (phone ?? '').trim();
  return /^\+?[0-9 ()-]{5,}$/.test(p) ? 'tel:' + p.replace(/[^0-9+]/g, '') : null;
}
