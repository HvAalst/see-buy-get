import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { isSandbox } from '../runtime/sandbox';
import { OutboxMailSender } from './outbox-mail.sender';
import { MAIL_TEMPLATES, MailTemplateId, renderMail } from './mail.templates';
import { RenderedMail, escapeHtml } from './mail.blocks';
import { DISPLAY_FACE, fontFaceCss, mailFont } from './mail.brand';

/** Where the preview pages find the typefaces: this server's own copy, beside them. */
const PREVIEW_FONTS = '../font';

/**
 * An email's HTML as a BROWSER can show it. A mail client finds the logo inside the message by its content id; a
 * browser has no message to look in, so for the preview the same picture is written into the page.
 */
export function htmlForBrowser(mail: RenderedMail): string {
  return mail.images.reduce((html, img) => html.split(`src="cid:${img.cid}"`).join(`src="data:${img.mimeType};base64,${img.base64}"`), mail.html);
}

/**
 * Looking at the emails — SANDBOX ONLY, but for the typefaces. The previews and the outbox answer 404 in production:
 * the outbox holds real reset codes, and the previews are for the people writing the emails, not for the internet.
 */
@Controller('mail')
export class MailController {
  constructor(private readonly outbox: OutboxMailSender) {}

  /** Every email, rendered with its sample data, on one page. */
  @Public()
  @Get('preview')
  previewIndex(@Res() res: Response): void {
    this.sandboxOnly();
    const cards = (Object.keys(MAIL_TEMPLATES) as MailTemplateId[])
      .map((id) => {
        const def = MAIL_TEMPLATES[id];
        const subject = renderMail(id, def.sample as never).subject;
        return `<section><header><h2>${escapeHtml(def.title)} <span class="${def.wired ? 'on' : 'off'}">${def.wired ? 'sent' : 'designed, not sent yet'}</span></h2>
<p>${escapeHtml(def.sentWhen)}</p><p class="subject">Subject: <b>${escapeHtml(subject)}</b> · <a href="preview/${id}">open</a> · <a href="preview/${id}?fonts=off">as Gmail and Outlook show it</a> · <a href="preview/${id}?format=text">plain text</a></p></header>
<iframe title="${escapeHtml(def.title)}" src="preview/${id}" loading="lazy"></iframe></section>`;
      })
      .join('\n');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SeeBuyGet emails</title><style>${fontFaceCss('font')}
body{margin:0;background:#eceef2;font:15px/1.5 Inter,system-ui,sans-serif;color:#1b1d2a}.wrap{max-width:1260px;margin:0 auto;padding:32px 20px}
h1,h2{font-family:'${DISPLAY_FACE}',Inter,system-ui,sans-serif}h1{margin:0 0 4px;color:#000963}.lede{margin:0 0 12px;color:#5f6270;max-width:78ch}.lede:last-of-type{margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:20px}
section{background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.06)}h2{margin:0;font-size:17px;color:#000963}
header p{margin:4px 0;color:#5f6270;font-size:14px}.subject{color:#1b1d2a}span.on,span.off{font:600 12px/1.5 Inter,system-ui,sans-serif;padding:2px 8px;border-radius:99px;margin-left:6px;vertical-align:2px}
span.on{background:#e3f5ea;color:#1c7c54}span.off{background:#fff1e6;color:#b4690e}iframe{width:100%;height:760px;border:1px solid #e6e6ea;border-radius:10px;margin-top:10px;background:#f4f4f6}
a{color:#4c46e0}</style></head><body><div class="wrap"><h1>Every email the network sends</h1>
<p class="lede">Rendered with sample data, in the house style: the logo, Deep Navy and Bright Orange, Bricolage Grotesque for the heading and Inter for everything read. The logo travels inside each email, so it shows wherever the email is opened.</p>
<p class="lede">The typefaces are shown here as a mail client that fetches them shows them, Apple Mail among them. Gmail and Outlook never fetch a typeface, whatever an email says: <b>as Gmail and Outlook show it</b> under each email is theirs, unless the typefaces happen to be installed on your own computer.</p>
<p class="lede">What this sandbox wrote and kept is at <a href="outbox">/v1/mail/outbox</a>. Email is sent through ZeptoMail when the server is started with its token and its sending address; without both, every email is kept.</p>
<div class="grid">${cards}</div></div></body></html>`);
  }

  /**
   * One email, as a mail client would show it — `?fonts=off` as one that fetches no typeface does, `?format=text`
   * for the plain-text version.
   */
  @Public()
  @Get('preview/:template')
  previewOne(@Param('template') template: string, @Res() res: Response, @Query('format') format?: string, @Query('fonts') fonts?: string): void {
    this.sandboxOnly();
    const def = MAIL_TEMPLATES[template as MailTemplateId];
    if (!def) throw new NotFoundException(`No email called ${template}`);
    const mail = renderMail(template as MailTemplateId, def.sample as never, fonts === 'off' ? { fontsUrl: '' } : { fontsUrl: PREVIEW_FONTS });
    if (format === 'text') res.type('text/plain; charset=utf-8').send(`Subject: ${mail.subject}\n\n${mail.text}`);
    else res.type('html').send(htmlForBrowser(mail));
  }

  /**
   * One of the typeface files. NOT sandbox-only: this is where `MAIL_FONT_URL` points a mail client that can fetch a
   * typeface, and a client asks from wherever the reader is. Only the files the emails name are served, by exact name;
   * they are public, they never change, and anybody's page may use them.
   */
  @Public()
  @Get('font/:file')
  font(@Param('file') file: string, @Res() res: Response): void {
    const bytes = mailFont(file);
    if (!bytes) throw new NotFoundException();
    res.set({ 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' }).send(bytes);
  }

  /** What this sandbox would have sent, newest first — the reset codes included. The pictures are named, not dumped. */
  @Public()
  @Get('outbox')
  outboxList(@Query('to') to?: string) {
    this.sandboxOnly();
    return { items: this.outbox.recent(to).map(({ html, images, ...rest }) => ({ ...rest, htmlLength: html.length, images: images.map((i) => i.name) })) };
  }

  private sandboxOnly(): void {
    if (!isSandbox()) throw new NotFoundException();
  }
}
