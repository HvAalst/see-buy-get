import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { LIVE_BEAT_MS, LiveListener, LiveService } from './live.service';

/** Who a signed-in caller listens as: staff and our companies' administrators the console, a fleet office its fleet. */
export function listenerOf(actor: IntrospectionResult | undefined): LiveListener {
  if (actor?.role === 'operator' || actor?.role === 'entity_admin') return { kind: 'console' };
  if (actor?.role === 'fleet_manager' && actor.tenant) return { kind: 'fleet', fleetDid: actor.tenant };
  throw new GlosError('FORBIDDEN', 'The live view is for the console and fleet offices');
}

/**
 * ONE LIVE VIEW (see LiveService). An open stream of server-sent events, read with the caller's own sign-in:
 * - `live` once, as it opens;
 * - `changed` with `{ topics }` whenever something its screens show may have changed (names only, never a record);
 * - `beat` every LIVE_BEAT_MS while nothing happens, so no proxy on the way takes it for a dead connection.
 * Closing the page closes it; the screen opens it again by itself after a dropped connection, and reads once.
 */
@Controller('sbg')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Roles('fleet_manager', 'entity_admin', 'operator')
  @Sse('live')
  stream(@Actor() actor: IntrospectionResult): Observable<MessageEvent> {
    const who = listenerOf(actor);
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ type: 'live', data: { topics: [] } });
      const close = this.live.open(who, (topics) => subscriber.next({ type: 'changed', data: { topics } }));
      const beat = setInterval(() => subscriber.next({ type: 'beat', data: {} }), LIVE_BEAT_MS);
      beat.unref?.();
      return () => {
        clearInterval(beat);
        close();
      };
    });
  }
}
