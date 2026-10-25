import { resolveBaseUrl } from '../../lib/sbg/config';

/**
 * A PHONE NUMBER'S COUNTRY CODE, CHOSEN FOR THE PERSON (the user, 2026-10-25: "use the country prefix based on
 * geolocation for UX").
 *
 * A number typed without its country code used to be read as Kenyan by the server — a Ugandan typing 0772 … was sent a
 * code to a stranger in Kenya — and every app suggested a different shape (+254…, 07…, +251 on Business). Now every
 * phone box has the country's code beside it (PhoneField), and it starts on the country the person is most likely in:
 *
 *  1. the one they chose themselves before, on this phone;
 *  2. where Cloudflare reads their internet address to be (GET /v1/sbg/visitor) — geolocation without asking the
 *     phone for its location, which would be a permission prompt on the very first screen;
 *  3. until that answers, or with no signal: the phone's own time zone, then its language's region;
 *  4. the network's home country.
 *
 * A guess, never a rule: one tap changes it, and the server still decides what a number is.
 */

/** Every country's dialling code — the server's own catalogue (backend countries/catalogue.data.ts), held equal by a test. */
const TABLE =
  'AD376 AE971 AF93 AG1268 AI1264 AL355 AM374 AO244 AR54 AS1684 AT43 AU61 AW297 AX358 AZ994 BA387 BB1246 BD880 BE32 ' +
  'BF226 BG359 BH973 BI257 BJ229 BL590 BM1441 BN673 BO591 BQ599 BR55 BS1242 BT975 BW267 BY375 BZ501 CA1 CC61 CD243 ' +
  'CF236 CG242 CH41 CI225 CK682 CL56 CM237 CN86 CO57 CR506 CU53 CV238 CW599 CX61 CY357 CZ420 DE49 DJ253 DK45 DM1767 ' +
  'DO1809 DZ213 EC593 EE372 EG20 EH212 ER291 ES34 ET251 FI358 FJ679 FK500 FM691 FO298 FR33 GA241 GB44 GD1473 GE995 ' +
  'GF594 GG44 GH233 GI350 GL299 GM220 GN224 GP590 GQ240 GR30 GT502 GU1671 GW245 GY592 HK852 HN504 HR385 HT509 HU36 ' +
  'ID62 IE353 IL972 IM44 IN91 IQ964 IR98 IS354 IT39 JE44 JM1876 JO962 JP81 KE254 KG996 KH855 KI686 KM269 KN1869 KP850 ' +
  'KR82 KW965 KY1345 KZ7 LA856 LB961 LC1758 LI423 LK94 LR231 LS266 LT370 LU352 LV371 LY218 MA212 MC377 MD373 ME382 ' +
  'MF590 MG261 MH692 MK389 ML223 MM95 MN976 MO853 MP1670 MQ596 MR222 MS1664 MT356 MU230 MV960 MW265 MX52 MY60 MZ258 ' +
  'NA264 NC687 NE227 NF672 NG234 NI505 NL31 NO47 NP977 NR674 NU683 NZ64 OM968 PA507 PE51 PF689 PG675 PH63 PK92 PL48 ' +
  'PM508 PN64 PR1787 PS970 PT351 PW680 PY595 QA974 RE262 RO40 RS381 RU7 RW250 SA966 SB677 SC248 SD249 SE46 SG65 SH290 ' +
  'SI386 SJ47 SK421 SL232 SM378 SN221 SO252 SR597 SS211 ST239 SV503 SX1721 SY963 SZ268 TC1649 TD235 TG228 TH66 TJ992 ' +
  'TK690 TL670 TM993 TN216 TO676 TR90 TT1868 TV688 TW886 TZ255 UA380 UG256 US1 UY598 UZ998 VA379 VC1784 VE58 VG1284 ' +
  'VI1340 VN84 VU678 WF681 WS685 XK383 YE967 YT262 ZA27 ZM260 ZW263';

const DIAL = new Map<string, string>(TABLE.split(' ').map((entry) => [entry.slice(0, 2), entry.slice(2)]));

/** Where the network began, and the guess when nothing else says. */
export const HOME_COUNTRY = 'KE';

/** "+254" for KE; undefined for a code the catalogue does not have. */
export function dialCodeOf(country: string): string | undefined {
  const digits = DIAL.get(country.toUpperCase());
  return digits ? `+${digits}` : undefined;
}

/** Every country there is a code for (ISO-3166 alpha-2). */
export function dialCountries(): string[] {
  return [...DIAL.keys()];
}

/**
 * The country a full number belongs to, by the longest code it starts with — "+256 772…" is Uganda. Codes several
 * countries share (+1, +7, +44…) keep `prefer` where it fits, so a Canadian number stays Canadian while it is typed.
 */
export function countryOfNumber(number: string, prefer?: string): string | undefined {
  const n = number.trim().replace(/^00/, '+');
  if (!n.startsWith('+')) return undefined;
  const d = n.slice(1).replace(/\D/g, '');
  if (!d) return undefined;
  const preferred = prefer ? DIAL.get(prefer.toUpperCase()) : undefined;
  if (prefer && preferred && d.startsWith(preferred)) return prefer.toUpperCase();
  let best: string | undefined;
  for (const [country, code] of DIAL) if (d.startsWith(code) && (!best || code.length > DIAL.get(best)!.length)) best = country;
  // A code several countries share goes to the one that holds it, not to the first in the alphabet (+1 is not Canada's).
  const holder = best ? SHARED_CODE_HOLDER[DIAL.get(best)!] : undefined;
  return holder ?? best;
}

/** Who a code shared by several countries is read as, without anything else to go by. */
const SHARED_CODE_HOLDER: Record<string, string> = { '1': 'US', '7': 'RU', '44': 'GB', '47': 'NO', '61': 'AU', '64': 'NZ', '212': 'MA', '262': 'RE', '290': 'SH', '358': 'FI', '590': 'GP', '599': 'CW' };

/** Where the national number keeps its leading 0 after the country code (Italy, San Marino, the Vatican). */
const KEEPS_ZERO = new Set(['IT', 'SM', 'VA']);

/**
 * The number the server is sent, from the country chosen and what was typed: "0772 123 456" in Uganda is
 * "+256772123456". A number typed with its own + (or 00) is taken as it is, whatever the box says; digits that already
 * begin with the country's code are not given it twice, as the server reads them. Empty while nothing is typed.
 */
export function phoneFrom(country: string, typed: string): string {
  const t = typed.trim();
  if (!t) return '';
  if (t.startsWith('+') || t.startsWith('00')) {
    const digits = t.replace(/^00/, '').replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = t.replace(/\D/g, '');
  if (!digits) return '';
  const upper = country.toUpperCase();
  const code = DIAL.get(upper);
  if (!code) return digits;
  if (digits.startsWith(code) && digits.length > code.length + 6) return `+${digits}`;
  const national = KEEPS_ZERO.has(upper) ? digits : digits.replace(/^0/, '');
  return `+${code}${national}`;
}

/** What the box shows for a number already known: the part after the country's code, as it would be typed at home. */
export function nationalOf(number: string, country: string): string {
  const upper = country.toUpperCase();
  const code = DIAL.get(upper);
  const n = number.trim();
  if (!code || !n.startsWith(`+${code}`)) return n;
  const rest = n.slice(code.length + 1);
  return KEEPS_ZERO.has(upper) || !rest ? rest : `0${rest}`;
}

/** A number as it is written at home, for the countries the network meets first; none for the rest. */
const EXAMPLE: Record<string, string> = {
  KE: '0712 345 678',
  UG: '0772 123 456',
  TZ: '0712 345 678',
  RW: '0788 123 456',
  BI: '79 12 34 56',
  ET: '091 123 4567',
  SS: '0977 123 456',
  SO: '061 234 5678',
  NG: '0803 123 4567',
  GH: '024 123 4567',
  ZA: '082 123 4567',
  NL: '06 12345678',
};
export function exampleNumber(country: string): string | undefined {
  return EXAMPLE[country.toUpperCase()];
}

/* ----------------------------------------------------------------------------------------- the guess -- */

const REMEMBERED = 'sbg-phone-country';

/** The country this phone's person chose for a number before — theirs, so it outranks every guess. */
export function rememberedCountry(): string | undefined {
  try {
    const c = globalThis.localStorage?.getItem(REMEMBERED) ?? undefined;
    return c && DIAL.has(c) ? c : undefined;
  } catch {
    return undefined;
  }
}

export function rememberCountry(country: string): void {
  try {
    if (DIAL.has(country)) globalThis.localStorage?.setItem(REMEMBERED, country);
  } catch {
    /* a phone that keeps nothing still works: it guesses again next time */
  }
}

/** A time zone that is one country's. Enough for where the network is and may go; the others fall to the language. */
const ZONE_COUNTRY: Record<string, string> = {
  'Africa/Nairobi': 'KE',
  'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Kigali': 'RW',
  'Africa/Bujumbura': 'BI',
  'Africa/Addis_Ababa': 'ET',
  'Africa/Mogadishu': 'SO',
  'Africa/Djibouti': 'DJ',
  'Africa/Asmara': 'ER',
  'Africa/Juba': 'SS',
  'Africa/Khartoum': 'SD',
  'Africa/Cairo': 'EG',
  'Africa/Kinshasa': 'CD',
  'Africa/Lubumbashi': 'CD',
  'Africa/Lusaka': 'ZM',
  'Africa/Blantyre': 'MW',
  'Africa/Maputo': 'MZ',
  'Africa/Harare': 'ZW',
  'Africa/Gaborone': 'BW',
  'Africa/Johannesburg': 'ZA',
  'Africa/Windhoek': 'NA',
  'Africa/Lagos': 'NG',
  'Africa/Accra': 'GH',
  'Africa/Abidjan': 'CI',
  'Africa/Dakar': 'SN',
  'Africa/Douala': 'CM',
  'Africa/Luanda': 'AO',
  'Africa/Casablanca': 'MA',
  'Africa/Tunis': 'TN',
  'Africa/Algiers': 'DZ',
  'Indian/Antananarivo': 'MG',
  'Indian/Mauritius': 'MU',
  'Indian/Comoro': 'KM',
  'Indian/Mahe': 'SC',
  'Asia/Dubai': 'AE',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Berlin': 'DE',
  'Europe/London': 'GB',
  'Europe/Paris': 'FR',
};

/** The phone's own say, with no signal and no question asked: its time zone, then its language's region (en-KE). */
export function deviceCountry(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && ZONE_COUNTRY[zone]) return ZONE_COUNTRY[zone];
  } catch {
    /* no time zone to read: the language may still say */
  }
  for (const tag of globalThis.navigator?.languages ?? []) {
    const region = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(tag)?.[1]?.toUpperCase();
    if (region && DIAL.has(region)) return region;
  }
  return undefined;
}

/** The country a phone box starts on before the network has answered. */
export function firstGuess(): string {
  return rememberedCountry() ?? deviceCountry() ?? HOME_COUNTRY;
}

let asked: Promise<string | undefined> | null = null;

/** Where Cloudflare reads this visitor to be — asked once a page, and nothing at all without signal. */
export function visitorCountry(): Promise<string | undefined> {
  asked ??= (async () => {
    try {
      const res = await fetch(`${resolveBaseUrl()}/v1/sbg/visitor`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { country?: string };
      return body.country && DIAL.has(body.country) ? body.country : undefined;
    } catch {
      return undefined;
    }
  })();
  return asked;
}

/** For the tests: forget the answer, as a new page would. */
export function forgetVisitorCountry(): void {
  asked = null;
}
