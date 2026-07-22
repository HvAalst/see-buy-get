/**
 * SeeBuyGet API library — the one typed way every PWA talks to the SeeBuyGet backend.
 *
 * Generated types (schema.d.ts, zero runtime bytes) + openapi-fetch + ~a few hundred lines of value:
 * a Result envelope (business failures are data, not exceptions), the RFC 9457 error model mapped to
 * icons + read-aloud keys for non-readers, a token session fixed against navigation loss and dead RTCs,
 * a client-version handshake (426 → update screen), and per-persona facades that expose only that
 * persona's operations.
 *
 * Usage:
 *   const sbg = createSbgClient({ config: makeConfig('driver', '1.0.0'), session });
 *   const driver = createDriverApi(sbg);
 *   const { data, error } = await driver.me(did);
 *   if (error) show(presentationFor(error.code));
 */
export { makeConfig, resolveBaseUrl, type SbgConfig } from './config';
export { Session, type MintFn, type MintedToken } from './session';
export { createSbgClient, type SbgClient, type Result, type Ok, type Err } from './client';
export { toSbgError, clientError, presentationFor, type SbgError, type SbgErrorCode, type ErrorPresentation } from './errors';
export {
  createMintedClient,
  createSeededClient,
  isMintSourced,
  isSignInRequired,
  isUnknownIdentity,
  narrow,
  preferMintFailure,
  publicRequest,
  purgeTokens,
  sbgForgot,
  sbgLogin,
  sbgReset,
  tokenKeyFor,
  type AppClient,
  type LoginView,
  type SeededAppClient,
} from './appclient';
export { createDriverApi, type DriverApi } from './personas/driver';
export { createAgentApi, type AgentApi } from './personas/agent';
export { createMdpApi, type MdpApi } from './personas/mdp';
export { createFleetApi, type FleetApi } from './personas/fleet';
export type { paths, components, operations } from './schema';
