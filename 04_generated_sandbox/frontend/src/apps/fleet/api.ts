import {
  createFleetApi,
  createMintedClient,
  makeConfig,
  publicRequest,
  purgeTokens,
  tokenKeyFor,
  type AppClient,
  type FleetApi,
  type Result,
  type SbgConfig,
} from '../../lib/sbg';
import { t } from '../../shared/i18n';
import type { ManagerView } from './types';

const APP_VERSION = '1.0.0';

/** sessionStorage namespace for fleet-manager bearer tokens — one key per DID. */
const TOKEN_PREFIX = 'sbg:fleet:';

export function fleetConfig(): SbgConfig {
  return makeConfig('fleet', APP_VERSION);
}

/**
 * Manager sign-in is a two-step: the @Public code login resolves the manager record
 * (AUTH_CODE_INVALID / AUTH_NOT_ACTIVE are real, readable rejections), then the app mints
 * a fleet_manager actor token for that DID with tenant = the manager's own DID — the
 * tenant is what scopes /vehicles, /fleet/drivers and /fleet/dashboard to THIS fleet
 * server-side. Same sandbox-mint limitation as the driver app (client-secret gated in
 * production); the manager login itself is real S2 surface.
 */
export function managerLogin(code: string): Promise<Result<ManagerView>> {
  return publicRequest<ManagerView>(fleetConfig(), '/v1/sbg/fleet/managers/login', { body: { code } });
}

export interface FleetClient {
  api: FleetApi;
  client: AppClient;
}

export function createFleetClient(managerDid: string): FleetClient {
  const client = createMintedClient(fleetConfig(), 'fleet_manager', managerDid, tokenKeyFor(TOKEN_PREFIX, managerDid), {
    tenant: managerDid,
  });
  return { api: createFleetApi(client.sbg), client };
}

export function purgeFleetTokens(keepDid: string | null): void {
  purgeTokens(TOKEN_PREFIX, keepDid);
}

/* ---------------------------------------------------------------- identity -- */

const DID_KEY = 'glos-fleet-did';
const COMPANY_KEY = 'glos-fleet-company';

function get(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function set(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable — the session will not survive a cold start */
  }
}
function drop(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* no-op */
  }
}

export const readManager = (): { did: string; company: string } | null => {
  const did = get(DID_KEY);
  if (!did) return null;
  return { did, company: get(COMPANY_KEY) ?? t('fleet.myFleetFallback') };
};
export const saveManager = (did: string, company: string): void => {
  set(DID_KEY, did);
  set(COMPANY_KEY, company);
};
export const clearManager = (): void => {
  drop(DID_KEY);
  drop(COMPANY_KEY);
};
