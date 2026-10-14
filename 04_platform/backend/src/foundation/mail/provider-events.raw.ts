import { raw } from 'express';

/** Where the mail provider posts its notices (a bounce). Given to the provider as `https://<this API>/v1/mail/provider/events`. */
export const PROVIDER_EVENTS_PATH = '/v1/mail/provider/events';

/**
 * READ THAT ONE ADDRESS AS THE BYTES IT ARRIVED IN.
 *
 * A notice is believed because its signature is over its body — the exact bytes, not what a parser made of them. The
 * server's ordinary parsers turn a body into an object and throw the bytes away, so this has to be put in front of
 * them, for this address only, WHERE THE SERVER IS STARTED (`main.ts`), before anything else reads a body. A module
 * cannot do it: its middleware runs after the parsers have already consumed the request.
 *
 * Left out, nothing is believed: `MailBounces.take` refuses a body that is not bytes, counts it, and logs why.
 */
export function readProviderEventsRaw(app: { use: (...args: never[]) => unknown }): void {
  (app.use as (path: string, handler: unknown) => unknown)(PROVIDER_EVENTS_PATH, raw({ type: () => true, limit: '512kb' }));
}
