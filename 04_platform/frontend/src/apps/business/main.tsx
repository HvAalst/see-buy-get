import './english';
import { render } from 'preact';
import '../../shared/tokens.css';
import { App } from './app';
import { initI18n } from '../../shared/i18n';

/**
 * Business app entry.
 *
 * The token layer before any component style, the locale stamped onto <html> before first paint — and no service
 * worker, for the console's reason: this app shows papers and containers somebody is about to act on, and a cached
 * copy is a copy that lies. Its update path is the browser's own reload.
 */
const host = document.getElementById('app');
initI18n();
if (host) render(<App />, host);
