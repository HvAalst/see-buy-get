import { render } from 'preact';
import '../../shared/tokens.css';
import { App } from './app';

/**
 * Front-door PWA entry — ships at the web ROOT.
 *
 * `tokens.css` is imported first so the token layer (and the self-hosted Inter faces it
 * pulls) is in the document before any component style; `shared/ui` brings its own sheet in
 * via its index, and `app.tsx` brings the screen layout.
 *
 * The service worker is registered from inside App() via `useRegisterSW`, not here: the
 * plugin runs in `prompt` mode with no injected registration, so an update is only ever
 * applied by an explicit tap.
 */
const host = document.getElementById('app');
if (host) render(<App />, host);
