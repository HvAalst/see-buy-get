import { describe, expect, it } from 'vitest';
import { recordContractFor, takeContractAsk } from './contractAsk';

/** A contract asked for, carried from the fleet's bell to its contract form — once (2026-10-30). */
describe('a contract asked for, from the bell to the form', () => {
  it('is taken once, then gone', () => {
    expect(takeContractAsk()).toBeNull();
    recordContractFor({ entityId: 'ent_savanna', name: 'Savanna Freight Forwarders' });
    expect(takeContractAsk()).toEqual({ entityId: 'ent_savanna', name: 'Savanna Freight Forwarders' });
    expect(takeContractAsk()).toBeNull();
  });
});
