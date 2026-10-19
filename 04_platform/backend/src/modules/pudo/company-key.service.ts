import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import type { CompanyCaller, CompanyKey, CompanyKeyView, CompanyKind } from './company-key.types';
import type { ApiKeyMode } from './pudo.types';

/** The header a company's key travels in — the one a store's does. Never a query parameter: those end up in access logs. */
export const COMPANY_KEY_HEADER = 'x-sbg-key';
/** Whose key it is, at a glance in a config file: a business's or a fleet's. */
const PREFIX: Record<CompanyKind, string> = { business: 'bk', fleet: 'fk' };
/** Keys a company may hold at once, not counting those taken away. */
const MAX_KEYS = 20;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * A COMPANY'S KEYS FOR ITS OWN SYSTEMS (round 12). The same promises a store's secret key makes (ApiKeyService): shown
 * once and kept as a hash, test or live in the key itself, taken away and kept rather than deleted, the last time each
 * was used. Whose it is — which business or fleet — is in the key's record, never in what the caller says.
 */
@Injectable()
export class CompanyKeyService {
  // Durable: a key a company has put in its own system must survive a restart, or every integration breaks on a deploy.
  private readonly keys = new PersistentMap<string, CompanyKey>('company-api-keys');

  /** A new key, returned whole in this answer and never again. */
  issue(owner: { kind: CompanyKind; id: string }, mode: ApiKeyMode, label: string | undefined, by: string, now: number = Date.now()): { key: CompanyKeyView; secret: string } {
    if (mode !== 'test' && mode !== 'live') throw new GlosError('INVALID_INPUT', 'A key is a test key or a live key', { field: 'mode' });
    if (this.mine(owner).filter((k) => !k.revokedAt).length >= MAX_KEYS) throw new GlosError('CONFLICT', `A company holds ${MAX_KEYS} keys at most — take one away first`);
    const secret = `${PREFIX[owner.kind]}_${mode}_${randomBytes(24).toString('hex')}`;
    const key: CompanyKey = {
      keyId: `ck_${randomBytes(6).toString('hex')}`,
      owner: { kind: owner.kind, id: owner.id },
      mode,
      ...(label?.trim() ? { label: label.trim().slice(0, 60) } : {}),
      hash: sha256(secret),
      hint: secret.slice(-4),
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.keys.set(key.keyId, key);
    return { key: view(key), secret };
  }

  /** Every key the company holds or held, newest first. */
  list(owner: { kind: CompanyKind; id: string }): CompanyKeyView[] {
    return this.mine(owner)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(view);
  }

  /** Stop a key working, now. Kept, so "what was that key doing" stays answerable. */
  revoke(owner: { kind: CompanyKind; id: string }, keyId: string, by: string, now: number = Date.now()): CompanyKeyView {
    const key = this.keys.get(keyId);
    if (!key || key.owner.kind !== owner.kind || key.owner.id !== owner.id) throw new GlosError('NOT_FOUND', 'No such key');
    if (!key.revokedAt) this.keys.set(keyId, { ...key, revokedAt: new Date(now).toISOString(), revokedBy: by });
    return view(this.keys.get(keyId)!);
  }

  /**
   * Who is calling. Unlike a store's quote surface, nothing here is public: no key is a refusal, and so is a key that is
   * not one of ours or has been taken away.
   */
  resolve(presented: string | undefined, now: number = Date.now()): CompanyCaller {
    const raw = presented?.trim();
    if (!raw) throw new GlosError('UNAUTHORIZED', `Give your company's key in the ${COMPANY_KEY_HEADER} header`);
    const digest = Buffer.from(sha256(raw), 'hex');
    const key = [...this.keys.values()].find((k) => {
      const kept = Buffer.from(k.hash, 'hex');
      return kept.length === digest.length && timingSafeEqual(kept, digest);
    });
    if (!key) throw new GlosError('UNAUTHORIZED', 'That key is not one of ours');
    if (key.revokedAt) throw new GlosError('UNAUTHORIZED', 'That key has been taken away — make a new one in the app');
    this.keys.set(key.keyId, { ...key, lastUsedAt: new Date(now).toISOString() });
    return { kind: key.owner.kind, id: key.owner.id, mode: key.mode, keyId: key.keyId, name: `${key.label ?? 'A key'} (…${key.hint})` };
  }

  /** For network staff, and for the company's own counts: keys that work, by mode. */
  counts(owner: { kind: CompanyKind; id: string }): { live: number; test: number } {
    const working = this.mine(owner).filter((k) => !k.revokedAt);
    return { live: working.filter((k) => k.mode === 'live').length, test: working.filter((k) => k.mode === 'test').length };
  }

  /** Every company that holds a working live key: who is told before a version of the API stops. */
  holders(): Array<{ kind: CompanyKind; id: string }> {
    const seen = new Map<string, { kind: CompanyKind; id: string }>();
    for (const k of this.keys.values()) if (!k.revokedAt && k.mode === 'live') seen.set(`${k.owner.kind}:${k.owner.id}`, k.owner);
    return [...seen.values()];
  }

  private mine(owner: { kind: CompanyKind; id: string }): CompanyKey[] {
    return [...this.keys.values()].filter((k) => k.owner.kind === owner.kind && k.owner.id === owner.id);
  }
}

function view(k: CompanyKey): CompanyKeyView {
  return {
    keyId: k.keyId,
    mode: k.mode,
    ...(k.label ? { label: k.label } : {}),
    hint: k.hint,
    createdAt: k.createdAt,
    createdBy: k.createdBy,
    ...(k.lastUsedAt ? { lastUsedAt: k.lastUsedAt } : {}),
    ...(k.revokedAt ? { revokedAt: k.revokedAt } : {}),
    ...(k.revokedBy ? { revokedBy: k.revokedBy } : {}),
  };
}
