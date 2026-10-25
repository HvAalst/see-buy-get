/**
 * EVERY APP'S OWN ENGLISH, TOGETHER — for the console, which shows a little of every app, for the tests, and the type.
 *
 * The catalog every app carries (en.ts) is the shared core: common words and accounts. Each app adds its own words
 * before it draws anything, through its english.ts, and only its own (the user, 2026-10-23: "the loading time of the
 * homepage should be short for a low quality phone with poor connection"). A few words two apps show alike are in a
 * catalog of their own, which each of those apps adds (en.goods.ts, en.counter.ts, en.vehicles.ts, en.site-hours.ts,
 * en.specialisms.ts; the console's in en.tower-business.ts). The help's words come when a help page or sheet opens.
 * After a build, scripts/check-words.mjs refuses an app that names a word it does not carry.
 */
import { enAgent } from './en.agent';
import { enDriver } from './en.driver';
import { enFleet } from './en.fleet';
import { enUpkeep } from './en.upkeep';
import { enMdp } from './en.mdp';
import { enVendor } from './en.vendor';
import { enHome } from './en.home';
import { enBusiness } from './en.business';
import { enSend } from './en.send';
import { enHelp } from './en.help';
import { enHelpApp } from './en.help-app';
import { enPages } from './en.pages';
import { enFront } from './en.front';
import { enPrivacy } from './en.privacy';

export const enApps = {
  ...enAgent,
  ...enDriver,
  ...enFleet,
  ...enUpkeep,
  ...enMdp,
  ...enVendor,
  ...enHome,
  ...enBusiness,
  ...enSend,
  ...enHelp,
  ...enHelpApp,
  ...enPages,
  ...enFront,
  ...enPrivacy,
};
