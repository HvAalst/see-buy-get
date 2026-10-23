import { addEnglish, helpWordsAlso } from '../../shared/i18n';
import { enMdp } from '../../shared/i18n/catalogs/en.mdp';
import { enCounter } from '../../shared/i18n/catalogs/en.counter';

/**
 * The Hub app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words, and
 * the counter staff's, whose screens it shares with the Shop app — not the other apps' own — so its first download
 * stays light on a slow connection (the user, 2026-10-23). The help's words come when its Help opens, the articles
 * about working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enMdp, ...enCounter });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));
