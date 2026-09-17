import { Global, Module } from '@nestjs/common';
import { HandleService } from './handle.service';

/**
 * Global, because a handle is an address for any kind of participant and the modules that create shops,
 * hubs, fleets and companies are four different places. Holding it anywhere narrower would mean either a
 * cycle or four copies of the same namespace, and a namespace with two owners is not a namespace.
 */
@Global()
@Module({ providers: [HandleService], exports: [HandleService] })
export class HandleModule {}
