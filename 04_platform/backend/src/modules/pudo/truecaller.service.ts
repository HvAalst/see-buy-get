import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { CodeRouteService } from '../../foundation/sms/code-route.service';
import type { TruecallerStart, TruecallerState, TruecallerStatus } from '../../foundation/sms/code-routes.types';
import { readTruecallerCallback, truecallerEndpoint, truecallerLink, truecallerNumbers } from '../../foundation/sms/truecaller';
import { TruecallerRoute } from '../../foundation/sms/truecaller.route';
import { OtpService } from './otp.service';

/** How long a confirmation may take, from the tap to Truecaller's answer. */
export const TRUECALLER_TTL_MS = 10 * 60_000;
/** One try per number at a time: a second tap within this long is the first one still going. */
const AGAIN_AFTER_MS = 15_000;
const FETCH_TIMEOUT_MS = 10_000;
/** The languages Truecaller's sheet speaks, of those it lists; any other app language opens it in English. */
const TRUECALLER_LANGS = new Set(['en', 'hi', 'mr', 'te', 'ml', 'ur', 'pa', 'ta', 'bn', 'kn', 'sw', 'ar']);

interface Session {
  phone: string;
  at: number;
  state: TruecallerState;
}

/**
 * 2026-11-17 — A NUMBER CONFIRMED BY TRUECALLER (the owner, of the BRICS nations' own apps: "as recommended … build it").
 *
 * The person typed their number and chose Truecaller (Android, where it is offered). `start` makes a secret request number and
 * the link their phone opens; Truecaller asks them, then tells our callback — opened, declined, or approved with a token. On
 * approval the profile is fetched from Truecaller's own address, and ONLY its phone numbers are read: the number they typed
 * must be among them. Then the number counts as confirmed, exactly as a code typed would (`OtpService.vouch`), and the page
 * that asks (`status`) carries on. Nothing of the profile is kept. Any other answer — declined, another number, nothing in
 * ten minutes — and the page sends a code instead.
 */
@Injectable()
export class TruecallerService {
  private readonly logger = new Logger(TruecallerService.name);
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly otp: OtpService,
    private readonly routes: CodeRouteService,
    private readonly truecaller: TruecallerRoute,
  ) {}

  private prune(now: number): void {
    for (const [nonce, s] of this.sessions) if (now - s.at > TRUECALLER_TTL_MS) this.sessions.delete(nonce);
  }

  /** The secret request number and the link, for a number Truecaller is offered for. */
  start(typed: string, lang: string, now: number = Date.now()): TruecallerStart {
    const phone = this.otp.phoneFor(typed);
    if (!this.routes.offers(phone, 'truecaller')) throw new GlosError('INVALID_STATE', 'Truecaller is not offered for numbers in that country: a code is sent instead');
    this.prune(now);
    const going = [...this.sessions.values()].find((s) => s.phone === phone && now - s.at < AGAIN_AFTER_MS && s.state !== 'confirmed');
    if (going) throw new GlosError('RATE_LIMITED', 'Truecaller was opened a moment ago: finish there, or wait a few seconds');
    const nonce = randomBytes(18).toString('base64url');
    this.sessions.set(nonce, { phone, at: now, state: 'waiting' });
    let site = '';
    try {
      site = process.env.SBG_PUBLIC_URL ? new URL(process.env.SBG_PUBLIC_URL).origin : '';
    } catch {
      site = '';
    }
    return { nonce, link: truecallerLink(this.truecaller.config, nonce, TRUECALLER_LANGS.has(lang) ? lang : 'en', site) };
  }

  /** What Truecaller tells the callback. Counts only for a request number this server made in the last ten minutes. */
  async callback(body: unknown, now: number = Date.now()): Promise<void> {
    const cb = readTruecallerCallback(body);
    if (!cb) return;
    const s = this.sessions.get(cb.requestId);
    if (!s || now - s.at > TRUECALLER_TTL_MS || s.state === 'confirmed') return;
    if (cb.kind === 'invoked') {
      if (s.state === 'waiting') s.state = 'opened';
      return;
    }
    if (cb.kind === 'rejected') {
      s.state = 'rejected';
      this.routes.noteConfirm(s.phone, 'truecaller', false, now);
      return;
    }
    const endpoint = truecallerEndpoint(cb.endpoint);
    if (!endpoint) {
      // Not Truecaller's own address: a forged callback, or a changed one — either way, nothing is confirmed by it.
      s.state = 'failed';
      this.logger.warn('a Truecaller callback named a profile address that is not Truecaller’s: refused');
      return;
    }
    const numbers = await this.profileNumbers(endpoint, cb.accessToken);
    if (numbers === null) {
      s.state = 'failed';
      return;
    }
    if (numbers.includes(s.phone)) {
      s.state = 'confirmed';
      this.otp.vouch(s.phone);
      this.routes.noteConfirm(s.phone, 'truecaller', true, now);
    } else {
      s.state = 'other_number';
      this.routes.noteConfirm(s.phone, 'truecaller', false, now);
    }
  }

  /** Where a confirmation is, for the page that asks about it. Unknown or old: expired. */
  status(nonce: string, now: number = Date.now()): TruecallerStatus {
    const s = this.sessions.get(nonce);
    if (!s) return { state: 'expired' };
    if (s.state !== 'confirmed' && now - s.at > TRUECALLER_TTL_MS) return { state: 'expired' };
    return { state: s.state };
  }

  /** The profile's phone numbers — and nothing else of it — or null when it could not be read. */
  private async profileNumbers(endpoint: string, token: string): Promise<string[] | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, { headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-cache', accept: 'application/json' }, redirect: 'manual', signal: abort.signal });
      if (res.status !== 200) return null;
      return truecallerNumbers(await res.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
