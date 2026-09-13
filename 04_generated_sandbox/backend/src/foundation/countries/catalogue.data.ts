/**
 * Every ISO-3166 country, as data. One line each: code | currency | dialling code | driving side | languages.
 *
 * Kept as compact lines rather than 250 objects so a person can read the whole world on a few screens and spot a
 * wrong currency. Names are not stored — they come from the platform's own region names, in the reader's language.
 * Where a country uses a currency it does not issue (EUR, USD, XOF, XAF…), that is the currency listed.
 *
 * Left out on purpose: the seven uninhabited ISO codes (AQ BV GS HM IO TF UM) — nobody lives there to ship from.
 * Added: Kosovo (XK), which has no ISO code of its own but is a real place goods cross into.
 */
export const COUNTRY_LINES = `
AD|EUR|376|R|ca
AE|AED|971|R|ar
AF|AFN|93|R|ps,fa
AG|XCD|1268|L|en
AI|XCD|1264|L|en
AL|ALL|355|R|sq
AM|AMD|374|R|hy
AO|AOA|244|R|pt
AR|ARS|54|R|es
AS|USD|1684|R|en,sm
AT|EUR|43|R|de
AU|AUD|61|L|en
AW|AWG|297|R|nl,pap
AX|EUR|358|R|sv
AZ|AZN|994|R|az
BA|BAM|387|R|bs,hr,sr
BB|BBD|1246|L|en
BD|BDT|880|L|bn
BE|EUR|32|R|nl,fr,de
BF|XOF|226|R|fr
BG|BGN|359|R|bg
BH|BHD|973|R|ar
BI|BIF|257|R|rn,fr,en
BJ|XOF|229|R|fr
BL|EUR|590|R|fr
BM|BMD|1441|L|en
BN|BND|673|L|ms
BO|BOB|591|R|es,qu,ay
BQ|USD|599|R|nl
BR|BRL|55|R|pt
BS|BSD|1242|L|en
BT|BTN|975|L|dz
BW|BWP|267|L|en,tn
BY|BYN|375|R|be,ru
BZ|BZD|501|R|en
CA|CAD|1|R|en,fr
CC|AUD|61|L|en
CD|CDF|243|R|fr
CF|XAF|236|R|fr,sg
CG|XAF|242|R|fr
CH|CHF|41|R|de,fr,it,rm
CI|XOF|225|R|fr
CK|NZD|682|L|en
CL|CLP|56|R|es
CM|XAF|237|R|fr,en
CN|CNY|86|R|zh
CO|COP|57|R|es
CR|CRC|506|R|es
CU|CUP|53|R|es
CV|CVE|238|R|pt
CW|ANG|599|R|nl,pap
CX|AUD|61|L|en
CY|EUR|357|L|el,tr
CZ|CZK|420|R|cs
DE|EUR|49|R|de
DJ|DJF|253|R|fr,ar
DK|DKK|45|R|da
DM|XCD|1767|L|en
DO|DOP|1809|R|es
DZ|DZD|213|R|ar
EC|USD|593|R|es
EE|EUR|372|R|et
EG|EGP|20|R|ar
EH|MAD|212|R|ar
ER|ERN|291|R|ti,ar,en
ES|EUR|34|R|es
ET|ETB|251|R|am
FI|EUR|358|R|fi,sv
FJ|FJD|679|L|en,fj
FK|FKP|500|L|en
FM|USD|691|R|en
FO|DKK|298|R|fo
FR|EUR|33|R|fr
GA|XAF|241|R|fr
GB|GBP|44|L|en
GD|XCD|1473|L|en
GE|GEL|995|R|ka
GF|EUR|594|R|fr
GG|GBP|44|L|en
GH|GHS|233|R|en
GI|GIP|350|R|en
GL|DKK|299|R|kl
GM|GMD|220|R|en
GN|GNF|224|R|fr
GP|EUR|590|R|fr
GQ|XAF|240|R|es,fr
GR|EUR|30|R|el
GT|GTQ|502|R|es
GU|USD|1671|R|en
GW|XOF|245|R|pt
GY|GYD|592|L|en
HK|HKD|852|L|zh,en
HN|HNL|504|R|es
HR|EUR|385|R|hr
HT|HTG|509|R|fr,ht
HU|HUF|36|R|hu
ID|IDR|62|L|id
IE|EUR|353|L|en,ga
IL|ILS|972|R|he
IM|GBP|44|L|en
IN|INR|91|L|hi,en
IQ|IQD|964|R|ar,ku
IR|IRR|98|R|fa
IS|ISK|354|R|is
IT|EUR|39|R|it
JE|GBP|44|L|en
JM|JMD|1876|L|en
JO|JOD|962|R|ar
JP|JPY|81|L|ja
KE|KES|254|L|sw,en
KG|KGS|996|R|ky,ru
KH|KHR|855|R|km
KI|AUD|686|L|en
KM|KMF|269|R|ar,fr
KN|XCD|1869|L|en
KP|KPW|850|R|ko
KR|KRW|82|R|ko
KW|KWD|965|R|ar
KY|KYD|1345|L|en
KZ|KZT|7|R|kk,ru
LA|LAK|856|R|lo
LB|LBP|961|R|ar
LC|XCD|1758|L|en
LI|CHF|423|R|de
LK|LKR|94|L|si,ta
LR|LRD|231|R|en
LS|LSL|266|L|en,st
LT|EUR|370|R|lt
LU|EUR|352|R|lb,fr,de
LV|EUR|371|R|lv
LY|LYD|218|R|ar
MA|MAD|212|R|ar
MC|EUR|377|R|fr
MD|MDL|373|R|ro
ME|EUR|382|R|sr
MF|EUR|590|R|fr
MG|MGA|261|R|mg,fr
MH|USD|692|R|en
MK|MKD|389|R|mk
ML|XOF|223|R|fr
MM|MMK|95|R|my
MN|MNT|976|R|mn
MO|MOP|853|L|zh,pt
MP|USD|1670|R|en
MQ|EUR|596|R|fr
MR|MRU|222|R|ar
MS|XCD|1664|L|en
MT|EUR|356|L|mt,en
MU|MUR|230|L|en,fr
MV|MVR|960|L|dv
MW|MWK|265|L|en,ny
MX|MXN|52|R|es
MY|MYR|60|L|ms
MZ|MZN|258|L|pt
NA|NAD|264|L|en
NC|XPF|687|R|fr
NE|XOF|227|R|fr
NF|AUD|672|L|en
NG|NGN|234|R|en
NI|NIO|505|R|es
NL|EUR|31|R|nl
NO|NOK|47|R|no
NP|NPR|977|L|ne
NR|AUD|674|L|en,na
NU|NZD|683|L|en
NZ|NZD|64|L|en,mi
OM|OMR|968|R|ar
PA|PAB|507|R|es
PE|PEN|51|R|es
PF|XPF|689|R|fr
PG|PGK|675|L|en,tpi
PH|PHP|63|R|fil,en
PK|PKR|92|L|ur,en
PL|PLN|48|R|pl
PM|EUR|508|R|fr
PN|NZD|64|L|en
PR|USD|1787|R|es,en
PS|ILS|970|R|ar
PT|EUR|351|R|pt
PW|USD|680|R|en
PY|PYG|595|R|es,gn
QA|QAR|974|R|ar
RE|EUR|262|R|fr
RO|RON|40|R|ro
RS|RSD|381|R|sr
RU|RUB|7|R|ru
RW|RWF|250|R|rw,en,fr,sw
SA|SAR|966|R|ar
SB|SBD|677|L|en
SC|SCR|248|L|en,fr
SD|SDG|249|R|ar,en
SE|SEK|46|R|sv
SG|SGD|65|L|en,ms,zh,ta
SH|SHP|290|L|en
SI|EUR|386|R|sl
SJ|NOK|47|R|no
SK|EUR|421|R|sk
SL|SLE|232|R|en
SM|EUR|378|R|it
SN|XOF|221|R|fr
SO|SOS|252|R|so,ar
SR|SRD|597|L|nl
SS|SSP|211|R|en
ST|STN|239|R|pt
SV|USD|503|R|es
SX|ANG|1721|R|nl,en
SY|SYP|963|R|ar
SZ|SZL|268|L|en,ss
TC|USD|1649|L|en
TD|XAF|235|R|fr,ar
TG|XOF|228|R|fr
TH|THB|66|L|th
TJ|TJS|992|R|tg
TK|NZD|690|L|en
TL|USD|670|L|pt,tet
TM|TMT|993|R|tk
TN|TND|216|R|ar
TO|TOP|676|L|to,en
TR|TRY|90|R|tr
TT|TTD|1868|L|en
TV|AUD|688|L|en
TW|TWD|886|R|zh
TZ|TZS|255|L|sw,en
UA|UAH|380|R|uk
UG|UGX|256|L|en,sw
US|USD|1|R|en
UY|UYU|598|R|es
UZ|UZS|998|R|uz
VA|EUR|379|R|it,la
VC|XCD|1784|L|en
VE|VES|58|R|es
VG|USD|1284|L|en
VI|USD|1340|L|en
VN|VND|84|R|vi
VU|VUV|678|R|bi,en,fr
WF|XPF|681|R|fr
WS|WST|685|L|sm,en
XK|EUR|383|R|sq,sr
YE|YER|967|R|ar
YT|EUR|262|R|fr
ZA|ZAR|27|L|en,af,zu,xh
ZM|ZMW|260|L|en
ZW|USD|263|L|en,sn,nd
`;

/** Countries whose addresses carry no postal code in everyday use — the form must not demand one. */
export const NO_POSTAL_CODE = new Set(
  'AE AG AO AW BF BI BJ BO BS BW BZ CD CF CG CI CK CM DJ DM ER FJ GA GD GH GM GQ GY HK JM KI KM KN KP LY ML MR MW NR NU QA RW SB SC SL SO SR SS ST SY TD TG TK TL TO TT TV UG VU YE ZW'.split(' '),
);

/** The identity documents vetting accepts, where a country's differ from passport / national ID / driving licence. */
export const ID_DOCUMENTS: Record<string, string[]> = {
  KE: ['national_id', 'passport', 'alien_id', 'driving_licence'],
  ET: ['fayda_id', 'kebele_id', 'passport', 'driving_licence'],
  TZ: ['nida_id', 'passport', 'voter_id', 'driving_licence'],
  UG: ['national_id', 'passport', 'driving_licence'],
  RW: ['national_id', 'passport', 'driving_licence'],
  ZM: ['nrc', 'passport', 'driving_licence'],
  DE: ['personalausweis', 'passport', 'residence_permit'],
  NL: ['id_card', 'passport', 'driving_licence', 'residence_permit'],
  GB: ['passport', 'driving_licence', 'biometric_residence_permit'],
  US: ['passport', 'driving_licence', 'state_id'],
};

export const DEFAULT_ID_DOCUMENTS = ['passport', 'national_id', 'driving_licence'];

/**
 * CA8 — what a country requires of anybody operating a company there, beyond incorporation and tax. Checklist items
 * on activation: a company of ours or a partner is not ready until each is registered and its paper verified.
 * Where a country's specifics are not recorded here, the one obligation every country now has stands.
 */
export interface LocalObligation {
  key: string;
  name: string;
  authority?: string;
}

export const DEFAULT_OBLIGATIONS: LocalObligation[] = [{ key: 'data_protection_registration', name: 'Registration with the data-protection regulator' }];

export const OBLIGATIONS: Record<string, LocalObligation[]> = {
  KE: [
    { key: 'e_invoicing', name: 'eTIMS electronic tax invoicing', authority: 'Kenya Revenue Authority' },
    { key: 'data_protection_registration', name: 'Registration as a data controller and processor', authority: 'Office of the Data Protection Commissioner' },
  ],
  TZ: [
    { key: 'e_invoicing', name: 'Electronic fiscal device (EFD/VFD) receipting', authority: 'Tanzania Revenue Authority' },
    { key: 'data_protection_registration', name: 'Registration as a data controller', authority: 'Personal Data Protection Commission' },
  ],
  UG: [
    { key: 'e_invoicing', name: 'EFRIS electronic invoicing', authority: 'Uganda Revenue Authority' },
    { key: 'data_protection_registration', name: 'Registration as a data collector and processor', authority: 'Personal Data Protection Office' },
  ],
  RW: [
    { key: 'e_invoicing', name: 'Electronic billing machine (EBM) invoicing', authority: 'Rwanda Revenue Authority' },
    { key: 'data_protection_registration', name: 'Registration as a data controller', authority: 'National Cyber Security Authority' },
  ],
  ZM: [
    { key: 'e_invoicing', name: 'Smart Invoice electronic invoicing', authority: 'Zambia Revenue Authority' },
    { key: 'data_protection_registration', name: 'Registration as a data controller', authority: 'Office of the Data Protection Commissioner' },
  ],
  ET: [
    { key: 'e_invoicing', name: 'Sales registration machine and electronic invoicing', authority: 'Ministry of Revenues' },
    { key: 'data_protection_registration', name: 'Registration as a data controller', authority: 'Ethiopian Communications Authority' },
  ],
  DE: [
    { key: 'e_invoicing', name: 'E-Rechnung — receiving and issuing structured invoices (XRechnung / ZUGFeRD)' },
    { key: 'data_protection_registration', name: 'Data protection officer notified to the supervisory authority' },
  ],
  GB: [{ key: 'data_protection_registration', name: 'Data protection fee and registration', authority: 'Information Commissioner’s Office' }],
};
