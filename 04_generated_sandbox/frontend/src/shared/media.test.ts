import { describe, expect, it } from 'vitest';
import { dataUrlBytes, fitWithin } from './media';

describe('media capture math (S26)', () => {
  it('fitWithin never upscales and preserves aspect ratio when shrinking', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ w: 800, h: 600 }); // already within → untouched
    expect(fitWithin(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 }); // landscape → longest side capped
    expect(fitWithin(3000, 4000, 1280)).toEqual({ w: 960, h: 1280 }); // portrait
    expect(fitWithin(2560, 2560, 96)).toEqual({ w: 96, h: 96 }); // square thumbnail
    expect(fitWithin(0, 0, 1280)).toEqual({ w: 0, h: 0 }); // degenerate input is safe
  });

  it('dataUrlBytes estimates the decoded size of a base64 data URL', () => {
    // "AAAA" → 3 bytes; the +2 padding case decodes to fewer.
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('not-a-data-url')).toBe(0);
  });
});
