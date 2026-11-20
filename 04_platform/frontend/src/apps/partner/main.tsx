import './english';
import { render } from 'preact';
import '../../shared/tokens.css';
import { keepNoReads } from '../../shared/readcache';
import { App } from './app';
import { initI18n } from '../../shared/i18n';

/**
 * Partner app entry (2026-11-20, the payments plan, 3c).
 *
 * The token layer before any component style, the locale stamped onto <html> before first paint. It installs, and keeps no
 * copy of its figures: what a partner owes changes with every step, and a cached copy is a copy that lies. Its service worker
 * keeps only the app itself; the read cache the other apps answer a dead spot with is turned off before anything is asked.
 */
keepNoReads();
const host = document.getElementById('app');
initI18n();
if (host) render(<App />, host);
