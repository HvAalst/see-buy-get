import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocale, useT } from '../i18n';
import { countryOfNumber, dialCodeOf, dialCountries, exampleNumber, firstGuess, nationalOf, phoneFrom, rememberCountry, rememberedCountry, visitorCountry } from '../phone/dial';

/** Every country with its code, named in the reader's language and in their order — worked out once a language. */
const listed = new Map<string, Array<{ code: string; label: string }>>();
function countryList(locale: string): Array<{ code: string; label: string }> {
  const kept = listed.get(locale);
  if (kept) return kept;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
  } catch {
    names = null;
  }
  const list = dialCountries()
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
    .map(({ code, name }) => ({ code, label: `${name} ${dialCodeOf(code)}` }));
  listed.set(locale, list);
  return list;
}

export interface PhoneFieldProps {
  /** On the number's own box, so a label's `for` and every script that types into it still find it. */
  id: string;
  /** The number as the screen keeps it: "+256772123456" once typed, or whatever it was given. */
  value: string;
  /** Told the whole number, its country's code included — never the national part alone. */
  onInput: (number: string) => void;
  disabled?: boolean;
  /** Left out, the country's own example ("0772 123 456" in Uganda) — never one country's shown in every country. */
  placeholder?: string;
  /** `tel` for a person's own number (the phone may offer it); `off` for somebody else's. */
  autoComplete?: string;
  /** The box's style: the apps' `input`, the console's `cinput`. */
  inputClass?: string;
  ariaLabel?: string;
  enterKeyHint?: 'done' | 'go' | 'next' | 'search' | 'send';
}

/**
 * A PHONE NUMBER WITH ITS COUNTRY'S CODE BESIDE IT (the user, 2026-10-25: "use the country prefix based on geolocation
 * for UX"). The code starts on the country the person is most likely in (shared/phone/dial.ts — chosen before, else
 * where Cloudflare reads them to be, else the phone's own time zone or language, else Kenya), shows short ("+256") and
 * opens the full list on a tap. The number is typed as at home — "0772 123 456" — and the screen is told the whole of
 * it, "+256772123456", so no server ever guesses which country a number is in. A number typed with its own + moves the
 * code to match.
 */
export function PhoneField({ id, value, onInput, disabled, placeholder, autoComplete = 'tel', inputClass = 'input', ariaLabel, enterKeyHint }: PhoneFieldProps) {
  const t = useT();
  const locale = useLocale();
  const [country, setCountry] = useState(() => countryOfNumber(value) ?? firstGuess());
  const [text, setText] = useState(() => nationalOf(value, countryOfNumber(value) ?? firstGuess()));
  // What this box last told the screen, so a number set from outside (a contact picked, a form cleared) is told apart.
  const told = useRef(value);
  // Once the person has typed or chosen, no later guess moves the code under them.
  const settled = useRef(Boolean(value) || Boolean(rememberedCountry()));

  useEffect(() => {
    if (value === told.current) return;
    told.current = value;
    const from = countryOfNumber(value, country);
    if (from) setCountry(from);
    setText(nationalOf(value, from ?? country));
  }, [value]);

  // Where Cloudflare reads this visitor to be: asked once a page, and taken only while nothing has been typed or chosen.
  useEffect(() => {
    let live = true;
    void visitorCountry().then((there) => {
      if (!live || !there || settled.current) return;
      setCountry(there);
    });
    return () => {
      live = false;
    };
  }, []);

  const tell = (next: string) => {
    told.current = next;
    onInput(next);
  };
  const typed = (raw: string) => {
    settled.current = true;
    setText(raw);
    // A number written whole, with its own +, says its own country: the code follows it.
    const own = countryOfNumber(raw, country);
    if (own && own !== country) setCountry(own);
    tell(phoneFrom(own ?? country, raw));
  };
  const chose = (next: string) => {
    settled.current = true;
    rememberCountry(next);
    setCountry(next);
    if (!text.trim().startsWith('+')) tell(phoneFrom(next, text));
  };

  const options = useMemo(() => countryList(locale), [locale]);
  const code = dialCodeOf(country) ?? '';

  return (
    <div class={`phonefield${inputClass.split(/\s+/).includes('cinput') ? ' phonefield--console' : ''}`}>
      {/* The number first: a label wrapping the field labels its first control, and that must be the number. The code
          is drawn before it all the same (CSS order). */}
      <input
        id={id}
        class={inputClass}
        type="tel"
        inputMode="tel"
        autocomplete={autoComplete}
        aria-label={ariaLabel}
        value={text}
        disabled={disabled}
        placeholder={placeholder ?? exampleNumber(country)}
        enterkeyhint={enterKeyHint}
        onInput={(e) => typed(e.currentTarget.value)}
      />
      <span class="phonefield__code">
        <span aria-hidden="true">{code}</span>
        <select aria-label={t('common.phone.country')} value={country} disabled={disabled} onChange={(e) => chose(e.currentTarget.value)}>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
