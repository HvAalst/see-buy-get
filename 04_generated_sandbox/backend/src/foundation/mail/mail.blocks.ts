/**
 * The pieces every SeeBuyGet email is built from, and the one layout they sit in.
 *
 * An email is written ONCE, as a list of blocks, and rendered twice: to HTML for the mail client and to plain text
 * for everyone whose client shows text (and for the spam filters that read it). Writing the two by hand drifts — the
 * text version of a reset email ends up without the code — so neither is ever written by hand.
 *
 * The HTML is deliberately old-fashioned: tables, inline styles, no web fonts, no images unless `MAIL_LOGO_URL` is
 * set. Mail clients strip <style>, ignore flexbox and block remote images by default, and a security email that only
 * looks right in one client is a security email people learn to distrust.
 */

export type MailBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  /** The one thing the reader must type — a reset code. Big, spaced, easy to copy. */
  | { kind: 'code'; label: string; value: string; note?: string }
  | { kind: 'button'; label: string; href: string }
  | { kind: 'facts'; rows: Array<[string, string]> }
  /** "Was this not you?" — the sentence that has to be found without reading the rest. */
  | { kind: 'warning'; title: string; text: string }
  | { kind: 'note'; text: string };

export interface MailDocument {
  subject: string;
  /** The grey line a mail client shows after the subject. Never repeats the subject. */
  preheader: string;
  blocks: MailBlock[];
  /** Why this address received it — every email says so, at the bottom. */
  reason: string;
}

export interface RenderedMail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/** Brand colours from brand/README.md: Deep Navy for ink and the header, Bright Orange where the eye must land,
 *  and the interface's action colour for the one button. */
const C = {
  navy: '#000963',
  orange: '#FB6200',
  action: '#4C46E0',
  ink: '#1B1D2A',
  muted: '#5F6270',
  line: '#E6E6EA',
  ground: '#F4F4F6',
  soft: '#F7F7F9',
  warnGround: '#FFF4EC',
  white: '#FFFFFF',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

export function escapeHtml(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only web links may become an href: a parameter can never smuggle `javascript:` into a button. */
function safeHref(href: string): string {
  return /^https?:\/\//i.test(href) ? escapeHtml(href) : '#';
}

function blockHtml(block: MailBlock): string {
  const e = escapeHtml;
  switch (block.kind) {
    case 'heading':
      return `<h1 style="margin:0 0 16px;font:700 24px/1.25 ${FONT};color:${C.navy};">${e(block.text)}</h1>`;
    case 'paragraph':
      return `<p style="margin:0 0 16px;font:400 16px/1.55 ${FONT};color:${C.ink};">${e(block.text)}</p>`;
    case 'note':
      return `<p style="margin:0 0 14px;font:400 14px/1.5 ${FONT};color:${C.muted};">${e(block.text)}</p>`;
    case 'code':
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-collapse:separate;"><tr>` +
        `<td style="background:${C.soft};border:1px solid ${C.line};border-radius:12px;padding:18px 20px;text-align:center;">` +
        `<div style="font:600 12px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">${e(block.label)}</div>` +
        `<div style="margin-top:8px;font:700 30px/1.2 ${MONO};letter-spacing:.12em;color:${C.navy};">${e(block.value)}</div>` +
        (block.note ? `<div style="margin-top:8px;font:400 14px/1.4 ${FONT};color:${C.muted};">${e(block.note)}</div>` : '') +
        `</td></tr></table>`
      );
    case 'button':
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr>` +
        `<td style="background:${C.action};border-radius:10px;">` +
        `<a href="${safeHref(block.href)}" style="display:inline-block;padding:13px 22px;font:600 16px/1 ${FONT};color:${C.white};text-decoration:none;border-radius:10px;">${e(block.label)}</a>` +
        `</td></tr></table>`
      );
    case 'facts':
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-top:1px solid ${C.line};">` +
        block.rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid ${C.line};font:400 14px/1.4 ${FONT};color:${C.muted};width:38%;vertical-align:top;">${e(label)}</td>` +
              `<td style="padding:10px 0;border-bottom:1px solid ${C.line};font:600 15px/1.4 ${FONT};color:${C.ink};vertical-align:top;">${e(value)}</td></tr>`,
          )
          .join('') +
        `</table>`
      );
    case 'warning':
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr>` +
        `<td style="background:${C.warnGround};border-left:4px solid ${C.orange};padding:14px 16px;">` +
        `<div style="font:700 15px/1.4 ${FONT};color:${C.navy};">${e(block.title)}</div>` +
        `<div style="margin-top:4px;font:400 15px/1.5 ${FONT};color:${C.ink};">${e(block.text)}</div>` +
        `</td></tr></table>`
      );
  }
}

function blockText(block: MailBlock): string {
  switch (block.kind) {
    case 'heading':
      return block.text.toUpperCase();
    case 'paragraph':
    case 'note':
      return block.text;
    case 'code':
      return `${block.label}: ${block.value}${block.note ? `\n${block.note}` : ''}`;
    case 'button':
      return `${block.label}: ${block.href}`;
    case 'facts':
      return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    case 'warning':
      return `${block.title}\n${block.text}`;
  }
}

/** The brand mark in the header: the real logo when it is hosted somewhere mail clients can fetch, else type. */
function markHtml(logoUrl?: string): string {
  if (logoUrl && /^https:\/\//i.test(logoUrl)) {
    return `<img src="${escapeHtml(logoUrl)}" width="140" alt="seebuyget" style="display:block;border:0;height:auto;max-width:140px;" />`;
  }
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="background:${C.orange};border-radius:8px;width:34px;height:34px;text-align:center;font:800 14px/34px ${FONT};color:${C.white};">sbg</td>` +
    `<td style="padding-left:10px;font:700 19px/1 ${FONT};color:${C.white};letter-spacing:-.01em;">seebuyget</td>` +
    `</tr></table>`
  );
}

export function renderDocument(doc: MailDocument, opts: { helpUrl: string; logoUrl?: string }): RenderedMail {
  const e = escapeHtml;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
    `<meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" />` +
    `<title>${e(doc.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.ground};-webkit-text-size-adjust:100%;">` +
    // The preheader: shown in the inbox list, hidden in the message.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(doc.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ground};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.white};border-radius:16px;overflow:hidden;">` +
    `<tr><td style="background:${C.navy};padding:20px 28px;">${markHtml(opts.logoUrl)}</td></tr>` +
    `<tr><td style="padding:32px 28px 8px;">${doc.blocks.map(blockHtml).join('')}</td></tr>` +
    `<tr><td style="padding:4px 28px 28px;"><div style="border-top:1px solid ${C.line};padding-top:16px;">` +
    `<p style="margin:0 0 8px;font:400 13px/1.5 ${FONT};color:${C.muted};">${e(doc.reason)}</p>` +
    `<p style="margin:0;font:400 13px/1.5 ${FONT};color:${C.muted};">Please do not reply — this address is not read. Help with signing in and your account: <a href="${safeHref(opts.helpUrl)}" style="color:${C.action};">SeeBuyGet help</a>.</p>` +
    `</div></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const text = ['SEEBUYGET', '', ...doc.blocks.flatMap((b) => [blockText(b), '']), '--', doc.reason, `Please do not reply — this address is not read. Help: ${opts.helpUrl}`].join('\n');
  return { subject: doc.subject, preheader: doc.preheader, html, text };
}
