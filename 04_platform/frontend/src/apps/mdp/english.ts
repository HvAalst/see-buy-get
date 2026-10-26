import { addEnglish, helpWordsAlso } from '../../shared/i18n';
import { enMdp } from '../../shared/i18n/catalogs/en.mdp';
import { enCounter } from '../../shared/i18n/catalogs/en.counter';
import { enSiteHours } from '../../shared/i18n/catalogs/en.site-hours';

/**
 * The Hub app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words, the
 * counter staff's, whose screens it shares with the Shop app, and a site's days and hours as every app says them (when
 * it receives stores' parcels in bulk) — not the other apps' own — so its first download
 * stays light on a slow connection (the user, 2026-10-23). The help's words come when its Help opens, the articles
 * about working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enMdp, ...enCounter, ...enSiteHours });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));
