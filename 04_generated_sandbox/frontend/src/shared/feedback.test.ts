import { afterEach, describe, expect, it, vi } from 'vitest';
import { beep, buzz, onFlash, primeAudio, signal, toneFor, vibrationFor, type Signal } from './feedback';

describe('tone + vibration specs', () => {
  it('ok is a single high note; error is a low two-note sequence', () => {
    expect(toneFor('ok')).toHaveLength(1);
    expect(toneFor('ok')[0].freq).toBeGreaterThan(toneFor('warn')[0].freq);
    const err = toneFor('error');
    expect(err).toHaveLength(2);
    expect(err[0].freq).toBeGreaterThan(err[1].freq); // falls, like a human "uh-uh"
    expect(err[0].gap).toBeGreaterThan(0); // a real gap between the two
  });

  it('every tone sits in the honest phone-speaker band', () => {
    for (const s of ['ok', 'warn', 'error'] as Signal[]) {
      for (const t of toneFor(s)) {
        expect(t.freq).toBeGreaterThanOrEqual(200);
        expect(t.freq).toBeLessThanOrEqual(1000);
        expect(t.ms).toBeGreaterThan(0);
      }
    }
  });

  it('vibration patterns escalate: ok short, error long and doubled', () => {
    expect(vibrationFor('ok')).toEqual([45]);
    expect(vibrationFor('error').length).toBeGreaterThan(vibrationFor('ok').length);
    expect(Math.max(...vibrationFor('error'))).toBeGreaterThan(Math.max(...vibrationFor('ok')));
  });
});

describe('flash pub/sub', () => {
  it('delivers the signal to every subscriber and unsubscribes cleanly', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onFlash(a);
    const offB = onFlash(b);
    signal('ok');
    expect(a).toHaveBeenCalledWith('ok');
    expect(b).toHaveBeenCalledWith('ok');
    offA();
    signal('error');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenLastCalledWith('error');
    offB();
  });

  it('one throwing subscriber never stops the others, and signal never throws', () => {
    const bad = onFlash(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offGood = onFlash(good);
    expect(() => signal('warn')).not.toThrow();
    expect(good).toHaveBeenCalledWith('warn');
    bad();
    offGood();
  });
});

describe('emitters degrade in a headless environment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('beep and primeAudio no-op without WebAudio, never throwing', () => {
    expect(() => beep('ok')).not.toThrow();
    expect(() => primeAudio()).not.toThrow();
  });

  it('buzz forwards the pattern when navigator.vibrate exists, and is silent otherwise', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    buzz('error');
    expect(vibrate).toHaveBeenCalledWith([120, 70, 120]);

    vi.stubGlobal('navigator', {});
    expect(() => buzz('ok')).not.toThrow();
  });
});
