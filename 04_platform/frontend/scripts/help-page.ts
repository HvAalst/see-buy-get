/**
 * help.html, WRITTEN FROM THE ARTICLES — never by hand again (2026-10-22). It was a hand-kept copy of
 * src/shared/guide/articles.ts, and it had drifted: the staff's own help was on it for anybody to read, and the sign-in
 * articles had not caught up with shops', hubs' and stores' sign-ins being tied to their own phones.
 *
 * Only the public articles are written; the staff's live in staff-articles.ts, which this does not import. The page's
 * head, styles and layout are kept as they are; the header, the list of contents, the articles and the foot are written.
 *
 *   npx vite-node scripts/help-page.ts      (then commit help.html; guide.test.ts fails if the two disagree)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARTICLES, GUIDE_APPS, type GuideApp } from '../src/shared/guide/articles';

const PAGE = resolve(__dirname, '../../../help.html');
const html = readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The apps a reader can be in: never the staff's console, which the public page does not name. */
const APPS = (Object.keys(GUIDE_APPS) as GuideApp[]).filter((a) => a !== 'console');
const appsOf = (apps: GuideApp[]) => apps.filter((a) => a !== 'console').map((a) => GUIDE_APPS[a]);

const toc = [
  '  <nav class="toc" aria-label="Help by app">',
  '    <ol>',
  ...APPS.map((app) => {
    const items = ARTICLES.filter((a) => a.apps.includes(app)).map((a) => `<li><a href="#${a.id}">${esc(a.title)}</a></li>`);
    return `      <li><b>${esc(GUIDE_APPS[app])}</b><ol>${items.join('')}</ol></li>`;
  }),
  '    </ol>',
  '  </nav>',
].join('\n');

const sections = ARTICLES.map((a) =>
  [
    `<section class="article" id="${a.id}">`,
    `  <h2>${esc(a.title)}</h2>`,
    `  <p class="in">${appsOf(a.apps).map(esc).join(' · ')}</p>`,
    `  <p class="lede">${esc(a.summary)}</p>`,
    ...(a.steps?.length ? ['  <ol>', ...a.steps.map((s) => `    <li>${esc(s)}</li>`), '  </ol>'] : []),
    ...(a.notes ?? []).map((n) => `  <p class="note">${esc(n)}</p>`),
    '</section>',
  ].join('\n'),
).join('\n\n');

const header = [
  '<header>',
  '  <p class="back"><a href="/">← SeeBuyGet</a></p>',
  '  <h1>SeeBuyGet help</h1>',
  '  <p class="sub">How to sign in to each SeeBuyGet app and keep it safe, and how each app does its work. Every app shows the same help behind its Help link.</p>',
  '</header>',
].join('\n');

const foot = ['<footer>', '  <p><a href="/">Back to SeeBuyGet</a></p>', '</footer>'].join('\n');

const head = html.slice(0, html.indexOf('<header>'));
const page = [
  head
    .replace(/<title>[^<]*<\/title>/, '<title>SeeBuyGet help</title>')
    .replace('  a { color: var(--accent); }\n', '  a { color: var(--accent); }\n  .back { margin: 0 0 12px; font-size: 14px; }\n  .back a { text-decoration: none; }\n')
    .replace(
      '<!--\n  The same articles every app shows behind its Help link (frontend/src/shared/guide/articles.ts).\n  guide.test.ts fails when this page and that list disagree: change both in the same commit.\n-->',
      '<!--\n  Written from frontend/src/shared/guide/articles.ts by frontend/scripts/help-page.ts: change the articles, then run\n  it. guide.test.ts fails when this page and that list disagree. The staff\'s own help is never on this page.\n-->',
    ),
  header,
  '<div class="cols">',
  toc,
  '  <main>',
  sections,
  '',
  foot,
  '  </main>',
  '</div>',
  '</div>',
  '</body>',
  '</html>',
  '',
].join('\n');
writeFileSync(PAGE, page);
console.log(`help.html: ${ARTICLES.length} articles, ${APPS.length} apps`);
