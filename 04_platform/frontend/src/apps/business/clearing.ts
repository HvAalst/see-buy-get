import type { SbgClient, components } from '../../lib/sbg';

/*
 * 2026-11-19 — A CLEARING AGENT'S OWN SIDE (parcels across a border, step 4): the arrival countries it is named to clear in, its
 * owner's acceptance, and the parcels into those countries — coming from abroad, waiting for customs, held — with what customs
 * decided and when a held one is paid.
 */
export type ClearingView = components['schemas']['ClearingView'];
export type ClearingRow = ClearingView['rows'][number];

type Result<T> = { data?: T; error?: { code?: string; title?: string; detail?: string } | null };

export interface ClearingApi {
  view(): Promise<Result<ClearingView>>;
  accept(country: string): Promise<Result<ClearingView>>;
  customs(parcelId: string, body: { outcome: 'released' | 'held'; amount?: number; reference?: string }): Promise<Result<ClearingRow>>;
  paid(parcelId: string): Promise<Result<ClearingRow>>;
}

export function clearingApi(sbg: SbgClient): ClearingApi {
  const call = <T>(fn: Parameters<SbgClient['request']>[0]) => sbg.request(fn) as unknown as Promise<Result<T>>;
  const id = (v: string) => encodeURIComponent(v);
  return {
    view: () => call((c) => c.GET('/v1/sbg/business/me/clearing' as never, {} as never) as never),
    accept: (country) => call((c) => c.POST(`/v1/sbg/business/me/clearing/${id(country)}/accept` as never, {} as never) as never),
    customs: (parcelId, body) => call((c) => c.POST(`/v1/sbg/business/me/clearing/parcels/${id(parcelId)}/customs` as never, { body } as never) as never),
    paid: (parcelId) => call((c) => c.POST(`/v1/sbg/business/me/clearing/parcels/${id(parcelId)}/paid` as never, {} as never) as never),
  };
}

/** The rows by what is to be done with them. */
export function clearingGroups(rows: ClearingRow[]): { coming: ClearingRow[]; customs: ClearingRow[]; held: ClearingRow[]; givenUp: ClearingRow[] } {
  return { coming: rows.filter((r) => r.step === 'coming'), customs: rows.filter((r) => r.step === 'customs'), held: rows.filter((r) => r.step === 'held'), givenUp: rows.filter((r) => r.step === 'given_up') };
}
