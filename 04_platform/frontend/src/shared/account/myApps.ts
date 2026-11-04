import { publicRequest, type Result, type SbgConfig } from '../../lib/sbg';
import { frontDoorUrl } from '../frontDoor';
import { shopDeviceKey, type DeviceParty } from './shopDevice';

/*
 * "YOUR SEEBUYGET APPS" (the owner, 2026-11-03: "From within that account you should be able to switch to other sbg apps
 * that you sign up to from within that first app"). One email may sign in to a shop, a hub and a store; once its owner
 * tapped "Yes, it is me" for each, the picture menu of one opens the others on this phone — a one-time hand-over the
 * server gives the app asking, from one of its own phones, and the other app takes on opening (#handover=…). No password
 * and no code to the other's number: the email already proved they are one owner's.
 */

export type AppRole = 'pudo' | 'mdp' | 'vendor';

export interface MyApp {
  role: AppRole;
  kind: string;
  /** False while its owner has not tapped "Yes, it is me" in the email for it. */
  linked: boolean;
}

/** Where each kind's app lives, and the kind its phone keys are kept under (shopDevice.ts). */
export const APP_OF: Record<AppRole, { path: string; party: DeviceParty }> = {
  pudo: { path: 'agent/', party: 'shop' },
  mdp: { path: 'mdp/', party: 'hub' },
  vendor: { path: 'vendor/', party: 'store' },
};

export interface MyAppsApi {
  list: () => Promise<Result<{ apps: MyApp[] }>>;
  /** The hand-over to that app: where to go, or why not. */
  open: (role: AppRole) => Promise<Result<{ href: string }>>;
  /** 2026-11-04 — another sign-up started from here: a one-time code that carries this account's details (carry.ts). */
  carry?: () => Promise<Result<{ code: string }>>;
}

type Get = <T>(path: string) => Promise<Result<T>>;
type Post = <T>(path: string, body: unknown) => Promise<Result<T>>;

/** `party`: the kind of the app asking — its phone key for this address goes with the ask, as with its sign-in. */
export function myAppsApi(get: Get, post: Post, email: () => string | null, party: DeviceParty): MyAppsApi {
  return {
    list: () => get<{ apps: MyApp[] }>('/v1/sbg/account/my-apps'),
    open: async (role) => {
      const mail = email();
      const r = await post<{ code: string }>('/v1/sbg/account/my-apps/hand-over', { role, device: shopDeviceKey(mail, party), targetDevice: shopDeviceKey(mail, APP_OF[role].party) });
      if (r.error) return r;
      return { data: { href: `${frontDoorUrl()}${APP_OF[role].path}#handover=${encodeURIComponent(r.data.code)}` }, error: null, status: r.status };
    },
    carry: () => post<{ code: string }>('/v1/sbg/account/my-apps/carry', { device: shopDeviceKey(email(), party) }),
  };
}

/** Go there (shared/frontDoor.ts, where the launcher finds it without the rest of this file). */
export { goToApp } from '../frontDoor';

/** The hand-over out of the address — `#handover=<code>` — or undefined when the address carries none. */
export function readHandOver(hash: string | undefined): string | undefined {
  const m = /(?:^#|&)handover=([^&]+)/.exec(hash ?? '');
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]).trim().slice(0, 80);
  } catch {
    return undefined;
  }
}

/**
 * Taken on opening: the hand-over out of the address (and the address cleaned of it, so a refresh or a bookmark carries
 * nothing), then signed in with it. Undefined when the address carries none.
 */
export function takeHandOverFromAddress<T>(config: SbgConfig): Promise<Result<T>> | undefined {
  const code = readHandOver(globalThis.location?.hash);
  if (!code) return undefined;
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  } catch {
    /* a browser that refuses the rewrite still signs in */
  }
  return publicRequest<T>(config, '/v1/sbg/auth/hand-over', { body: { code } });
}
