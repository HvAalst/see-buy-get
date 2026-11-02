import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { spaceLines, spaceProblem } from './logic';
import { HubSpaceCard } from './screens/HubSpaceCard';
import type { HubSpaceView, MdpView } from './types';

/*
 * 2026-11-02 — A HUB'S FLOOR AGAINST ITS SPACE, on its start screen (the owner: "shouldn't a hub also declare its space?" —
 * "18 of 40 bag places free · 600 parcels a day"). What is held to here: the places free of its places and its day's
 * sorting; the parcels sorted today of that; over full in red, with every bag still taken; full; the day full; a hub that
 * never said asked to, never told it is full; the owner's Change, and its people told whose it is.
 */
const space = (over: Partial<HubSpaceView> = {}): HubSpaceView => ({
  mdpId: 'mdp_1',
  name: 'Central Sort',
  declared: true,
  bagPlaces: 40,
  sortPerDay: 600,
  inbound: 12,
  outbound: 10,
  onFloor: 22,
  free: 18,
  comingIn: 0,
  waiting: 0,
  sortedToday: 120,
  day: '2026-11-02',
  floorFull: false,
  dayFull: false,
  noRoom: false,
  ...over,
});
const hub = (s: HubSpaceView | undefined): MdpView => ({ mdpId: 'mdp_1', did: 'did:hub', name: 'Central Sort', zones: ['Z'], pricePerParcel: 0.5, vetting: { state: 'approved' }, space: s });
const card = (s: HubSpaceView | undefined, staff = false) => renderToString(<HubSpaceCard sbg={null} hub={hub(s)} staff={staff} onSaved={() => undefined} />);

describe('the floor at a glance', () => {
  it('says the places free of its places and its day, and what was sorted today', () => {
    const lines = spaceLines(space(), t)!;
    expect(lines.headline).toBe('18 of 40 bag places free · 600 parcels a day');
    expect(lines.sorted).toBe('Sorted today: 120 of 600');
    expect(lines).toMatchObject({ note: null, tone: 'ok', pill: null });
    // One place, one parcel: the plural said right.
    expect(spaceLines(space({ bagPlaces: 1, free: 1, onFloor: 0, sortPerDay: 1 }), t)!.headline).toBe('1 of 1 bag place free · 1 parcel a day');
  });

  it('over full is red, and says every bag is still taken; full and the day full are warnings; bags waiting elsewhere are said', () => {
    const over = spaceLines(space({ onFloor: 42, free: 0, overBy: 2, floorFull: true, noRoom: true }), t)!;
    expect(over).toMatchObject({ tone: 'danger', pill: 'Over full' });
    expect(over.note).toContain('Over full: 42 bags on 40 places. Every bag a driver brings is still taken.');
    const full = spaceLines(space({ onFloor: 40, free: 0, floorFull: true, noRoom: true, waiting: 3 }), t)!;
    expect(full).toMatchObject({ tone: 'warn', pill: 'Full' });
    expect(full.note).toContain('Your floor is full.');
    expect(full.note).toContain('3 bags wait elsewhere for room here');
    expect(spaceLines(space({ sortedToday: 600, dayFull: true }), t)).toMatchObject({ tone: 'warn', pill: 'Day full', note: expect.stringContaining('what is not sorted today is sorted tomorrow') });
    expect(spaceLines(space({ waiting: 1 }), t)).toMatchObject({ tone: 'info', note: expect.stringContaining('1 bag waits elsewhere') });
  });

  it('asks a hub that never said, and never calls it full', () => {
    const lines = spaceLines(space({ declared: false, bagPlaces: undefined, sortPerDay: undefined, free: undefined }), t)!;
    expect(lines).toMatchObject({ headline: 'Your space is not set yet', tone: 'warn', pill: null, sorted: null });
    expect(lines.note).toContain('Until you do, bags keep coming to you');
    expect(spaceLines(undefined, t)).toBeNull();
  });

  it('takes a whole number inside the server’s bounds, and says which is wrong', () => {
    expect(spaceProblem('40', '600')).toBeNull();
    expect(spaceProblem('0', '600')).toBe('mdp.space.badPlaces');
    expect(spaceProblem('1.5', '600')).toBe('mdp.space.badPlaces');
    expect(spaceProblem('10001', '600')).toBe('mdp.space.badPlaces');
    expect(spaceProblem('40', '')).toBe('mdp.space.badPerDay');
    expect(spaceProblem('40', '1000001')).toBe('mdp.space.badPerDay');
  });
});

describe('the card on the start screen', () => {
  it('shows the owner the floor, what was sorted today and Change', () => {
    const html = card(space());
    expect(html).toContain('Your floor');
    expect(html).toContain('18 of 40 bag places free · 600 parcels a day');
    expect(html).toContain('Sorted today: 120 of 600');
    expect(html).toContain('On the floor: 12 bags to sort, 10 bags going out');
    expect(html).toContain('>Change<');
    expect(html).not.toContain('The hub’s owner sets these.');
  });

  it('shows its people the same, and whose it is to change', () => {
    const html = card(space({ onFloor: 41, free: 0, overBy: 1, floorFull: true, noRoom: true }), true);
    expect(html).toContain('Over full');
    expect(html).toContain('note--danger');
    expect(html).toContain('The hub’s owner sets these.');
    expect(html).not.toContain('>Change<');
  });

  it('asks the owner of a hub that never said to set it', () => {
    const html = card(space({ declared: false, bagPlaces: undefined, sortPerDay: undefined, free: undefined }));
    expect(html).toContain('Your space is not set yet');
    expect(html).toContain('Set your space');
    expect(html).not.toContain('Sorted today');
    // Read before hubs had a space: nothing drawn rather than a guess.
    expect(card(undefined)).toBe('');
  });
});
