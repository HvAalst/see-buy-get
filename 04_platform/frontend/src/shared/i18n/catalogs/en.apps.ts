/**
 * EVERY APP'S OWN ENGLISH, TOGETHER — for the apps that carry it all, and the type.
 *
 * The catalog every app carries (en.ts) is the shared core: common words, accounts, sending. Each app adds its own words
 * before it draws anything, through its english.ts, as the console always has (the user, 2026-10-23: "the loading time
 * of the homepage should be short for a low quality phone with poor connection"). The front door adds only its own
 * (apps/home/english.ts) and the help's words when a help page or a help sheet needs them; the other apps add this.
 */
import { enAgent } from './en.agent';
import { enDriver } from './en.driver';
import { enFleet } from './en.fleet';
import { enMdp } from './en.mdp';
import { enVendor } from './en.vendor';
import { enHome } from './en.home';
import { enBusiness } from './en.business';
import { enHelp } from './en.help';
import { enPages } from './en.pages';
import { enFront } from './en.front';
import { enPrivacy } from './en.privacy';

export const enApps = {
  ...enAgent,
  ...enDriver,
  ...enFleet,
  ...enMdp,
  ...enVendor,
  ...enHome,
  ...enBusiness,
  ...enHelp,
  ...enPages,
  ...enFront,
  ...enPrivacy,
};
