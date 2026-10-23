// Every app's words for the tests: each app's own and the console's, which in a running app each app adds for itself
// (its english.ts).
import { addEnglish } from './shared/i18n';
import { enTowerAll } from './shared/i18n/catalogs/en.tower';
import { enApps } from './shared/i18n/catalogs/en.apps';

addEnglish({ ...enApps, ...enTowerAll });
