import { NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { renderDocument } from './mail.blocks';
import { DISPLAY_FACE, LOGO_CID, LOGO_SHOWN, MAIL_FONTS, TEXT_FACE, brandLogo, fontFaceCss, fontsBase, mailFont } from './mail.brand';
import { MailBounces } from './mail-bounces.service';
import { MailController, htmlForBrowser } from './mail.controller';
import { MAIL_TEMPLATES, MailTemplateId, renderMail } from './mail.templates';
import { OutgoingMail } from './mail.types';
import { OutboxMailSender } from './outbox-mail.sender';
import { toZeptoMailRequest } from './zeptomail';

/*
 * THE HOUSE STYLE IN AN EMAIL — the identity's own logo, colours and two typefaces (brand/README.md), carried in the
 * ways a mail client lets them be carried. The user, 2026-10-07: "before production we can already create the sbg
 * house style for the emails like font types, the use of corporate colors, logo".
 */

const ids = Object.keys(MAIL_TEMPLATES) as MailTemplateId[];
const every = () => ids.map((id) => ({ id, mail: renderMail(id, MAIL_TEMPLATES[id].sample as never) }));
const BRAND = join(__dirname, '..', '..', '..', '..', '..', 'brand');
const ASSETS = join(__dirname, 'assets');

describe('the house style in an email', () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.MAIL_LOGO_URL;
    delete process.env.MAIL_FONT_URL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  describe('the logo', () => {
    it('is the identity’s own file for a dark ground, byte for byte — not a redrawing of it', () => {
      const identity = readFileSync(join(BRAND, 'png', 'logo-horizontal-on-dark-512w.png'));
      const logo = brandLogo()!;
      expect(Buffer.from(logo.base64, 'base64').equals(identity)).toBe(true);
      expect(logo).toMatchObject({ cid: 'sbg-logo', name: 'seebuyget.png', mimeType: 'image/png' });
      // A PNG, 512 × 92 as drawn; shown at a third of that, in the same proportion.
      expect(identity.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect([identity.readUInt32BE(16), identity.readUInt32BE(20)]).toEqual([512, 92]);
      expect(Math.abs(LOGO_SHOWN.width / LOGO_SHOWN.height - 512 / 92)).toBeLessThan(0.05);
    });

    it('is in the header of every email, carried inside it: nothing is fetched to show it', () => {
      for (const { id, mail } of every()) {
        const imgs = mail.html.match(/<img\b[^>]*>/g) ?? [];
        expect([id, imgs.length]).toEqual([id, 1]);
        expect(imgs[0]).toContain(`src="cid:${LOGO_CID}"`);
        expect(imgs[0]).toContain(`width="${LOGO_SHOWN.width}"`);
        // With pictures off, the name is still there, in white on the navy.
        expect(imgs[0]).toMatch(/alt="seebuyget"/);
        expect(imgs[0]).toMatch(/color:#FFFFFF/);
        expect(mail.images).toEqual([brandLogo()]);
        // No picture, stylesheet or script is asked of any server.
        expect(mail.html).not.toMatch(/src="https?:|<link\b|<script\b|@import|url\(/);
        // The typed stand-in for the logo is gone from the header.
        expect(mail.html).not.toContain('>sbg</td>');
        // The header is Deep Navy, and the plain-text version needs no picture to say who it is from.
        expect(mail.html).toContain('<td style="background:#000963;padding:20px 28px;"><img');
        expect(mail.text.startsWith('SEEBUYGET\n')).toBe(true);
      }
    });

    it('goes to the provider as an inline picture the HTML points at, and only when the email carries one', () => {
      const outgoing = (id: MailTemplateId): OutgoingMail => ({ ...renderMail(id, MAIL_TEMPLATES[id].sample as never), template: id, to: { address: 'amina@kilima.co.ke' }, reference: `${id}:abc`, tracking: false });
      const sent = toZeptoMailRequest(outgoing('welcome'));
      expect(sent.inline_images).toEqual([{ mime_type: 'image/png', name: 'seebuyget.png', content: brandLogo()!.base64, cid: LOGO_CID }]);
      expect(sent.htmlbody).toContain(`src="cid:${sent.inline_images![0].cid}"`);

      // Hosted by the operator instead: the email points at it, and carries nothing.
      process.env.MAIL_LOGO_URL = 'https://cdn.seebuyget.com/logo-on-dark.png';
      const hosted = outgoing('welcome');
      expect(hosted.images).toEqual([]);
      expect(hosted.html).toContain('<img src="https://cdn.seebuyget.com/logo-on-dark.png"');
      expect(hosted.html).not.toContain('cid:');
      expect(toZeptoMailRequest(hosted)).not.toHaveProperty('inline_images');
      // An address that is not https is no address: the logo stays inside the email.
      for (const not of ['http://cdn.seebuyget.com/logo.png', 'javascript:alert(1)', '//cdn.seebuyget.com/logo.png', '']) {
        process.env.MAIL_LOGO_URL = not;
        expect(outgoing('welcome').images).toEqual([brandLogo()]);
      }
    });

    it('shows in a browser’s preview as the same picture, written into the page', () => {
      const mail = renderMail('welcome', MAIL_TEMPLATES.welcome.sample);
      const shown = htmlForBrowser(mail);
      expect(shown).toContain(`src="data:image/png;base64,${brandLogo()!.base64}"`);
      expect(shown).not.toContain('cid:');
      // Nothing else about the email is touched, and the email itself is not changed by being looked at.
      expect(shown.split('data:image/png;base64,' + brandLogo()!.base64).join(`cid:${LOGO_CID}`)).toBe(mail.html);
      expect(mail.html).toContain(`src="cid:${LOGO_CID}"`);
    });

    it('falls back to the name in type when the logo’s file is not there: the email goes all the same', () => {
      jest.isolateModules(() => {
        jest.doMock('fs', () => ({ ...jest.requireActual('fs'), readFileSync: () => { throw new Error('ENOENT'); } }));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const blocks = require('./mail.blocks') as typeof import('./mail.blocks');
        const mail = blocks.renderDocument({ subject: 's', preheader: 'p', blocks: [{ kind: 'heading', text: 'Hello' }], reason: 'r' }, { helpUrl: 'https://help.example' });
        expect(mail.images).toEqual([]);
        expect(mail.html).not.toContain('<img');
        expect(mail.html).toContain('>sbg</td>');
        expect(mail.html).toMatch(/>seebuyget<\/td>/);
      });
      jest.dontMock('fs');
    });
  });

  describe('the typefaces', () => {
    it('are the identity’s two, named in every email: Bricolage Grotesque for the heading, Inter for what is read', () => {
      expect([DISPLAY_FACE, TEXT_FACE]).toEqual(['Bricolage Grotesque', 'Inter']);
      for (const { id, mail } of every()) {
        const h1 = mail.html.match(/<h1 style="[^"]*"/)?.[0] ?? '';
        expect([id, h1]).toEqual([id, expect.stringContaining("font:700 26px/1.2 'Bricolage Grotesque',Inter,-apple-system,")]);
        // Everything else that sets a typeface starts with Inter — except the code, which is set to be typed.
        const fonts = [...mail.html.matchAll(/font:[^;"]*\d+px\/[\d.a-z]+ ([^;"]+)[;"]/g)].map((m) => m[1]);
        expect(fonts.length).toBeGreaterThan(3);
        for (const f of fonts) expect(f).toMatch(/^('Bricolage Grotesque',Inter,-apple-system,|Inter,-apple-system,|ui-monospace,)/);
        // …and every one ends in the reader's own, for the clients that never fetch a typeface.
        for (const f of fonts.filter((x) => !x.startsWith('ui-monospace'))) expect(f).toMatch(/Helvetica,Arial,sans-serif$/);
      }
    });

    it('are fetched by nobody unless the server is told where they are served', () => {
      for (const { mail } of every()) expect(mail.html).not.toMatch(/@font-face|<style/);
      process.env.MAIL_FONT_URL = 'https://api.seebuyget.com/v1/mail/font/';
      const html = renderMail('welcome', MAIL_TEMPLATES.welcome.sample).html;
      expect(html.match(/@font-face/g)).toHaveLength(4);
      expect(html).toContain("@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:200 800;font-display:swap;src:url('https://api.seebuyget.com/v1/mail/font/bricolage-grotesque.woff2') format('woff2');}");
      for (const weight of [400, 600, 700]) expect(html).toContain(`@font-face{font-family:'Inter';font-style:normal;font-weight:${weight};font-display:swap;src:url('https://api.seebuyget.com/v1/mail/font/inter-${weight}.woff2') format('woff2');}`);
      // In the head, once, and nothing else in it.
      expect(html.match(/<style>/g)).toHaveLength(1);
      expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('</head>'));
    });

    it('takes only an https address with nothing in it that could close the stylesheet', () => {
      expect(fontsBase(' https://api.seebuyget.com/v1/mail/font// ')).toBe('https://api.seebuyget.com/v1/mail/font');
      expect(fontsBase('https://fonts.seebuyget.com:8443/a_b-c~d/%20')).toBe('https://fonts.seebuyget.com:8443/a_b-c~d/%20');
      for (const not of [undefined, '', '   ', 'http://api.seebuyget.com/font', '//api.seebuyget.com/font', 'api.seebuyget.com/font', "https://x.example/');}body{display:none}", 'https://x.example/"><script>', 'https://x.example/a b', 'https://x.example/a(b)', 'https://x.example/a\\b', 'https://x.example/?q=<']) {
        expect(fontsBase(not)).toBeUndefined();
        process.env.MAIL_FONT_URL = not ?? '';
        expect(renderMail('welcome', MAIL_TEMPLATES.welcome.sample).html).not.toMatch(/@font-face|<style|<script|body\{/);
      }
    });

    it('are four files this server holds, with their licences beside them — and it hands out those four and nothing else', () => {
      expect(Object.keys(MAIL_FONTS).sort()).toEqual(['bricolage-grotesque.woff2', 'inter-400.woff2', 'inter-600.woff2', 'inter-700.woff2']);
      for (const name of Object.keys(MAIL_FONTS)) {
        const bytes = mailFont(name)!;
        expect([name, bytes.subarray(0, 4).toString('latin1')]).toEqual([name, 'wOF2']);
        expect(bytes.equals(readFileSync(join(ASSETS, name)))).toBe(true);
        expect(fontFaceCss('X')).toContain(`url('X/${name}')`);
      }
      // Both faces are under the Open Font License, which asks that its text travels with the files.
      for (const licence of ['OFL-bricolage-grotesque.txt', 'OFL-inter.txt']) expect(readFileSync(join(ASSETS, licence), 'utf8')).toContain('SIL Open Font License');
      // A name is one of the four or it is nothing: not the logo, not a licence, not a path, not a property of an object.
      for (const not of ['logo-on-dark.png', 'OFL-inter.txt', '../assets/inter-400.woff2', 'inter-400.woff2/', 'INTER-400.WOFF2', 'inter-500.woff2', '', 'constructor', 'toString', '__proto__']) expect(mailFont(not)).toBeUndefined();
      expect(existsSync(join(ASSETS, 'logo-on-dark.png'))).toBe(true);
    });
  });

  describe('the colours', () => {
    it('are the identity’s: Deep Navy for the header and the heading, Bright Orange where the eye must land', () => {
      const reset = renderMail('password-reset', MAIL_TEMPLATES['password-reset'].sample).html;
      expect(reset).toContain('<td style="background:#000963;');
      expect(reset).toMatch(/<h1 style="[^"]*color:#000963;"/);
      expect(reset).toContain('border-left:4px solid #FB6200;');
      // The one button is the interface's action colour, which the identity itself never uses — and is never orange.
      expect(reset).toMatch(/<td style="background:#4C46E0;border-radius:10px;"><a /);
      expect(reset).not.toMatch(/<a [^>]*background:#FB6200/);
    });
  });

  describe('looking at them', () => {
    function answer() {
      const res = { headers: {} as Record<string, string>, body: undefined as unknown, kind: '' };
      const api = {
        set: (h: Record<string, string>) => (Object.assign(res.headers, h), api),
        type: (t: string) => ((res.kind = t), api),
        send: (b: unknown) => ((res.body = b), api),
      };
      return { res, api: api as never };
    }
    const controller = () => new MailController(new OutboxMailSender(), new MailBounces());

    it('shows one email as a client that fetches the typefaces shows it — or, asked, as one that does not', () => {
      const withFaces = answer();
      controller().previewOne('welcome', withFaces.api);
      const html = withFaces.res.body as string;
      expect(html.match(/@font-face/g)).toHaveLength(4);
      expect(html).toContain("url('../font/inter-400.woff2')");
      expect(html).toContain('src="data:image/png;base64,');
      const without = answer();
      controller().previewOne('welcome', without.api, undefined, 'off');
      expect(without.res.body as string).not.toMatch(/@font-face|<style/);
      expect(without.res.body as string).toContain('src="data:image/png;base64,');
      // Off means off, even on a server that is told where the typefaces are.
      process.env.MAIL_FONT_URL = 'https://api.seebuyget.com/v1/mail/font';
      const stillOff = answer();
      controller().previewOne('welcome', stillOff.api, undefined, 'off');
      expect(stillOff.res.body as string).not.toContain('@font-face');
      const text = answer();
      controller().previewOne('welcome', text.api, 'text');
      expect([text.res.kind, (text.res.body as string).startsWith('Subject: ')]).toEqual(['text/plain; charset=utf-8', true]);
      expect(() => controller().previewOne('no-such-email', answer().api)).toThrow(NotFoundException);
    });

    it('hands out a typeface to anybody, anywhere — and keeps the previews and the outbox to a sandbox', () => {
      const served = answer();
      controller().font('inter-600.woff2', served.api);
      expect(served.res.headers).toEqual({ 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' });
      expect((served.res.body as Buffer).equals(mailFont('inter-600.woff2')!)).toBe(true);
      expect(() => controller().font('logo-on-dark.png', answer().api)).toThrow(NotFoundException);
      expect(() => controller().font('../mail.service.ts', answer().api)).toThrow(NotFoundException);

      process.env.GLOS_ENV = 'production';
      const live = answer();
      controller().font('bricolage-grotesque.woff2', live.api);
      expect((live.res.body as Buffer).length).toBeGreaterThan(10_000);
      expect(() => controller().previewOne('welcome', answer().api)).toThrow(NotFoundException);
      expect(() => controller().previewIndex(answer().api)).toThrow(NotFoundException);
      expect(() => controller().outboxList()).toThrow(NotFoundException);
    });

    it('lists every email on one page, in the house style itself, and says what a reader’s mail client may not show', () => {
      const page = answer();
      controller().previewIndex(page.api);
      const html = page.res.body as string;
      for (const id of ids) expect(html).toContain(`<iframe title="${MAIL_TEMPLATES[id].title.replace(/&/g, '&amp;')}" src="preview/${id}"`);
      expect(html.match(/preview\/[a-z-]+\?fonts=off/g)).toHaveLength(ids.length);
      expect(html).toContain("url('font/bricolage-grotesque.woff2')");
      expect(html).toMatch(/Gmail and Outlook never fetch a typeface/);
    });

    it('names the pictures an email kept in the outbox carried, without pouring them out', async () => {
      const outbox = new OutboxMailSender();
      await outbox.send({ ...renderMail('welcome', MAIL_TEMPLATES.welcome.sample), template: 'welcome', to: { address: 'amina@example.com' }, reference: 'welcome:abc', tracking: false });
      const listed = new MailController(outbox, new MailBounces()).outboxList().items;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ template: 'welcome', images: ['seebuyget.png'], htmlLength: expect.any(Number) });
      expect(JSON.stringify(listed)).not.toContain(brandLogo()!.base64.slice(0, 60));
      expect(listed[0]).not.toHaveProperty('html');
    });
  });

  it('keeps an email small enough that no mail client cuts it short', () => {
    // Gmail clips an HTML part past about 102 KB. The logo is not in the HTML part; the typefaces never are.
    for (const { id, mail } of every()) expect([id, Buffer.byteLength(mail.html) < 20_000]).toEqual([id, true]);
    expect(Buffer.from(brandLogo()!.base64, 'base64').length).toBeLessThan(20_000);
    expect(renderDocument({ subject: 's', preheader: 'p', blocks: [], reason: 'r' }, { helpUrl: 'https://help.example' }).images).toHaveLength(1);
  });
});
