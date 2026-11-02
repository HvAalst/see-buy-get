import { CarMessagesService } from './car-messages.service';
import { DeviceBook, type KnownDevice } from './person-devices';
import { carKeyHashOf, newCarKey, type DeviceCarKey } from './car-keys';

/*
 * 2026-11-02 — WHO A CAR DOOR IS SPEAKING TO, AND WHAT IT READS (the owner: "we start with 2"). Over stubs: the device
 * book is the real one; the person and the chat are what the service asks of them. The doors themselves, over the wire:
 * test/car-messages.e2e-spec.ts.
 */
const T0 = Date.parse('2026-11-02T08:00:00Z');

function setUp() {
  const book = new DeviceBook(new Map<string, KnownDevice>());
  const people: Record<string, { personDid: string; closedAt?: string; roles: Array<{ role: string; entityDid: string; status: string }> }> = {
    'did:person:amos': { personDid: 'did:person:amos', roles: [{ role: 'driver', entityDid: 'did:drv:amos', status: 'active' }] },
  };
  const persons = {
    findCarKey: (hash: string, now?: number) => book.findCar(hash, now),
    updateCarKey: (hash: string, change: (c: DeviceCarKey) => DeviceCarKey, now?: number) => book.updateCar(hash, change, now),
    findByDid: (did: string) => people[did],
  };
  const unreadFor = jest.fn((conversationId: string, did: string) => {
    if (conversationId !== 'cv_1' || did !== 'did:drv:amos') throw new Error('Conversation not found');
    return {
      thread: { conversationId: 'cv_1', freightCode: 'FRT-7781', freightLabel: 'Roses · Nairobi → Nakuru', lastSeq: 3, blocked: false, blockedByMe: false },
      items: [
        { seq: 2, kind: 'text', body: 'Gate 3', at: '2026-11-02T08:01:00Z' },
        { seq: 3, kind: 'voice', voice: { voiceId: 'vn_1', durationSec: 9 }, at: '2026-11-02T08:02:00Z' },
      ],
    };
  });
  const service = new CarMessagesService(persons as never, { unreadFor } as never);
  const keyFor = (personDid = 'did:person:amos', driverDid = 'did:drv:amos', lang = 'en') => {
    const device = book.add(personDid, T0);
    const key = newCarKey();
    book.setCar(personDid, device, { keyHash: carKeyHashOf(key), driverDid, addedAt: new Date(T0).toISOString(), lang }, T0);
    return key;
  };
  return { book, people, service, keyFor };
}

describe('who a car door is speaking to', () => {
  it('a car key of ours, in the Car scheme, for a person who still holds that driver record', () => {
    const { service, keyFor } = setUp();
    const key = keyFor();
    expect(service.resolve(`Car ${key}`, T0)).toEqual({ personDid: 'did:person:amos', driverDid: 'did:drv:amos', keyHash: carKeyHashOf(key), lang: 'en' });
  });

  it('nothing else: no header, a sign-in, a key nobody has — one answer, with nothing to tell them apart', () => {
    const { service, keyFor } = setUp();
    const key = keyFor();
    for (const header of [undefined, `Bearer ${key}`, key, 'Car dvc_123']) expect(() => service.resolve(header, T0)).toThrow(/takes the car key of the SeeBuyGet Driver app/);
    expect(() => service.resolve(`Car ${newCarKey()}`, T0)).toThrow(/not one of ours, or it was turned off/);
  });

  it('a person who no longer holds the driver record it was made for — or whose account is closed — opens nothing', () => {
    const { service, keyFor, people } = setUp();
    const key = keyFor();
    people['did:person:amos'].roles = [{ role: 'driver', entityDid: 'did:drv:amos', status: 'suspended' }];
    expect(() => service.resolve(`Car ${key}`, T0)).toThrow(/not one of ours, or it was turned off/);
    people['did:person:amos'].roles = [{ role: 'driver', entityDid: 'did:drv:other', status: 'active' }];
    expect(() => service.resolve(`Car ${key}`, T0)).toThrow(/not one of ours/);
    people['did:person:amos'].roles = [{ role: 'driver', entityDid: 'did:drv:amos', status: 'active' }];
    people['did:person:amos'].closedAt = new Date(T0).toISOString();
    expect(() => service.resolve(`Car ${key}`, T0)).toThrow(/not one of ours/);
  });

  it('writes down the day it was used, once a day — and that day does not keep the phone known', () => {
    const { service, keyFor, book } = setUp();
    const key = keyFor();
    service.resolve(`Car ${key}`, T0);
    expect(book.findCar(carKeyHashOf(key), T0)?.car.usedAt).toBe(new Date(T0).toISOString());
    service.resolve(`Car ${key}`, T0 + 60_000);
    expect(book.findCar(carKeyHashOf(key), T0)?.car.usedAt).toBe(new Date(T0).toISOString());
  });
});

describe('what the car reads', () => {
  it('titled by the load, from the poster as the chat names them, each line what to say — never a voice message’s audio', () => {
    const { service, keyFor } = setUp();
    const caller = service.resolve(`Car ${keyFor()}`, T0);
    expect(service.unread(caller, 'cv_1')).toEqual({
      conversationId: 'cv_1',
      title: 'FRT-7781 · Roses · Nairobi → Nakuru',
      code: 'FRT-7781',
      label: 'Roses · Nairobi → Nakuru',
      from: 'The poster',
      lang: 'en',
      unread: 2,
      lastSeq: 3,
      canReply: true,
      messages: [
        { seq: 2, from: 'The poster', text: 'Gate 3', kind: 'text', at: '2026-11-02T08:01:00Z' },
        { seq: 3, from: 'The poster', text: 'A voice message: open the app when you stop.', kind: 'voice', at: '2026-11-02T08:02:00Z' },
      ],
    });
    expect(JSON.stringify(service.unread(caller, 'cv_1'))).not.toContain('vn_1');
    expect(() => service.unread(caller, 'cv_other')).toThrow(/Conversation not found/);
  });
});
