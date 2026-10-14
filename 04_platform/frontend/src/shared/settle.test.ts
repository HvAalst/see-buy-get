import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { settleWords } from './settle';

/**
 * The sentence three apps say about money this network never touches.
 *
 * The gap it closes was NOT a missing invoice — board freight is priced by us and books a payable at
 * delivery because the shipper paid us; a departure is the fleet's own price agreed directly. The gap was
 * that nobody said so, and a shipper who reads a price on our screens and nothing about settlement
 * assumes we are handling it.
 */
describe('how a shipper pays a carrier directly', () => {
  it('says who, how and when in one sentence', () => {
    expect(settleWords({ method: 'mobile_money', when: 'on_delivery' }, t)).toBe('You pay them by mobile money, when it is delivered.');
    expect(settleWords({ method: 'cash', when: 'on_pickup' }, t)).toBe('You pay them in cash, when they collect.');
  });

  it('says the fleet has NOT said, rather than leaving a blank line', () => {
    // Silence here reads as "the network is handling it", which is the one thing that is certainly not
    // happening — so absence gets a sentence of its own.
    expect(settleWords(undefined, t)).toContain('have not said');
  });

  it('treats a value it does not recognise as nothing said', () => {
    // A method from a newer server, or a corrupted record: better an honest "ask them" than a blank or
    // a raw enum leaking onto a shopkeeper's screen.
    expect(settleWords({ method: 'bitcoin', when: 'on_delivery' }, t)).toContain('have not said');
    expect(settleWords({ method: 'cash', when: 'whenever' }, t)).toContain('have not said');
  });
});
