import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { agentRow, checkedLine, type DirectoryChoice } from '../tower/directoryChoice';
import { FindHaulier } from './screens/FindHaulier';
import type { BusinessClient } from './api';

/*
 * THE DIRECTORY INSIDE THE APPS (the user, 2026-10-30: "when a business appoints a clearing agent or looks for a carrier,
 * let it pick from the directory"). A clearing agent to appoint is a row of the directory's entry — its own words, what it
 * says it clears, what we saw, what our staff checked; a haulier to ask is reached by a button, never a printed number,
 * and asked once a week.
 */
const firm = (over: Partial<DirectoryChoice> = {}): DirectoryChoice => ({
  id: 'ent_pwani',
  handle: 'pwani-clearing',
  name: 'Pwani Clearing',
  kinds: ['clearing_agent'],
  country: 'KE',
  since: '2026-09-01T00:00:00.000Z',
  seen: {},
  checks: [
    { paper: 'certificate_of_incorporation', what: 'certificate of incorporation', at: '2026-09-01' },
    { paper: 'representative_id', what: 'representative id', at: '2026-09-03' },
  ],
  ...over,
});

describe('a clearing agent to appoint, from the directory', () => {
  it('carries its own words, what it says it clears, what we saw and what our staff checked — and its id', () => {
    const row = agentRow(firm({ words: 'Vehicles at Mombasa since 2009.', says: { clears: ['vehicles', 'sea_container'], places: ['Mombasa'] }, seen: { appointed: 4, cleared: 3 }, contact: { phone: '+254 722 444 555' } }), t, { seen: 'tower.imports.agentSeen', fresh: 'tower.imports.agentNew' });
    expect(row).toMatchObject({ id: 'ent_pwani', handle: 'pwani-clearing', country: 'KE', words: 'Vehicles at Mombasa since 2009.', says: 'Vehicles and plant, Sea containers · Mombasa', phone: '+254 722 444 555' });
    expect(row.seen).toBe(t('tower.imports.agentSeen', { appointed: 4, cleared: 3 }));
    expect(row.checked).toMatch(/^2 papers checked by our staff, the last on /);
    expect(row.checked).toContain('2026');
  });

  it('says a firm never appointed is new here, not bad; and names no papers it has none of', () => {
    const row = agentRow(firm({ checks: [] }), t, { seen: 'business.exports.agent.seen', fresh: 'business.exports.agent.new' });
    expect(row.seen).toBe(t('business.exports.agent.new'));
    expect(row.checked).toBeUndefined();
    expect(row.says).toBeUndefined();
    expect(checkedLine([{ paper: 'licence', what: 'licence', at: '2026-10-30' }], t)).toMatch(/^1 paper checked/);
  });
});

describe('finding a haulier', () => {
  const kudu = firm({ id: 'did:glos:kudu', handle: 'kudu-haulage', name: 'Kudu Haulage', kinds: ['haulier'], words: 'Flatbeds to Kampala.', seen: { delivered: 2 }, contact: { phone: '+254 733 100 200', email: 'office@kudu.example', website: 'https://kudu.example' } });
  const render = (rows: DirectoryChoice[], owner = true) => renderToString(<FindHaulier client={{} as BusinessClient} owner={owner} onAsked={() => undefined} initial={rows} />);

  it('reaches a haulier by buttons, never a printed number, and offers an owner to ask it', () => {
    const html = render([kudu]);
    expect(html).toContain('Kudu Haulage');
    expect(html).toContain('“Flatbeds to Kampala.”');
    expect(html).toContain('2 loads delivered by its drivers on SeeBuyGet.');
    expect(html).toContain('href="tel:+254733100200"');
    expect(html.replace(/href="[^"]*"/g, '')).not.toMatch(/733 ?100 ?200/);
    expect(html).toContain('href="mailto:office@kudu.example"');
    expect(html).toContain(t('business.contracts.ask'));
  });

  it('says when it was asked, for a week; never offers a non-owner the ask', () => {
    const asked = render([{ ...kudu, askedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }]);
    expect(asked).not.toContain(t('business.contracts.ask'));
    expect(asked).toContain('Asked on ');
    const old = render([{ ...kudu, askedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }]);
    expect(old).toContain(t('business.contracts.ask'));
    const booker = render([kudu], false);
    expect(booker).not.toContain(t('business.contracts.ask'));
    expect(booker).toContain(t('business.contracts.askOwner'));
  });

  it('says plainly when no haulier is in the directory, and that most of a fleet’s work never comes through us', () => {
    expect(render([])).toContain(t('business.contracts.findNone'));
    expect(render([{ ...kudu, seen: {} }])).toContain(t('business.contracts.findSeenNone'));
  });
});
