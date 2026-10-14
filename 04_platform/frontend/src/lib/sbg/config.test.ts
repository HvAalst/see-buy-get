import { afterEach, describe, expect, it } from 'vitest';
import { publicPageUrl } from './config';

/**
 * The address of a participant's public page.
 *
 * It matters that this is one function rather than a template literal at each call site: a handle that
 * is not a handle must produce NO LINK, and a door that opens somewhere unintended is worse than a name
 * with no door behind it.
 */
describe('the public page of a participant', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('is relative, because in production every app is one site', () => {
    expect(publicPageUrl('kilima-logistics')).toBe('/@kilima-logistics');
  });

  it('takes an origin when the console is on another port from the public site', () => {
    // The suite runs in node, where there is no window — so the browser global is the thing to stand up.
    (globalThis as { window?: unknown }).window = { SBG_SITE: 'http://localhost:5180/' };
    // The trailing slash of a pasted origin does not become a double slash in the path.
    expect(publicPageUrl('fedex')).toBe('http://localhost:5180/@fedex');
  });

  it('refuses anything that is not a handle we issued', () => {
    // Handles are lowercase, url-safe and minted by the directory. Everything here is somebody else's
    // string arriving where a link is about to be built out of it.
    expect(publicPageUrl('')).toBeNull();
    expect(publicPageUrl('Kilima')).toBeNull();
    expect(publicPageUrl('-leading-dash')).toBeNull();
    expect(publicPageUrl('has space')).toBeNull();
    expect(publicPageUrl('evil.com/path')).toBeNull();
    expect(publicPageUrl('javascript:alert(1)')).toBeNull();
    expect(publicPageUrl('a'.repeat(65))).toBeNull();
  });
});
