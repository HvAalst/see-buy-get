import { resolveBaseUrl } from '../../lib/sbg/config';
import type { Result, SbgClient } from '../../lib/sbg';

/**
 * THE TERMS OF USE, WHAT HAPPENS TO PEOPLE'S DATA, AND COOKIES — as the server holds them, written by staff in the
 * console (the user, 2026-10-25). Read by anybody; agreed to at every sign-up; asked again after signing in when a
 * version published since asks everybody to agree again. The backend half is foundation/documents.
 */
export type DocumentKind = 'terms' | 'privacy' | 'cookies';
export const DOCUMENT_KINDS: readonly DocumentKind[] = ['terms', 'privacy', 'cookies'];

/** A published version, as anybody reads it. */
export interface PublishedDocument {
  kind: DocumentKind;
  number: number;
  title: string;
  body: string;
  publishedAt: string;
  changeNote: string;
  askAgain: boolean;
  path: string;
}

/** One line of a document's public history. */
export interface PublishedVersionLine {
  number: number;
  title: string;
  publishedAt: string;
  changeNote: string;
  askAgain: boolean;
}

/** One document of what a sign-up agrees to: the version to read now, and the oldest that still counts. */
export interface AgreementDocument {
  kind: DocumentKind;
  title: string;
  number: number;
  publishedAt: string;
  since: number;
  path: string;
}

/** The versions somebody agrees to, by document — what a sign-up sends as `agreement`. */
export type AgreementNumbers = Record<DocumentKind, number>;

export interface MyAgreement {
  needed: boolean;
  documents: AgreementDocument[];
  agreedAt?: string;
  agreed?: Partial<AgreementNumbers>;
}

/** The numbers to send for the versions on screen. */
export function numbersOf(set: readonly AgreementDocument[]): AgreementNumbers {
  const out = { terms: 0, privacy: 0, cookies: 0 } as AgreementNumbers;
  for (const doc of set) out[doc.kind] = doc.number;
  return out;
}

/** The documents with a version since what this person agreed to — what the app marks as new when it asks again. */
export function changedSince(set: readonly AgreementDocument[], agreed: Partial<AgreementNumbers> | undefined): DocumentKind[] {
  if (!agreed) return [];
  return set.filter((d) => (agreed[d.kind] ?? 0) < d.number).map((d) => d.kind);
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${resolveBaseUrl()}${path}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

let setOnce: Promise<AgreementDocument[] | null> | null = null;

/**
 * What a sign-up agrees to now. Asked once a page; a failure is not kept (no signal now is not no terms), so the next
 * screen that asks tries again.
 */
export function fetchAgreementSet(fresh = false): Promise<AgreementDocument[] | null> {
  if (fresh) setOnce = null;
  const asked = (setOnce ??= getJson<{ documents?: AgreementDocument[] }>('/v1/sbg/agreement').then((d) => (Array.isArray(d?.documents) ? d!.documents : null)));
  void asked.then((s) => {
    if (!s && setOnce === asked) setOnce = null;
  });
  return asked;
}

/** A document as it reads now, or one earlier version of it, word for word. */
export function fetchDocument(kind: DocumentKind, number?: number): Promise<PublishedDocument | null> {
  return getJson<PublishedDocument>(number ? `/v1/sbg/documents/${kind}/versions/${number}` : `/v1/sbg/documents/${kind}`);
}

/** Every published version of a document, newest first. */
export function fetchDocumentHistory(kind: DocumentKind): Promise<PublishedVersionLine[] | null> {
  return getJson<{ items?: PublishedVersionLine[] }>(`/v1/sbg/documents/${kind}/history`).then((d) => (Array.isArray(d?.items) ? d!.items : null));
}

/** Where this sign-in stands: must they agree before going on. */
export function readMyAgreement(sbg: SbgClient): Promise<Result<MyAgreement>> {
  return sbg.request((c) => c.GET('/v1/sbg/agreement/mine', {})) as Promise<Result<MyAgreement>>;
}

/** Agree, signed in — to the versions that were on screen. */
export function agreeNow(sbg: SbgClient, numbers: AgreementNumbers): Promise<Result<MyAgreement>> {
  return sbg.request((c) => c.POST('/v1/sbg/agreement/mine', { body: numbers })) as Promise<Result<MyAgreement>>;
}

/** For the tests: forget the set, as a new page would. */
export function forgetAgreementSet(): void {
  setOnce = null;
}
