import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'preact-render-to-string';
import { Sections, maySwipe, swipeTo } from './Sections';

/*
 * A LONG RECORD IN SECTIONS, SWIPED THROUGH (the owner, 2026-11-02: "some fields are pretty data heavy like historical
 * freight … we don't want to mush scrolling. In that case a sticky but swipable subheader could appear and the content
 * could also be navigated with swiping").
 */
describe('sections swiped through', () => {
  const keys = ['overview', 'road', 'papers'];

  it('moves one section along the swipe — left for the next, right for the one before — and stops at the ends', () => {
    expect(swipeTo(0, keys, -90)).toBe(1);
    expect(swipeTo(1, keys, 90)).toBe(0);
    expect(swipeTo(2, keys, -90)).toBe(2);
    expect(swipeTo(0, keys, 90)).toBe(0);
    // A small move is not a swipe.
    expect(swipeTo(1, keys, -20)).toBe(1);
  });

  it('leaves a swipe from the screen’s edge to the phone’s Back, and one on a map, a field or a sideways row alone', () => {
    expect(maySwipe({ x: 200, width: 390, onOwnGesture: false })).toBe(true);
    expect(maySwipe({ x: 10, width: 390, onOwnGesture: false })).toBe(false);
    expect(maySwipe({ x: 380, width: 390, onOwnGesture: false })).toBe(false);
    expect(maySwipe({ x: 200, width: 390, onOwnGesture: true })).toBe(false);
  });

  it('names every section in a pinned row of tabs, shows the first, keeps the rest mounted, and marks what waits', () => {
    const html = renderToString(
      <Sections
        label="This load, in parts"
        sections={[
          { key: 'overview', label: 'Overview', attention: true, content: <p>Facts</p> },
          { key: 'papers', label: 'Papers', count: 3, content: <p>Invoice</p> },
        ]}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="This load, in parts"');
    expect(html).toMatch(/<button[^>]*aria-selected="true"[^>]*>Overview<span class="secs__dot"/);
    expect(html).toMatch(/aria-selected="false"[^>]*>Papers<span class="secs__count">3<\/span>/);
    // Both panes are there — the second hidden, its content kept.
    expect(html).toMatch(/data-sec="papers" class="secs__pane" hidden(="")?><p>Invoice<\/p>/);
    expect(html).not.toMatch(/data-sec="overview"[^>]*hidden/);
  });

  it('is how a business reads a load’s whole record: overview, the road, papers, payment, a claim', () => {
    const src = readFileSync('src/apps/business/screens/LoadsScreen.tsx', 'utf8');
    const keys = [...src.matchAll(/key: '(\w+)',\r?\n\s*label: t\('business\.loads\.sec\.\1'\)/g)].map((m) => m[1]);
    expect(keys).toEqual(['overview', 'road', 'papers', 'money', 'claim']);
    // What waits for the business's answer is in the first section.
    const overview = src.slice(src.indexOf("key: 'overview'"), src.indexOf("key: 'road'"));
    for (const waits of ['<LoadRefusal', '<LoadPaidAnswer', "proposals.some((p) => p.status === 'open')", 'row.canCancel']) expect(overview).toContain(waits);
    // Its tab carries a dot while offers wait for an answer; the road's while the cold chain is broken.
    expect(overview).toMatch(/attention: Boolean\(proposals\?\.some\(\(p\) => p\.status === 'open'\)\)/);
    expect(src.slice(src.indexOf("key: 'road'"), src.indexOf("key: 'papers'"))).toMatch(/attention: Boolean\(row\.coldChainBroken\)/);
  });
});
