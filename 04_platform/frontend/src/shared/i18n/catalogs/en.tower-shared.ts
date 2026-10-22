/**
 * The console's words that other apps show too — a business's places, a paper's expiry date. Kept under their tower.*
 * names, and in the catalog every app carries; the rest of the console's words are in en.tower.ts, which only the
 * console loads (apps/tower/english.ts), so no other app's code carries how the console works (2026-10-22).
 */
export const enTowerShared = {
  'tower.papers.needDate': 'A new expiry date is needed.',
  'tower.papers.datePast': 'That date has already passed — a renewed licence runs into the future.',
  'tower.settings.placesTitle': 'Your places',
  'tower.settings.placesCount': '{n} saved',
  'tower.settings.placesNone': 'None yet. You will be offered one the next time you mint a road leg.',
  'tower.settings.kindPort': 'Port',
  'tower.settings.kindDelivery': 'Delivery',
  'tower.sites.fromPin': 'A pin somebody dropped.',
  'tower.sites.fromAddress': 'From “{address}” — the middle of that place, not a gate.',
};
