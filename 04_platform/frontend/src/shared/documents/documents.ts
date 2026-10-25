import { resolveBaseUrl } from '../../lib/sbg/config';
import type { Result, SbgClient } from '../../lib/sbg';

/**
 * THE TERMS OF USE, WHAT HAPPENS TO PEOPLE'S DATA, AND COOKIES — as the server holds them, written by staff in the
 * console (the user, 2026-10-25). Read by anybody; agreed to at every sign-up; asked again after signing in when a
 * version published since asks everybody to agree again. The backend half is foundation/documents.
 *
 * GENERAL, AND EACH COUNTRY'S OWN (the user, 2026-10-25: "every country needs it's specific adjustments, so there will
 * be the general terms of use, global, and specific terms of use"): somebody in a country with documents of its own
 * agrees to those as well as the general ones. Each is a LINE, named by its key: `terms`, or `terms@KE` for Kenya's.
 */
export type DocumentKind = 'terms' | 'privacy' | 'cookies';
export const DOCUMENT_KINDS: readonly DocumentKind[] = ['terms', 'privacy', 'cookies'];

/** A published version, as anybody reads it. */
export interface PublishedDocument {
  key: string;
  kind: DocumentKind;
  /** The country whose own line it is; absent for the general text. */
  country?: string;
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

/** A country with a version of its own of a document, published. */
export interface DocumentCountry {
  country: string;
  name: string;
  number: number;
  publishedAt: string;
  path: string;
}

/** One document of what a sign-up agrees to: the version to read now, and the oldest that still counts. */
export interface AgreementDocument {
  key: string;
  kind: DocumentKind;
  country?: string;
  title: string;
  number: number;
  publishedAt: string;
  since: number;
  path: string;
}

/** The versions somebody agreed to, by line key. */
export type AgreedVersions = Record<string, number>;

/** What a sign-up sends as `agreement`: the versions on screen, and the country they were shown for. */
export interface Agreement {
  versions: AgreedVersions;
  country?: string;
}

/** Where a sign-up made under somebody signed in stands: being checked, nothing to ask, or the agreement ticked. */
export type AgreementHere = Agreement | 'covered' | null;

export interface MyAgreement {
  needed: boolean;
  /** The country whose own documents were asked: the one this sign-in works in. */
  country?: string;
  documents: AgreementDocument[];
  agreedAt?: string;
  agreed?: AgreedVersions;
}

/** The versions to send for the documents on screen. */
export function numbersOf(set: readonly AgreementDocument[]): AgreedVersions {
  const out: AgreedVersions = {};
  for (const doc of set) out[doc.key] = doc.number;
  return out;
}

/** The documents with a version since what this person agreed to — what the app marks as new when it asks again. */
export function changedSince(set: readonly AgreementDocument[], agreed: AgreedVersions | undefined): string[] {
  if (!agreed) return [];
  return set.filter((d) => (agreed[d.key] ?? 0) < d.number).map((d) => d.key);
}

/**
 * One set out of several countries' — the general documents once, then each country's own, in the order the countries
 * were given: what somebody signing up in one country with a phone from another agrees to.
 */
export function mergeSets(sets: ReadonlyArray<readonly AgreementDocument[]>): AgreementDocument[] {
  const seen = new Set<string>();
  const general: AgreementDocument[] = [];
  const own: AgreementDocument[] = [];
  for (const set of sets) {
    for (const doc of set) {
      if (seen.has(doc.key)) continue;
      seen.add(doc.key);
      (doc.country ? own : general).push(doc);
    }
  }
  return [...general, ...own];
}

/** A country's name in the reader's language — "Kenya" — or its code where the phone cannot say. */
export function countryNameIn(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The countries a sign-up is in, each once, upper case, empties left out. */
export function countriesOf(countries: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(countries.map((c) => (c ?? '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${resolveBaseUrl()}${path}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const sets = new Map<string, Promise<AgreementDocument[] | null>>();

/**
 * What a sign-up agrees to now — the general documents, and `country`'s own where it has any. Asked once a page per
 * country; a failure is not kept (no signal now is not no terms), so the next screen that asks tries again.
 */
export function fetchAgreementSet(country?: string, fresh = false): Promise<AgreementDocument[] | null> {
  const code = countriesOf([country])[0] ?? '';
  if (fresh) sets.delete(code);
  let asked = sets.get(code);
  if (!asked) {
    asked = getJson<{ documents?: AgreementDocument[] }>(`/v1/sbg/agreement${code ? `?country=${code}` : ''}`).then((d) => (Array.isArray(d?.documents) ? d!.documents : null));
    sets.set(code, asked);
    const mine = asked;
    void mine.then((s) => {
      if (!s && sets.get(code) === mine) sets.delete(code);
    });
  }
  return asked;
}

/** The same for several countries at once: one set, each document once. Nothing when any of them could not be read. */
export async function fetchAgreementSets(countries: ReadonlyArray<string | null | undefined>, fresh = false): Promise<AgreementDocument[] | null> {
  const codes = countriesOf(countries);
  const all = await Promise.all((codes.length ? codes : ['']).map((c) => fetchAgreementSet(c || undefined, fresh)));
  return all.every((s): s is AgreementDocument[] => Array.isArray(s)) ? mergeSets(all) : null;
}

const countryQuery = (country?: string, joiner = '?') => (country ? `${joiner}country=${encodeURIComponent(country.toUpperCase())}` : '');

/** A document as it reads now, or one earlier version of it, word for word — the general text, or a country's own. */
export function fetchDocument(kind: DocumentKind, number?: number, country?: string): Promise<PublishedDocument | null> {
  return getJson<PublishedDocument>(number ? `/v1/sbg/documents/${kind}/versions/${number}${countryQuery(country)}` : `/v1/sbg/documents/${kind}${countryQuery(country)}`);
}

/** Every published version of a document, newest first. */
export function fetchDocumentHistory(kind: DocumentKind, country?: string): Promise<PublishedVersionLine[] | null> {
  return getJson<{ items?: PublishedVersionLine[] }>(`/v1/sbg/documents/${kind}/history${countryQuery(country)}`).then((d) => (Array.isArray(d?.items) ? d!.items : null));
}

/** The countries with a version of their own of a document. */
export function fetchDocumentCountries(kind: DocumentKind): Promise<DocumentCountry[] | null> {
  return getJson<{ items?: DocumentCountry[] }>(`/v1/sbg/documents/${kind}/countries`).then((d) => (Array.isArray(d?.items) ? d!.items : null));
}

/**
 * Where this sign-in stands: must they agree before going on — for the country they work in, or `country`, one they are
 * about to sign something up in.
 */
export function readMyAgreement(sbg: SbgClient, country?: string): Promise<Result<MyAgreement>> {
  const query = country ? { query: { country } } : {};
  return sbg.request((c) => c.GET('/v1/sbg/agreement/mine', { params: query })) as Promise<Result<MyAgreement>>;
}

/** Agree, signed in — to the versions that were on screen. */
export function agreeNow(sbg: SbgClient, agreement: Agreement): Promise<Result<MyAgreement>> {
  return sbg.request((c) => c.POST('/v1/sbg/agreement/mine', { body: agreement })) as Promise<Result<MyAgreement>>;
}

/** For the tests: forget the sets, as a new page would. */
export function forgetAgreementSet(): void {
  sets.clear();
}
