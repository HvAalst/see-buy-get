import type { Translate } from './i18n';

/**
 * REFUSED AT THE DOOR (the user, 2026-10-27), as a sender's load carries it (backend FreightRefusal): when and why, by when
 * the sender says where the goods go, and — once said, or once the 48 hours have — what became of them.
 */
export type RefusalChoice = 'back' | 'elsewhere' | 'give_up';
export interface Refusal {
  at: string;
  by?: string;
  note?: string;
  decideBy: string;
  remindedAt?: string;
  decision?: { choice: RefusalChoice; at: string; by?: string; byDeadline?: boolean; destLabel?: string; destLocation?: { lat: number; lng: number }; returnLeg?: { freightId: string; code: string } };
  /** Only a part refused, at the handover (2026-10-27): the rest was delivered. */
  part?: { packages: number; of: number };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "29 Oct at 08:00 UTC" — a moment said so that nobody needs to know where the reader is, as the notices say it. */
export function utcMoment(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} at ${iso.slice(11, 16)} UTC`;
}

/** What a refusal card says: what happened at the door, then what to do and by when — or what became of the goods. */
export function refusalSays(r: Refusal, pickupLabel: string, t: Translate): string[] {
  // A part refused at the handover: how many of how many, the rest delivered (the user, 2026-10-27: "Refusal rules, for the part").
  const what = r.part
    ? t('refusal.whatPart', { n: r.part.packages, of: r.part.of, when: `on ${utcMoment(r.at)}` })
    : r.note
      ? t('refusal.whatWhy', { when: `on ${utcMoment(r.at)}`, note: r.note })
      : t('refusal.what', { when: `on ${utcMoment(r.at)}` });
  const d = r.decision;
  if (!d) return [what, t('refusal.ask', { by: utcMoment(r.decideBy), pickup: pickupLabel })];
  if (d.choice === 'give_up') return [what, t('refusal.decided.giveUp')];
  const place = d.destLabel ?? pickupLabel;
  const code = d.returnLeg?.code ?? '';
  return [what, d.byDeadline ? t('refusal.decided.deadline', { place, code }) : t(d.choice === 'back' ? 'refusal.decided.back' : 'refusal.decided.elsewhere', { place, code })];
}

/** The sender's choice of another place, as the server takes it — or the words key of what is missing. */
export function elsewhereBody(form: { label: string; pin: { lat: number; lng: number } | null; contactName: string; contactPhone: string }):
  | { body: { choice: 'elsewhere'; destLabel: string; destLocation: { lat: number; lng: number }; contactName?: string; contactPhone?: string } }
  | { error: 'refusal.err.place' | 'refusal.err.pin' } {
  const destLabel = form.label.trim();
  if (destLabel.length < 3) return { error: 'refusal.err.place' };
  if (!form.pin) return { error: 'refusal.err.pin' };
  return {
    body: {
      choice: 'elsewhere',
      destLabel,
      destLocation: form.pin,
      ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
      ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
    },
  };
}
