import { GlosEvent } from '../../foundation/events/glos-events';
import { FiscalCodeSweeper } from './fiscal-code.sweeper';

/*
 * 2026-11-24 — A CODE ABOUT TO RUN OUT (the owner's brief, feature 2): each code due is published once and kept as told.
 */
describe('the sweep of codes about to run out', () => {
  it('publishes each code due, and keeps it as told so the next sweep does not tell it again', () => {
    const due = [{ freightId: 'frt_1', code: 'FRT-1', key: 'RO:RO123456', country: 'RO', kind: 'UIT', fiscalCode: 'RO123456', expiresAt: '2026-11-27T21:59:59.999Z', expired: false, senderDid: 'did:biz' }];
    const told: string[] = [];
    const published: Array<[string, unknown]> = [];
    const dispatch = { fiscalCodesToTell: () => due.filter((d) => !told.includes(`${d.freightId}:${d.key}`)), markFiscalTold: (id: string, key: string) => told.push(`${id}:${key}`) };
    const events = { publish: (topic: string, payload: unknown) => (published.push([topic, payload]), Promise.resolve()) };
    const sweeper = new FiscalCodeSweeper(dispatch as never, events as never);
    expect(sweeper.sweep()).toBe(1);
    expect(published).toEqual([[GlosEvent.Pudo.FiscalCodeExpiring, due[0]]]);
    expect(told).toEqual(['frt_1:RO:RO123456']);
    expect(sweeper.sweep()).toBe(0);
  });
});
