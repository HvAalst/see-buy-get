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
 *
 * So does the text that carries a code — and off a sandbox it is the only way a code reaches a phone, so "kept" there
 * is not people who are told late: it is nobody signing up at all.
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
export type BounceRefusal = 'unsigned' | 'algorithm' | 'stale' | 'mismatch' | 'unreadable' | 'not_raw';
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
  /** Not handed to the provider since it started: email to the address came back. A code still goes. */
  bounced: number;
  /** The provider's bounce notices: listened for or not, how many came, how many were refused and why the last was. */
  bounces: { listening: boolean; stopped: number; received: number; refused: number; unsigned: number; lastAt?: string; lastRefused?: BounceRefusal; lastRefusedAt?: string };
  /** Could not be handed over and being tried again: how many wait now, and since when the oldest. In memory only. */
  waiting: number;
  waitingSince?: string;
  /** Since the server started: handed over on a later try · given up on. */
  sentLater: number;
  gaveUp: number;
  /** `again` — it failed, and is kept to be tried again. */
  last?: { at: string; ok: boolean; what: string; failed?: MailFailure; code?: string; again?: boolean };
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
export type SmsFailure = 'unreachable' | 'refused' | 'limit' | 'rejected' | 'failed';
export type SmsProblem = 'no_account' | 'no_credential' | 'no_sender' | 'not_twilio' | 'sandbox';
export interface SmsConnection {
  sends: boolean;
  accountSet: boolean;
  credential?: 'api_key' | 'auth_token';
  sender?: 'service' | 'from';
  problem?: SmsProblem;
  /** Texts go to a stand-in on the server's own machine: a sandbox being driven. No phone receives one. */
  standIn: boolean;
  /** The countries a code is texted to — the ones that are switched on — as "KE +254". Empty: none. */
  countries: string[];
  written: number;
  failed: number;
  /** Not texted since the server started: the number's country is not switched on. */
  fenced: number;
  last?: { at: string; ok: boolean; failed?: SmsFailure; code?: string };
}
export interface Connections {
  router: RouterConnection;
  adviser: AdviserConnection;
  mail: MailConnection;
  push: PushConnection;
  sms: SmsConnection;
  sandbox: boolean;
  /** The review code (GLOS_REVIEW_CODE_UNTIL): a new account's code is 000000 until the end of this day, UTC. */
  reviewCode?: { until: string } | null;
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
export function countWords(n: number, failed: number, t: Translate, triedAgain = false): string {
  // Where what failed may still go later (email), the count says it is of the first try.
  return failed > 0 ? t(triedAgain ? 'tower.conn.fact.countFailedFirst' : 'tower.conn.fact.countFailed', { n, failed }) : String(n);
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
  if (!c.last) {
    const heard = mailBounceWords(c, t);
    return { tone: heard.length ? 'warn' : 'info', tag: t('tower.conn.tag.unsent'), line: [t('tower.conn.mail.unsent', { since: momentWords(since) }), ...heard].join(' ') };
  }
  const when = momentWords(c.last.at);
  const heard = mailBounceWords(c, t);
  const earlier = [...(c.failed > 0 ? [t('tower.conn.mail.someFailed', { failed: c.failed, n: c.written })] : []), ...mailAgainWords(c, t), ...heard].map((x) => ` ${x}`).join('');
  if (c.last.ok) {
    // It is getting through now — and some from before are still waiting, or were lost. Not a clean bill.
    // …or nobody is listening for what comes back, or what comes is being refused.
    const behind = c.waiting > 0 || c.gaveUp > 0 || heard.length > 0;
    return { tone: behind ? 'warn' : 'ok', tag: t(c.waiting > 0 ? 'tower.conn.tag.catchingUp' : 'tower.conn.tag.sending'), line: t('tower.conn.mail.sent', { when, what: c.last.what }) + earlier };
  }
  const kind: MailFailure = c.last.failed ?? 'failed';
  const account = kind === 'refused' || kind === 'limit';
  const line = [
    t(`tower.conn.mail.failed.${kind}`, { when, what: c.last.what }),
    ...(kind === 'refused' ? [t(`tower.conn.mail.refusedWhy.${refusedWhy(c.last.code)}`)] : []),
    ...(c.last.code ? [t('tower.conn.mail.code', { code: c.last.code })] : []),
    // Of THAT email: kept to be tried again, or lost. Said from what the server did with it, not guessed from the kind.
    t(c.last.again ? 'tower.conn.mail.lastKept' : 'tower.conn.mail.lastLost'),
  ].join(' ');
  return { tone: account ? 'danger' : 'warn', tag: t(MAIL_FAILED_TAG[kind]), line: line + earlier };
}

/**
 * What became of the emails that could not be handed over: how many WAIT to be tried again — with the one thing
 * staff must know about them, that they wait in memory and a restart loses them — and how many were given up on.
 * Nothing when there is nothing to say. Worded as counts, so one and many read the same.
 */
export function mailAgainWords(c: MailConnection, t: Translate): string[] {
  return [
    ...(c.waiting > 0 ? [t('tower.conn.mail.waiting', { n: c.waiting, since: momentWords(c.waitingSince ?? '') })] : []),
    ...(c.sentLater > 0 ? [t('tower.conn.mail.sentLater', { n: c.sentLater })] : []),
    ...(c.gaveUp > 0 ? [t('tower.conn.mail.gaveUp', { n: c.gaveUp })] : []),
  ];
}

/**
 * What is WRONG about hearing of email that comes back — nothing when all is as it should be. Not listening at all,
 * on a server that sends: an address that bounces goes on being written to, which is what a provider judges an
 * account by. Or SIGNED notices arriving and being refused — which means the key here is not the provider's, or the
 * receiver (built from its documentation, and never yet sent a real one) reads them wrongly. Said only while that
 * is the newest thing that happened: once a notice has been taken since, it is history, and is left to the counts.
 *
 * A request with NO signature is not warned of at all. The address is public and something will always find it;
 * a warning that never clears is one nobody reads, and it would sit on top of the one that matters.
 */
export function mailBounceWords(c: MailConnection, t: Translate): string[] {
  if (!c.bounces.listening) return [t('tower.conn.mail.bounces.deaf')];
  if (c.bounces.refused === 0) return [];
  if (c.bounces.lastAt && c.bounces.lastRefusedAt && c.bounces.lastAt > c.bounces.lastRefusedAt) return [];
  return [t('tower.conn.mail.bounces.refused', { n: c.bounces.refused, when: momentWords(c.bounces.lastRefusedAt ?? '') }) + ' ' + t(`tower.conn.mail.bounces.why.${c.bounces.lastRefused ?? 'mismatch'}`)];
}

/** The fact beside "Bounce notices": not listened for; listened for and none yet; or how many were taken and refused. */
export function bounceListenWords(c: MailConnection, t: Translate): string {
  if (!c.bounces.listening) return t('tower.conn.fact.bouncesDeaf');
  if (c.bounces.received === 0 && c.bounces.refused === 0 && c.bounces.unsigned === 0) return t('tower.conn.fact.bouncesNone');
  return t('tower.conn.fact.bouncesSome', { received: c.bounces.received, refused: c.bounces.refused, unsigned: c.bounces.unsigned });
}

/** The fact beside "Waiting to be tried again": none, or how many and since when. */
export function waitingWords(c: MailConnection, t: Translate): string {
  return c.waiting > 0 ? t('tower.conn.fact.waitingSome', { n: c.waiting, since: momentWords(c.waitingSince ?? '') }) : t('tower.conn.fact.waitingNone');
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
 * The text that carries a code. Kept or sent is said first, as the others' is — but what "kept" MEANS differs. On a
 * sandbox the code is handed back to the app that asked, and nothing is missing. Anywhere else the text is the only
 * way a code reaches a phone: nobody signs up, confirms a new phone or replaces a PIN, and each is told so.
 *
 * Where texts do leave, a failure is said by WHOSE IT IS. A refusal is the account's, and red. A number Twilio cannot
 * text is that number's — the person was told to check it — and is not a fault of the connection at all.
 */
export function smsSays(c: SmsConnection, sandbox: boolean, since: string, t: Translate, reviewCode?: { until: string } | null): ConnectionSays {
  if (!c.sends) {
    const why = c.problem ? t(`tower.conn.sms.problem.${c.problem}`) : '';
    // The review code: new accounts get in with 000000 until the day it names — said in amber, with the day, and why it is not live.
    if (!sandbox && reviewCode) return { tone: 'warn', tag: t('tower.conn.tag.reviewCode'), line: [t('tower.conn.sms.reviewLive', { until: reviewCode.until }), why].filter(Boolean).join(' ') };
    if (!sandbox) return { tone: 'danger', tag: t('tower.conn.tag.noCodes'), line: [t('tower.conn.sms.keptLive'), why].filter(Boolean).join(' ') };
    // On a sandbox, kept is how it should be — with a whole account set too, which a sandbox does not use. Half an
    // account is somebody's unfinished set-up, and is said as that.
    return { tone: c.problem && c.problem !== 'sandbox' ? 'warn' : 'info', tag: t('tower.conn.tag.kept'), line: [t('tower.conn.sms.kept', { n: c.written }), why].filter(Boolean).join(' ') };
  }
  // A stand-in is said before anything the last text met: "handed to Twilio" would not be true of any of them.
  const standIn = c.standIn ? `${t('tower.conn.sms.standIn')} ` : '';
  if (!c.last) return { tone: 'info', tag: t('tower.conn.tag.unsent'), line: standIn + t('tower.conn.sms.unsent', { since: momentWords(since) }) };
  const when = momentWords(c.last.at);
  const earlier = c.failed > 0 ? ` ${t('tower.conn.sms.someFailed', { failed: c.failed, n: c.written })}` : '';
  if (c.last.ok) return { tone: c.standIn ? 'info' : 'ok', tag: t('tower.conn.tag.sending'), line: standIn + t(c.standIn ? 'tower.conn.sms.sentStandIn' : 'tower.conn.sms.sent', { when }) + earlier };
  const kind: SmsFailure = c.last.failed ?? 'failed';
  const line = [
    t(`tower.conn.sms.failed.${kind}`, { when }),
    ...(kind === 'refused' ? [t(`tower.conn.sms.refusedWhy.${smsRefusedWhy(c.last.code)}`)] : []),
    ...(c.last.code ? [t('tower.conn.sms.code', { code: c.last.code })] : []),
  ].join(' ');
  return { tone: SMS_FAILED[kind].tone, tag: t(SMS_FAILED[kind].tag), line: standIn + line + earlier };
}

const SMS_FAILED = {
  refused: { tone: 'danger', tag: 'tower.conn.tag.mailRefused' },
  limit: { tone: 'warn', tag: 'tower.conn.tag.smsLimit' },
  // One number that cannot be texted is not the connection failing: the person mistyped, or gave a landline.
  rejected: { tone: 'info', tag: 'tower.conn.tag.smsRejected' },
  unreachable: { tone: 'warn', tag: 'tower.conn.tag.notSending' },
  failed: { tone: 'warn', tag: 'tower.conn.tag.notSending' },
} as const;

/**
 * What a refusal is about, from Twilio's own number for it — only the numbers whose meaning its error dictionary
 * states. One of them is about a single country and leaves every other number going; the wording says which.
 */
export function smsRefusedWhy(code: string | undefined): 'credential' | 'country' | 'sender' | 'trial' | 'unknown' {
  if (code === '20003') return 'credential';
  if (code === '21408') return 'country';
  if (code === '21606') return 'sender';
  if (code === '21608') return 'trial';
  return 'unknown';
}

/** The countries a code is texted to, as the screen says them: the ones that are switched on, or that none is. */
export function smsCountryWords(c: SmsConnection, t: Translate): string {
  return c.countries.length ? c.countries.join(', ') : t('tower.conn.fact.smsCountriesNone');
}

/**
 * What staff are told when a change to a country is approved. Where it switched the country ON — it may take goods
 * in, which it could not — its numbers are texted codes from that moment, and the provider's own list of countries
 * has to be changed by hand: said here, at the one moment somebody is thinking about that country.
 */
export function approvedSays(proposal: { jurisdiction?: string; gains?: string[] } | undefined, t: Translate): string {
  const country = proposal?.jurisdiction ?? '';
  const approved = t('tower.presence.approved', { country });
  return proposal?.gains?.includes('takeIn') ? `${approved} ${t('tower.presence.approvedSms', { country })}` : approved;
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
