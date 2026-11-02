import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { CarMessagesService, type CarCaller } from './car-messages.service';

interface CarRequest {
  headers?: Record<string, string | string[] | undefined>;
  sbgCar?: CarCaller;
  sbgRateKey?: string;
}

/**
 * THE CAR'S DOOR (2026-11-02, "Messages in the car"; car-messages.service.ts). Refuses a call that does not carry a car
 * key in `Authorization: Car <key>` — a driver's sign-in, a device key, a company key, nothing at all — and a car key that
 * opens nothing; otherwise leaves behind whose it is, and whose limit to spend. Runs BEFORE RateLimitGuard, which reads
 * what this leaves: each car key is counted as itself.
 */
@Injectable()
export class CarKeyGuard implements CanActivate {
  constructor(private readonly car: CarMessagesService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<CarRequest>();
    const caller = this.car.resolve(req.headers?.authorization);
    req.sbgCar = caller;
    req.sbgRateKey = `car:${caller.keyHash.slice(0, 24)}`;
    return true;
  }
}

/** The car key's driver, for a handler behind CarKeyGuard. */
export const CarKey = createParamDecorator((_data: unknown, context: ExecutionContext): CarCaller => {
  const caller = context.switchToHttp().getRequest<CarRequest>().sbgCar;
  if (!caller) throw new Error('CarKey read without CarKeyGuard');
  return caller;
});
