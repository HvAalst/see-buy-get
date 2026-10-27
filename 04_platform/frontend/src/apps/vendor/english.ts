import { addEnglish, helpWordsAlso } from '../../shared/i18n';
import { enSiteHours } from '../../shared/i18n/catalogs/en.site-hours';
import { enVendor } from '../../shared/i18n/catalogs/en.vendor';
import { enAbbr } from '../../shared/i18n/catalogs/en.abbr';
import { enRefusal } from '../../shared/i18n/catalogs/en.refusal';

/**
 * The Store app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words, and a
 * site's days and hours as every app says them (when a hub receives) — not the other apps' own, so its first download
 * stays light on a slow connection (the user, 2026-10-23). The help's words
 * come when its Help opens, the articles about working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enVendor, ...enSiteHours, ...enAbbr, ...enRefusal });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));
