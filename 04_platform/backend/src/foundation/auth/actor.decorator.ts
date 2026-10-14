import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { IntrospectionResult } from './auth.types';

/**
 * The single seam a handler reads to learn WHO is calling. The guard populates `request.auth` from
 * introspect(); this exposes it typed. Handlers must read identity from here — NEVER from a request
 * body field the caller controls (that is the self-asserted-identity hole S3 deletes).
 *
 *   accept(@Actor() actor: Actor, @Body() dto: AcceptDto) { ... actor.did ... }
 *   list(@Actor('tenant') tenant?: string) { ... }
 */
export type Actor = IntrospectionResult;

export const CurrentActor = createParamDecorator(
  (field: keyof Actor | undefined, ctx: ExecutionContext): Actor | Actor[keyof Actor] | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { auth?: Actor }>();
    const actor = request.auth;
    return field ? actor?.[field] : actor;
  },
);

/** Alias so call sites read `@Actor()`. */
export const Actor = CurrentActor;
