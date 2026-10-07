import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { isSandbox } from '../runtime/sandbox';
import { OutboxMailSender } from './outbox-mail.sender';
import { MAIL_TEMPLATES, MailTemplateId, renderMail } from './mail.templates';
import { escapeHtml } from './mail.blocks';

/**
 * Looking at the emails — SANDBOX ONLY. Every route answers 404 in production: the outbox holds real reset codes,
 * and the previews are for the people writing the emails, not for the internet.
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
<p>${escapeHtml(def.sentWhen)}</p><p class="subject">Subject: <b>${escapeHtml(subject)}</b> · <a href="preview/${id}">open</a> · <a href="preview/${id}?format=text">plain text</a></p></header>
<iframe title="${escapeHtml(def.title)}" src="preview/${id}" loading="lazy"></iframe></section>`;
      })
      .join('\n');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SeeBuyGet emails</title><style>
body{margin:0;background:#eceef2;font:15px/1.5 system-ui,sans-serif;color:#1b1d2a}.wrap{max-width:1260px;margin:0 auto;padding:32px 20px}
h1{margin:0 0 4px;color:#000963}.lede{margin:0 0 24px;color:#5f6270}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:20px}
section{background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.06)}h2{margin:0;font-size:17px;color:#000963}
header p{margin:4px 0;color:#5f6270;font-size:14px}.subject{color:#1b1d2a}span.on,span.off{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;margin-left:6px;vertical-align:2px}
span.on{background:#e3f5ea;color:#1c7c54}span.off{background:#fff1e6;color:#b4690e}iframe{width:100%;height:760px;border:1px solid #e6e6ea;border-radius:10px;margin-top:10px;background:#f4f4f6}
a{color:#4c46e0}</style></head><body><div class="wrap"><h1>Every email the network sends</h1>
<p class="lede">Rendered with sample data. What this sandbox wrote and kept is at <a href="outbox">/v1/mail/outbox</a>. Email is sent through ZeptoMail when the server is started with its token and its sending address; without both, every email is kept.</p>
<div class="grid">${cards}</div></div></body></html>`);
  }

  /** One email, as the mail client would show it — or `?format=text` for the plain-text version. */
  @Public()
  @Get('preview/:template')
  previewOne(@Param('template') template: string, @Res() res: Response, @Query('format') format?: string): void {
    this.sandboxOnly();
    const def = MAIL_TEMPLATES[template as MailTemplateId];
    if (!def) throw new NotFoundException(`No email called ${template}`);
    const mail = renderMail(template as MailTemplateId, def.sample as never);
    if (format === 'text') res.type('text/plain; charset=utf-8').send(`Subject: ${mail.subject}\n\n${mail.text}`);
    else res.type('html').send(mail.html);
  }

  /** What this sandbox would have sent, newest first — the reset codes included. */
  @Public()
  @Get('outbox')
  outboxList(@Query('to') to?: string) {
    this.sandboxOnly();
    return { items: this.outbox.recent(to).map(({ html, ...rest }) => ({ ...rest, htmlLength: html.length })) };
  }

  private sandboxOnly(): void {
    if (!isSandbox()) throw new NotFoundException();
  }
}
