import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { AgreementBlock } from './Agreement';
import type { AgreementDocument } from './documents';

/*
 * WHAT A SIGN-UP AGREES TO, ON SCREEN — the general documents, and a country's own on top (the user, 2026-10-25:
 * "general terms of use, global, and specific terms of use"). Rendered from a set already read, as the sheet that asks
 * again after signing in has it.
 */
const doc = (key: string, title: string, number = 1): AgreementDocument => {
  const [kind, country] = key.split('@') as [AgreementDocument['kind'], string | undefined];
  return { key, kind, ...(country ? { country } : {}), title, number, since: number, publishedAt: '2026-10-25T09:00:00.000Z', path: `/${kind}/` };
};
const SET = [doc('terms', 'Terms of use', 2), doc('privacy', 'Your data at SeeBuyGet'), doc('cookies', 'Cookies'), doc('terms@KE', 'Terms of use — Kenya')];
const rows = (html: string) => [...html.matchAll(/<span class="row__t">(.*?)<\/span><span class="row__s">(.*?)<\/span>/g)].map((m) => [m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), m[2]]);

describe('the documents on a sign-up', () => {
  it('lists the general ones, then the country’s own, said to add to them', () => {
    const html = renderToString(<AgreementBlock agreed={null} onChange={() => undefined} set={SET} countries={['KE']} />);
    expect(rows(html).map(([title]) => title)).toEqual(['Terms of use', 'Your data at SeeBuyGet', 'Cookies', 'Terms of use — Kenya']);
    expect(rows(html)[3][1]).toBe('What Kenya adds, on top of the general text');
    expect(rows(html)[0][1]).toBe('What SeeBuyGet does and does not do, and what each side can expect');
  });

  it('marks a country’s own they never agreed to as new, and a later version of one they did as a new version', () => {
    const html = renderToString(<AgreementBlock agreed={null} onChange={() => undefined} set={SET} countries={['KE']} changed={['terms', 'terms@KE']} had={{ terms: 1, privacy: 1, cookies: 1 }} lede={false} />);
    const marked = Object.fromEntries(rows(html).map(([title]) => [title.replace(/ new( version)?$/, ''), title.match(/ (new( version)?)$/)?.[1] ?? '']));
    expect(marked).toEqual({ 'Terms of use': 'new version', 'Your data at SeeBuyGet': '', Cookies: '', 'Terms of use — Kenya': 'new' });
  });
});
