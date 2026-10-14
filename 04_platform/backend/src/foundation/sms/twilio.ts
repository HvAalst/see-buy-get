import { isSandbox } from '../runtime/sandbox';
import { OutgoingSms, SmsCredential, SmsFailure, SmsProblem, SmsSenderKind } from './sms.types';

/**
 * TWILIO, AS A SET OF PLAIN FUNCTIONS: what the server was given, what one text looks like on the wire, and what an
 * answer means. `TwilioSmsSender` does the sending; this file knows no socket.
 *
 * Read from Twilio's Message resource documentation on 2026-10-11:
 *   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 *   HTTP Basic auth: the Account SID and its Auth Token — or an API Key SID and its secret, which Twilio recommends
 *   Content-Type application/x-www-form-urlencoded; `To` (E.164), `Body`, and `From` OR `MessagingServiceSid`
 *   201 Created with a JSON message that carries a `sid`, its `status` "queued" (or "accepted" with a Messaging Service)
 *   an error is JSON { code, message, more_info, status }
 *
 * WHAT 201 MEANS, AND DOES NOT: Twilio has TAKEN the message. Whether it reached the phone is known only later, by a
 * status callback this server does not listen for. So "sent" here means handed to Twilio, and is said that way.
 *
 * NEVER SENT THROUGH THE REAL PROVIDER FROM HERE: it is tested against a server standing where Twilio stands.
 */
type Env = Record<string, string | undefined>;

export const TWILIO_API = 'https://api.twilio.com';

export interface TwilioConfig {
  accountSet: boolean;
  credential?: SmsCredential;
  sender?: SmsSenderKind;
  /** Something of Twilio's is set, and it is not used: why. */
  problem?: SmsProblem;
  /** The address is a stand-in on this machine (a sandbox being driven), not Twilio's. */
  standIn: boolean;
  // There ONLY when it can be used: an account, a credential, a sender, and an address a credential may go to.
  endpoint?: string;
  authorization?: string;
  from?: { field: 'From' | 'MessagingServiceSid'; value: string };
}

const set = (v: string | undefined) => (v ?? '').trim();

/**
 * WHAT THE SERVER WAS GIVEN TO TEXT WITH, and whether it can be used.
 *
 * The credential is the API key and its secret where both are set, the account's own auth token otherwise. The
 * sender is a Messaging Service where one is named, a number or sender name otherwise.
 *
 * THE ADDRESS IS TWILIO'S, and is not a setting. `TWILIO_URL` exists for one thing: a stand-in on this machine, on a
 * sandbox — which is how the sender is tested and driven without an account. Anything else in it is refused, and
 * nothing is sent: a credential is for one address.
 *
 * A SANDBOX DOES NOT TEXT THROUGH TWILIO, with everything set. Its people are made up — the seeds ask for a code
 * for every one of them — and a made-up number may be somebody's.
 */
export function twilioConfig(env: Env = process.env, sandbox: boolean = isSandbox()): TwilioConfig {
  const account = set(env.TWILIO_ACCOUNT_SID);
  const token = set(env.TWILIO_AUTH_TOKEN);
  const keySid = set(env.TWILIO_API_KEY_SID);
  const keySecret = set(env.TWILIO_API_KEY_SECRET);
  const service = set(env.TWILIO_MESSAGING_SERVICE_SID);
  const number = set(env.TWILIO_FROM);
  const address = set(env.TWILIO_URL);
  const anySet = Boolean(account || token || keySid || keySecret || service || number || address);

  const credential: SmsCredential | undefined = keySid && keySecret ? 'api_key' : token ? 'auth_token' : undefined;
  const sender: SmsSenderKind | undefined = service ? 'service' : number ? 'from' : undefined;
  const standInAt = address ? standIn(address, sandbox) : undefined;
  const said = { accountSet: Boolean(account), ...(credential ? { credential } : {}), ...(sender ? { sender } : {}), standIn: Boolean(standInAt) };
  if (!anySet) return said;

  const problem: SmsProblem | undefined =
    address && !standInAt ? 'not_twilio' : !account ? 'no_account' : !credential ? 'no_credential' : !sender ? 'no_sender' : sandbox && !standInAt ? 'sandbox' : undefined;
  if (problem) return { ...said, problem };

  const basic = credential === 'api_key' ? `${keySid}:${keySecret}` : `${account}:${token}`;
  return {
    ...said,
    endpoint: `${standInAt ?? TWILIO_API}/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`,
    authorization: `Basic ${Buffer.from(basic).toString('base64')}`,
    from: service ? { field: 'MessagingServiceSid', value: service } : { field: 'From', value: number },
  };
}

/** The origin of a stand-in this server may talk to: plain http, on this machine, and only on a sandbox. */
function standIn(address: string, sandbox: boolean): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  const onThisMachine = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return sandbox && onThisMachine && url.protocol === 'http:' ? url.origin : undefined;
}

/** The form Twilio is sent: who to, who from, and what. */
export function toTwilioForm(config: TwilioConfig, sms: OutgoingSms): string {
  const form = new URLSearchParams();
  form.set('To', sms.to);
  if (config.from) form.set(config.from.field, config.from.value);
  form.set('Body', sms.body);
  return form.toString();
}

export type TwilioAnswer = { ok: true } | { ok: false; kind: SmsFailure; code?: string };

/**
 * Twilio's own error numbers that say THE NUMBER cannot be texted — the person's to put right, not ours. Only the
 * ones whose wording in its error dictionary (read 2026-10-11) names the number texted:
 *   21211 Invalid 'To' Phone Number · 21214 'To' phone number cannot be reached · 21217 Phone number does not appear
 *   to be valid · 21610 Attempt to send to unsubscribed recipient · 21614 'To' number is not a valid mobile number
 * Anything else on a 400 is how WE are set up, and is said so with its number: 21408 (the destination's region is
 * not allowed in the account's Geo Permissions), 21606 (the From number cannot send messages), 21608 (a trial
 * account, and a number that was not verified with it).
 */
const BAD_NUMBER = new Set(['21211', '21214', '21217', '21610', '21614']);
const CODE = /^\d{3,6}$/;

/**
 * WHAT AN ANSWER MEANS. A text was taken only on a success that is Twilio's own answer — JSON that carries the
 * message's id and does not say it failed. A page from a proxy that says 200 is not Twilio taking a text. Otherwise
 * it is said by whose it is to put right. Only a number is kept: Twilio's words name the phone.
 */
export function readTwilioAnswer(status: number, body: string): TwilioAnswer {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const answer = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : undefined;
  const raw = answer?.code ?? answer?.error_code;
  const code = typeof raw === 'number' || typeof raw === 'string' ? (CODE.test(String(raw)) ? String(raw) : undefined) : undefined;
  const failed = (kind: SmsFailure): TwilioAnswer => ({ ok: false, kind, ...(code ? { code } : {}) });

  if (status >= 200 && status < 300) {
    const taken = typeof answer?.sid === 'string' && answer.sid.length > 0 && answer.status !== 'failed' && answer.status !== 'undelivered' && !code;
    return taken ? { ok: true } : failed('failed');
  }
  if (code && BAD_NUMBER.has(code)) return failed('rejected');
  if (status === 429 || code === '20429') return failed('limit');
  // The credential (401), the account or what it may do (403), an account that is not there (404), and every 400
  // that is not about the number: the sender, the service, a country it was not allowed to text.
  if (status === 400 || status === 401 || status === 403 || status === 404) return failed('refused');
  return failed('failed');
}
