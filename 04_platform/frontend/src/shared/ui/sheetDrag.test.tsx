import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { FLICK, MIN_FLICK, SLOP, pullOf, releaseOf, velocityOf } from './sheetDrag';
import { NavScreen } from './NavScreen';
import { Sheet } from './Sheet';

/*
 * 2026-11-02 — A SHEET PULLED DOWN, A SCREEN THAT ARRIVES (the owner: "make it as native as today can be").
 */

describe('pulling a sheet down', () => {
  it('a finger still within the slop is not yet a pull; down is; up and sideways are the sheet’s own scroll', () => {
    expect(pullOf(2, 3, true)).toBe('wait');
    expect(pullOf(0, SLOP + 2, true)).toBe('pull');
    expect(pullOf(0, -(SLOP + 2), true)).toBe('leave');
    expect(pullOf(SLOP + 10, SLOP + 2, true)).toBe('leave');
  });

  it('never pulls a sheet whose content is not at its top (unless by its handle — the caller says so)', () => {
    expect(pullOf(0, 40, false)).toBe('leave');
  });

  it('let go past a third of its height, it closes; short of it, it springs back', () => {
    expect(releaseOf(201, 600, 0)).toBe('close');
    expect(releaseOf(199, 600, 0)).toBe('stay');
  });

  it('a flick closes from a short pull; a tremble does not', () => {
    expect(releaseOf(MIN_FLICK + 6, 600, FLICK + 0.3)).toBe('close');
    expect(releaseOf(MIN_FLICK - 4, 600, FLICK + 0.3)).toBe('stay');
    expect(releaseOf(MIN_FLICK + 6, 600, FLICK - 0.3)).toBe('stay');
  });

  it('measures speed over the last tenth of a second, so a pause before letting go is not a flick', () => {
    expect(velocityOf([{ t: 0, y: 0 }])).toBe(0);
    expect(velocityOf([{ t: 0, y: 0 }, { t: 50, y: 50 }, { t: 100, y: 100 }])).toBeCloseTo(1);
    // Fast early, then held still for 300 ms: the release is at rest.
    expect(velocityOf([{ t: 0, y: 0 }, { t: 50, y: 200 }, { t: 350, y: 200 }])).toBeCloseTo(0);
  });
});

describe('the sheet, with Back and the pull added', () => {
  it('draws as it did: the backdrop, the dialog, its handle, its title', () => {
    const html = renderToString(
      <Sheet open onClose={() => undefined} title="End your shift?">
        <p>Body</p>
      </Sheet>,
    );
    expect(html).toContain('class="sheet__backdrop"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('class="sheet__grab"');
    expect(html).toContain('End your shift?');
  });
});

describe('a screen arriving', () => {
  it('comes in from the right going forward, from the left going back, and just appears otherwise', () => {
    expect(renderToString(<NavScreen nav={{ seq: 2, slide: 'push' }}>x</NavScreen>)).toBe('<div class="navscreen navscreen--push">x</div>');
    expect(renderToString(<NavScreen nav={{ seq: 3, slide: 'pop' }}>x</NavScreen>)).toBe('<div class="navscreen navscreen--pop">x</div>');
    expect(renderToString(<NavScreen nav={{ seq: 0, slide: 'none' }}>x</NavScreen>)).toBe('<div class="navscreen">x</div>');
  });
});
