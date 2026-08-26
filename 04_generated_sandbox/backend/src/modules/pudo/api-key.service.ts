import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { ApiKey, ApiKeyKind, ApiKeyMode, ApiKeyView } from './pudo.types';

/**
 * Merchant API keys — who is asking, on a surface where anybody may ask.
 *
 * The public quote works without one and will keep working: a merchant should be able to paste a button
 * into a page and see a price before they have an account, because a product that demands a signup before
 * it demonstrates anything does not get integrated. A key is what you get when you outgrow that — a limit
 * that belongs to you rather than to whoever shares your IP, and the costed breakdown behind the number.
 *
 * TWO KINDS, and the difference is not a permission level, it is where they are allowed to be:
 *
 *  - **Publishable** (`pk_`) goes in a page, in plain sight, in the widget's own markup. It can ask what
 *    something costs and nothing else. It is stored IN FULL, because it is public by construction and a
 *    merchant needs to read it back when they rebuild a template. Pretending otherwise would be theatre.
 *  - **Secret** (`sk_`) never leaves a server. It unlocks the participant breakdown — every stop's own
 *    published fee and the company owed it — which is open data we intend to publish but not to hand to a
 *    competitor as a costed route on an anonymous call. It is shown ONCE and stored as a HASH, so a
 *    breach of this table cannot be replayed as the merchant.
 *
 * The hash is a plain SHA-256 and that is deliberate, not a shortcut: a key is 32 bytes of system-chosen
 * randomness, not a human-chosen password, so there is no dictionary to slow an attacker down with — the
 * work factor a password needs would buy nothing here and cost every request.
 *
 * TWO MODES, `test` and `live`, carried in the key itself so a glance at a config file tells you which
 * world it points at. Today a test key quotes exactly as a live one does — a quote creates nothing, so
 * there is nothing for a sandbox to spare — and the response says which mode answered. The mode earns its
 * place now rather than later because the credentials have to be separate BEFORE minting exists: the point
 * is that the key you develop with is never the key that can ship things.
 */

const PREFIXES: Record<ApiKeyKind, string> = { publishable: 'pk', secret: 'sk' };
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** What a caller turned out to be. `anonymous` is a first-class answer, not a failure. */
export interface Caller {
  kind: ApiKeyKind | 'anonymous';
  mode: ApiKeyMode;
  vendorId?: string;
  keyId?: string;
  /** What to count a rate limit against: the merchant when we know them, the network when we do not. */
  rateKey?: string;
}

export const ANONYMOUS: Caller = { kind: 'anonymous', mode: 'live' };

@Injectable()
export class ApiKeyService {
  // Durable: a key a merchant has pasted into their storefront must survive a restart, or every
  // integration in the field breaks on a deploy.
  private readonly keys = new PersistentMap<string, ApiKey>('pudo-api-keys');

  /**
   * Mint a key for a store. The SECRET is returned here and nowhere else, ever again.
   *
   * Returning it once is the whole contract: it means a stolen database is a list of hashes rather than a
   * set of working credentials, and it means "I lost my key" has exactly one honest answer — make another
   * and revoke the old one.
   */
  issue(vendorId: string, kind: ApiKeyKind, mode: ApiKeyMode, label?: string): { key: ApiKey; secret: string } {
    const value = `${PREFIXES[kind]}_${mode}_${randomBytes(kind === 'secret' ? 24 : 16).toString('hex')}`;
    const key: ApiKey = {
      keyId: `key_${randomBytes(6).toString('hex')}`,
      vendorId,
      kind,
      mode,
      label: label?.trim() || undefined,
      // A publishable key is public by construction, so it is kept whole and can be read back. A secret
      // one is kept only as a hash, and `hint` is the last four characters — enough to tell two keys apart
      // in a list, useless to anybody who finds it.
      value: kind === 'publishable' ? value : undefined,
      hash: kind === 'secret' ? sha256(value) : undefined,
      hint: value.slice(-4),
      createdAt: new Date().toISOString(),
    };
    this.keys.set(key.keyId, key);
    return { key, secret: value };
  }

  /** Every key this store holds, in a shape safe to render: no secret, ever, not even to its owner. */
  list(vendorId: string): ApiKeyView[] {
    return [...this.keys.values()]
      .filter((k) => k.vendorId === vendorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((k) => ApiKeyService.view(k));
  }

  /** Stop a key working. Kept rather than deleted, so "what was that key doing" stays answerable. */
  revoke(vendorId: string, keyId: string): ApiKeyView {
    const key = this.keys.get(keyId);
    if (!key || key.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `No such key: ${keyId}`);
    if (!key.revokedAt) {
      key.revokedAt = new Date().toISOString();
      this.keys.set(keyId, key);
    }
    return ApiKeyService.view(key);
  }

  /**
   * Who is calling? A missing key is ANONYMOUS, not an error — the quote surface is public and stays so.
   * A key that is present and wrong IS an error: silently degrading a bad key to anonymous would let a
   * typo look like a working integration right up until the day the limits mattered.
   */
  resolve(presented?: string | null): Caller {
    const raw = presented?.trim();
    if (!raw) return ANONYMOUS;
    const key = this.find(raw);
    if (!key) throw new GlosError('AUTH_CODE_INVALID', 'That API key is not one of ours, or it has been revoked');
    if (key.revokedAt) throw new GlosError('AUTH_CODE_INVALID', 'That API key has been revoked — issue a new one');
    // Cheap and useful: the one signal that tells a merchant which of their keys is the stale one, and an
    // operator that a key they thought was dormant is being used.
    key.lastUsedAt = new Date().toISOString();
    this.keys.set(key.keyId, key);
    return { kind: key.kind, mode: key.mode, vendorId: key.vendorId, keyId: key.keyId, rateKey: key.keyId };
  }

  /** May this caller see every stop's own fee and the company owed it? Only a server-side key. */
  static seesBreakdown(caller: Caller): boolean {
    return caller.kind === 'secret';
  }

  private find(presented: string): ApiKey | undefined {
    if (presented.startsWith(`${PREFIXES.publishable}_`)) {
      // Public by construction: nothing is protected by comparing it slowly.
      return [...this.keys.values()].find((k) => k.kind === 'publishable' && k.value === presented);
    }
    const digest = sha256(presented);
    return [...this.keys.values()].find((k) => {
      if (k.kind !== 'secret' || !k.hash) return false;
      const a = Buffer.from(k.hash, 'hex');
      const b = Buffer.from(digest, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    });
  }

  private static view(k: ApiKey): ApiKeyView {
    return {
      keyId: k.keyId,
      kind: k.kind,
      mode: k.mode,
      label: k.label,
      hint: k.hint,
      // A publishable key reads back in full — a merchant rebuilding a template needs it, and it was
      // never a secret. A secret one shows four characters and no more.
      value: k.kind === 'publishable' ? k.value : undefined,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    };
  }
}
