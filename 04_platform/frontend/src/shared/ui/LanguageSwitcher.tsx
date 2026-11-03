import { useState } from 'preact/hooks';
import { LOCALE_ENDONYMS, getLocale, localesOfCountry, localesWithWords, setLocale, t, useLocale, type Locale } from '../i18n';
import { firstGuess } from '../phone/dial';
import { Choice } from './Choice';

/**
 * The language picker — in every app's Settings (shared/account/SettingsSheet.tsx). Each language is named in itself (an
 * endonym), so a speaker recognises their own without reading English. Only the languages with words written in are
 * offered, and of those first the ones that count in the person's country (2026-11-03, the owner: "the language would
 * require a little digging for the nations where it is actually not applicable"): the rest wait under "Other languages".
 * Choosing one fetches its words and flips the whole app live; the choice is remembered. Chips, never the phone's own list.
 */
export function LanguageSwitcher() {
  useLocale(); // re-render this control when the language changes
  const [all, setAll] = useState(false);
  const current = getLocale();
  const written = localesWithWords();
  const here = localesOfCountry(firstGuess());
  const near = written.filter((l) => here.includes(l) || l === current);
  const far = written.filter((l) => !near.includes(l));
  const offered = all ? written : near;
  if (written.length < 2) return null;
  return (
    <div class="field">
      {offered.length > 1 ? (
        <Choice id="langswitch" label={t('common.language')} value={current} options={offered.map((l) => ({ value: l, label: LOCALE_ENDONYMS[l] }))} onChange={(l) => setLocale(l as Locale)} />
      ) : (
        <p class="field__label">{t('common.language')}</p>
      )}
      {far.length && !all ? (
        <button type="button" class="linkbtn" onClick={() => setAll(true)}>
          {t('common.otherLanguages')}
        </button>
      ) : null}
    </div>
  );
}
