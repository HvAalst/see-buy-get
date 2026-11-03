import { LOCALE_ENDONYMS, getLocale, localesWithWords, setLocale, t, useLocale, type Locale } from '../i18n';
import { Choice } from './Choice';

/**
 * The language picker — in every app's Settings (shared/account/SettingsSheet.tsx). Each language is named in itself (an
 * endonym), so a speaker recognises their own without reading English. Only the languages with words written in are
 * offered (2026-11-03: English and Kiswahili first); choosing one fetches its words and flips the whole app live (and the
 * document `dir` for right-to-left), and the choice is remembered across restarts. Chips, never the phone's own list.
 */
export function LanguageSwitcher() {
  useLocale(); // re-render this control when the language changes
  const offered = localesWithWords();
  if (offered.length < 2) return null;
  return (
    <div class="field">
      <Choice
        id="langswitch"
        label={t('common.language')}
        value={getLocale()}
        options={offered.map((l) => ({ value: l, label: LOCALE_ENDONYMS[l] }))}
        onChange={(l) => setLocale(l as Locale)}
      />
    </div>
  );
}
