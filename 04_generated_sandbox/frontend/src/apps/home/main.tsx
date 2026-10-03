import { hydrate, render } from 'preact';
import '../../shared/tokens.css';
import { App } from './app';
import { getLocale, initI18n } from '../../shared/i18n';

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
initI18n(); // adopt the saved/device language + stamp <html lang/dir> before first paint
/*
 * The front page arrives as finished HTML (prerender.tsx), rendered in English. Where this device reads English, the
 * app takes over that markup (hydrate); in any other language it draws afresh, so nobody reads English text that
 * the app never replaces. A page with nothing prerendered in it — dev, or a deep screen — is simply rendered.
 */
if (host) {
  if (host.firstElementChild && getLocale() === 'en') hydrate(<App />, host);
  else {
    host.textContent = '';
    render(<App />, host);
  }
}
