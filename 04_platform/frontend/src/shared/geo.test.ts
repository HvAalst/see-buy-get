import { describe, expect, it } from 'vitest';
import { pinAfterRename } from './geo';

describe('pinAfterRename — a pin only outlives the name it came from if a human placed it', () => {
  const pin = { lat: 7.06, lng: 38.47 };

  it('drops a LOOKED-UP pin the moment the name changes', () => {
    // The geocoded pin IS the old name: keeping it would price a haul — or match a road — to a place
    // nobody asked for, silently, because the map still shows a pin and the text still reads fine.
    expect(pinAfterRename(pin, 'name')).toBeNull();
  });

  it('keeps a HAND-DROPPED pin through a corrected spelling', () => {
    // That pin is the person's own answer about where somewhere is; a typo fix must not throw it away.
    expect(pinAfterRename(pin, 'map')).toBe(pin);
  });

  it('has nothing to drop when nothing was placed', () => {
    expect(pinAfterRename(null, null)).toBeNull();
  });
});
