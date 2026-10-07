import { isSandbox } from '../runtime/sandbox';
import { MailAddress, MailFailure, MailProblem, OutgoingMail } from './mail.types';

/**
 * The body of ZeptoMail's send-email call (`POST /v1.1/email`), built from one of our emails.
 *
 * Kept as a pure function so the request can be checked without sending one. We send our own rendered HTML and text
 * rather than ZeptoMail-hosted templates: the words live in this repository, beside the code that decides when they
 * go, and are reviewed and tested with it.
 */
export interface ZeptoMailRequest {
  from: { address: string; name?: string };
  to: Array<{ email_address: { address: string; name?: string } }>;
  reply_to?: Array<{ address: string; name?: string }>;
  subject: string;
  htmlbody: string;
  textbody: string;
  client_reference: string;
  track_clicks: boolean;
  track_opens: boolean;
}

/** The address this server starts with. It is on a domain nobody owns: no provider will send for it. */
export const PLACEHOLDER_FROM = 'noreply@seebuyget.example';

/** The sender address. Must be verified on the ZeptoMail domain before production can send. */
export function mailFrom(): MailAddress {
  return {
    address: process.env.MAIL_FROM_ADDRESS?.trim() || PLACEHOLDER_FROM,
    name: process.env.MAIL_FROM_NAME?.trim() || 'SeeBuyGet',
  };
}

export function toZeptoMailRequest(mail: OutgoingMail, from: MailAddress = mailFrom(), replyTo?: MailAddress): ZeptoMailRequest {
  return {
    from: { address: from.address, ...(from.name ? { name: from.name } : {}) },
    to: [{ email_address: { address: mail.to.address, ...(mail.to.name ? { name: mail.to.name } : {}) } }],
    ...(replyTo ? { reply_to: [{ address: replyTo.address, ...(replyTo.name ? { name: replyTo.name } : {}) }] } : {}),
    subject: mail.subject,
    htmlbody: mail.html,
    textbody: mail.text,
    client_reference: mail.reference,
    track_clicks: mail.tracking,
    track_opens: mail.tracking,
  };
}

/** The path of the send-email call, added where the address that is set names only a host. */
export const ZEPTOMAIL_SEND_PATH = '/v1.1/email';
const TOKEN_PREFIX = 'Zoho-enczapikey';

/**
 * WHAT THE SERVER WAS GIVEN TO SEND WITH, and whether it can be used.
 *
 * `endpoint` and `authorization` are there only when it can. THE ADDRESS HAS NO DEFAULT, deliberately: the provider's
 * host differs by data centre, its documentation named two different hosts when this was written (the product was
 * being renamed), and a token posted to another region's host comes back as "invalid key" — which would send the
 * operator to a token that was right. So the address is copied from the account's own API page, like the token.
 *
 * It must be https, because the token goes in a header. The one exception is a stand-in on this machine, on a
 * sandbox — which is how the sender is tested and driven without an account.
 */
export interface ZeptoMailConfig {
  tokenSet: boolean;
  /** The host of the address that is set, usable or not. Never the address: an address can carry a key. */
  host?: string;
  problem?: MailProblem;
  endpoint?: string;
  authorization?: string;
}

export function zeptoMailConfig(env: NodeJS.ProcessEnv = process.env, sandbox: boolean = isSandbox()): ZeptoMailConfig {
  const token = env.ZEPTOMAIL_TOKEN?.trim();
  const raw = env.ZEPTOMAIL_URL?.trim();
  let url: URL | undefined;
  try {
    url = raw ? new URL(raw) : undefined;
  } catch {
    url = undefined;
  }
  const web = url && (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? url : undefined;
  const host = web?.host;
  if (!token) return { tokenSet: false, ...(host ? { host } : {}) };
  if (!raw) return { tokenSet: true, problem: 'no_address' };
  if (!web) return { tokenSet: true, problem: 'not_an_address' };
  const onThisMachine = ['localhost', '127.0.0.1', '[::1]'].includes(web.hostname);
  if (web.protocol === 'http:' && !(sandbox && onThisMachine)) return { tokenSet: true, host, problem: 'not_https' };
  const path = web.pathname.replace(/\/+$/, '');
  return {
    tokenSet: true,
    host,
    // Whatever else the address carried — a user, a query — is not sent anywhere.
    endpoint: `${web.origin}${path || ZEPTOMAIL_SEND_PATH}`,
    // The account shows the token with its scheme in front; people paste it both ways.
    authorization: token.toLowerCase().startsWith(`${TOKEN_PREFIX.toLowerCase()} `) ? token : `${TOKEN_PREFIX} ${token}`,
  };
}

/** What the provider's answer came to. `again` — nothing says it was taken, and asking once more can do no harm. */
export type ZeptoMailAnswer = { ok: true } | { ok: false; kind: MailFailure; code?: string; again: boolean };

/** The provider will not send for this account as it stands: the token, the sender's domain, the account itself. */
const REFUSED = new Set(['SERR_157', 'TM_4001', 'SM_111', 'SM_128', 'AE_101']);
/** Its credit or its sending limit is used up. */
const LIMIT = new Set(['LE_101', 'LE_102', 'SM_133', 'SMI_115']);
const CODE = /^[A-Z]{2,6}_\d{2,6}$/;

/**
 * READ THE PROVIDER'S ANSWER — without leaning on one exact shape of it.
 *
 * Its documentation has shown two: an error under `error` with `details`, and an error under `data.error_code`; a
 * success as 201 and as 200. So: an email was taken only if the status is a success AND the body is its JSON AND
 * that JSON carries no error. A page that answers 200 with something else — a wrong address, a proxy's sign-in page
 * — is a failure, not a sent email. What kind of failure is read from its codes where they are known, and from the
 * status where they are not. Only a code is kept: the provider's words can name the address an email was for.
 */
export function readZeptoMailAnswer(status: number, body: string): ZeptoMailAnswer {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const answer = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : undefined;
  const error = answer?.error && typeof answer.error === 'object' ? (answer.error as Record<string, unknown>) : undefined;
  const data = answer?.data && typeof answer.data === 'object' && !Array.isArray(answer.data) ? (answer.data as Record<string, unknown>) : undefined;
  const details = Array.isArray(error?.details) ? (error.details as Array<Record<string, unknown>>) : [];
  // The most particular code first: the detail says which rule, the code above it only which family.
  const codes = [...details.map((d) => d?.code), error?.code, data?.error_code].filter((c): c is string => typeof c === 'string' && CODE.test(c));
  const saysError = Boolean(error) || Boolean(data?.error_code) || answer?.message === 'error';
  const success = status >= 200 && status < 300;
  if (success && answer && !saysError) return { ok: true };
  const code = codes[0];
  const failed = (kind: MailFailure, again = false): ZeptoMailAnswer => ({ ok: false, kind, ...(code ? { code } : {}), again });
  if (codes.some((c) => REFUSED.has(c))) return failed('refused');
  if (codes.some((c) => LIMIT.has(c))) return failed('limit');
  if (status === 401 || status === 403) return failed('refused');
  if (status === 429) return failed('limit');
  // A gateway saying the service is not there has not taken the email: once more is safe. A plain 500 may have.
  if (status >= 500) return failed('failed', status === 502 || status === 503 || status === 504);
  if (status >= 400 || (success && saysError)) return failed('rejected');
  return failed('failed');
}
