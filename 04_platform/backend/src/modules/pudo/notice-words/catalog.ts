/*
 * 2026-11-26 — THE NOTICE CATALOGUE: every phrase a notice is said in (say.ts), English and each language beside it, one file
 * for each part of the system in each language. A phrase is in every language in the same commit (notice-words.spec.ts).
 */
import { EN_BELL } from './en/bell';
import { EN_DISPATCHER_A } from './en/dispatcher-a';
import { EN_DISPATCHER_B } from './en/dispatcher-b';
import { EN_SERVICES_A } from './en/services-a';
import { EN_SERVICES_B } from './en/services-b';
import { EN_SERVICES_C } from './en/services-c';
import { EN_SERVICES_D } from './en/services-d';
import { EN_SAFETY } from './en/safety';
import { EN_DETAILS } from './en/details';
import { EN_MAIL_ACCOUNT } from './en/mail-account';
import { EN_MAIL_STAFF } from './en/mail-staff';
import { EN_MAIL_COMPANIES } from './en/mail-companies';
import { EN_MAIL_GOODS } from './en/mail-goods';
import { SW_BELL } from './sw/bell';
import { SW_DISPATCHER_A } from './sw/dispatcher-a';
import { SW_DISPATCHER_B } from './sw/dispatcher-b';
import { SW_SERVICES_A } from './sw/services-a';
import { SW_SERVICES_B } from './sw/services-b';
import { SW_SERVICES_C } from './sw/services-c';
import { SW_SERVICES_D } from './sw/services-d';
import { SW_SAFETY } from './sw/safety';
import { SW_DETAILS } from './sw/details';
import { SW_MAIL_ACCOUNT } from './sw/mail-account';
import { SW_MAIL_STAFF } from './sw/mail-staff';
import { SW_MAIL_COMPANIES } from './sw/mail-companies';
import { SW_MAIL_GOODS } from './sw/mail-goods';
import { NL_BELL } from './nl/bell';
import { NL_DISPATCHER_A } from './nl/dispatcher-a';
import { NL_DISPATCHER_B } from './nl/dispatcher-b';
import { NL_SERVICES_A } from './nl/services-a';
import { NL_SERVICES_B } from './nl/services-b';
import { NL_SERVICES_C } from './nl/services-c';
import { NL_SERVICES_D } from './nl/services-d';
import { NL_SAFETY } from './nl/safety';
import { NL_DETAILS } from './nl/details';
import { NL_MAIL_ACCOUNT } from './nl/mail-account';
import { NL_MAIL_STAFF } from './nl/mail-staff';
import { NL_MAIL_COMPANIES } from './nl/mail-companies';
import { NL_MAIL_GOODS } from './nl/mail-goods';
import { AM_BELL } from './am/bell';
import { AM_DISPATCHER_A } from './am/dispatcher-a';
import { AM_DISPATCHER_B } from './am/dispatcher-b';
import { AM_SERVICES_A } from './am/services-a';
import { AM_SERVICES_B } from './am/services-b';
import { AM_SERVICES_C } from './am/services-c';
import { AM_SERVICES_D } from './am/services-d';
import { AM_SAFETY } from './am/safety';
import { AM_DETAILS } from './am/details';
import { AM_MAIL_ACCOUNT } from './am/mail-account';
import { AM_MAIL_STAFF } from './am/mail-staff';
import { AM_MAIL_COMPANIES } from './am/mail-companies';
import { AM_MAIL_GOODS } from './am/mail-goods';
import { BG_BELL } from './bg/bell';
import { BG_DISPATCHER_A } from './bg/dispatcher-a';
import { BG_DISPATCHER_B } from './bg/dispatcher-b';
import { BG_SERVICES_A } from './bg/services-a';
import { BG_SERVICES_B } from './bg/services-b';
import { BG_SERVICES_C } from './bg/services-c';
import { BG_SERVICES_D } from './bg/services-d';
import { BG_SAFETY } from './bg/safety';
import { BG_DETAILS } from './bg/details';
import { BG_MAIL_ACCOUNT } from './bg/mail-account';
import { BG_MAIL_STAFF } from './bg/mail-staff';
import { BG_MAIL_COMPANIES } from './bg/mail-companies';
import { BG_MAIL_GOODS } from './bg/mail-goods';

/** Each part's English, by its file: a key is in one part only. */
export const NOTICE_AREAS = {
  'bell': EN_BELL,
  'dispatcher-a': EN_DISPATCHER_A,
  'dispatcher-b': EN_DISPATCHER_B,
  'services-a': EN_SERVICES_A,
  'services-b': EN_SERVICES_B,
  'services-c': EN_SERVICES_C,
  'services-d': EN_SERVICES_D,
  'safety': EN_SAFETY,
  'details': EN_DETAILS,
  'mail-account': EN_MAIL_ACCOUNT,
  'mail-staff': EN_MAIL_STAFF,
  'mail-companies': EN_MAIL_COMPANIES,
  'mail-goods': EN_MAIL_GOODS,
} as const;

export const NOTICE_EN = {
  ...EN_BELL,
  ...EN_DISPATCHER_A,
  ...EN_DISPATCHER_B,
  ...EN_SERVICES_A,
  ...EN_SERVICES_B,
  ...EN_SERVICES_C,
  ...EN_SERVICES_D,
  ...EN_SAFETY,
  ...EN_DETAILS,
  ...EN_MAIL_ACCOUNT,
  ...EN_MAIL_STAFF,
  ...EN_MAIL_COMPANIES,
  ...EN_MAIL_GOODS,
} as const;

export type NoticeKey = keyof typeof NOTICE_EN;

/** Each language, by part, as written. */
export const NOTICE_TRANSLATION_AREAS: Record<'sw' | 'nl' | 'am' | 'bg', Record<keyof typeof NOTICE_AREAS, Record<string, string>>> = {
  sw: {
    'bell': SW_BELL,
    'dispatcher-a': SW_DISPATCHER_A,
    'dispatcher-b': SW_DISPATCHER_B,
    'services-a': SW_SERVICES_A,
    'services-b': SW_SERVICES_B,
    'services-c': SW_SERVICES_C,
    'services-d': SW_SERVICES_D,
    'safety': SW_SAFETY,
    'details': SW_DETAILS,
    'mail-account': SW_MAIL_ACCOUNT,
    'mail-staff': SW_MAIL_STAFF,
    'mail-companies': SW_MAIL_COMPANIES,
    'mail-goods': SW_MAIL_GOODS,
  },
  nl: {
    'bell': NL_BELL,
    'dispatcher-a': NL_DISPATCHER_A,
    'dispatcher-b': NL_DISPATCHER_B,
    'services-a': NL_SERVICES_A,
    'services-b': NL_SERVICES_B,
    'services-c': NL_SERVICES_C,
    'services-d': NL_SERVICES_D,
    'safety': NL_SAFETY,
    'details': NL_DETAILS,
    'mail-account': NL_MAIL_ACCOUNT,
    'mail-staff': NL_MAIL_STAFF,
    'mail-companies': NL_MAIL_COMPANIES,
    'mail-goods': NL_MAIL_GOODS,
  },
  am: {
    'bell': AM_BELL,
    'dispatcher-a': AM_DISPATCHER_A,
    'dispatcher-b': AM_DISPATCHER_B,
    'services-a': AM_SERVICES_A,
    'services-b': AM_SERVICES_B,
    'services-c': AM_SERVICES_C,
    'services-d': AM_SERVICES_D,
    'safety': AM_SAFETY,
    'details': AM_DETAILS,
    'mail-account': AM_MAIL_ACCOUNT,
    'mail-staff': AM_MAIL_STAFF,
    'mail-companies': AM_MAIL_COMPANIES,
    'mail-goods': AM_MAIL_GOODS,
  },
  bg: {
    'bell': BG_BELL,
    'dispatcher-a': BG_DISPATCHER_A,
    'dispatcher-b': BG_DISPATCHER_B,
    'services-a': BG_SERVICES_A,
    'services-b': BG_SERVICES_B,
    'services-c': BG_SERVICES_C,
    'services-d': BG_SERVICES_D,
    'safety': BG_SAFETY,
    'details': BG_DETAILS,
    'mail-account': BG_MAIL_ACCOUNT,
    'mail-staff': BG_MAIL_STAFF,
    'mail-companies': BG_MAIL_COMPANIES,
    'mail-goods': BG_MAIL_GOODS,
  },
};

/** Each language's phrases. */
export const NOTICE_TRANSLATIONS: Record<'sw' | 'nl' | 'am' | 'bg', Partial<Record<NoticeKey, string>>> = {
  sw: Object.assign({}, ...Object.values(NOTICE_TRANSLATION_AREAS.sw)) as Partial<Record<NoticeKey, string>>,
  nl: Object.assign({}, ...Object.values(NOTICE_TRANSLATION_AREAS.nl)) as Partial<Record<NoticeKey, string>>,
  am: Object.assign({}, ...Object.values(NOTICE_TRANSLATION_AREAS.am)) as Partial<Record<NoticeKey, string>>,
  bg: Object.assign({}, ...Object.values(NOTICE_TRANSLATION_AREAS.bg)) as Partial<Record<NoticeKey, string>>,
};
