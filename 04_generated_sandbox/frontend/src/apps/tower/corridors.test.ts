import { describe, expect, it } from 'vitest';
import { EMPTY_CORRIDOR_FORM, corridorBlocker, corridorName, corridorViews, zoneOptions, type CorridorRow } from './corridors';

/**
 * The corridors screen.
 *
 * A corridor is the network's promise that a bus runs between two zones, and three different surfaces
 * read it as one: a shop deciding what it may take in, a counter building a handover manifest, and a
 * fleet manager choosing what a shift serves. So the tests here are about the ways this screen could
 * quietly break one of those — a second corridor nobody would ever reach, a route inside one zone that
 * routing will never ask for, and a blocked corridor vanishing so that "closed" and "never existed" look
 * the same.
 */

const corridor = (over: Partial<CorridorRow> = {}): CorridorRow => ({
  corridorId: 'cor_1',
  name: 'A → B',
  originZone: 'Z-A',
  destZone: 'Z-B',
  status: 'active',
  ...over,
});

const form = (over: Partial<typeof EMPTY_CORRIDOR_FORM> = {}) => ({ ...EMPTY_CORRIDOR_FORM, originZone: 'Z-A', destZone: 'Z-B', ...over });

describe('the table', () => {
  it('says how many shifts are running on each one', () => {
    // Blocking a corridor with four buses on it is a different decision from blocking an idle one, and
    // the screen has to put that number in front of the person about to press it.
    const rows = corridorViews(
      [corridor(), corridor({ corridorId: 'cor_2', originZone: 'Z-B', destZone: 'Z-C' })],
      [
        { assignmentId: 'as_1', driverDid: 'd1', corridorId: 'cor_1' },
        { assignmentId: 'as_2', driverDid: 'd2', corridorId: 'cor_1' },
        { assignmentId: 'as_3', driverDid: 'd3' }, // a shift on no corridor: local work, counted nowhere
      ],
    );
    expect(rows.map((r) => [r.corridorId, r.shifts])).toEqual([
      ['cor_1', 2],
      ['cor_2', 0],
    ]);
  });

  it('keeps blocked corridors, at the bottom', () => {
    // Hiding them would make "we have no corridor from A to B" and "we closed the one we had" look
    // identical — and there would be no way back to reopen it.
    const rows = corridorViews(
      [corridor({ corridorId: 'cor_x', originZone: 'Z-A', destZone: 'Z-B', status: 'blocked' }), corridor({ corridorId: 'cor_y', originZone: 'Z-C', destZone: 'Z-D' })],
      [],
    );
    expect(rows.map((r) => r.corridorId)).toEqual(['cor_y', 'cor_x']);
  });
});

describe('the zones offered', () => {
  it('gathers what this deployment actually knows about, once each, in order', () => {
    expect(
      zoneOptions([{ zone: 'Z-B' }, { zone: 'Z-A' }, { zone: 'Z-A' }, {}], [{ zones: ['Z-C', 'Z-A'] }], [corridor({ destZone: 'Z-D' })]),
    ).toEqual(['Z-A', 'Z-B', 'Z-C', 'Z-D']);
  });

  it('is empty rather than invented when nothing has been read', () => {
    expect(zoneOptions(null, null, null)).toEqual([]);
  });
});

describe('what stops a corridor being drawn', () => {
  it('needs both ends', () => {
    expect(corridorBlocker(form({ originZone: '' }), [])).toBe('tower.corridors.needZones');
    expect(corridorBlocker(form({ destZone: '  ' }), [])).toBe('tower.corridors.needZones');
  });

  it('refuses a corridor inside one zone', () => {
    // Routing only asks for a corridor when the parcel crosses a zone boundary, so this one could be
    // drawn and would never once be consulted.
    expect(corridorBlocker(form({ destZone: 'Z-A' }), [])).toBe('tower.corridors.sameZone');
  });

  it('refuses a second ACTIVE corridor on a pair that already has one', () => {
    // The lookup takes the first match, so the second would be a route nobody could ever reach — drawn,
    // listed, and dead.
    expect(corridorBlocker(form(), [corridor()])).toBe('tower.corridors.duplicate');
  });

  it('allows one where the existing corridor is blocked, and in the other direction', () => {
    // Replacing a closed route is the normal path; and a bus that runs A→B does not thereby run B→A.
    expect(corridorBlocker(form(), [corridor({ status: 'blocked' })])).toBeNull();
    expect(corridorBlocker(form({ originZone: 'Z-B', destZone: 'Z-A' }), [corridor()])).toBeNull();
  });

  it('says nothing about the things it does not own', () => {
    // No name, no schedule, an unheard-of zone: all allowed. The first corridor into a new zone is drawn
    // before any shop is there, and a screen that guesses at a rule it does not own refuses what the
    // network permits.
    expect(corridorBlocker(form({ originZone: 'Z-NEW', name: '', schedule: '' }), [])).toBeNull();
  });
});

describe('the name', () => {
  it('falls back to the zone pair rather than sending a blank', () => {
    expect(corridorName(form({ name: '' }))).toBe('Z-A → Z-B');
    expect(corridorName(form({ name: '  Coast express ' }))).toBe('Coast express');
  });
});
