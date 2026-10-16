import type { Result, SbgClient } from '../../lib/sbg';
import type { components } from '../../lib/sbg/schema';

export type FleetSites = components['schemas']['FleetSitesView'];
export type FleetSite = components['schemas']['FleetSiteView'];
export type SiteHome = components['schemas']['SiteHome'];

/** What the office writes about a site: what is not sent stays as it was. */
export interface SiteInput {
  name?: string;
  lat?: number;
  lng?: number;
  address?: string;
  hours?: Record<string, { open: string; close: string } | null> | null;
  loadingBays?: number;
  shifts?: Array<{ shiftId?: string; name: string; start: string; hours: number }>;
}

/**
 * A FLEET'S SITES, over the wire — the depots and yards its trucks and drivers work from. Read when the Sites screen
 * opens, so it lives beside that screen rather than in the app's one big hook.
 */
export function sitesApi(sbg: SbgClient, fleetDid: string) {
  const path = { did: fleetDid };
  return {
    view: (): Promise<Result<FleetSites>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/sites', { params: { path } })) as never,
    add: (body: SiteInput): Promise<Result<FleetSites>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/sites', { params: { path }, body: body as never })) as never,
    update: (siteId: string, body: SiteInput): Promise<Result<FleetSites>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/sites/{siteId}', { params: { path: { ...path, siteId } }, body: body as never })) as never,
    close: (siteId: string): Promise<Result<FleetSites>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/sites/{siteId}/close', { params: { path: { ...path, siteId } } })) as never,
    setHome: (kind: 'vehicle' | 'driver', id: string, siteId: string): Promise<Result<FleetSites>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/site-homes', { params: { path }, body: { kind, id, siteId } })) as never,
  };
}

export type SitesApi = ReturnType<typeof sitesApi>;

/** A site's name, from its id — the id itself where the site is not (or no longer) on the list. */
export function siteName(sites: Pick<FleetSite, 'siteId' | 'name'>[], siteId: string): string {
  return sites.find((s) => s.siteId === siteId)?.name ?? siteId;
}

/** A point typed as "-1.2921, 36.8219": both numbers, in range — or nothing. */
export function pointOf(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}
