import { describe, expect, it } from 'vitest';
import { nextSteps, passageNow, placeOk, type PassageForDriver } from './passage';

const onTheRoad: PassageForDriver = { crosses: true, from: 'KE', to: 'UG', posts: ['Malaba', 'Busia'] };

describe('a load at a border or a hub, from the cab (round 14)', () => {
  it('offers the border only on a load that crosses one, and the clearing only at a post', () => {
    expect(nextSteps(onTheRoad)).toEqual(['at_border', 'at_hub']);
    expect(nextSteps({ crosses: false, posts: [] })).toEqual(['at_hub']);
    expect(nextSteps({ ...onTheRoad, atPost: { post: 'Malaba', since: '2026-10-19T13:40:00.000Z' } })).toEqual(['cleared_border', 'at_hub']);
    expect(nextSteps(undefined)).toEqual([]);
  });

  it('shows a step said on this phone at once — kept for a signal or not — until the server has it', () => {
    // Said here, not yet at SeeBuyGet: at the post now, so "cleared" can follow without waiting for a signal.
    const said = passageNow(onTheRoad, { kind: 'at_border', post: 'Malaba', at: '2026-10-19T13:40:00.000Z' });
    expect(said).toMatchObject({ atPost: { post: 'Malaba', since: '2026-10-19T13:40:00.000Z' }, last: { kind: 'at_border', post: 'Malaba' } });
    expect(nextSteps(said)).toEqual(['cleared_border', 'at_hub']);
    // Cleared here: no longer at the post.
    const across = passageNow({ ...onTheRoad, atPost: { post: 'Malaba', since: '2026-10-19T13:40:00.000Z' } }, { kind: 'cleared_border', post: 'Malaba', at: '2026-10-19T16:40:00.000Z' });
    expect(across?.atPost).toBeUndefined();
    expect(across?.last).toMatchObject({ kind: 'cleared_border' });
    // The server has caught up (or knows better): its word stands.
    const server = { ...onTheRoad, last: { kind: 'at_hub' as const, hub: 'Kampala ICD', at: '2026-10-19T18:00:00.000Z' } };
    expect(passageNow(server, { kind: 'at_border', post: 'Malaba', at: '2026-10-19T13:40:00.000Z' })).toBe(server);
    expect(passageNow(undefined, { kind: 'at_hub', hub: 'x', at: '2026-10-19T13:40:00.000Z' })).toBeUndefined();
  });

  it('asks for a name a person can read', () => {
    expect(placeOk('  ')).toBe(false);
    expect(placeOk('M')).toBe(false);
    expect(placeOk(' Malaba ')).toBe(true);
  });
});
