import { LOCALE_ENDONYMS, LOCALES, getLocale, setLocale, t, useLocale, type Locale } from '../i18n';

/**
 * The language picker — drop it in any app's Account/Settings. Each language is named in itself (an endonym),
 * so a speaker recognises their own without reading English. Choosing one flips the whole app live (and the
 * document `dir` for right-to-left), and the choice is remembered across restarts.
 */
export function LanguageSwitcher() {
  useLocale(); // re-render this control when the language changes
  const current = getLocale();
  return (
    <div class="field">
      <label class="field__label" for="langswitch">
        {t('common.language')}
      </label>
      <select id="langswitch" class="select" value={current} aria-label={t('common.chooseLanguage')} onChange={(e) => setLocale(e.currentTarget.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_ENDONYMS[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
