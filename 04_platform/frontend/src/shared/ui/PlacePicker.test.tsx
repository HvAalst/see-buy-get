import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { PlacePicker } from './PlacePicker';

/*
 * 2026-11-12 — THE MAP OPENS FULL SCREEN (the owner: "the 'Find it on the map' button should open a full screen slide up
 * sheet"): closed, the picker is the name and the button — no map squeezed under them; the button works with no name typed
 * (the map then opens where the phone is).
 */
describe('the place picker', () => {
  const picker = (label = '') =>
    renderToString(
      <PlacePicker id="p" fieldLabel="What is it called?" placeholder="e.g. the junction" mapLabel="Tap the map" findLabel="Find it on the map" label={label} pin={null} onLabel={() => undefined} onPin={() => undefined} geocode={async () => null} noteText={() => 'Type the name'} startHere />,
    );
  it('shows the name and the button, and no map until the button opens it', () => {
    const html = picker();
    expect(html).toContain('Find it on the map');
    expect(html).toContain('What is it called?');
    expect(html).not.toContain('pmap');
    expect(html).not.toContain('sheet--full');
  });
  it('lets the button be pressed with no name typed', () => {
    expect(picker()).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]*>)*\s*Find it on the map/);
  });
});
