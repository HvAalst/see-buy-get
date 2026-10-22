import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { TopBar } from './TopBar';
import { frontDoorUrl } from './AllAppsLink';

/*
 * THE MARK GOES HOME (the user, 2026-10-22: "can't return to homepage when I am in the browser except through the chrome
 * back arrow"). Every app's top bar, wherever it shows the mark — its first screen, sign-in included — links to the front
 * page; deeper in, the leading slot is the way back instead.
 */
describe('the mark in the top bar', () => {
  it('links to the front page, named for a screen reader', () => {
    const html = renderToString(<TopBar title="Send" />);
    expect(html).toMatch(/<a class="topbar__mark" href="\/" aria-label="SeeBuyGet front page"/);
    // In a browser tab it opens there: no new tab unless the app is installed.
    expect(html).not.toContain('target="_blank"');
  });

  it('gives way to the back arrow deeper in', () => {
    expect(renderToString(<TopBar title="Send" onBack={() => undefined} />)).not.toContain('topbar__mark');
  });

  it('finds the front door at the root, or the front door’s own server in development', () => {
    expect(frontDoorUrl(undefined, true)).toBe('/');
    expect(frontDoorUrl({ protocol: 'http:', hostname: 'localhost' }, true)).toBe('http://localhost:5180/');
    expect(frontDoorUrl({ protocol: 'https:', hostname: 'seebuyget.com' }, false)).toBe('/');
  });
});
