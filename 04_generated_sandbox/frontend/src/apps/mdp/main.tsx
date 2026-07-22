import { render } from 'preact';
import '../../shared/tokens.css';

/**
 * MDP (Hub) PWA entry — PLACEHOLDER SHELL.
 *
 * NOTE the split identity, on purpose: the app id (source folder, SBG_APP, deploy base
 * `/mdp/`) is `mdp` — the merchant distribution point of the legacy pages — but the thing
 * the user installs is "Hub". Anything user-visible — manifest, title, install prompt —
 * says Hub.
 *
 * This file exists so the app is a real, installable build target (own base, own manifest,
 * own service worker). It renders a holding screen and nothing else; the screens, API
 * wiring and update prompt are written in the app slice that follows.
 *
 * Two things the replacement must keep:
 *  - `tokens.css` imported FIRST, so the token layer (and the self-hosted Inter faces it
 *    pulls) is in the document before any component style;
 *  - the service worker registered from inside the app with `useRegisterSW`, never here —
 *    the plugin runs in `prompt` mode with no injected registration, so an update is only
 *    ever applied by an explicit tap.
 */
const host = document.getElementById('app');
if (host) {
  render(
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeContent: 'center',
        gap: '10px',
        padding: '24px',
        textAlign: 'center',
        background: 'var(--appbg)',
        fontFamily: 'var(--font)',
      }}
    >
      <h1 style={{ fontSize: '24px', fontWeight: 800, lineHeight: 1.2, color: 'var(--navy)' }}>
        SeeBuyGet Hub
      </h1>
      <p style={{ fontSize: '16px', lineHeight: 1.5, color: 'var(--tx2)' }}>
        App shell only — screens land in the next slice.
      </p>
    </main>,
    host,
  );
}
