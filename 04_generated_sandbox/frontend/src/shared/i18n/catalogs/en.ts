/**
 * The BASE message catalog (English). Every key lives here; other locales are `Partial<Messages>` and fall
 * back to these strings key-by-key, so translating is additive and never blocks a release.
 *
 * Keys are namespaced dotted paths (`common.retry`). Interpolate with `{name}` placeholders — `t('x', {name})`.
 * Not `as const`: the values must be typed `string` so a translation may differ from the English literal.
 */
export const en = {
  // Shared controls the whole network reuses.
  'common.readAloud': 'Read this screen aloud',
  'common.stop': 'Stop',
  'common.retry': 'Try again',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.done': 'Done',
  'common.save': 'Save',
  'common.skip': 'Skip',
  'common.next': 'Next',
  'common.loading': 'Loading…',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.language': 'Language',
  'common.chooseLanguage': 'Choose your language',
  'common.greeting': 'Hi, {name}',

  // Account screen (a worked example of the pattern; the rest of the screens migrate incrementally).
  'account.title': 'Your account',

  // The app-update gate (shown when a new version is required).
  'update.title': 'This app needs updating',
  'update.body': 'A newer version is required before you can carry on working.',
  'update.cta': 'Update now',

  // The offline banner (shown when the network drops and stale data is on screen).
  'offline.banner': 'No signal — showing what we last knew.',
};

export type Messages = typeof en;
export type MessageKey = keyof Messages;
