import { describe, expect, it } from 'vitest';
import { EMPTY_LINE, lineBlocker, lineZones, ownLines, usableCorridors } from './logic';
import type { CorridorRow } from './types';

const row = (over: Partial<CorridorRow> = {}): CorridorRow => ({ corridorId: 'cor_1', name: 'A → B', originZone: 'Z-A', destZone: 'Z-B', status: 'active', ...over });
const mine = { kind: 'fleet' as const, managerDid: 'did:fleet:a', company: 'Alpha' };
const theirs = { kind: 'fleet' as const, managerDid: 'did:fleet:b', company: 'Beta' };

describe('F1 — a fleet’s own lines', () => {
  it('offers a shift only published corridors that are the network’s or ours', () => {
    const list = [
      row({ corridorId: 'net' }),
      row({ corridorId: 'mine', owner: mine }),
      row({ corridorId: 'theirs', owner: theirs }),
      row({ corridorId: 'waiting', owner: mine, status: 'proposed' }),
      row({ corridorId: 'closed', status: 'blocked' }),
    ];
    expect(usableCorridors(list, 'did:fleet:a').map((c) => c.corridorId)).toEqual(['net', 'mine']);
  });

  it('lists this fleet’s own lines, the ones waiting for the network first', () => {
    const list = [row({ corridorId: 'live', owner: mine }), row({ corridorId: 'net' }), row({ corridorId: 'waiting', owner: mine, status: 'proposed', originZone: 'Z-Z' })];
    expect(ownLines(list, 'did:fleet:a').map((c) => c.corridorId)).toEqual(['waiting', 'live']);
    expect(ownLines(list, undefined)).toEqual([]);
  });

  it('says why a line cannot be proposed before the server has to', () => {
    expect(lineBlocker(EMPTY_LINE, [])).toBe('fleet.lines.needZones');
    expect(lineBlocker({ ...EMPTY_LINE, originZone: 'Z-A', destZone: 'Z-A' }, [])).toBe('fleet.lines.sameZone');
    expect(lineBlocker({ ...EMPTY_LINE, originZone: 'Z-A', destZone: 'Z-B' }, [row({ status: 'proposed', owner: mine })])).toBe('fleet.lines.duplicate');
    // A closed corridor is not in the way — replacing it is the normal path.
    expect(lineBlocker({ ...EMPTY_LINE, originZone: 'Z-A', destZone: 'Z-B' }, [row({ status: 'blocked' })])).toBeNull();
  });

  it('suggests every zone it can see, once each', () => {
    expect(lineZones([row(), row({ originZone: 'Z-B', destZone: 'Z-C' })])).toEqual(['Z-A', 'Z-B', 'Z-C']);
  });
});
