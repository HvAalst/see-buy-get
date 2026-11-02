import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { createVerify, generateKeyPairSync } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FCM_SCOPE, GOOGLE_TOKEN_URL, fcmConfig, readFcmAnswer, signedAssertion, wakeMessage } from './fcm';
import { CarTokenGone, CarWakeError, FcmWakeSender, OutboxCarWakeSender, chooseCarWakeSender } from './car-wake';
import { tokenPrint } from './car-keys';

/*
 * THE WAKE-UP THAT REACHES A PHONE (2026-11-02, "Messages in the car"; the owner: "we start with 2").
 *
 * What is tested is the RECEIVING END: a server standing where Google stands checks the signed assertion with the service
 * account's public key, hands out an access token, and says what it was sent; the sender is believed only as far as that
 * server's answer goes. Nothing here reaches Google. The service account is made here, for this run, and is nobody's.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ACCOUNT = { type: 'service_account', project_id: 'sbg-driver-test', private_key_id: 'kid-1', private_key: PEM, client_email: 'wake@sbg-driver-test.iam.gserviceaccount.com', token_uri: GOOGLE_TOKEN_URL };
const TOKEN = `fGx7${'a'.repeat(30)}:APA91b${'Q'.repeat(60)}`;

interface Seen {
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}
type Answer = (res: ServerResponse) => void;
const json =
  (status: number, body: unknown): Answer =>
  (res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
const SENT = json(200, { name: 'projects/sbg-driver-test/messages/0:1' });
const fcmError = (code: number, status: string, errorCode?: string, message = 'refused', more: unknown[] = []) =>
  json(code, { error: { code, message, status, details: [...(errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : []), ...more] } });

/** Read a JWT the way Google does: the signature against the public key, then the claims. */
function checkedClaims(jwt: string): Record<string, unknown> | undefined {
  const [h, c, s] = jwt.split('.');
  const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'));
  return ok ? (JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as Record<string, unknown>) : undefined;
}

describe('the wake-up that reaches a phone', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
  });

  /** Google, stood in for: an access token for a good assertion; each send answered with the next answer, the last for ever after. */
  async function google(...answers: Answer[]): Promise<{ tokens: Seen[]; sends: Seen[]; url: string }> {
    const tokens: Seen[] = [];
    const sends: Seen[] = [];
    let handed = 0;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const seen = { url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
        if (req.url === '/token') {
          tokens.push(seen);
          const form = new URLSearchParams(seen.body);
          const claims = form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' ? checkedClaims(form.get('assertion') ?? '') : undefined;
          if (!claims) return json(400, { error: 'invalid_grant' })(res);
          handed += 1;
          return json(200, { access_token: `ya29.stand-in-${handed}`, expires_in: 3599, token_type: 'Bearer' })(res);
        }
        sends.push(seen);
        answers[Math.min(sends.length - 1, answers.length - 1)](res);
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { tokens, sends, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  const env = (url: string, over: Record<string, string> = {}) => ({ GLOS_FCM_SERVICE_ACCOUNT: JSON.stringify(ACCOUNT), GLOS_FCM_URL: url, ...over });

  it('off and quiet when nothing is set: the outbox keeps what would have gone — a print of the token, and the two fields', async () => {
    const config = fcmConfig({}, false);
    expect(config).toEqual({ projectSet: false, accountSet: false, standIn: false });
    const fcm = new FcmWakeSender(config);
    expect(fcm.ready()).toBe(false);
    const outbox = new OutboxCarWakeSender();
    const sender = chooseCarWakeSender(outbox, fcm);
    expect(sender).toBe(outbox);
    await sender.send(TOKEN, 'cv_1');
    expect(outbox.recent(TOKEN)).toEqual([{ to: tokenPrint(TOKEN), data: { kind: 'chat', conversationId: 'cv_1' }, at: expect.any(String) }]);
    expect(JSON.stringify(outbox.recent())).not.toContain(TOKEN);
  });

  it('says what is missing, and is not used: half a set-up is nothing sent', () => {
    expect(fcmConfig({ GLOS_FCM_PROJECT_ID: 'p' }, false).problem).toBe('no_account');
    expect(fcmConfig({ GLOS_FCM_SERVICE_ACCOUNT: 'not json, not base64 of it, not a file' }, false).problem).toBe('unreadable_account');
    expect(fcmConfig({ GLOS_FCM_SERVICE_ACCOUNT: JSON.stringify({ ...ACCOUNT, private_key: 'nope' }) }, false).problem).toBe('unreadable_account');
    expect(fcmConfig({ GLOS_FCM_SERVICE_ACCOUNT: JSON.stringify({ ...ACCOUNT, project_id: undefined }) }, false).problem).toBe('no_project');
    // A sandbox wakes no phone through Firebase, everything set: its people are made up.
    expect(fcmConfig({ GLOS_FCM_SERVICE_ACCOUNT: JSON.stringify(ACCOUNT) }, true).problem).toBe('sandbox');
    // An address that is not Google's is refused — on a server real people use, even on this machine; anywhere else, always.
    expect(fcmConfig(env('http://127.0.0.1:9'), false).problem).toBe('not_google');
    expect(fcmConfig(env('https://fcm.example.com'), true).problem).toBe('not_google');
    for (const c of [fcmConfig({ GLOS_FCM_PROJECT_ID: 'p' }, false), fcmConfig(env('http://127.0.0.1:9'), false)]) expect(new FcmWakeSender(c).ready()).toBe(false);
  });

  it('reads the service account as one line of JSON, as base64 of it, or from its file — and Google’s address otherwise', () => {
    const asBase64 = fcmConfig({ GLOS_FCM_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(ACCOUNT)).toString('base64') }, false);
    const dir = mkdtempSync(join(tmpdir(), 'fcm-'));
    const file = join(dir, 'service-account.json');
    writeFileSync(file, JSON.stringify(ACCOUNT, null, 2));
    const fromFile = fcmConfig({ GLOS_FCM_SERVICE_ACCOUNT: file, GLOS_FCM_PROJECT_ID: 'sbg-driver-other' }, false);
    for (const c of [asBase64, fromFile]) {
      expect(c.problem).toBeUndefined();
      expect(c.tokenUrl).toBe(GOOGLE_TOKEN_URL);
      expect(new FcmWakeSender(c).ready()).toBe(true);
    }
    expect(asBase64.sendUrl).toBe('https://fcm.googleapis.com/v1/projects/sbg-driver-test/messages:send');
    // The project said in the environment is the one sent to.
    expect(fromFile.sendUrl).toBe('https://fcm.googleapis.com/v1/projects/sbg-driver-other/messages:send');
  });

  it('signs the assertion as Google asks: RS256 by the service account, for the messaging scope, an hour at most', () => {
    const config = fcmConfig({ GLOS_FCM_SERVICE_ACCOUNT: JSON.stringify(ACCOUNT) }, false);
    const now = Date.parse('2026-11-02T10:00:00Z');
    const jwt = signedAssertion(config, now);
    expect(JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8'))).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-1' });
    expect(checkedClaims(jwt)).toEqual({ iss: ACCOUNT.client_email, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: now / 1000, exp: now / 1000 + 3600 });
  });

  it('sends exactly the token, `kind: chat` and the conversation — nothing else — with the access token Google handed out, asked for once', async () => {
    const g = await google(SENT);
    const sender = new FcmWakeSender(fcmConfig(env(g.url), true), 2000);
    expect(sender.ready()).toBe(true);
    await sender.send(TOKEN, 'cv_7');
    await sender.send(TOKEN, 'cv_8');
    expect(g.tokens).toHaveLength(1);
    expect(g.sends).toHaveLength(2);
    expect(g.sends[0].url).toBe('/v1/projects/sbg-driver-test/messages:send');
    expect(g.sends[0].headers.authorization).toBe('Bearer ya29.stand-in-1');
    expect(JSON.parse(g.sends[0].body)).toEqual({ message: { token: TOKEN, data: { kind: 'chat', conversationId: 'cv_7' }, android: { priority: 'HIGH' } } });
    expect(JSON.parse(g.sends[0].body)).toEqual(wakeMessage(TOKEN, 'cv_7'));
  });

  it('a token Firebase says is gone is said to be gone — and nothing else is', async () => {
    const tokenViolation = { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }] };
    for (const answer of [fcmError(404, 'NOT_FOUND', 'UNREGISTERED'), fcmError(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH'), fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token'), fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Bad request', [tokenViolation])]) {
      const g = await google(answer);
      await expect(new FcmWakeSender(fcmConfig(env(g.url), true), 2000).send(TOKEN, 'cv_1')).rejects.toBeInstanceOf(CarTokenGone);
    }
    // A fault of ours, of Google's, or a limit: the token is good, the wake-up just did not go.
    const kinds: Array<[Answer, string]> = [
      [fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Invalid JSON payload received'), 'refused'],
      [fcmError(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'), 'limit'],
      [fcmError(503, 'UNAVAILABLE', 'UNAVAILABLE'), 'failed'],
      [json(200, { not: 'a message name' }), 'failed'],
    ];
    for (const [answer, kind] of kinds) {
      const g = await google(answer);
      const err = await new FcmWakeSender(fcmConfig(env(g.url), true), 2000).send(TOKEN, 'cv_1').catch((e: unknown) => e);
      expect([kind, err instanceof CarWakeError ? err.kind : err]).toEqual([kind, kind]);
    }
  });

  it('an access token Firebase refuses is asked for again, once, and the wake-up tried once more', async () => {
    const g = await google(fcmError(401, 'UNAUTHENTICATED'), SENT);
    await new FcmWakeSender(fcmConfig(env(g.url), true), 2000).send(TOKEN, 'cv_1');
    expect(g.tokens).toHaveLength(2);
    expect(g.sends.map((s) => s.headers.authorization)).toEqual(['Bearer ya29.stand-in-1', 'Bearer ya29.stand-in-2']);
  });

  it('nothing it throws carries the token, the key or the address — and no answer in time is "unreachable"', async () => {
    const quiet = createServer(() => undefined);
    servers.push(quiet);
    await new Promise<void>((r) => quiet.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(quiet.address() as AddressInfo).port}`;
    const err = (await new FcmWakeSender(fcmConfig(env(url), true), 200).send(TOKEN, 'cv_1').catch((e: unknown) => e)) as CarWakeError;
    expect(err.kind).toBe('unreachable');
    expect(`${err.message} ${err.stack}`).not.toContain(TOKEN);
    expect(`${err.message}`).not.toContain('127.0.0.1');
  });

  it('reads Firebase’s answers as its documentation says them', () => {
    expect(readFcmAnswer(200, JSON.stringify({ name: 'projects/p/messages/1' }))).toEqual({ ok: true });
    expect(readFcmAnswer(200, '<html>ok</html>')).toEqual({ ok: false, kind: 'failed' });
    expect(readFcmAnswer(404, JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }))).toEqual({ ok: false, kind: 'gone' });
    expect(readFcmAnswer(404, JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } }))).toEqual({ ok: false, kind: 'refused' });
    expect(readFcmAnswer(401, '{}')).toEqual({ ok: false, kind: 'auth' });
    expect(readFcmAnswer(500, 'oops')).toEqual({ ok: false, kind: 'failed' });
  });
});
