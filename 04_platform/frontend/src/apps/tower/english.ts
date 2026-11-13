import { addEnglish, wordsOf } from '../../shared/i18n';
import { enTowerAll } from '../../shared/i18n/catalogs/en.tower';
import { enApps } from '../../shared/i18n/catalogs/en.apps';

/**
 * The console's own words, and every app's (staff read what each app says, and the help), added before anything of the
 * console is evaluated: main.tsx imports this first.
 */
addEnglish({ ...enApps, ...enTowerAll });

// 2026-11-03 — the same catalogues in the other languages, fetched only when one is chosen (shared/i18n/index.ts).
wordsOf('tower', 'tower-business', 'agent', 'goods', 'counter', 'driver', 'vehicles', 'fleet', 'site-hours', 'upkeep', 'mdp', 'vendor', 'home', 'specialisms', 'business', 'send', 'help', 'help-app', 'pages', 'front', 'privacy', 'abbr', 'refusal', 'directory', 'directory-card', 'site-tools');
