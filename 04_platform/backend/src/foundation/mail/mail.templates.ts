import { RenderedMail, renderDocument } from './mail.blocks';
import { fontsBase } from './mail.brand';

/**
 * EVERY EMAIL THE NETWORK SENDS — its words, what it needs to be written, and when it goes.
 *
 * Two rules the words keep:
 *  1. **No email carries a credential that works on its own, except the reset code**, which is the one thing email
 *     exists to deliver here. A temporary password is handed over in person; a fleet code is read in the app; a
 *     parcel's collection code lives in the Send app (S22) — an inbox is forwarded, shared and read over shoulders.
 *  2. **Every change to how somebody signs in is told to them**, with what to do if it was not them. That notice
 *     cannot be turned off.
 */
import { ACCOUNT_MAILS, type AccountMailParams } from './mail.account';
import { COMPANIES_MAILS, type CompanyMailParams } from './mail.companies';
import { GOODS_MAILS, type GoodsMailParams } from './mail.goods';
import { STAFF_MAILS, type StaffMailParams } from './mail.staff';
import { helpUrl, writeMail, type MailTemplate } from './mail.kit';
import type { NoticeWords } from '../../modules/pudo/notice-words/say';

export * from './mail.kit';

/** Every email's parameters, by its name: each group file declares its own. */
export interface MailParams extends AccountMailParams, StaffMailParams, CompanyMailParams, GoodsMailParams {}

export type MailTemplateId = keyof MailParams;

export const MAIL_TEMPLATES: { [K in MailTemplateId]: MailTemplate<MailParams[K]> } = { ...ACCOUNT_MAILS, ...STAFF_MAILS, ...COMPANIES_MAILS, ...GOODS_MAILS };

/**
 * Write one email: the words for these parameters, rendered to HTML and text inside the shared layout — in the language of
 * the person it goes to where all of it is written there (2026-11-27; `reader`), else in English.
 */
export function renderMail<K extends MailTemplateId>(template: K, params: MailParams[K], look?: { fontsUrl?: string }, reader?: { lang?: string; words?: NoticeWords }): RenderedMail {
  const def = MAIL_TEMPLATES[template] as MailTemplate<MailParams[K]>;
  // `MAIL_FONT_URL` — where the typeface files are served (this server serves them at /v1/mail/font). A look that is
  // passed in is the preview's, which points a browser at this server's own copy.
  const fontsUrl = look?.fontsUrl ?? fontsBase(process.env.MAIL_FONT_URL);
  return renderDocument(writeMail(def, params, reader), { helpUrl: helpUrl(), logoUrl: process.env.MAIL_LOGO_URL, ...(fontsUrl ? { fontsUrl } : {}) });
}
