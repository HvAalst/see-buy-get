import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * 2026-11-02 — THE HUB'S BELL. What the network tells a hub (a colleague at the counter turning its fingerprint unlock
 * off, a notice for its floor) had nowhere to show: the Hub app was the one app with no bell, while its install guide
 * asked to allow notifications. And the Send app, which has no shared account menu, keeps the install guide too.
 */
describe('every installed app keeps its notices and its guide', () => {
  it('rings the hub’s own bell in its top bar', () => {
    expect(readFileSync('src/apps/mdp/api.ts', 'utf8')).toMatch(/notifications: createNotificationsApi\(client\.sbg\)/);
    expect(readFileSync('src/apps/mdp/useMdpApp.ts', 'utf8')).toMatch(/notifications: client\?\.notifications \?\? null/);
    expect(readFileSync('src/apps/mdp/app.tsx', 'utf8')).toMatch(/<NotificationBell api=\{notifications\} \/>/);
  });

  it('keeps the install guide in the Send app’s own account screen', () => {
    expect(readFileSync('src/apps/genesis/screens/AccountScreen.tsx', 'utf8')).toMatch(/<InstallGuideSheet open=\{guideOpen\} onClose=\{\(\) => setGuideOpen\(false\)\} app="send" \/>/);
  });
});
