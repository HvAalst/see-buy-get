import { describe, expect, it, vi } from 'vitest';
import type { SbgClient } from '../client';
import { createAgentApi } from './agent';
import { createDriverApi } from './driver';
import { createMdpApi } from './mdp';

/**
 * A STEP CARRIES THE MOMENT IT WAS DONE (round 23, the user: "Counters' writes keep their time"; round 22 for the
 * driver's pickup and delivery). A custody step queued with no signal waits on the phone and is sent later with the body
 * it was built with — so the body must say when it was done, at the moment the person did it, or the server can only
 * date it when it arrives.
 */
describe('a custody step carries the moment it was done', () => {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const post = (path: string, init: { body: Record<string, unknown> }) => {
    sent.push({ path, body: init.body });
    return Promise.resolve({ data: {}, response: new Response('{}') });
  };
  const sbg = { request: (fn: (raw: unknown) => Promise<unknown>) => fn({ POST: post }) } as unknown as SbgClient;
  const at = new Date('2026-10-20T07:15:00.000Z');
  const stampOf = async (call: () => Promise<unknown>) => {
    sent.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(at);
    try {
      await call();
    } finally {
      vi.useRealTimers();
    }
    expect(sent).toHaveLength(1);
    return sent[0];
  };

  it('on every step a shop’s counter queues: take-in, intake, the bus, arrival, a bag filled and sealed', async () => {
    const agent = createAgentApi(sbg);
    const steps = [
      () => agent.accept({ agentDid: 'did:a', parcelId: 'P1', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'm1' }),
      () => agent.intake('P1', 'm1'),
      () => agent.handover('did:a', 'DRV-1-123456', ['P1']),
      () => agent.arrive('P1', 'did:a'),
      () => agent.fillBag('did:a', 'BAG-1', 'P1'),
      () => agent.sealBag('did:a', 'BAG-1', { acknowledgeShortShip: true, shortShipReason: 'next bag' }),
    ];
    for (const step of steps) {
      const { path, body } = await stampOf(step);
      expect({ path, observedAt: body.observedAt }).toEqual({ path, observedAt: at.toISOString() });
    }
  });

  it('keeps what the step said beside it', async () => {
    const agent = createAgentApi(sbg);
    expect((await stampOf(() => agent.accept({ agentDid: 'did:a', parcelId: 'P1', destZone: 'Z', senderMobile: '+1', receiverMobile: '+2', dropoffPhotoRef: 'm1' }))).body).toMatchObject({ parcelId: 'P1', dropoffPhotoRef: 'm1' });
    expect((await stampOf(() => agent.sealBag('did:a', 'BAG-1', { acknowledgeShortShip: true, shortShipReason: 'next bag' }))).body).toMatchObject({ acknowledgeShortShip: true, shortShipReason: 'next bag' });
  });

  it('on a temperature read and a shift ended (round 24)', async () => {
    const driver = createDriverApi(sbg);
    expect((await stampOf(() => driver.recordTemp('F1', 'did:d', 4.5))).body).toEqual({ driverDid: 'did:d', celsius: 4.5, observedAt: at.toISOString() });
    expect((await stampOf(() => driver.endSession('did:d', 15230))).body).toEqual({ odometerKm: 15230, observedAt: at.toISOString() });
    expect((await stampOf(() => driver.endSession('did:d'))).body).toEqual({ observedAt: at.toISOString() });
  });

  it('on a bag loaded onto a vehicle, by the driver or at a hub', async () => {
    for (const load of [() => createDriverApi(sbg).loadBag('BAG-1', 'DRV-1'), () => createMdpApi(sbg).loadBag('BAG-1', 'DRV-1')]) {
      const { body } = await stampOf(load);
      expect(body).toEqual({ driverBadgeId: 'DRV-1', observedAt: at.toISOString() });
    }
  });
});
