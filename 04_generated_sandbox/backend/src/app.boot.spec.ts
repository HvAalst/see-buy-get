import { MailService } from './foundation/mail/mail.service';
import { SmsService } from './foundation/sms/sms.service';
import { PresenceService } from './foundation/presence/presence.service';
import { FleetMoveService } from './modules/pudo/fleet-move.service';
import { FleetOfferService } from './modules/pudo/fleet-offer.service';
import { AccountRecoveryService } from './modules/pudo/account-recovery.service';
import { NetworkPulseService } from './modules/pudo/network-pulse.service';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

/**
 * Does the application actually start?
 *
 * Every other suite in this repo lists its providers by hand, which is fast and focused and completely
 * blind to the dependency-injection container. A service can be perfectly unit-tested and still make the
 * real app fail to boot — and it did: an `@Injectable` given an optional primitive constructor parameter
 * (`builtinDir?: string`) makes Nest look for a provider for `String`, fails to find one, and the process
 * dies at startup. 856 green tests said nothing about it, because not one of them asked the container to
 * build anything.
 *
 * So this suite asks exactly one question, and it is the only question that matters before any other test
 * result means anything: **can the container construct the whole graph?**
 */
describe('the application boots', () => {
  it('resolves every provider in the real module graph', async () => {
    process.env.GLOS_PERSIST = 'off'; // a boot check must not write to disk
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    // Mail is injected @Optional (so hand-listed specs keep working) — which is exactly why the real graph must have it.
    expect(moduleRef.get(MailService)).toBeDefined();
    // And the text that carries a code: optional on the controller, and without it no code leaves the server.
    expect(moduleRef.get(SmsService)).toBeDefined();
    // …and it asks the register of countries which numbers may be texted: without it, any number in the world is.
    expect((moduleRef.get(SmsService) as unknown as { presence?: unknown }).presence).toBeInstanceOf(PresenceService);
    // The same for moving a driver between fleets: optional on the controller, so the real graph must hold it.
    expect(moduleRef.get(FleetMoveService, { strict: false })).toBeDefined();
    expect(moduleRef.get(FleetOfferService, { strict: false })).toBeDefined();
    expect(moduleRef.get(AccountRecoveryService, { strict: false })).toBeDefined();
    expect(moduleRef.get(NetworkPulseService, { strict: false })).toBeDefined();
    await moduleRef.close();
  }, 60_000);
});
