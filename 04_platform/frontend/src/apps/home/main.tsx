import './english';
import { hydrate, render } from 'preact';
import '../../shared/tokens.css';
import { App } from './app';
import { loadDirectoryPage, loadHelpPage } from './lazyScreens';
import { getLocale, initI18n, setLocale, wordsReady } from '../../shared/i18n';
import { splitLocale } from './sitePaths';

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
// 2026-11-18 — a page at /sw/…, /nl/… or /am/… is in that language: the address is the reader's choice.
const fromAddress = splitLocale(location.pathname);
if (fromAddress.locale !== 'en') setLocale(fromAddress.locale);
/*
 * The front page arrives as finished HTML (prerender.tsx), rendered in English. Where this device reads English, the
 * app takes over that markup (hydrate); in any other language it draws afresh, so nobody reads English text that
 * the app never replaces. A page with nothing prerendered in it — dev, or a deep screen — is simply rendered.
 */
function mount(el: HTMLElement): void {
  if (el.firstElementChild && getLocale() === 'en') hydrate(<App />, el);
  else {
    el.textContent = '';
    render(<App />, el);
  }
}
/*
 * A HELP PAGE BRINGS ITS OWN CODE AND WORDS FIRST — they are not in the homepage's download (lazyScreens.ts) — so the
 * page is taken over whole, never half. Until then the finished HTML is already on screen and readable.
 */
/*
 * 2026-11-18 — in another language, the finished HTML (built in that language) stays on screen until the language's words
 * have come, so the page is never drawn in English for a moment first.
 */
const start = (el: HTMLElement) => (getLocale() !== 'en' && el.firstElementChild ? void wordsReady().then(() => mount(el), () => mount(el)) : mount(el));
if (host) {
  const page = fromAddress.rest;
  if (/^\/help(\/|$)/.test(page)) void loadHelpPage().then(() => start(host), () => start(host));
  else if (/^\/directory(\/|$)/.test(page)) void loadDirectoryPage().then(() => start(host), () => start(host));
  else start(host);
}
