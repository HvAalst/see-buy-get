import type { MessageKey, Translate } from '../i18n';
import { looksLikeAKey } from '../archive/documentLink';
import { day } from '../archive/words';

/*
 * THE DAMAGE CLAIM REPORT, as the people who meet one read it: whoever it is for, in their own app; staff, in the
 * console; and whoever was handed a link to it, signed out, on the front door.
 *
 * The user, 2026-10-12: "we hand over a report of the parcel mint, the finger print and it's related documents to an
 * insurer of the claimants choice, to the claimant themselves or one set by the vendor according to their shipping
 * policy." So nothing here says anybody was right or wrong, or that anything is owed. It says what the record held.
 */

export type HolderKind = 'sender' | 'shop' | 'driver' | 'hub' | 'receiver';
export interface ReportHolder {
  kind: HolderKind;
  name: string;
}
export interface DamageReportBody {
  number: string;
  statement: string;
  parcel: { parcelId: string; shipmentId?: string; through: string; store?: string; orderNumber?: string; madeAt: string; from: string; to: string; size: string; fragile: boolean; contents?: string[]; declaredValue?: number; currency: string };
  terms: { promise: string; company?: string; coverLimit: number; currency: string };
  problem: { origin: 'counter' | 'buyer'; reportedAt: string; reason: string; parcelWas: string; heldBy?: ReportHolder; shop?: string };
  custody: Array<{ holder: ReportHolder; from: string; to?: string; note?: string }>;
  events: Array<{ at: string; status: string; note: string; fingerprint?: string }>;
  photographs: Array<{ what: string; reference: string; mediaId?: string; takenAt?: string; sha256?: string }>;
}
export interface DamageReportView {
  parcelId: string;
  madeAt: string;
  sha256: string;
  body: DamageReportBody;
}

export type ReportLinkState = 'ready' | 'expired' | 'cancelled' | 'used_up';
export interface ReportLinkView {
  state: ReportLinkState;
  expiresAt: string;
  number?: string;
  parcelId?: string;
  from?: string;
  to?: string;
  reportedAt?: string;
  sha256?: string;
  opensLeft?: number;
}
export interface ReportLinkRow {
  linkId: string;
  state: ReportLinkState;
  createdAt: string;
  expiresAt: string;
  opened: number;
  lastOpenedAt?: string;
  cancelledAt?: string;
}
export interface MadeReportLink {
  url: string;
  link: ReportLinkRow;
}
/** What became of asking about a link: the server's answer, or why there is none. */
export type ReportLinkAnswer = { view: ReportLinkView } | { failed: 'not_ours' | 'busy' | 'unreachable' };

/** A moment as somebody reads it on a phone: the day and the time, in their own clock. */
export function moment(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${day(iso)}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * THE KEY, out of the part of an address a browser sends to no server: `#report=<key>`. Whatever follows is handed
 * back as it is, even when it cannot be a key — somebody was sent here for a report, and should land on a page that
 * says so. `undefined` only when the address is not about a report at all.
 */
export function readReportKey(hash: string | undefined): string | undefined {
  const m = /(?:^#|&)report=([^&]*)/.exec(hash ?? '');
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]).trim().slice(0, 200);
  } catch {
    return m[1].trim().slice(0, 200);
  }
}

export { looksLikeAKey };

const HANDS: Record<HolderKind, MessageKey> = { sender: 'dreport.hands.sender', shop: 'dreport.hands.shop', driver: 'dreport.hands.carrier', hub: 'dreport.hands.hub', receiver: 'dreport.hands.receiver' };
const THROUGH: Record<string, MessageKey> = { store: 'dreport.through.store', counter: 'dreport.through.counter', app: 'dreport.through.app' };
const PHOTO: Record<string, MessageKey> = { contents: 'dreport.photo.contents', drop_off: 'dreport.photo.dropOff', handed_over: 'dreport.photo.handedOver', received: 'dreport.photo.received', problem: 'dreport.photo.problem' };

/** In whose hands, said as the kind of hands and the name: "Shop: Riverside Corner". */
export function holderWords(h: ReportHolder, t: Translate): string {
  return `${t(HANDS[h.kind] ?? 'dreport.hands.carrier')}: ${h.name}`;
}

/** What the company that carried it pays itself, in a sentence — the terms the parcel travelled under. */
export function termsWords(terms: DamageReportBody['terms'], t: Translate): string {
  if (terms.promise === 'theirs') return t('dreport.terms.theirs');
  if (terms.promise !== 'ours') return t('dreport.terms.none');
  const company = terms.company ?? t('dreport.terms.theCompany');
  return terms.coverLimit > 0 ? t('dreport.terms.covered', { company, amount: terms.coverLimit.toFixed(2), currency: terms.currency }) : t('dreport.terms.noCover', { company });
}

export interface ReportSection {
  title: string;
  /** Label and value; a row with no label is a sentence of its own. */
  rows: Array<{ label?: string; value: string }>;
}

/**
 * THE REPORT ON A SCREEN, in the order somebody with a claim reads it: what was reported, the parcel as it was made,
 * the terms it travelled under, who held it and when, the steps, the photographs, and the fingerprint to compare.
 */
export function reportSections(report: DamageReportView, t: Translate): ReportSection[] {
  const b = report.body;
  const row = (label: string, value: string | undefined) => (value ? [{ label, value }] : []);
  return [
    {
      title: t('dreport.section.problem'),
      rows: [
        ...row(t('dreport.row.reportedBy'), b.problem.origin === 'counter' ? t('dreport.by.shop', { shop: b.problem.shop ?? t('dreport.theShop') }) : t('dreport.by.receiver')),
        ...row(t('dreport.row.when'), moment(b.problem.reportedAt)),
        ...row(t('dreport.row.words'), b.problem.reason),
        ...row(t('dreport.row.parcelWas'), b.problem.parcelWas),
        ...row(t('dreport.row.heldBy'), b.problem.heldBy ? holderWords(b.problem.heldBy, t) : t('dreport.heldByNobody')),
      ],
    },
    {
      title: t('dreport.section.parcel'),
      rows: [
        ...row(t('dreport.row.parcel'), b.parcel.parcelId),
        ...row(t('dreport.row.through'), t(THROUGH[b.parcel.through] ?? 'dreport.through.counter')),
        ...row(t('dreport.row.store'), b.parcel.store),
        ...row(t('dreport.row.order'), b.parcel.orderNumber),
        ...row(t('dreport.row.made'), moment(b.parcel.madeAt)),
        ...row(t('dreport.row.from'), b.parcel.from),
        ...row(t('dreport.row.to'), b.parcel.to),
        ...row(t('dreport.row.size'), b.parcel.fragile ? t('dreport.sizeFragile', { size: b.parcel.size }) : b.parcel.size),
        ...row(t('dreport.row.contents'), b.parcel.contents?.join('; ')),
        ...row(t('dreport.row.value'), b.parcel.declaredValue !== undefined ? `${b.parcel.declaredValue.toFixed(2)} ${b.parcel.currency}` : undefined),
      ],
    },
    { title: t('dreport.section.terms'), rows: [{ value: termsWords(b.terms, t) }] },
    {
      title: t('dreport.section.custody'),
      // The receiver's is not a stretch of time in the network's hands: it is the moment the parcel left them.
      rows: b.custody.map((leg) => ({
        label: holderWords(leg.holder, t),
        value: leg.holder.kind === 'receiver' ? t('dreport.handedOverAt', { at: moment(leg.from) }) : leg.to ? t('dreport.fromTo', { from: moment(leg.from), to: moment(leg.to) }) : t('dreport.fromStill', { from: moment(leg.from) }),
      })),
    },
    // The record's own word for the last step is "Disputed". Nobody disputes anything here: a problem was reported.
    { title: t('dreport.section.steps'), rows: b.events.map((e) => ({ label: moment(e.at), value: [e.status === 'Disputed' ? t('dreport.step.reported') : e.status.replace(/_/g, ' '), e.note].filter(Boolean).join(' — ') })) },
    {
      title: t('dreport.section.photos'),
      rows: b.photographs.length ? b.photographs.map((p) => ({ label: t(PHOTO[p.what] ?? 'dreport.photo.problem'), value: p.mediaId ? t('dreport.photo.inFile') : t('dreport.photo.referenceOnly', { reference: p.reference }) })) : [{ value: t('dreport.photo.noneAtAll') }],
    },
    { title: t('dreport.section.fingerprint'), rows: [{ value: report.sha256 }, { value: t('dreport.fingerprintHint') }] },
  ];
}

export interface ReportLinkSays {
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon: 'check' | 'clock' | 'warning' | 'offline' | 'info';
  title: string;
  lines: string[];
  canTake: boolean;
  canRetry: boolean;
}

/** How few openings are left before it is worth saying so. */
export const FEW_OPENINGS = 5;

/**
 * What the front-door page says to whoever was handed a link. One that opens says what it opens and until when;
 * one that does not says which way it stopped, and who to turn to — whoever gave it to them, never us: the report
 * is theirs to give.
 */
export function reportLinkSays(answer: ReportLinkAnswer, t: Translate): ReportLinkSays {
  const stopped = (title: string, lines: string[], over: Partial<ReportLinkSays> = {}): ReportLinkSays => ({ tone: 'warn', icon: 'clock', title, lines, canTake: false, canRetry: false, ...over });
  if ('failed' in answer) {
    if (answer.failed === 'not_ours') return stopped(t('dreport.link.notOurs.title'), [t('dreport.link.notOurs.detail'), t('dreport.link.askGiver')], { tone: 'danger', icon: 'warning' });
    if (answer.failed === 'busy') return stopped(t('dreport.link.busy.title'), [t('dreport.link.busy.detail')], { canRetry: true });
    return stopped(t('dreport.link.unreachable.title'), [t('dreport.link.unreachable.detail')], { icon: 'offline', canRetry: true });
  }
  const v = answer.view;
  if (v.state === 'expired') return stopped(t('dreport.link.expired.title'), [t('dreport.link.expired.detail', { date: day(v.expiresAt) }), t('dreport.link.askGiver')]);
  if (v.state === 'cancelled') return stopped(t('dreport.link.cancelled.title'), [t('dreport.link.cancelled.detail'), t('dreport.link.askGiver')], { icon: 'warning' });
  if (v.state === 'used_up') return stopped(t('dreport.link.usedUp.title'), [t('dreport.link.usedUp.detail'), t('dreport.link.askGiver')]);
  const lines = [t('dreport.link.ready.about', { number: v.number ?? '', from: v.from ?? '', to: v.to ?? '', date: day(v.reportedAt) }), t('dreport.link.ready.what'), t('dreport.link.ready.until', { date: day(v.expiresAt) })];
  if (v.opensLeft !== undefined && v.opensLeft <= FEW_OPENINGS) lines.push(t('dreport.link.ready.fewLeft', { count: v.opensLeft }));
  return { tone: 'info', icon: 'info', title: t('dreport.link.ready.title'), lines, canTake: true, canRetry: false };
}

/** One link on the report, as whoever made it reads it: when it stops or how it stopped, and how often it was used. */
export function reportLinkRowSays(row: ReportLinkRow, t: Translate): { title: string; detail: string; working: boolean } {
  const opened = row.opened === 0 ? t('dreport.link.row.neverOpened') : t('dreport.link.row.opened', { count: row.opened, date: day(row.lastOpenedAt) });
  if (row.state === 'ready') return { title: t('dreport.link.row.ready', { date: day(row.expiresAt) }), detail: opened, working: true };
  const how = row.state === 'cancelled' ? t('dreport.link.row.cancelled', { date: day(row.cancelledAt) }) : row.state === 'expired' ? t('dreport.link.row.expired', { date: day(row.expiresAt) }) : t('dreport.link.row.usedUp');
  return { title: how, detail: opened, working: false };
}

/** The file's name on somebody's phone: the report's own number. */
export function reportFileName(number: string | undefined): string {
  const safe = (number ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);
  return `damage-claim-report${safe ? `-${safe}` : ''}.zip`;
}
