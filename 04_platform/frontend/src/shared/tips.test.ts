import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hiddenCount, hide, isHidden, restoreAll, subscribe } from './tips';

/** A stand-in for the phone's storage, so the real one is never touched by a test run. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const GRACE = 'did:glos:grace';
const AMOS = 'did:glos:amos';

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

describe('what a person has finished reading', () => {
  it('shows everything until somebody puts it away, then keeps it away', () => {
    expect(isHidden(GRACE, 'driver.route.how')).toBe(false);
    hide(GRACE, 'driver.route.how');
    expect(isHidden(GRACE, 'driver.route.how')).toBe(true);
    // Only that one — dismissing a tip is not dismissing the app's teaching wholesale.
    expect(isHidden(GRACE, 'driver.board.how')).toBe(false);
  });

  it('is SCOPED TO THE PERSON, because a fleet phone has more than one driver on it', () => {
    hide(GRACE, 'driver.shift.what');
    // The second driver has learned nothing yet, and the first one's reading is not their reading.
    expect(isHidden(AMOS, 'driver.shift.what')).toBe(false);
    expect(hiddenCount(AMOS)).toBe(0);
  });

  it('brings every one of them back — the way out of a mis-tap', () => {
    hide(GRACE, 'driver.route.how');
    hide(GRACE, 'driver.board.how');
    expect(hiddenCount(GRACE)).toBe(2);
    restoreAll(GRACE);
    expect(hiddenCount(GRACE)).toBe(0);
    expect(isHidden(GRACE, 'driver.route.how')).toBe(false);
  });

  it('restores ONLY that person — one driver tidying up does not undo the other’s', () => {
    hide(GRACE, 'driver.route.how');
    hide(AMOS, 'driver.route.how');
    restoreAll(GRACE);
    expect(isHidden(AMOS, 'driver.route.how')).toBe(true);
  });

  it('counts a tip once however many times it is dismissed', () => {
    hide(GRACE, 'driver.route.how');
    hide(GRACE, 'driver.route.how');
    expect(hiddenCount(GRACE)).toBe(1);
  });

  it('tells the screen, so the restore in the foot reaches the explainers at the top', () => {
    const heard = vi.fn();
    const stop = subscribe(heard);
    hide(GRACE, 'driver.board.reach');
    expect(heard).toHaveBeenCalledTimes(1);
    restoreAll(GRACE);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    hide(GRACE, 'driver.route.how');
    expect(heard).toHaveBeenCalledTimes(2); // unsubscribed, and not leaking
  });

  it('SHOWS THE TIP when storage is unreachable, rather than losing it', () => {
    // A private window or blocked site data. A tip that will not go away is a nuisance; a person who
    // cannot read how the app works is stuck, so this fails towards showing.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(isHidden(GRACE, 'driver.route.how')).toBe(false);
    expect(() => hide(GRACE, 'driver.route.how')).not.toThrow();
    expect(isHidden(GRACE, 'driver.route.how')).toBe(false);
    expect(hiddenCount(GRACE)).toBe(0);
  });

  it('shows everything again if the stored list is corrupt', () => {
    localStorage.setItem('sbg.tips.v1:' + GRACE, 'not json at all');
    expect(isHidden(GRACE, 'driver.route.how')).toBe(false);
    // And it recovers: the next dismissal writes a clean list rather than appending to rubbish.
    hide(GRACE, 'driver.route.how');
    expect(isHidden(GRACE, 'driver.route.how')).toBe(true);
    expect(hiddenCount(GRACE)).toBe(1);
  });

  it('keeps a signed-out reader in their own bucket rather than failing', () => {
    hide(null, 'driver.route.how');
    expect(isHidden(null, 'driver.route.how')).toBe(true);
    expect(isHidden(GRACE, 'driver.route.how')).toBe(false);
  });
});
