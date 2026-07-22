import { render } from 'preact';
import '../../shared/tokens.css';
import { App } from './app';

/**
 * Driver PWA entry.
 *
 * `tokens.css` is imported first so the token layer (and the self-hosted Inter faces it
 * pulls) is in the document before any component style; `shared/ui` brings its own sheet in
 * via its index, and `app.tsx` brings the screen layout.
 *
 * The service worker is registered from inside App() via `useRegisterSW`, not here: the
 * plugin runs in `prompt` mode with no injected registration, so the update is only ever
 * applied by an explicit tap. A driver mid-shift never gets the ground moved under them.
 */
const host = document.getElementById('app');
if (host) render(<App />, host);
