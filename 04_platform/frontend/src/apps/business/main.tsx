import './english';
import { render } from 'preact';
import '../../shared/tokens.css';
import { keepNoReads } from '../../shared/readcache';
import { App } from './app';
import { initI18n } from '../../shared/i18n';

/**
 * Business app entry.
 *
 * The token layer before any component style, the locale stamped onto <html> before first paint.
 *
 * 2026-11-02 — it installs now, and still keeps no copy of its data: this app shows papers and containers somebody is
 * about to act on, and a cached copy is a copy that lies. Its service worker (registered in app.tsx, as every app's is)
 * keeps only the app itself; and the read cache that answers the other apps' reads in a dead spot is turned off for this
 * page before anything is asked — see vite.config.ts, its `business` entry.
 */
keepNoReads();
const host = document.getElementById('app');
initI18n();
if (host) render(<App />, host);
