import { CarTokenGone, CarWakeError, CarWakeService, OutboxCarWakeSender, type CarWakeSender } from './car-wake';
import { DeviceBook, type KnownDevice } from './person-devices';
import { carKeyHashOf, newCarKey, tokenPrint, type DeviceCarKey } from './car-keys';

/*
 * 2026-11-02 — WHO IS WOKEN WHEN A MESSAGE ARRIVES (the owner: "we start with 2"). The phones whose car key reads that
 * driver's chats, and only those whose native part told us where Firebase reaches them; an account at rest is not woken;
 * a token Firebase says is gone is dropped — unless the phone told us a new one meanwhile — and nothing ever throws.
 */
const TOKEN_A = `tokA${'a'.repeat(40)}`;
const TOKEN_B = `tokB${'b'.repeat(40)}`;

function setUp(sender: CarWakeSender, resting: string[] = []) {
  const book = new DeviceBook(new Map<string, KnownDevice>());
  const persons = {
    isResting: (did: string) => resting.includes(did),
    carKeysOfDriver: (did: string) => book.carsOfDriver(did),
    updateCarKey: (hash: string, change: (c: DeviceCarKey) => DeviceCarKey) => book.updateCar(hash, change),
  };
  const add = (personDid: string, driverDid: string, fcmToken?: string) => {
    const device = book.add(personDid);
    const keyHash = carKeyHashOf(newCarKey());
    book.setCar(personDid, device, { keyHash, driverDid, addedAt: new Date().toISOString(), lang: 'en', ...(fcmToken ? { fcmToken, tokenAt: new Date().toISOString() } : {}) });
    return keyHash;
  };
  return { book, add, wakes: new CarWakeService(persons as never, sender) };
}

describe('who is woken when a message arrives', () => {
  it('every phone of that driver’s that told us its token — none of anybody else’s, none still waiting', async () => {
    const outbox = new OutboxCarWakeSender();
    const { add, wakes } = setUp(outbox);
    add('did:person:amos', 'did:drv:amos', TOKEN_A);
    add('did:person:amos', 'did:drv:amos');
    add('did:person:grace', 'did:drv:grace', TOKEN_B);
    expect(await wakes.wake('did:drv:amos', 'cv_1')).toBe(1);
    expect(outbox.recent()).toEqual([{ to: tokenPrint(TOKEN_A), data: { kind: 'chat', conversationId: 'cv_1' }, at: expect.any(String) }]);
    expect(await wakes.wake('did:shop', 'cv_1')).toBe(0);
  });

  it('the car reaches a driver only once their phone told us its token, and never one at rest — what keeps a notice from being pushed twice', () => {
    const outbox = new OutboxCarWakeSender();
    const { add, wakes } = setUp(outbox);
    add('did:person:amos', 'did:drv:amos');
    expect(wakes.reachesInCar('did:drv:amos')).toBe(false);
    add('did:person:amos', 'did:drv:amos', TOKEN_A);
    expect(wakes.reachesInCar('did:drv:amos')).toBe(true);
    expect(wakes.reachesInCar('did:drv:grace')).toBe(false);
    const resting = setUp(outbox, ['did:drv:amos']);
    resting.add('did:person:amos', 'did:drv:amos', TOKEN_A);
    expect(resting.wakes.reachesInCar('did:drv:amos')).toBe(false);
  });

  it('an account at rest is not woken: what arrived waits in the app', async () => {
    const outbox = new OutboxCarWakeSender();
    const { add, wakes } = setUp(outbox, ['did:drv:amos']);
    add('did:person:amos', 'did:drv:amos', TOKEN_A);
    expect(await wakes.wake('did:drv:amos', 'cv_1')).toBe(0);
    expect(outbox.recent()).toEqual([]);
  });

  it('a token Firebase says is gone is dropped — "Waiting for the phone" again; a fault keeps it; nothing throws', async () => {
    let answer: 'gone' | 'fault' = 'fault';
    const sender: CarWakeSender = {
      send: async () => {
        throw answer === 'gone' ? new CarTokenGone() : new CarWakeError('failed', 'Firebase answered with a fault');
      },
    };
    const { add, book, wakes } = setUp(sender);
    const hash = add('did:person:amos', 'did:drv:amos', TOKEN_A);
    await expect(wakes.wake('did:drv:amos', 'cv_1')).resolves.toBe(1);
    expect(book.findCar(hash)?.car.fcmToken).toBe(TOKEN_A);
    answer = 'gone';
    await expect(wakes.wake('did:drv:amos', 'cv_1')).resolves.toBe(1);
    expect(book.findCar(hash)?.car.fcmToken).toBeUndefined();
    expect(book.findCar(hash)?.car.tokenAt).toBeUndefined();
    expect(wakes.counts()).toEqual({ handed: 0, failed: 2, dropped: 1 });
  });

  it('…but a token the phone replaced meanwhile is kept: only the one Firebase answered about is dropped', async () => {
    const holder: { book?: DeviceBook; hash?: string } = {};
    const sender: CarWakeSender = {
      send: async () => {
        // The phone tells us a new token while the wake-up to the old one is on its way.
        holder.book?.updateCar(holder.hash as string, (c) => ({ ...c, fcmToken: TOKEN_B }));
        throw new CarTokenGone();
      },
    };
    const { add, book, wakes } = setUp(sender);
    holder.book = book;
    holder.hash = add('did:person:amos', 'did:drv:amos', TOKEN_A);
    await wakes.wake('did:drv:amos', 'cv_1');
    expect(book.findCar(holder.hash)?.car.fcmToken).toBe(TOKEN_B);
  });
});
