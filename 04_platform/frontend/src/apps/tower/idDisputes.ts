import type { MessageKey, Translate } from '../../shared/i18n';

/*
 * TWO PEOPLE SAY ONE NATIONAL ID IS THEIRS — what the console says about a dispute, and what its reader may do.
 *
 * The user, 2026-10-08: staff see "a selfie with the holder showing it's ID back and front"; "staff decide from the
 * photos, if that is still disputed they can make an appointment in person." Two of us: one says whose it is and why,
 * a second, different one approves. So the screen puts the two sets of photographs side by side, says what speaks
 * for and against each, and offers a decision only where the cards that were read allow it.
 */

export type DisputeState = 'opened' | 'answering' | 'ready' | 'checked' | 'decided' | 'appointment' | 'rechecked' | 'final' | 'conceded' | 'withdrawn' | 'lapsed';
export type DisputeSide = 'claimant' | 'holder';

export interface DisputeParty {
  sentAt?: string;
  face?: string;
  front?: string;
  back?: string;
  card?: 'matches' | 'differs';
  who?: string;
  since?: string;
  phoneEnds?: string;
  onRecord?: string[];
  retakeWhy?: string;
  came?: boolean;
}

export interface DisputeRow {
  disputeId: string;
  reference: string;
  holderReference: string;
  register: 'driver' | 'shop';
  state: DisputeState;
  openedAt: string;
  photosBy?: string;
  answerBy?: string;
  claimant: DisputeParty;
  holder: DisputeParty;
  proposedTo?: DisputeSide;
  proposedBy?: string;
  proposedAt?: string;
  proposedWhat?: string;
  proposedReason?: string;
  proposedByYou?: boolean;
  sentBackWhy?: string;
  decidedTo?: DisputeSide;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  holderEffect?: 'held' | 'corrected' | 'none';
  contestBy?: string;
  appointmentDate?: string;
  appointmentBy?: DisputeSide;
  /** The hour of the appointment, where the company counts its visitors by the hour. */
  appointmentAt?: string;
  /** The day-before reminder went to whoever of the two has an account, and when. */
  appointmentRemindedAt?: string;
  /** The appointment is on a day the country's company no longer receives visitors. */
  appointmentOffDay?: boolean;
  /** Where people are sent and when visitors are received — the country's company's own entry. Absent: it wrote nothing. */
  place?: { company: string; address?: string; hours?: string; visitDays?: string[]; visitFrom?: string; visitTo?: string; visitorsPerHour?: number; closedDates?: Array<{ date: string; note?: string }> };
  finalTo?: DisputeSide;
  finalBy?: string;
  finalAt?: string;
  endedAt?: string;
}

const STATES: DisputeState[] = ['opened', 'answering', 'ready', 'checked', 'decided', 'appointment', 'rechecked', 'final', 'conceded', 'withdrawn', 'lapsed'];
export const DISPUTE_LABEL = Object.fromEntries(STATES.map((s) => [s, `tower.ids.state.${s}`])) as Record<DisputeState, MessageKey>;

/** Waiting on one of us is the loudest; waiting on the two people is information; over is quiet. */
export const DISPUTE_TONE: Record<DisputeState, 'warn' | 'info' | 'ok' | 'quiet'> = {
  opened: 'quiet',
  answering: 'info',
  ready: 'warn',
  checked: 'warn',
  decided: 'ok',
  appointment: 'info',
  rechecked: 'warn',
  final: 'ok',
  conceded: 'ok',
  withdrawn: 'quiet',
  lapsed: 'quiet',
};

const todayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** It waits on a member of staff: to be decided, to be approved, or — the day having come — to have an appointment recorded. */
export function waitsOnUs(row: Pick<DisputeRow, 'state' | 'appointmentDate'>, now: number = Date.now()): boolean {
  if (row.state === 'ready' || row.state === 'checked' || row.state === 'rechecked') return true;
  return row.state === 'appointment' && Boolean(row.appointmentDate) && (row.appointmentDate as string) <= todayOf(now);
}

/** It waits on one of the two people, or on a day that has not come. */
export function waitsOnThem(row: Pick<DisputeRow, 'state' | 'appointmentDate'>, now: number = Date.now()): boolean {
  return row.state === 'opened' || row.state === 'answering' || (row.state === 'appointment' && !waitsOnUs(row, now));
}

/** How many wait on us. Null while unread: "none waiting" and "we have not looked" are different claims. */
export function disputesWaiting(rows: DisputeRow[] | null, now: number = Date.now()): number | null {
  return rows === null ? null : rows.filter((r) => waitsOnUs(r, now)).length;
}

/**
 * WHAT THE READER MAY DO NEXT. `propose` — read the cards and say whose it is · `approve` — the second step ·
 * `other` — the reader proposed it, so the approval is somebody else's · `record` — the appointment's day has come:
 * say who came and what was seen · `wait` — it waits on the two people, or on the day · `over`.
 */
export type DisputeStep = 'propose' | 'approve' | 'other' | 'record' | 'wait' | 'over';

export function disputeStep(row: DisputeRow, me?: string, now: number = Date.now()): DisputeStep {
  if (row.state === 'ready') return 'propose';
  if (row.state === 'checked' || row.state === 'rechecked') return row.proposedByYou || (Boolean(me) && row.proposedBy === me) ? 'other' : 'approve';
  if (row.state === 'appointment') return waitsOnUs(row, now) ? 'record' : 'wait';
  if (row.state === 'opened' || row.state === 'answering') return 'wait';
  return 'over';
}

/**
 * MAY THE ID BE PROPOSED FOR THIS ONE? The server's own rule, said before the button rather than after it: from the
 * photographs it can go only to somebody whose card was read as carrying it; after an appointment the decision can
 * change only for somebody who came.
 */
export function mayPropose(row: DisputeRow, to: DisputeSide, came?: { claimant: boolean; holder: boolean }): { ok: boolean; why?: MessageKey } {
  if (row.state === 'appointment') {
    if (to !== row.decidedTo && !came?.[to]) return { ok: false, why: 'tower.ids.cannot.notCame' };
    return { ok: true };
  }
  if (to === 'claimant') return row.claimant.card === 'matches' ? { ok: true } : { ok: false, why: 'tower.ids.cannot.claimantCard' };
  return row.holder.card === 'matches' || row.claimant.card === 'differs' ? { ok: true } : { ok: false, why: 'tower.ids.cannot.holderCard' };
}

/** The three photographs one of them sent, in the order they were asked for. */
export function photoRefs(party: DisputeParty): string[] {
  return [party.face, party.front, party.back].filter((x): x is string => Boolean(x));
}

/** The line under a dispute in the list: what register, when, and what it waits on. */
export function disputeSub(row: DisputeRow, t: Translate): string {
  const base = t('tower.ids.rowSub', { what: t(row.register === 'driver' ? 'tower.ids.reg.driver' : 'tower.ids.reg.shop'), when: row.openedAt.slice(0, 10) });
  if (row.state === 'opened' && row.photosBy) return `${base} · ${t('tower.ids.row.opened', { date: row.photosBy.slice(0, 10) })}`;
  if (row.state === 'answering' && row.answerBy) return `${base} · ${t('tower.ids.row.answering', { date: row.answerBy.slice(0, 10) })}`;
  if ((row.state === 'checked' || row.state === 'rechecked') && row.proposedBy) return `${base} · ${t('tower.ids.row.proposed', { who: row.proposedBy })}`;
  if (row.state === 'appointment' && row.appointmentDate) return `${base} · ${t('tower.ids.row.appointment', { date: row.appointmentDate })}`;
  return base;
}

/** What the number read on a card came to — or that nobody has read it yet. */
export function cardWords(party: DisputeParty, t: Translate): string {
  if (!party.sentAt && !party.card) return t('tower.ids.card.none');
  return t(party.card ? `tower.ids.card.${party.card}` : 'tower.ids.card.unread');
}

/**
 * WHAT TO WEIGH BEFORE SAYING WHOSE IT IS — only while there is something to decide. The plain cases say what will
 * happen; the hard one (both cards carry the number) says what a photograph can and cannot settle.
 */
export function disputeNotes(row: DisputeRow, t: Translate): Array<{ tone: 'danger' | 'warn' | 'info'; text: string }> {
  if (row.state !== 'ready') return [];
  const notes: Array<{ tone: 'danger' | 'warn' | 'info'; text: string }> = [];
  if (!row.holder.sentAt) notes.push({ tone: 'warn', text: t('tower.ids.note.holderSilent') });
  if (row.claimant.card === 'differs') notes.push({ tone: 'danger', text: t('tower.ids.note.claimantDiffers') });
  if (row.holder.card === 'differs') notes.push({ tone: 'info', text: t('tower.ids.note.holderDiffers') });
  if (row.claimant.card === 'matches' && row.holder.card === 'matches') notes.push({ tone: 'danger', text: t('tower.ids.note.bothMatch') });
  if (!row.holder.onRecord?.length) notes.push({ tone: 'info', text: t('tower.ids.note.nothingOnRecord') });
  return notes;
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * WHERE THE TWO PEOPLE ARE SENT, AND WHEN — as the country's company wrote it in its own admin (the user,
 * 2026-10-08: "the country needs to set its address info in their admin from there we fetch"; "it's up to the
 * countries to set visiting days and visiting hours"). Staff type neither. What it has NOT written is said, with
 * what that means for a ticket, because a blank here would read as nothing being wrong.
 */
export function placeWords(row: Pick<DisputeRow, 'place'>, t: Translate): { where: string; visiting: string; closed: string; missing: boolean } {
  const p = row.place;
  const days = p?.visitDays?.length ? WEEK.filter((d) => p.visitDays!.includes(d)).map((d) => t(`tower.contact.day.${d}` as never)) : [];
  const hours = p?.visitFrom && p?.visitTo ? t('tower.ids.place.hours', { from: p.visitFrom, to: p.visitTo }) : '';
  return {
    where: p?.address ? `${p.company}, ${p.address}` : t('tower.ids.place.noAddress'),
    // Its days, its hours, and — where it has said — how many it sees in an hour: then an appointment is for an hour.
    visiting: days.length ? t('tower.ids.place.visiting', { when: [days.join(', '), hours, p?.visitorsPerHour ? t('tower.ids.place.perHour', { n: p.visitorsPerHour }) : ''].filter(Boolean).join(' · ') }) : t('tower.ids.place.noDays'),
    // The dates it has said it is closed, soonest first: nobody is offered one, and nobody can take one.
    closed: p?.closedDates?.length ? t('tower.ids.place.closed', { dates: p.closedDates.slice(0, 6).map((c) => (c.note ? `${c.date} (${c.note})` : c.date)).join(', ') + (p.closedDates.length > 6 ? ` +${p.closedDates.length - 6}` : '') }) : '',
    missing: !p?.address || !days.length,
  };
}

/**
 * WHAT IS SAID UNDER AN APPOINTMENT: that it no longer fits what the company says now — which outranks everything,
 * because somebody is about to travel for nothing — or else where the day-before reminder stands.
 */
export function appointmentHint(row: Pick<DisputeRow, 'state' | 'appointmentOffDay' | 'appointmentRemindedAt'>, t: Translate, when: (iso: string) => string): string {
  if (row.appointmentOffDay) return t('tower.ids.fact.appointmentOffDay');
  if (row.appointmentRemindedAt) return t('tower.ids.fact.reminded', { when: when(row.appointmentRemindedAt) });
  // Once it is over, a reminder that never went is not something still to come.
  return row.state === 'appointment' ? t('tower.ids.fact.willRemind') : '';
}

/** What the decision did, in a line — for the facts of a dispute that is decided. */
export function decidedWords(row: DisputeRow, t: Translate, when: (iso: string) => string): string {
  if (!row.decidedTo) return '';
  const who = t(row.decidedTo === 'claimant' ? 'tower.ids.side.claimant' : 'tower.ids.side.holder');
  const effect = row.decidedTo === 'claimant' && row.holderEffect && row.holderEffect !== 'none' ? ` ${t(`tower.ids.effect.${row.holderEffect}`)}` : '';
  return t('tower.ids.decided', { who, by: row.decidedBy ?? '', when: row.decidedAt ? when(row.decidedAt) : '' }) + effect;
}

export function finalWords(row: DisputeRow, t: Translate, when: (iso: string) => string): string {
  if (!row.finalTo) return '';
  const who = t(row.finalTo === 'claimant' ? 'tower.ids.side.claimant' : 'tower.ids.side.holder');
  return t(row.finalTo === row.decidedTo ? 'tower.ids.final.stands' : 'tower.ids.final.changed', { who, by: row.finalBy ?? '', when: row.finalAt ? when(row.finalAt) : '' });
}
