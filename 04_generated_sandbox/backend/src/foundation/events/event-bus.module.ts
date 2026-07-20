import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.service';

/** Global so every module can inject the EventBus to emit/consume domain events. */
@Global()
@Module({
  providers: [EventBus],
  exports: [EventBus],
})
export class EventBusModule {}
