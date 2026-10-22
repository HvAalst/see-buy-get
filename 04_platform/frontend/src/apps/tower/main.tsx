// First: the console's own words, which no other app carries — before any module that may read one is evaluated.
import './english';
import { render } from 'preact';
import '../../shared/tokens.css';
import { App } from './app';
import { initI18n } from '../../shared/i18n';

/**
 * Operator console entry.
 *
 * Same first two lines as every other app — the token layer before any component style, the locale
 * adopted and stamped onto <html> before first paint — and then deliberately NOTHING about a service
 * worker. This app does not install and does not register one: an operator acts on a queue, and a
 * cached queue is a queue that lies. Its update path is the browser's own reload.
 */
const host = document.getElementById('app');
initI18n();
if (host) render(<App />, host);
