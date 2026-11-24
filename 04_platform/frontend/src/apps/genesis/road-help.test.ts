import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { articles, siteArticleById } from '../../shared/guide/articles';
import { t } from '../../shared/i18n';

const HERE = 'src/apps/genesis';

/*
 * 2026-11-23 — A PARCEL TO ANOTHER EU COUNTRY, EXPLAINED (the Netherlands–Bulgaria plan, step 3d): a public page every party reads,
 * linked from the Send app where such a parcel is booked, under the sender's word on what it holds.
 */
describe('the page of a parcel to another EU country', () => {
  it('is public, six steps, in the help of every app that touches such a parcel', () => {
    const page = articles().find((a) => a.id === 'parcel-in-the-eu');
    expect(siteArticleById('parcel-in-the-eu')?.id).toBe('parcel-in-the-eu');
    expect(page).toMatchObject({ group: 'daily' });
    expect(page?.steps).toHaveLength(6);
    expect(page?.apps).toEqual(expect.arrayContaining(['send', 'agent', 'mdp', 'driver', 'business', 'vendor', 'console']));
    expect(t('help.parcel-in-the-eu.step4' as never)).toMatch(/Only that fleet’s drivers carry the route’s bags/);
  });

  it('is linked where the Send app books one, under the goods word, and only there', () => {
    const src = readFileSync(join(HERE, 'screens/SendScreen.tsx'), 'utf8');
    expect(src).toMatch(/\{q\?\.withinUnion \? \(\s*<p class="hint">\s*<a href=\{`\$\{frontDoorUrl\(\)\}help\/parcel-in-the-eu\/`\} target="_blank" rel="noopener">\s*\{t\('send\.road\.how'\)\}/);
    expect(src.indexOf('help/parcel-in-the-eu/')).toBeGreaterThan(src.indexOf('<GoodsWord passage={q.withinUnion}'));
  });
});
