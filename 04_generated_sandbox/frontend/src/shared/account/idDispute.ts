import type { Result } from '../../lib/sbg';

/*
 * TWO PEOPLE SAY ONE NATIONAL ID IS THEIRS — what each of them is told, at each point.
 *
 * The user, 2026-10-08: staff see "a selfie with the holder showing it's ID back and front"; "staff decide from the
 * photos, if that is still disputed they can make an appointment in person. our system will generate a ticket with
 * instructions and what they need to bring for the appointment date."
 *
 * Each of the two holds a REFERENCE of their own and reads everything with it. One of them may have no account at
 * all — they were refused at registration — so every state says where it stands AND what to do next, and never
 * anything about the other person.
 */

export type IdRegister = 'driver' | 'shop';
export type DisputeSide = 'claimant' | 'holder';
export type DisputePhoto = 'face' | 'front' | 'back';
export type DisputeState = 'opened' | 'answering' | 'ready' | 'checked' | 'decided' | 'appointment' | 'rechecked' | 'final' | 'conceded' | 'withdrawn' | 'lapsed';
export type Bring = 'id_card' | 'phone' | 'reference' | 'second_document';

export const DISPUTE_PHOTOS: DisputePhoto[] = ['face', 'front', 'back'];

export interface DisputePlace {
  company: string;
  contactName?: string;
  phone?: string;
  phoneAlt?: string;
  email?: string;
  address?: string;
  hours?: string;
  /** The days it receives visitors (`mon` … `sun`), as the company set them in its own admin. Absent: it set none. */
  visitDays?: string[];
  visitFrom?: string;
  visitTo?: string;
  /** How many visitors it sees in an hour, where it has said — then an appointment is for an hour. */
  visitorsPerHour?: number;
  /** The dates it is closed: public holidays, one-off closures. */
  closedDates?: Array<{ date: string; note?: string }>;
}

/** A day an appointment can be made for — with its hours and the places left in each, where the office counts by the hour. */
export interface DisputeDay {
  date: string;
  hours?: Array<{ at: string; free: number }>;
}

export interface DisputeTicket {
  reference: string;
  date: string;
  /** The hour, from `at` until `until`, where the office counts its visitors by the hour. */
  at?: string;
  until?: string;
  yours: boolean;
  bring: Bring[];
  changesLeft: number;
  /** The company changed its visiting days since, and this day is no longer one of them. */
  offDay?: boolean;
  place?: DisputePlace;
}

export interface DisputeOpened {
  reference: string;
  photosBy: string;
  support?: DisputePlace;
}

export interface DisputeStatus {
  reference: string;
  side: DisputeSide;
  register: IdRegister;
  state: DisputeState;
  openedAt: string;
  photos: DisputePhoto[];
  sent: boolean;
  photosDueBy?: string;
  retakeWhy?: string;
  yours?: boolean;
  reason?: string;
  held?: boolean;
  contestBy?: string;
  ticket?: DisputeTicket;
  /** The days — and hours — there are to choose from, as the server worked them out. Absent: the office has set no visiting days. */
  choices?: DisputeDay[];
  support?: DisputePlace;
}

/** What a signed-in person's own account says about a dispute over their ID — with THEIR reference. */
export interface DisputeAgainstMe {
  reference: string;
  register: IdRegister;
  state: DisputeState;
  answerBy?: string;
  held?: boolean;
}

/**
 * WHAT SETTINGS SAYS ABOUT IT, on the list — three different situations, and the difference is what to do: answer
 * (and by when), read a decision that was made, or end a hold. Each opens the same sheet.
 */
export function settingsIdSays(d: DisputeAgainstMe, t: (key: never, vars?: Record<string, string | number>) => string): { title: string; detail: string; cta: string } {
  const say = t as (key: string, vars?: Record<string, string | number>) => string;
  if (d.held) return { title: say('account.settings.id.heldTitle'), detail: say('account.settings.id.heldDetail'), cta: say('account.settings.id.openHeld') };
  if (['decided', 'appointment', 'rechecked', 'final'].includes(d.state)) return { title: say('account.settings.id.decidedTitle'), detail: say('account.settings.id.decidedDetail'), cta: say('account.settings.id.openDecided') };
  const by = d.answerBy ? new Date(d.answerBy).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
  return { title: say('account.settings.id.title'), detail: by ? say('account.settings.id.detailBy', { date: by }) : say('account.settings.id.detail'), cta: say('account.settings.id.open') };
}

/** The doors either of the two people uses, by their own reference. Signed in or not: the reference is the key. */
export interface IdDisputeApi {
  status: (reference: string) => Promise<Result<DisputeStatus>>;
  photo: (reference: string, which: DisputePhoto, dataUrl: string, thumbDataUrl?: string) => Promise<Result<DisputeStatus>>;
  send: (reference: string) => Promise<Result<DisputeStatus>>;
  withdraw: (reference: string) => Promise<Result<DisputeStatus>>;
  appoint: (reference: string, date: string, at?: string) => Promise<Result<DisputeStatus>>;
}

/** Built on whatever can post: a public request at a sign-in screen, or a signed-in client in Settings. */
export function idDisputeApi(post: <T>(path: string, body: unknown) => Promise<Result<T>>): IdDisputeApi {
  const at = '/v1/sbg/identity/id-disputes';
  return {
    status: (reference) => post(`${at}/status`, { reference }),
    photo: (reference, which, dataUrl, thumbDataUrl) => post(`${at}/photo`, { reference, which, dataUrl, ...(thumbDataUrl ? { thumbDataUrl } : {}) }),
    send: (reference) => post(`${at}/send`, { reference }),
    withdraw: (reference) => post(`${at}/withdraw`, { reference }),
    appoint: (reference, date, hour) => post(`${at}/appointment`, { reference, date, ...(hour ? { at: hour } : {}) }),
  };
}

type Say = (key: string, vars?: Record<string, string | number>) => string;
type T = (key: never, vars?: Record<string, string | number>) => string;
const day = (iso?: string) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');

/** Is this an ID-dispute reference — `ID-XXXX-XXXX`, however it was typed? The letters in front are what tell it from an account move's. */
export function looksLikeIdReference(typed: string): boolean {
  const s = (typed ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.startsWith('ID') && s.length === 10;
}

export interface IdSays {
  tone: 'info' | 'ok' | 'warn';
  icon: 'clock' | 'check' | 'warning' | 'info';
  title: string;
  /** Each a sentence of its own. */
  lines: string[];
}

/**
 * WHERE IT STANDS, for the one reading — and what to do next. A decision says whose it is in the reader's terms
 * ("yours" / "not yours"), with staff's reason only for the one who did not get it; a hold says the one thing that
 * ends it.
 */
export function idStatusSays(status: DisputeStatus, t: T): IdSays {
  const say = t as Say;
  const what = say(status.register === 'driver' ? 'account.id.reg.driver' : 'account.id.reg.shop');
  const mine = status.side === 'claimant';
  const why = status.reason ? [say('account.id.why', { reason: status.reason })] : [];
  const contest = status.contestBy ? [say('account.id.contest', { date: day(status.contestBy) })] : [];
  const held = status.held ? [say('account.id.held', { what })] : [];
  const again = status.retakeWhy ? [say('account.id.retake', { reason: status.retakeWhy })] : [];

  switch (status.state) {
    case 'opened':
      // The claimant owes their photographs. A holder reading this was told earlier, and it is the other's turn.
      return mine
        ? { tone: 'info', icon: 'clock', title: say('account.id.claimant.owed'), lines: [...again, say('account.id.claimant.owedDetail', { date: day(status.photosDueBy) })] }
        : { tone: 'info', icon: 'clock', title: say('account.id.holder.waiting'), lines: [say(status.sent ? 'account.id.withStaffDetail' : 'account.id.holder.maySend', { date: day(status.photosDueBy) })] };
    case 'answering':
      if (mine) return { tone: 'info', icon: 'clock', title: say('account.id.claimant.sent'), lines: [say('account.id.claimant.sentDetail')] };
      return { tone: 'warn', icon: 'warning', title: say('account.id.holder.asked', { what }), lines: [...again, say('account.id.holder.askedDetail', { date: day(status.photosDueBy) })] };
    case 'ready':
    case 'checked':
      if (!mine && !status.sent && status.photosDueBy) return { tone: 'warn', icon: 'warning', title: say('account.id.holder.asked', { what }), lines: [say('account.id.holder.late')] };
      return { tone: 'info', icon: 'clock', title: say('account.id.withStaff'), lines: [say('account.id.withStaffDetail')] };
    case 'decided':
    case 'final': {
      const last = status.state === 'final' ? [say('account.id.final')] : [];
      if (status.yours) return { tone: 'ok', icon: 'check', title: say('account.id.yours'), lines: [say(mine ? 'account.id.yoursRegister' : 'account.id.yoursKept'), ...last] };
      return { tone: 'warn', icon: 'warning', title: say(mine ? 'account.id.notYours' : 'account.id.gone', { what }), lines: [...why, ...(mine || status.held ? held : [say('account.id.corrected')]), ...contest, ...last] };
    }
    case 'appointment':
      return { tone: 'info', icon: 'clock', title: say(status.ticket?.yours ? 'account.id.appointment.yours' : 'account.id.appointment.theirs'), lines: [say(status.ticket?.yours ? 'account.id.appointment.yoursDetail' : 'account.id.appointment.theirsDetail'), ...held] };
    case 'rechecked':
      return { tone: 'info', icon: 'clock', title: say('account.id.rechecked'), lines: [say('account.id.recheckedDetail'), ...held] };
    case 'conceded':
      return mine
        ? { tone: 'ok', icon: 'check', title: say('account.id.yours'), lines: [say('account.id.conceded.claimant'), say('account.id.yoursRegister')] }
        : { tone: 'ok', icon: 'check', title: say('account.id.conceded.holder'), lines: [say('account.id.conceded.holderDetail')] };
    case 'withdrawn':
      return { tone: 'info', icon: 'info', title: say(mine ? 'account.id.withdrawn.claimant' : 'account.id.withdrawn.holder'), lines: [say('account.id.nothingChanged')] };
    default:
      return { tone: 'info', icon: 'info', title: say('account.id.lapsed'), lines: [say(mine ? 'account.id.lapsed.claimant' : 'account.id.nothingChanged')] };
  }
}

/** What the reader may still do. Decided by the server's own answer, never guessed from the state alone. */
export function idActions(status: DisputeStatus): { photos: boolean; withdraw: boolean; appoint: boolean; changeDay: boolean; ownId: boolean } {
  const undecided = ['opened', 'answering', 'ready', 'checked'].includes(status.state);
  return {
    photos: Boolean(status.photosDueBy),
    withdraw: status.side === 'claimant' && undecided,
    appoint: Boolean(status.contestBy),
    changeDay: status.state === 'appointment' && Boolean(status.ticket?.yours) && (status.ticket?.changesLeft ?? 0) > 0,
    // "The number on my record is not mine": the holder's to say while it is open, and what ends a hold.
    ownId: Boolean(status.held) || (status.side === 'holder' && undecided && status.state !== 'opened'),
  };
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/**
 * THE DAYS THERE ARE TO CHOOSE FROM — the server's own list, never worked out here. The user, 2026-10-08: "it's up
 * to the countries to set visiting days and visiting hours"; "the country should set it's own public holidays
 * and/or one off closure"; "the limitation is set by the country as an actual number of visitors per hour." Only
 * the server knows all three together, and what other people have already taken.
 *
 * NULL where the office has set no visiting days: then any day may be asked for, and the person is told to ask
 * first. When MOVING an appointment, the day it is already on is not a change — unless it has hours, and the
 * change is to another hour of the same day.
 */
export function dayChoices(status: Pick<DisputeStatus, 'choices' | 'ticket'>): DisputeDay[] | null {
  if (!status.choices) return null;
  return status.choices.filter((c) => Boolean(c.hours) || c.date !== status.ticket?.date);
}

/** The hours of the day that was chosen, where the office counts by the hour. Null: a day is all there is to choose. */
export function hoursOn(status: Pick<DisputeStatus, 'choices'>, date: string): Array<{ at: string; free: number }> | null {
  return status.choices?.find((c) => c.date === date)?.hours ?? null;
}

/** Is there enough chosen to make the appointment: a day — and, where the day has hours, one of them with a place left. */
export function readyToAppoint(status: Pick<DisputeStatus, 'choices'>, date: string, at: string): boolean {
  if (!date) return false;
  const hours = hoursOn(status, date);
  return hours ? hours.some((h) => h.at === at && h.free > 0) : true;
}

/** A day as a button says it: "Mon 12 Oct". */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** When the company receives visitors, in a line: its days in the week's order, then its hours. Null where it has set no days. */
export function visitingWords(place: DisputePlace | undefined, t: T): string | null {
  const say = t as Say;
  const days = place?.visitDays;
  if (!days?.length) return null;
  const names = WEEK.filter((d) => days.includes(d)).map((d) => say(`account.id.day.${d}`));
  const hours = place?.visitFrom && place?.visitTo ? say('account.id.visitHours', { from: place.visitFrom, to: place.visitTo }) : '';
  return [names.join(', '), hours].filter(Boolean).join(' · ');
}

/** The ticket, as lines to read at a glance and say at a desk: when, where, who to ask for. */
export function ticketLines(ticket: DisputeTicket, t: T): { when: string; where: string[] } {
  const say = t as Say;
  const p = ticket.place;
  return {
    // The day — and the hour, where the office gave one: somebody told "Friday" and somebody told "Friday, ten to
    // eleven" plan a different morning.
    when:
      new Date(`${ticket.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
      (ticket.at && ticket.until ? `, ${say('account.id.ticket.hour', { from: ticket.at, until: ticket.until })}` : ''),
    where: p
      ? [
          p.company,
          // Its address, or that it has written none — said beside whatever else it did write.
          ...(p.address ? [p.address] : [say('account.id.ticket.noAddress')]),
          // When it receives VISITORS, where it has said; the gate's own hours only where it has not.
          ...(visitingWords(p, t) ? [say('account.id.ticket.visiting', { when: visitingWords(p, t) as string })] : p.hours ? [p.hours, say('account.id.ticket.noDays')] : [say('account.id.ticket.noDays')]),
          ...(p.contactName ? [say('account.id.ticket.askFor', { name: p.contactName })] : []),
          ...(p.phone ? [say('account.move.supportPhone', { phone: [p.phone, p.phoneAlt].filter(Boolean).join(' / ') })] : []),
        ]
      : [say('account.id.ticket.noPlace')],
  };
}

/** What to bring, in the order it is asked for. The second document depends on what they registered as. */
export function bringLines(ticket: DisputeTicket, register: IdRegister, t: T): string[] {
  const say = t as Say;
  return ticket.bring.map((b) => (b === 'second_document' ? say(register === 'driver' ? 'account.id.bring.second.driver' : 'account.id.bring.second.shop') : b === 'reference' ? say('account.id.bring.reference', { reference: ticket.reference }) : say(`account.id.bring.${b}`)));
}

/** The days an appointment may be made for: from tomorrow, three weeks ahead. `YYYY-MM-DD`, as a date input wants. */
export function appointmentDays(now: number = Date.now()): { min: string; max: string } {
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString().slice(0, 10);
  return { min: at(1), max: at(21) };
}
