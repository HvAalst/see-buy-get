import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEND_DESCRIPTION, SEND_SUMMARY, SHARE_CARD, sendHead } from '../../../scripts/send-head.mjs';

/*
 * 2026-11-18 — THE SEND PAGE AS A SEARCH ENGINE OR AN AI ASSISTANT READS IT (the owner: "do it"). It said one line, named no
 * address of its own, carried no structured data, and its preview picture did not exist. Now its head says what it does,
 * where it is, how to track, and shows the share card that does exist; a summary stands in the app's place until it starts.
 */
const SITE = 'https://seebuyget.example';
const page = readFileSync(join('src/apps/genesis/index.html'), 'utf8');
const ldOf = (html: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]) as Record<string, unknown>;

describe('the Send page’s head', () => {
  it('says what the page does, at its own address, with the share card that exists', () => {
    const html = sendHead(page, SITE);
    expect(html).toContain('<title>SeeBuyGet Send — see the price, send and track a parcel</title>');
    expect(html).toContain(`<meta name="description" content="${SEND_DESCRIPTION}" />`);
    expect(html).toContain(`<link rel="canonical" href="${SITE}/send/" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/send/" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE}/img/share-card.png" />`);
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    // The picture that did not exist is gone, and so is the address with www.
    expect(html).not.toMatch(/social-card\.png|www\.seebuyget\.com/);
  });

  it('is a web application of SeeBuyGet’s whose action is tracking a parcel by its code', () => {
    const ld = ldOf(sendHead(page, SITE));
    expect(ld).toMatchObject({ '@type': 'WebApplication', name: 'SeeBuyGet Send', url: `${SITE}/send/`, provider: { '@type': 'Organization', name: 'SeeBuyGet' } });
    expect(ld.potentialAction).toEqual({ '@type': 'TrackAction', target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/send/?track={tracking_code}` } });
  });

  it('a reader that runs no script reads what the page is for, in the app’s place', () => {
    const html = sendHead(page, SITE);
    expect(html).toContain(`<div id="app">${SEND_SUMMARY}</div>`);
    expect(SEND_SUMMARY).toMatch(/See the price before you send, with no account/);
    // The app takes the summary’s place when it starts.
    expect(readFileSync(join('src/apps/genesis/main.tsx'), 'utf8')).toMatch(/host\.textContent = '';\s*render\(<App \/>, host\)/);
  });

  it('without the site’s address, writes no absolute address at all', () => {
    const html = sendHead(page, '');
    expect(html).not.toMatch(/rel="canonical"|og:url|og:image/);
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(ldOf(html)).not.toHaveProperty('potentialAction');
  });

  it('the share card is the front page’s own, and a changed page is said loudly at build time', () => {
    const prerender = readFileSync(join('src/apps/home/prerender.tsx'), 'utf8');
    expect(prerender).toContain(`SHARE_IMAGE = { path: '${SHARE_CARD.path}', width: ${SHARE_CARD.width}, height: ${SHARE_CARD.height}, type: '${SHARE_CARD.type}' }`);
    expect(() => sendHead('<html><head></head><body></body></html>', SITE)).toThrow(/send-head/);
    // The build writes it into the Send app's page, and only there.
    expect(readFileSync(join('vite.config.ts'), 'utf8')).toContain("...(APP_ID === 'genesis' ? [sendHeadPlugin()] : []),");
  });
});
