import { EventBus } from './event-bus.service';
import { EventEnvelope } from './event.types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxAttempts: 3, backoffMs: () => 0 });
  });

  it('delivers a published event to subscribers', async () => {
    const received: EventEnvelope[] = [];
    bus.subscribe('shipment.created', (e) => {
      received.push(e);
    });

    const envelope = await bus.publish('shipment.created', { glosId: 'SHIP-1' }, { source: 'm2' });

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ glosId: 'SHIP-1' });
    expect(received[0].traceId).toBe(envelope.traceId);
    expect(received[0].attempt).toBe(1);
  });

  it('unsubscribe stops further delivery', async () => {
    let count = 0;
    const off = bus.subscribe('x', () => {
      count += 1;
    });
    await bus.publish('x', {});
    off();
    await bus.publish('x', {});
    expect(count).toBe(1);
  });

  it('retries a failing handler then succeeds (at-least-once)', async () => {
    let attempts = 0;
    bus.subscribe('flaky', () => {
      attempts += 1;
      if (attempts < 2) throw new Error('transient');
    });

    await bus.publish('flaky', {});

    expect(attempts).toBe(2);
    expect(bus.getDeadLetters()).toHaveLength(0);
  });

  it('dead-letters a handler that always fails, without blocking others', async () => {
    let goodCalls = 0;
    bus.subscribe('order', () => {
      throw new Error('always fails');
    });
    bus.subscribe('order', () => {
      goodCalls += 1;
    });

    await bus.publish('order', { id: 1 });

    expect(goodCalls).toBe(1); // the healthy subscriber still got it
    const dead = bus.getDeadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0].envelope.type).toBe('order');
    expect(dead[0].error).toContain('always fails');
  });

  it('propagates the traceId across a cascade automatically', async () => {
    // Handler of A publishes B WITHOUT specifying a traceId — it should inherit A's.
    bus.subscribe('a', async () => {
      await bus.publish('b', {});
    });
    let bTrace: string | undefined;
    bus.subscribe('b', (e) => {
      bTrace = e.traceId;
    });

    const a = await bus.publish('a', {});

    expect(bTrace).toBe(a.traceId);
  });

  it('records every event in the log', async () => {
    await bus.publish('one', {});
    await bus.publish('two', {});
    expect(bus.getLog().map((e) => e.type)).toEqual(['one', 'two']);
  });
});
