import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markInstalled, markedInstalled, platformOf, shouldOffer } from './install';

/*
 * THE CALL TO INSTALL, AND WHEN IT GOES (the owner, 2026-11-02: "sticky until the moment the app is installed").
 */
describe('install this app: when the call shows', () => {
  it('knows an Android phone, an iPhone and an iPad (which says it is a Mac, with a touch screen)', () => {
    expect(platformOf('Mozilla/5.0 (Linux; Android 13; TECNO CK7n) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe('android');
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.1 Safari/605.1.15', 5)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.1 Safari/605.1.15', 0)).toBe('other');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/120.0')).toBe('other');
  });

  it('calls on any phone and wherever the browser offers it; never once installed; not on a desk browser that cannot', () => {
    const base = { installed: false, marked: false, canPrompt: false };
    expect(shouldOffer({ ...base, platform: 'android' })).toBe(true);
    expect(shouldOffer({ ...base, platform: 'ios' })).toBe(true);
    expect(shouldOffer({ ...base, platform: 'other', canPrompt: true })).toBe(true);
    expect(shouldOffer({ ...base, platform: 'other' })).toBe(false);
    expect(shouldOffer({ ...base, platform: 'android', canPrompt: true, installed: true })).toBe(false);
    expect(shouldOffer({ ...base, platform: 'ios', marked: true })).toBe(false);
  });
});

describe('install this app: remembered once installed', () => {
  const was = (globalThis as { localStorage?: unknown }).localStorage;
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  });
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = was;
  });

  it('is not installed until it says so, and stays installed after', () => {
    expect(markedInstalled()).toBe(false);
    markInstalled();
    expect(markedInstalled()).toBe(true);
  });
});
