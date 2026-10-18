import { Controller, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Scopes } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { VendorCallbackService } from './vendor-callback.service';
import { VendorService, type VendorCallback } from './vendor.service';

/**
 * A STORE'S MESSAGES TO ITS OWN SYSTEM, SENT AGAIN (the user, round 9: "Webhooks for every party", the store first). A
 * store could read what was sent and not do anything about one that did not arrive: now it sends one again, or sends
 * itself a test, and is answered once the first try has been made. Its own acts, signed in as itself — staff are
 * refused by name, as on every door that changes a store.
 */
@Controller('sbg')
export class StoreMessagesController {
  constructor(
    private readonly vendors: VendorService,
    private readonly sender: VendorCallbackService,
  ) {}

  /** A message that says only that it is a test, to the address the store has: does its system take and verify ours? */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/callbacks/test')
  async test(@Param('id') id: string, @Actor() actor: IntrospectionResult): Promise<VendorCallback> {
    this.assertTheStore(id, actor);
    const sent = this.vendors.testCallback(id);
    await this.sender.drain();
    return this.vendors.callbackOf(id, sent.id);
  }

  /** One sent again: the same message, to the address and with the secret the store has now, with a fresh round of tries. */
  @Scopes('vendor:manage:self')
  @Post('vendors/:id/callbacks/:callbackId/resend')
  async resend(@Param('id') id: string, @Param('callbackId') callbackId: string, @Actor() actor: IntrospectionResult): Promise<VendorCallback> {
    this.assertTheStore(id, actor);
    this.vendors.resendCallback(id, callbackId);
    await this.sender.drain();
    return this.vendors.callbackOf(id, callbackId);
  }

  /** The store itself, and nobody standing in — the same rule, in the same words, as SbgController.assertVendorSelf. */
  private assertTheStore(id: string, actor: IntrospectionResult): void {
    const vendor = this.vendors.get(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A store makes its own changes, signed in as that store. Staff read a store under Stores and change nothing in its name');
    if (!actor?.did || actor.did !== vendor.did) throw new GlosError('FORBIDDEN', 'This store is not yours to change');
  }
}
