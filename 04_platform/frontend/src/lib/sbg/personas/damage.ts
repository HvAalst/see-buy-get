import type { SbgClient } from '../client';

/**
 * THE DAMAGE CLAIM REPORT, for whoever is signed in and may read one: the receiver of the parcel, the store on its
 * own order, the shop that reported the problem at its counter, and staff (who also read the list of them all).
 *
 * Who that is, is asked by the server of the parcel itself. Anybody else is told there is no such report.
 */
export function createDamageReportApi(sbg: SbgClient) {
  return {
    report: (parcelId: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}/damage-report', { params: { path: { id: parcelId } } })),
    /** The file: the report to read or print, the same facts for a machine, and the photographs. */
    file: (parcelId: string) => sbg.request<Blob>((c) => c.GET('/v1/sbg/parcels/{id}/damage-report/file' as never, { params: { path: { id: parcelId } }, parseAs: 'blob' } as never)),
    links: (parcelId: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}/damage-report/links', { params: { path: { id: parcelId } } })),
    /** The address in the answer is shown this once: the key is not kept. */
    makeLink: (parcelId: string) => sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/damage-report/links', { params: { path: { id: parcelId } } })),
    cancelLink: (parcelId: string, linkId: string) => sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/damage-report/links/{linkId}/cancel', { params: { path: { id: parcelId, linkId } } })),
    /** The receiver adds what they found after the parcel was handed over: a note beside the report, which does not change. */
    addNote: (parcelId: string, body: { text: string; photoRefs?: string[] }) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/damage-report/notes', { params: { path: { id: parcelId } }, body })),
    /** Staff: every problem reported, newest first. */
    list: () => sbg.request((c) => c.GET('/v1/sbg/damage-reports')),
  };
}

export type DamageReportApi = ReturnType<typeof createDamageReportApi>;
