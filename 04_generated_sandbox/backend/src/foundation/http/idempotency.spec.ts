import { IdempotencyService } from './idempotency.service';

/**
 * Do this once, however many times you are asked.
 *
 * The property under test is not "it caches" — it is that a caller who cannot tell a lost response from a
 * failed request has exactly one safe thing to do, and doing it is free.
 */
describe('idempotency', () => {
  let idem: IdempotencyService;
  beforeEach(() => {
    idem = new IdempotencyService();
  });

  const body = { to: 'Kisumu', weightKg: 2 };

  it('runs once and replays the FIRST answer', async () => {
    let runs = 0;
    const work = () => ({ id: `ship_${++runs}` });

    const first = await idem.run('v1', 'key-1', body, work);
    const second = await idem.run('v1', 'key-1', body, work);

    expect(first).toEqual({ result: { id: 'ship_1' }, replayed: false });
    expect(second).toEqual({ result: { id: 'ship_1' }, replayed: true }); // the same shipment, not a second
    expect(runs).toBe(1);
  });

  it('does not care what order the request was written in', async () => {
    // `{a,b}` and `{b,a}` are the same request; a client library that reorders keys must not look like a
    // client changing its mind.
    await idem.run('v1', 'key-1', { a: 1, b: 2 }, () => 'first');
    const again = await idem.run('v1', 'key-1', { b: 2, a: 1 }, () => 'second');
    expect(again).toEqual({ result: 'first', replayed: true });
  });

  it('refuses the same name for a DIFFERENT request', async () => {
    // The caller's own bookkeeping has gone wrong — two shipments sharing one name. Quietly returning the
    // first would ship the wrong parcel and report success. Louder is kinder.
    await idem.run('v1', 'key-1', body, () => 'first');
    await expect(idem.run('v1', 'key-1', { ...body, weightKg: 9 }, () => 'second')).rejects.toThrow(/already used for a different request/);
  });

  it('refuses a name that is still in flight rather than running it twice', async () => {
    // The window between "started" and "finished" is exactly where a double-click lands.
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    const inFlight = idem.run('v1', 'key-1', body, async () => {
      await slow;
      return 'done';
    });

    await expect(idem.run('v1', 'key-1', body, () => 'jumped the queue')).rejects.toThrow(/still in progress/);
    release();
    expect(await inFlight).toEqual({ result: 'done', replayed: false });
  });

  it('releases the name when the work FAILED', async () => {
    // The caller could not have known the request was doomed. Forcing a fresh id to retry a fixable error
    // — a top-up that had not landed yet — turns a recoverable problem into a lost order.
    await expect(idem.run('v1', 'key-1', body, () => { throw new Error('balance too low'); })).rejects.toThrow('balance too low');
    const retry = await idem.run('v1', 'key-1', body, () => 'worked this time');
    expect(retry).toEqual({ result: 'worked this time', replayed: false });
  });

  it('keeps two merchants apart', async () => {
    // Two of them choosing the same uuid is unlikely and must still be harmless.
    await idem.run('v1', 'shared-name', body, () => 'theirs');
    expect(await idem.run('v2', 'shared-name', body, () => 'mine')).toEqual({ result: 'mine', replayed: false });
  });

  it('leaves a caller who does not use it with ordinary behaviour', async () => {
    // Idempotency is the CALLER's tool. Requiring the header would push the burden onto the many callers
    // who retry nothing in order to protect the few who do.
    let runs = 0;
    await idem.run('v1', undefined, body, () => ++runs);
    await idem.run('v1', '   ', body, () => ++runs);
    expect(runs).toBe(2);
  });

  it('forgets a spent name once it has aged out', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-26T10:00:00Z') });
    try {
      const fresh = new IdempotencyService();
      await fresh.run('v1', 'key-1', body, () => 'first');
      jest.setSystemTime(new Date('2026-08-27T11:00:00Z')); // 25 hours later
      expect(await fresh.run('v1', 'key-1', body, () => 'second')).toEqual({ result: 'second', replayed: false });
    } finally {
      jest.useRealTimers();
    }
  });
});
