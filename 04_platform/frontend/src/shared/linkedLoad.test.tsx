import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { followLink, intentOf, onLaunch, resetLaunchForTests, withoutIntent, type LoadAsked } from './launch';
import { openLinkedLoad } from './linkedLoad';
import { Sections } from './ui/Sections';
import { loadSectionFor } from '../apps/business/logic';
import { LoadDetail } from '../apps/business/screens/LoadsScreen';
import type { BusinessView, PostedLoad } from '../apps/business/api';
import { SentAsFreight } from '../apps/vendor/screens/OrdersScreen';
import { FreightScreen } from '../apps/agent/screens/FreightScreen';
import type { AgentActions, AgentState } from '../apps/agent/useAgentApp';
import type { VendorActions, VendorLoad, VendorState } from '../apps/vendor/useVendorApp';

/*
 * 2026-11-02 — THE LOAD A NOTICE TO ITS POSTER NAMES (the owner: "wire it in"). The poster may be a shop, a store or a
 * business: one link for all three — `/?load=<freightId>&about=<part>` — and each opens that load where it reads its
 * loads. A load not among the account's is said so in words; nothing opens on a list that shows nothing.
 */

afterEach(() => resetLaunchForTests());

describe('the link', () => {
  it('names the load, and the part of it the notice is about — nothing else a hand-made address could add', () => {
    expect(intentOf('/?load=frt_1')).toEqual({ load: { id: 'frt_1' } });
    expect(intentOf('/?load=frt_1&about=road')).toEqual({ load: { id: 'frt_1', about: 'road' } });
    expect(intentOf('/?load=frt_1&about=seals')).toEqual({ load: { id: 'frt_1', about: 'seals' } });
    expect(intentOf('/?load=frt_1&about=claim')).toEqual({ load: { id: 'frt_1', about: 'claim' } });
    // Not one of a load's parts: no part — the load opens where its answer waits.
    expect(intentOf('/?load=frt_1&about=money')).toEqual({ load: { id: 'frt_1' } });
    expect(intentOf('/?load=..%2Fetc')).toBeNull();
    expect(withoutIntent('https://x.test/business/?load=frt_1&about=road&x=1')).toBe('/business/?x=1');
    // The front page's contact form has an `about` of its own: left alone where there is no load.
    expect(withoutIntent('https://x.test/?about=billing')).toBe('/?about=billing');
  });

  it('is followed inside the page to whoever opens loads here — with its part', () => {
    const got: LoadAsked[] = [];
    onLaunch('load', (l) => got.push(l));
    expect(followLink('/?load=frt_9&about=claim')).toBe(true);
    expect(got).toEqual([{ id: 'frt_9', about: 'claim' }]);
  });

  it('leads nowhere in an app that has no loads of its own to open', () => {
    onLaunch('go', () => undefined);
    expect(followLink('/?load=frt_9')).toBe(false);
  });
});

describe('opening it: read afresh, then that load — or said in words', () => {
  const loads = [{ freightId: 'frt_1', code: 'FRT-1' }, { freightId: 'frt_2', code: 'FRT-2' }];
  const steps = (over: { mayRead?: boolean; fetched?: typeof loads | null } = {}) => {
    const did: string[] = [];
    return {
      did,
      steps: {
        mayRead: over.mayRead ?? true,
        fetch: async () => {
          did.push('fetch');
          return over.fetched === undefined ? loads : over.fetched;
        },
        keep: (l: typeof loads) => void did.push(`keep:${l.length}`),
        open: (l: (typeof loads)[number]) => void did.push(`open:${l.code}`),
        say: (why: string) => void did.push(`say:${why}`),
      },
    };
  };

  it('opens the load named, among the account’s loads read afresh', async () => {
    const { did, steps: s } = steps();
    expect(await openLinkedLoad('frt_2', s)).toBe('opened');
    expect(did).toEqual(['fetch', 'keep:2', 'open:FRT-2']);
  });

  it('a load not among the account’s: the list is kept and the reason said — nothing opened', async () => {
    const { did, steps: s } = steps();
    expect(await openLinkedLoad('frt_other', s)).toBe('not_yours');
    expect(did).toEqual(['fetch', 'keep:2', 'say:not_yours']);
  });

  it('somebody who does not read the account’s loads (a shop’s people at the counter) is told so, and nothing is fetched', async () => {
    const { did, steps: s } = steps({ mayRead: false });
    expect(await openLinkedLoad('frt_1', s)).toBe('not_read');
    expect(did).toEqual(['say:not_read']);
  });

  it('a list that could not be read is the app’s own failure to say: nothing kept, nothing opened', async () => {
    const { did, steps: s } = steps({ fetched: null });
    expect(await openLinkedLoad('frt_1', s)).toBe('failed');
    expect(did).toEqual(['fetch']);
  });

  it('the shop and the store say why in their own words', () => {
    expect(t('agent.freight.notYours')).toMatch(/not among this shop’s loads/);
    expect(t('agent.freight.ownerReads')).toMatch(/owner/);
    expect(t('vendor.loads.notYours')).toMatch(/not among this store’s loads/);
    expect(t('business.loads.notYours')).toMatch(/not among this business’s loads/);
  });
});

describe('the Business app opens the load on the section the notice is about', () => {
  it('maps the part to its section: the road, the papers for a seal, the claim — the Overview where an answer waits', () => {
    expect(loadSectionFor('road')).toBe('road');
    expect(loadSectionFor('seals')).toBe('papers');
    expect(loadSectionFor('claim')).toBe('claim');
    expect(loadSectionFor(undefined)).toBe('overview');
  });

  it('a record in sections opens on the one asked for, and on the first when that one is not there', () => {
    const secs = [
      { key: 'overview', label: 'Overview', content: <p>o</p> },
      { key: 'road', label: 'On the road', content: <p>r</p> },
    ];
    expect(renderToString(<Sections label="Load" sections={secs} opensOn="road" />)).toContain('data-tab="road" aria-selected="true"');
    expect(renderToString(<Sections label="Load" sections={secs} opensOn="nowhere" />)).toContain('data-tab="overview" aria-selected="true"');
  });

  it('the load’s own detail opens on its road, where a hold is said', () => {
    const row = {
      freightId: 'frt_6',
      code: 'FRT-6',
      description: 'Bricks',
      destLabel: 'Gate 3',
      weightKg: 400,
      status: 'in_transit',
      openProposals: 0,
      commitMode: 'instant',
      createdAt: '2026-11-01T08:00:00.000Z',
      pickedUpAt: '2026-11-01T09:00:00.000Z',
      heldByAuthority: { by: 'customs', since: '2026-11-02T08:00:00.000Z' },
    } as unknown as PostedLoad;
    const business = { entityId: 'biz_1', name: 'Jenga Bricks Ltd', country: 'KE', activities: ['shipper'], you: { role: 'owner', name: 'Baraka' } } as unknown as BusinessView;
    const html = renderToString(<LoadDetail row={row} start="road" business={business} client={null} act onClose={() => undefined} onChanged={() => undefined} />);
    expect(html).toContain('data-tab="road" aria-selected="true"');
    expect(html).toContain(t('common.held.short'));
  });
});

describe('the shop opens the load named on its freight', () => {
  it('the freight screen, on that load’s own page — not another', () => {
    const f = { freightId: 'frt_4', code: 'FRT-4', description: 'Maize, 40 bags', destLabel: 'Nakuru', weightKg: 2000, status: 'delivered', commitMode: 'instant', currency: 'KES', createdAt: '2026-11-01T08:00:00.000Z', openProposals: 0 };
    const state = { posted: [f, { ...f, freightId: 'frt_5', code: 'FRT-5' }], pricesFor: 'frt_4', prices: [], pricesState: 'ready', postedState: 'ready', busy: null, agent: null } as unknown as AgentState;
    const html = renderToString(<FreightScreen state={state} actions={{ chatApi: null, loadPosted: async () => undefined } as unknown as AgentActions} />);
    expect(html).toContain(t('agent.freight.pricesTitle', { code: 'FRT-4' }));
    expect(html).not.toContain(t('agent.freight.pricesTitle', { code: 'FRT-5' }));
  });
});

describe('the store brings the load named into sight, marked', () => {
  const load = (id: string, code: string): VendorLoad => ({ freightId: id, code, description: 'Sofa', destLabel: 'Westlands', weightKg: 80, status: 'in_transit' });
  it('marks the one asked for, and only that one', () => {
    const state = { loads: [load('frt_1', 'FRT-1'), load('frt_2', 'FRT-2')], soughtLoad: { id: 'frt_2', seq: 1 } } as unknown as VendorState;
    const html = renderToString(<SentAsFreight state={state} actions={{} as VendorActions} />);
    expect(html.match(/row--sought/g)?.length).toBe(1);
    expect(html).toMatch(/id="load-frt_2"[^>]*class="row row--static row--sought"[^>]*aria-current="true"/);
  });
});

describe('who opens a load from a link', () => {
  const read = (p: string) => readFileSync(`src/apps/${p}`, 'utf8');
  it('the three apps a load’s poster reads it in listen for it — and no other app does', () => {
    expect(read('business/app.tsx')).toMatch(/onLaunch\('load'/);
    expect(read('agent/useAgentApp.ts')).toMatch(/onLaunch\('load'/);
    expect(read('vendor/useVendorApp.ts')).toMatch(/onLaunch\('load'/);
    for (const other of ['driver/useDriverApp.ts', 'fleet/useFleetApp.ts', 'genesis/useSendApp.ts', 'mdp/useMdpApp.ts']) expect(read(other), other).not.toMatch(/onLaunch\('load'/);
  });

  it('each opens it through the same steps', () => {
    expect(read('business/screens/LoadsScreen.tsx')).toMatch(/openLinkedLoad<PostedLoad>/);
    expect(read('agent/useAgentApp.ts')).toMatch(/openLinkedLoad<PostedFreight>/);
    expect(read('vendor/useVendorApp.ts')).toMatch(/openLinkedLoad<VendorLoad>/);
  });
});
