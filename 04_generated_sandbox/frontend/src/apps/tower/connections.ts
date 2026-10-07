import type { Translate } from '../../shared/i18n';

/**
 * WHAT THIS SERVER IS CONNECTED TO, as the console says it.
 *
 * Two services stand behind a fleet's planning panel: a routing server for road distances, and the adviser. Each falls
 * back quietly where it is used — a plan is made on estimates, the adviser says it is not set up — so staff could not
 * tell a service that works from one that is set and silent. Each is said here as ONE state and the sentence that
 * goes with it: not set up · set, and wrong · set, and not yet asked · answering · not answering.
 *
 * "Configured" is never said on its own. An address that is set and unreachable is configured, and every plan made on
 * it is an estimate.
 *
 * Mail and push stand behind everybody. They do not fall back: each is handed to a sender, and the sender this server
 * starts with keeps what it is handed. Their states are: kept, not sent · set, and wrong · nothing sent yet · sending
 * · not getting through.
 */

export interface RouterAsk {
  at: string;
  ok: boolean;
  places: number;
  why?: string;
}
export interface RouterConnection {
  configured: boolean;
  host?: string;
  invalid?: boolean;
  profile: string;
  maxPoints: number;
  last?: RouterAsk;
}
export type AdviserFailure = 'not_configured' | 'busy' | 'unreachable' | 'declined';
export interface AdviserConnection {
  configured: boolean;
  model: string;
  last?: { at: string; ok: boolean; failed?: AdviserFailure };
}
export type MailFailure = 'unreachable' | 'refused' | 'limit' | 'rejected' | 'failed';
export type MailProblem = 'no_address' | 'not_an_address' | 'not_https';
export interface MailConnection {
  sends: boolean;
  tokenSet: boolean;
  host?: string;
  problem?: MailProblem;
  from: string;
  fromIsPlaceholder: boolean;
  written: number;
  failed: number;
  /** Not handed to the provider: their address is on a domain reserved for examples and tests, and cannot exist. */
  reserved: number;
  last?: { at: string; ok: boolean; what: string; failed?: MailFailure; code?: string };
}
export type PushKeys = 'own' | 'built_in' | 'mismatched';
export interface PushConnection {
  sends: boolean;
  keys: PushKeys;
  devices: number;
  people: number;
  handed: number;
  failed: number;
  last?: { at: string; ok: boolean };
}
export interface Connections {
  router: RouterConnection;
  adviser: AdviserConnection;
  mail: MailConnection;
  push: PushConnection;
  sandbox: boolean;
  since: string;
}
export interface RouterCheck {
  at: string;
  ok: boolean;
  why?: string;
  km?: number;
  noRoad?: boolean;
  apartKm?: number;
  near?: string;
  ms?: number;
}

export type ConnectionTone = 'ok' | 'warn' | 'danger' | 'info' | 'quiet';
export interface ConnectionSays {
  tone: ConnectionTone;
  /** The one word for where it stands. */
  tag: string;
  /** What that means for the people using it, and what to do about it where there is something to do. */
  line: string;
}

/** A moment as the console says it: the day and the time, in the reader's own clock. */
export function momentWords(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The routing server: where it stands, and what that means for a day's plan. */
export function routerSays(c: RouterConnection, since: string, t: Translate): ConnectionSays {
  if (!c.configured) return { tone: 'quiet', tag: t('tower.conn.tag.off'), line: t('tower.conn.router.off') };
  if (c.invalid) return { tone: 'danger', tag: t('tower.conn.tag.invalid'), line: t('tower.conn.router.invalid') };
  if (!c.last) return { tone: 'info', tag: t('tower.conn.tag.unasked'), line: t('tower.conn.router.unasked', { since: momentWords(since) }) };
  const when = momentWords(c.last.at);
  if (c.last.ok) return { tone: 'ok', tag: t('tower.conn.tag.answering'), line: t('tower.conn.router.answered', { when, n: c.last.places }) };
  return { tone: 'warn', tag: t('tower.conn.tag.silent'), line: t('tower.conn.router.failed', { when, n: c.last.places, why: c.last.why ?? t('tower.conn.router.noReason') }) };
}

/** The adviser: where it stands, and what a fleet's office meets. */
export function adviserSays(c: AdviserConnection, since: string, t: Translate): ConnectionSays {
  if (!c.configured) return { tone: 'quiet', tag: t('tower.conn.tag.off'), line: t('tower.conn.adviser.off') };
  if (!c.last) return { tone: 'info', tag: t('tower.conn.tag.unasked'), line: t('tower.conn.adviser.unasked', { since: momentWords(since) }) };
  const when = momentWords(c.last.at);
  if (c.last.ok) return { tone: 'ok', tag: t('tower.conn.tag.answering'), line: t('tower.conn.adviser.answered', { when }) };
  // A key that was refused is the operator's to put right, and is said louder than a service that was busy.
  if (c.last.failed === 'not_configured') return { tone: 'danger', tag: t('tower.conn.tag.refused'), line: t('tower.conn.adviser.refused', { when }) };
  return { tone: 'warn', tag: t('tower.conn.tag.silent'), line: t(c.last.failed === 'busy' ? 'tower.conn.adviser.busy' : 'tower.conn.adviser.unreachable', { when }) };
}

/** A count since the server started, with how many of them failed said beside it only when some did. */
export function countWords(n: number, failed: number, t: Translate): string {
  return failed > 0 ? t('tower.conn.fact.countFailed', { n, failed }) : String(n);
}

/**
 * Mail. The first question is not whether it is answering but whether anything LEAVES: without the provider's token
 * and its sending address, the sender this server starts with keeps what it is handed. That is said first — in a
 * sandbox as the way it is meant to run, anywhere else as people who are not being told. A token that is set is never
 * taken for sending: it is said as a token nothing uses, with why where the server knows why.
 *
 * Where email does leave, a failure is said by WHOSE IT IS: a refusal or a used-up limit is the account's, stops
 * every email, and is said in red; one email turned down, or a provider that could not be reached, is said as that.
 */
export function mailSays(c: MailConnection, sandbox: boolean, since: string, t: Translate): ConnectionSays {
  if (!c.sends) {
    const line = t(sandbox ? 'tower.conn.mail.kept' : 'tower.conn.mail.keptLive', { n: c.written });
    const why = c.problem ? t(`tower.conn.mail.problem.${c.problem}`) : c.tokenSet ? t('tower.conn.mail.tokenUnused') : '';
    // On a sandbox with nothing set this is how it should be. With a token set, somebody meant it to send.
    return { tone: !sandbox ? 'danger' : why ? 'warn' : 'info', tag: t('tower.conn.tag.kept'), line: why ? `${line} ${why}` : line };
  }
  // It sends, as an address no provider delivers for: said before anything the last email met.
  if (c.fromIsPlaceholder) return { tone: 'danger', tag: t('tower.conn.tag.noFrom'), line: t('tower.conn.mail.noFrom', { from: c.from }) };
  if (!c.last) return { tone: 'info', tag: t('tower.conn.tag.unsent'), line: t('tower.conn.mail.unsent', { since: momentWords(since) }) };
  const when = momentWords(c.last.at);
  const earlier = c.failed > 0 ? ` ${t('tower.conn.mail.someFailed', { failed: c.failed, n: c.written })}` : '';
  if (c.last.ok) return { tone: 'ok', tag: t('tower.conn.tag.sending'), line: t('tower.conn.mail.sent', { when, what: c.last.what }) + earlier };
  const kind: MailFailure = c.last.failed ?? 'failed';
  const account = kind === 'refused' || kind === 'limit';
  const line = [
    t(`tower.conn.mail.failed.${kind}`, { when, what: c.last.what }),
    ...(kind === 'refused' ? [t(`tower.conn.mail.refusedWhy.${refusedWhy(c.last.code)}`)] : []),
    ...(c.last.code ? [t('tower.conn.mail.code', { code: c.last.code })] : []),
  ].join(' ');
  return { tone: account ? 'danger' : 'warn', tag: t(MAIL_FAILED_TAG[kind]), line: line + earlier };
}

const MAIL_FAILED_TAG = {
  refused: 'tower.conn.tag.mailRefused',
  limit: 'tower.conn.tag.mailLimit',
  rejected: 'tower.conn.tag.mailRejected',
  unreachable: 'tower.conn.tag.notSending',
  failed: 'tower.conn.tag.notSending',
} as const;

/**
 * What a refusal is about, from the provider's own code — only the codes whose meaning its documentation states.
 * Anything else is said as what is known: it will not send for this account as it is set up.
 */
export function refusedWhy(code: string | undefined): 'token' | 'sender' | 'review' | 'blocked' | 'unknown' {
  if (code === 'SERR_157') return 'token';
  if (code === 'SM_111') return 'sender';
  if (code === 'SM_128') return 'review';
  if (code === 'AE_101') return 'blocked';
  return 'unknown';
}

/** The provider's sending address, as the screen may show it: its host, or what is wrong with what was set. */
export function mailAddressWords(c: MailConnection, t: Translate): string {
  if (c.problem === 'not_an_address') return t('tower.conn.fact.notAnAddress');
  if (c.problem === 'not_https' && c.host) return t('tower.conn.fact.notHttps', { host: c.host });
  return c.host ?? t('tower.conn.fact.none');
}

/**
 * Push — the message that lights a phone whose app is closed. Kept or sent is said first, as the mail's is. Then the
 * keys, which can be wrong in two ways no push would show until it is refused: a pair that does not belong together,
 * and the pair written in the source, which anybody can sign with.
 */
export function pushSays(c: PushConnection, sandbox: boolean, since: string, t: Translate): ConnectionSays {
  if (!c.sends) return { tone: sandbox ? 'info' : 'danger', tag: t('tower.conn.tag.kept'), line: t(sandbox ? 'tower.conn.push.kept' : 'tower.conn.push.keptLive') };
  if (c.keys === 'mismatched') return { tone: 'danger', tag: t('tower.conn.tag.keysMismatched'), line: t('tower.conn.push.mismatched') };
  if (c.keys === 'built_in') return { tone: 'danger', tag: t('tower.conn.tag.keysBuiltIn'), line: t('tower.conn.push.builtIn') };
  if (!c.last) return { tone: 'info', tag: t('tower.conn.tag.unsent'), line: t('tower.conn.push.unsent', { since: momentWords(since) }) };
  const when = momentWords(c.last.at);
  const earlier = c.failed > 0 ? ` ${t('tower.conn.push.someFailed', { failed: c.failed, n: c.handed })}` : '';
  if (c.last.ok) return { tone: 'ok', tag: t('tower.conn.tag.sending'), line: t('tower.conn.push.sent', { when }) + earlier };
  return { tone: 'warn', tag: t('tower.conn.tag.notSending'), line: t('tower.conn.push.failed', { when }) + earlier };
}

/**
 * What a check of the routing server met, as a sentence. An answer is said WITH its figure and how far apart the two
 * places really are: a server that holds another country's map answers too, and only the figure gives it away.
 */
export function checkSays(r: RouterCheck, t: Translate): { tone: ConnectionTone; line: string } {
  if (!r.ok) return { tone: 'warn', line: t('tower.conn.check.failed', { why: r.why ?? t('tower.conn.router.noReason') }) };
  const where = { apart: r.apartKm ?? 0, near: r.near ?? '', ms: r.ms ?? 0 };
  if (r.noRoad || r.km === undefined) return { tone: 'warn', line: t('tower.conn.check.noRoad', where) };
  return { tone: plausible(r.km, r.apartKm) ? 'ok' : 'warn', line: t(plausible(r.km, r.apartKm) ? 'tower.conn.check.ok' : 'tower.conn.check.odd', { ...where, km: r.km }) };
}

/**
 * Could this be the road between two places that far apart? Never shorter than the straight line (less a little for
 * where the server puts each place on its nearest road), and not many times longer. Outside that, the answer is one —
 * and is very likely about somewhere else.
 */
export function plausible(km: number, apartKm: number | undefined): boolean {
  if (!apartKm || apartKm <= 0) return true;
  return km >= apartKm * 0.5 && km <= apartKm * 8;
}
