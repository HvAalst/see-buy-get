import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import type { BusinessView, CarriageContract, Client, NewLoad } from './api';
import { COLD_NATURES, isColdNature, isDangerousNature, loadGaps, nextDay, orderableContracts, type LoadForm } from './logic';
import { NATURES } from '../agent/logic';
import {
  DRAFT_KEEP_MS,
  EMPTY_POST,
  draftOwner,
  draftTouched,
  dropLoadDraft,
  dropLoadDrafts,
  keepLoadDraft,
  keptLoadDraft,
  loadBody,
  loadEnds,
  postBack,
  postFields,
  postGaps,
  postNext,
  postSteps,
  sendLoad,
  startForm,
  stepGaps,
  tempGaps,
  tempRangeOf,
  todayIn,
  type PostForm,
  type PostStep,
  type SendIo,
} from './postLoad';
import { PostLoad, type PostStart } from './screens/PostLoad';
import { LoadDetail, LoadsScreen } from './screens/LoadsScreen';
import type { PostedLoad } from './api';

/*
 * THE OWNER, 2026-11-03: "the 'post a new load' is a pretty large page. It is in my opinion better if we chunk it up similar
 * to the sign up process. And an indicator shows how far we are before a load goes public. That would enable us to use a
 * slightly larger font size and more white space."
 */

const HERE = 'src/apps/business';
/** A Tuesday morning: tomorrow is the 4th. */
const NOW = new Date(2026, 10, 3, 10, 0, 0);

/** A phone's own storage, for the tests that read what a screen keeps there. */
function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
const phone = memoryStore();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: phone });

const business = (over: Partial<BusinessView> = {}): BusinessView => ({
  entityId: 'ent_kudu',
  name: 'Kudu Traders Ltd',
  country: 'KE',
  activities: ['shipper'],
  registrationNo: 'PVT-2026-0042',
  check: { state: 'verified', missing: [] },
  createdAt: '2026-11-02T08:00:00.000Z',
  you: { memberId: 'mem_1', name: 'Amina Odhiambo', role: 'owner', state: 'joined', phoneEnds: '5678', invitedBy: 'Amina Odhiambo', invitedAt: '2026-11-02T08:00:00.000Z', you: true },
  ...over,
});
const CONTRACT: CarriageContract = { contractId: 'c1', fleetDid: 'did:sbg:fleet:kilima', fleetName: 'Kilima Haulage', shipper: { name: 'Kudu Traders Ltd' }, reference: 'K-2026', status: 'active', createdAt: '2026-10-01T08:00:00.000Z', createdBy: 'did:x' };
const CLIENT: Client = { clientId: 'cl_1', name: 'Tana Mills', country: 'KE', createdBy: 'did:x', createdAt: '2026-10-01T08:00:00.000Z' } as Client;
const SITES = [
  { siteId: 's1', kind: 'delivery' as const, name: 'Kudu Mombasa Road', location: { lat: -1.3245, lng: 36.8521 }, from: 'pin' as const },
  { siteId: 's2', kind: 'delivery' as const, name: 'Kudu Thika', location: { lat: -1.0332, lng: 37.0693 }, from: 'pin' as const },
];
const RECEIVING = { code: '7KQ3-PX9M', name: 'Tana Mills', siteName: 'Thika works', location: { lat: -1.04, lng: 37.08 } };
const noop = () => undefined;

const form = (over: Partial<PostForm> = {}): PostForm => ({ ...startForm('KE', NOW), ...over });
const at = (start: PostStart, b: BusinessView = business()) =>
  renderToString(<PostLoad business={b} client={null} start={{ now: NOW, contracts: [], clients: [], ...start }} onLeave={noop} onPosted={noop} onOpen={noop} onAnother={noop} />);
const ctx = (f: PostForm, over: Partial<{ crossing: boolean; contract: boolean }> = {}) => ({ crossing: Boolean(f.destCountry && f.destCountry !== 'KE'), contract: Boolean(f.contractId), today: todayIn(NOW), ...over });
const names = (steps: PostStep[]) => steps.map((s) => t(`business.post.step.${s}` as never));

describe('posting a load, one step per screen, in an order that suits the load', () => {
  it('goes from and to, what it is, when, its value and price, on the day, then the check — where there is no carrier to choose', () => {
    expect(postSteps({ choice: false, contract: false })).toEqual(['route', 'goods', 'when', 'value', 'day', 'check']);
    const html = at({ step: 'route', form: form() });
    expect(html).toContain('steps steps--pinned');
    expect(html).toContain('Posting a load · goes public at the last step');
    expect(html).toContain('step 1 of 6');
    for (const name of names(['route', 'goods', 'when', 'value', 'day', 'check'])) expect(html).toContain(name);
    expect(html).not.toContain(`>${t('business.post.step.carrier')}<`);
  });

  it('asks who carries it first where a contract could take it; under a contract there is no When, and the bar says to whom it goes', () => {
    expect(postSteps({ choice: true, contract: false })).toEqual(['carrier', 'route', 'goods', 'when', 'value', 'day', 'check']);
    expect(postSteps({ choice: true, contract: true })).toEqual(['carrier', 'route', 'goods', 'value', 'day', 'check']);
    const board = at({ step: 'carrier', form: form(), contracts: [CONTRACT] });
    expect(board).toContain('step 1 of 7');
    expect(board).toContain('Posting a load · goes public at the last step');
    expect(board).toContain('Kilima Haulage · K-2026');
    expect(board).not.toContain(t('business.loads.f.deliverOn'));
    const ordered = at({ step: 'carrier', form: form({ contractId: 'c1' }), contracts: [CONTRACT] });
    expect(ordered).toContain('Ordering a load · sent at the last step');
    expect(ordered).toContain('step 1 of 6');
    expect(ordered).not.toContain(`<span>${t('business.post.step.when')}</span>`);
    // The day it must arrive, its order number, and — with no When of its own — the hours it can be delivered.
    for (const label of ['business.loads.f.deliverOn', 'business.loads.f.orderRef', 'business.loads.f.window'] as const) expect(ordered).toContain(t(label));
    expect(postFields('carrier', true)).toContain('deliveryWindow');
    expect(postFields('carrier', false)).not.toContain('deliveryWindow');
  });

  it('asks an expeditor whose goods they are, even with no contract — and says the load goes on the open board', () => {
    const html = at({ step: 'carrier', form: form(), clients: [] }, business({ activities: ['expeditor'] }));
    expect(html).toContain('step 1 of 7');
    expect(html).toContain(t('business.sentFor.label'));
    expect(html).toContain(t('business.post.boardOnly'));
    // Nobody to send for, no contract: the first step is left out, and a step kept from before opens as the first there is.
    expect(at({ step: 'carrier', form: form() })).toContain(`id="biz-post-title" tabindex="-1">${t('business.post.t.route')}`);
  });

  it('asks dangerous goods their UN number, shipping name, class and packing group — straight under the kind of goods, and only then', () => {
    const dg = at({ step: 'goods', form: form({ natureCode: 'HAZ-FLAM' }) });
    for (const label of ['business.exports.sli.unNumber', 'business.exports.sli.shippingName', 'business.exports.sli.hazardClass', 'business.exports.sli.packingGroup'] as const) expect(dg).toContain(t(label));
    expect(dg.indexOf(t('business.exports.sli.unNumber'))).toBeLessThan(dg.indexOf(t('business.loads.f.weight')));
    expect(at({ step: 'goods', form: form() })).not.toContain(t('business.exports.sli.unNumber'));
    // No step of their own: the same steps as any load.
    expect(at({ step: 'goods', form: form({ natureCode: 'HAZ-FLAM' }) })).toContain('step 2 of 6');
  });

  // 2026-11-03 — the page asked no temperature; a business posting fresh or frozen food now says the one it is kept at.
  it('asks fresh or frozen food the temperature it is kept at — straight under the kind of goods, on no step of its own, and no other goods', () => {
    const cold = at({ step: 'goods', form: form({ natureCode: 'FOP' }) });
    expect(cold).toContain('step 2 of 6');
    for (const words of ['business.post.temp.title', 'business.post.temp.hint', 'business.post.temp.between', 'business.post.temp.lowest', 'business.post.temp.highest'] as const) expect(cold).toContain(t(words));
    expect(cold).toContain('Chilled goods: between 2 and 8. Frozen: -18 or colder');
    expect(cold.indexOf(t('business.post.temp.title'))).toBeGreaterThan(cold.indexOf(t('business.loads.f.nature')));
    expect(cold.indexOf(t('business.post.temp.title'))).toBeLessThan(cold.indexOf(t('business.loads.f.weight')));
    // A phone's number pad has no minus sign, and frozen goods need one: the two boxes ask no number pad.
    expect(cold.match(/<input class="cinput" type="number" step="0.5" min="-30" max="30" aria-label="[^"]+"/g)).toHaveLength(2);
    for (const n of NATURES.filter((x) => x.key !== 'FOP')) expect(at({ step: 'goods', form: form({ natureCode: n.key }) }), n.key).not.toContain(t('business.post.temp.title'));
    expect(COLD_NATURES).toEqual(['FOP']);
  });

  it('asks it of exactly the goods the network carries cold — the backend’s own list, read', () => {
    const source = readFileSync('../backend/src/modules/pudo/cargo.types.ts', 'utf8');
    const block = source.slice(source.indexOf('export const NATURE_CAPABILITY'), source.indexOf('};', source.indexOf('export const NATURE_CAPABILITY')));
    const coldChain = [...block.matchAll(/'?([A-Z-]+)'?: 'coldChain'/g)].map((m) => m[1]);
    expect(block).toContain("FOP: 'coldChain'");
    expect(coldChain).toEqual([...COLD_NATURES]);
    expect(isColdNature('FOP')).toBe(true);
    for (const n of ['GEN', 'FOD', 'HUM', 'HAZ-BIO', '', undefined]) expect(isColdNature(n)).toBe(false);
  });

  it('asks a trucked flight’s waybill and flight only once it is ticked', () => {
    expect(at({ step: 'value', form: form() })).not.toContain(t('business.loads.f.flightAwb'));
    const ticked = at({ step: 'value', form: form({ truckFlight: true }) });
    for (const label of ['business.loads.f.flightAwb', 'business.loads.f.flightNo', 'business.loads.f.flightAirline'] as const) expect(ticked).toContain(t(label));
  });

  it('asks a load that leaves the country who receives it, their address and customs — and, on what it is, its packages', () => {
    const abroad = form({ destCountry: 'UG' });
    const route = at({ step: 'route', form: abroad });
    expect(route).toContain(t('business.loads.f.customs'));
    expect(route).toContain(t('business.loads.f.crossing'));
    expect(route).toContain(t('business.loads.f.consigneeHintCrossing'));
    expect(at({ step: 'route', form: form() })).not.toContain(t('business.loads.f.customs'));
    expect(stepGaps('route', abroad, ctx(abroad))).toEqual(['fromSiteId', 'toSiteId', 'consigneeName', 'consigneeAddress']);
    expect(stepGaps('goods', abroad, ctx(abroad))).toEqual(['description', 'weightKg', 'packages']);
    expect(stepGaps('goods', { ...abroad, packaging: 'loose' }, ctx(abroad))).toEqual(['description', 'weightKg']);
  });
});

describe('Back, and the phone’s Back', () => {
  const steps = postSteps({ choice: true, contract: false });

  it('goes back a step at a time; the first step’s way out leaves the load for now, and done has neither', () => {
    expect(postBack('carrier', steps)).toBeNull();
    expect(postBack('route', steps)).toBe('carrier');
    expect(postBack('when', steps)).toBe('goods');
    expect(postBack('check', steps)).toBe('day');
    expect(postBack('done', steps)).toBeNull();
    expect(postNext('goods', steps)).toBe('when');
    expect(postNext('goods', postSteps({ choice: true, contract: true }))).toBe('value');
    const first = at({ step: 'route', form: form() });
    expect(first).toContain(`>${t('business.post.leave')}</button>`);
    expect(first).not.toContain(`>${t('common.back')}</button>`);
    expect(first).toContain(t('business.post.keptHint'));
    const second = at({ step: 'goods', form: form() });
    expect(second).toContain(`>${t('common.back')}</button>`);
    expect(second).not.toContain(t('business.post.leave'));
  });

  it('lets the phone’s Back do what Back does, one entry per step — and leave the load for now from the first', () => {
    const src = readFileSync(join(HERE, 'screens/PostLoad.tsx'), 'utf8');
    expect(src).toContain('<BackStep key={step} back={() => (back ? goBack(back) : onLeave())} />');
  });

  it('focuses the step’s title and reads the page from its top on a new step', () => {
    const src = readFileSync(join(HERE, 'screens/PostLoad.tsx'), 'utf8');
    expect(src).toMatch(/window\.scrollTo\?\.\(0, 0\);\s*titleRef\.current\?\.focus\(\);\s*\}, \[step\]\);/);
    expect(at({ step: 'value', form: form() })).toContain('id="biz-post-title" tabindex="-1"');
  });

  it('from the check, Change goes to that part and its way on is back to the check', () => {
    const html = at({ step: 'goods', form: form(), backTo: 'check' });
    expect(html).toContain(`>${t('business.post.toCheck')}</button>`);
    expect(html).not.toContain(`>${t('common.next')}</button>`);
  });
});

describe('each step’s checks, said beside the field', () => {
  it('stops each step only on its own answers', () => {
    const f = form();
    const c = ctx(f);
    expect(stepGaps('route', f, c)).toEqual(['fromSiteId', 'toSiteId']);
    expect(stepGaps('goods', f, c)).toEqual(['description', 'weightKg']);
    for (const s of ['when', 'value', 'day'] as const) expect(stepGaps(s, f, c)).toEqual([]);
    // The check stops on all of them.
    expect(stepGaps('check', f, c)).toEqual(['description', 'fromSiteId', 'toSiteId', 'weightKg']);
  });

  it('keeps the page’s own rules — dangerous goods, a value in a money — and what the browser and the server checked', () => {
    const f = form();
    expect(stepGaps('goods', form({ natureCode: 'HAZ-CHEM', description: 'Acid', weightKg: '10' }), ctx(f))).toEqual(['unNumber', 'properShippingName', 'hazardClass']);
    expect(stepGaps('goods', form({ natureCode: 'HAZ-FLAM', description: 'Paint', weightKg: '10', unNumber: '12', properShippingName: 'Paint', hazardClass: '3' }), ctx(f))).toEqual(['unNumber']);
    expect(stepGaps('value', form({ declaredValue: '12500' }), ctx(f))).toEqual(['valueCurrency']);
    expect(stepGaps('value', form({ declaredValue: '12500', valueCurrency: 'KES' }), ctx(f))).toEqual([]);
    // The space it takes: more than nothing, at most 150 m³ — the box's own limits and the server's.
    expect(stepGaps('goods', form({ description: 'Foam', weightKg: '80', volumeM3: '200' }), ctx(f))).toEqual(['volumeM3']);
    expect(stepGaps('goods', form({ description: 'Foam', weightKg: '80', volumeM3: '2.5' }), ctx(f))).toEqual([]);
    // An order's day: needed, and not one that has gone (a load kept on the phone for days).
    const order = { ...ctx(f), contract: true };
    expect(stepGaps('carrier', form({ contractId: 'c1' }), order)).toEqual([]);
    expect(stepGaps('carrier', form({ contractId: 'c1', deliverOn: '' }), order)).toEqual(['deliverOn']);
    expect(stepGaps('carrier', form({ contractId: 'c1', deliverOn: '2026-11-01' }), order)).toEqual(['deliverOnGone']);
    // A collection day that has gone, which the server would quietly turn into "as soon as a carrier can".
    expect(stepGaps('when', form({ pickupOn: '2026-11-02' }), ctx(f))).toEqual(['pickupOnGone']);
    expect(stepGaps('when', form({ pickupOn: '2026-11-03' }), ctx(f))).toEqual([]);
    // What loadGaps says, it still says: nothing of it dropped.
    const full = form({ destCountry: 'UG', natureCode: 'HAZ-BIO', declaredValue: '5' });
    expect(postGaps(full, ctx(full)).filter((g) => g !== 'volumeM3')).toEqual(loadGaps({ ...full, crossing: true }));
  });

  // 2026-11-03 — the server's own rules for a range (heavy-cargo.ts, tempRangeGap), said beside it before Next.
  it('checks the temperature in words: both ends or neither, -30 to 30 °C, the lowest below the highest — of cold goods only', () => {
    const fresh = (over: Partial<PostForm>) => form({ natureCode: 'FOP', description: 'Fish', weightKg: '900', ...over });
    const f = form();
    expect(stepGaps('goods', fresh({}), ctx(f))).toEqual([]);
    expect(stepGaps('goods', fresh({ tempMinC: '-25', tempMaxC: '-18' }), ctx(f))).toEqual([]);
    expect(stepGaps('goods', fresh({ tempMinC: ' 2 ', tempMaxC: '8' }), ctx(f))).toEqual([]);
    expect(stepGaps('goods', fresh({ tempMinC: '-30', tempMaxC: '30' }), ctx(f))).toEqual([]);
    expect(stepGaps('goods', fresh({ tempMinC: '-25' }), ctx(f))).toEqual(['tempRange']);
    expect(stepGaps('goods', fresh({ tempMaxC: '8' }), ctx(f))).toEqual(['tempRange']);
    expect(stepGaps('goods', fresh({ tempMinC: 'cold', tempMaxC: '8' }), ctx(f))).toEqual(['tempRange']);
    expect(stepGaps('goods', fresh({ tempMinC: '-40', tempMaxC: '-18' }), ctx(f))).toEqual(['tempBounds']);
    expect(stepGaps('goods', fresh({ tempMinC: '2', tempMaxC: '31' }), ctx(f))).toEqual(['tempBounds']);
    expect(stepGaps('goods', fresh({ tempMinC: '8', tempMaxC: '2' }), ctx(f))).toEqual(['tempOrder']);
    expect(stepGaps('goods', fresh({ tempMinC: '4', tempMaxC: '4' }), ctx(f))).toEqual(['tempOrder']);
    // Only the goods step stops on it, and the check with it.
    for (const s of ['route', 'when', 'value', 'day'] as const) expect(stepGaps(s, fresh({ tempMinC: '8', tempMaxC: '2' }), ctx(f))).not.toContain('tempOrder');
    expect(stepGaps('check', fresh({ tempMinC: '8', tempMaxC: '2' }), ctx(f))).toContain('tempOrder');
    // A range typed, then the goods changed to ones not carried cold: nothing asked, nothing sent.
    expect(tempGaps(form({ natureCode: 'GEN', tempMinC: '8', tempMaxC: '2' }))).toEqual([]);
    expect(tempRangeOf(form({ natureCode: 'GEN', tempMinC: '2', tempMaxC: '8' }))).toBeNull();
    expect(tempRangeOf(fresh({ tempMinC: '-25', tempMaxC: '-18' }))).toEqual({ minC: -25, maxC: -18 });
    expect(tempRangeOf(fresh({ tempMinC: '-25' }))).toBeNull();
    // Said beside the boxes once Next is tapped, and not before.
    const wrong = fresh({ tempMinC: '8', tempMaxC: '2' });
    expect(at({ step: 'goods', form: wrong, tried: true })).toContain(t('business.post.need.tempOrder'));
    expect(at({ step: 'goods', form: wrong })).not.toContain(t('business.post.need.tempOrder'));
    expect(at({ step: 'goods', form: fresh({ tempMinC: '-25' }), tried: true })).toContain(t('business.post.need.tempRange'));
    expect(at({ step: 'goods', form: fresh({ tempMinC: '-45', tempMaxC: '-18' }), tried: true })).toContain(t('business.post.need.tempBounds'));
  });

  it('shows on the check the range it is kept in — or, none given, the usual 2 to 8 °C — for cold goods only', () => {
    const ready = form({ natureCode: 'FOP', description: 'Fish', fromSiteId: 's1', toSiteId: 's2', weightKg: '900' });
    const kept = at({ step: 'check', form: { ...ready, tempMinC: '-25', tempMaxC: '-18' }, sites: SITES });
    expect(kept).toMatch(new RegExp(`id="biz-post-goods"[\\s\\S]*${t('business.post.k.temp')}[\\s\\S]*-25 °C and -18 °C[\\s\\S]*id="biz-post-when"`));
    expect(kept).not.toContain(t('business.post.v.tempUsual'));
    expect(at({ step: 'check', form: ready, sites: SITES })).toContain(t('business.post.v.tempUsual'));
    // Half given: shown as typed, with what it needs under the part — never as the usual range.
    const half = at({ step: 'check', form: { ...ready, tempMinC: '-25' }, sites: SITES });
    expect(half).toContain('-25 °C and — °C');
    expect(half).not.toContain(t('business.post.v.tempUsual'));
    expect(half).toContain(t('business.post.need.tempRange'));
    expect(at({ step: 'check', form: { ...ready, natureCode: 'FOD', tempMinC: '-25', tempMaxC: '-18' }, sites: SITES })).not.toContain(t('business.post.k.temp'));
  });

  it('says what is missing beside its field once Next is tapped, and not before', () => {
    const tried = at({ step: 'route', form: form(), tried: true });
    expect(tried).toContain(t('business.loads.need.fromSiteId'));
    expect(tried).toContain(t('business.loads.need.toSiteId'));
    expect(at({ step: 'route', form: form() })).not.toContain(t('business.loads.need.fromSiteId'));
    const goods = at({ step: 'goods', form: form({ volumeM3: '400' }), tried: true });
    expect(goods).toContain(t('business.loads.need.description'));
    expect(goods).toContain(t('business.post.need.volumeM3'));
    expect(at({ step: 'carrier', form: form({ contractId: 'c1', deliverOn: '2026-11-01' }), contracts: [CONTRACT], tried: true })).toContain(t('business.post.need.deliverOnGone'));
  });

  it('shows on the check what each part still needs, under that part, with Change to it', () => {
    const html = at({ step: 'check', form: form({ description: 'Coffee' }), sites: SITES });
    expect(html).toContain(t('business.post.stillNeeds'));
    expect(html).toMatch(new RegExp(`id="biz-post-route">${t('business.post.step.route')}[\\s\\S]*${t('business.loads.need.fromSiteId')}[\\s\\S]*id="biz-post-goods"`));
    expect((html.match(new RegExp(`>${t('business.post.change')}</button>`, 'g')) ?? []).length).toBe(5);
    expect(html).toContain('aria-label="Change: What it is"');
  });
});

/*
 * THE SAME REQUEST AS THE ONE PAGE. Below is that page's own request, word for word as LoadsScreen.tsx had it at 6dbc2a57
 * (NewLoadPanel: its starting answers, its gate, its two ends and the body it sent) — kept here so the wizard is held to
 * it. The page is filled with every answer at once; the wizard step by step, each step taking only the answers it asks
 * (postFields), as a person does. The two requests must be the same, byte for byte.
 */
type OldForm = LoadForm & { volumeM3: string; truckFlight: boolean; flightAwb: string; flightNo: string; flightAirline: string; declaredValue: string; specialInterest: string; valueCurrency: string; noTranshipment: boolean; coverRequired: boolean; consigneeName: string; consigneeAddress: string; unNumber: string; properShippingName: string; hazardClass: string; packingGroup: string; customsInstructions: string; receiverRef: string; packaging: string; packages: string; destCountry: string; natureCode: string; fragile: boolean; commitMode: 'negotiate' | 'instant'; instructions: string; contactName: string; contactPhone: string; deliveryWindow: string; pickupOn: string; forClientId: string; contractId: string; deliverOn: string; orderRef: string };
const OLD_EMPTY: OldForm = { volumeM3: '', truckFlight: false, flightAwb: '', flightNo: '', flightAirline: '', declaredValue: '', specialInterest: '', valueCurrency: '', noTranshipment: false, coverRequired: false, consigneeName: '', consigneeAddress: '', unNumber: '', properShippingName: '', hazardClass: '', packingGroup: '', customsInstructions: '', description: '', fromSiteId: '', toSiteId: '', receivingPoint: '', receiverRef: '', weightKg: '', packaging: '', packages: '', destCountry: '', natureCode: 'GEN', fragile: false, commitMode: 'negotiate', instructions: '', contactName: '', contactPhone: '', deliveryWindow: '', pickupOn: '', forClientId: '', contractId: '', deliverOn: '', orderRef: '' };

function onePage(answers: Partial<OldForm>, env: { business: BusinessView; contracts: CarriageContract[]; receiving: typeof RECEIVING | null }): NewLoad | null {
  const { business } = env;
  const form: OldForm = { ...OLD_EMPTY, destCountry: business.country, deliverOn: nextDay(NOW), ...answers };
  const packages = Number(form.packages);
  const counted = Number.isInteger(packages) && packages >= 1 && packages <= 500 ? packages : undefined;
  const crossing = Boolean(form.destCountry && form.destCountry !== business.country);
  const dangerous = isDangerousNature(form.natureCode);
  const gaps = loadGaps({ ...form, crossing });
  const offered = orderableContracts(env.contracts, form.deliverOn || nextDay());
  const contract = offered.find((c) => c.contractId === form.contractId) ?? null;
  const receiving = env.receiving;
  if (gaps.length) return null;
  const sites = SITES;
  const from = sites.find((s) => s.siteId === form.fromSiteId);
  const to = receiving ? { name: `${receiving.name} — ${receiving.siteName}`, location: receiving.location } : sites.find((s) => s.siteId === form.toSiteId);
  if (!from || !to) return null;
  return {
    description: form.description.trim(),
    pickupLabel: from.name,
    pickupLocation: from.location,
    destLabel: to.name,
    destLocation: to.location,
    // A business sends from its own country; where the goods go is its choice, and a crossing is asked of a known one.
    pickupCountry: business.country,
    destCountry: form.destCountry || business.country,
    weightKg: Number(form.weightKg),
    ...(form.packaging ? { packaging: form.packaging } : {}),
    ...(counted ? { packages: counted } : {}),
    natureCode: form.natureCode,
    ...(form.consigneeName.trim() && !receiving ? { consignee: { name: form.consigneeName.trim(), ...(form.consigneeAddress.trim() ? { address: form.consigneeAddress.trim() } : {}) } } : {}),
    ...(dangerous ? { dangerousGoods: { unNumber: form.unNumber.trim(), properShippingName: form.properShippingName.trim(), hazardClass: form.hazardClass.trim(), ...(form.packingGroup ? { packingGroup: form.packingGroup } : {}) } } : {}),
    ...(crossing && form.customsInstructions.trim() ? { customsInstructions: form.customsInstructions.trim() } : {}),
    fragile: form.fragile,
    ...(form.coverRequired ? { coverRequired: true } : {}),
    ...(Number(form.declaredValue) > 0 && form.valueCurrency ? { declaredValue: { amount: Number(form.declaredValue), currency: form.valueCurrency } } : {}),
    ...(Number(form.specialInterest) > 0 && form.valueCurrency ? { specialInterest: { amount: Number(form.specialInterest), currency: form.valueCurrency } } : {}),
    ...(form.noTranshipment ? { noTranshipment: true } : {}),
    ...(Number(form.volumeM3) > 0 ? { volumeM3: Number(form.volumeM3) } : {}),
    ...(form.truckFlight && form.flightAwb.trim() && form.flightNo.trim() ? { truckFlight: { awb: form.flightAwb.trim(), flight: form.flightNo.trim(), ...(form.flightAirline.trim() ? { airline: form.flightAirline.trim() } : {}) } } : {}),
    commitMode: form.commitMode,
    ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
    ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
    ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
    ...(form.deliveryWindow.trim() ? { deliveryWindow: form.deliveryWindow.trim() } : {}),
    ...(form.pickupOn && !contract ? { scheduledPickupAt: new Date(`${form.pickupOn}T08:00:00`).toISOString() } : {}),
    ...(form.forClientId ? { forClientId: form.forClientId } : {}),
    // To another business's receiving point: it sees the load coming in, and its own number for the order with it.
    ...(receiving ? { receivingPoint: receiving.code, ...(form.receiverRef.trim() ? { receiverRef: form.receiverRef.trim() } : {}) } : {}),
    // Under a contract: the day it must arrive, and no pickup date of our own — the fleet plans when it collects.
    ...(contract ? { contractId: contract.contractId, deliverOn: form.deliverOn, ...(form.orderRef.trim() ? { orderRef: form.orderRef.trim() } : {}) } : {}),
  };
}

/** The wizard, filled step by step: each step takes only the answers it asks, and Next only where that step needs nothing. */
function stepByStep(answers: Partial<PostForm>, env: { business: BusinessView; contracts: CarriageContract[]; clients: Client[]; receiving: typeof RECEIVING | null }): { body: NewLoad; walked: PostStep[] } {
  const { business } = env;
  let f = startForm(business.country, NOW);
  const kind = () => {
    const offered = orderableContracts(env.contracts, f.deliverOn || nextDay());
    const contract = offered.find((c) => c.contractId === f.contractId) ?? null;
    const sentFor = business.activities.includes('expeditor') || env.clients.length > 0;
    return { contract, steps: postSteps({ choice: offered.length > 0 || sentFor, contract: Boolean(contract) }) };
  };
  const take = (step: PostStep) => {
    // A choice on a step can draw more of it (a contract its day and hours): what it now asks is answered too.
    for (let i = 0; i < 2; i++) {
      for (const k of postFields(step, Boolean(kind().contract))) if (k in answers) f = { ...f, [k]: answers[k] } as PostForm;
    }
  };
  const walked: PostStep[] = [];
  let step = kind().steps[0];
  for (let guard = 0; step !== 'check' && guard < 10; guard++) {
    take(step);
    walked.push(step);
    const { contract } = kind();
    const c = { crossing: Boolean(f.destCountry && f.destCountry !== business.country), contract: Boolean(contract), today: todayIn(NOW) };
    expect({ step, gaps: stepGaps(step, f, c) }).toEqual({ step, gaps: [] });
    step = postNext(step, kind().steps);
  }
  const { contract } = kind();
  expect(postGaps(f, { crossing: Boolean(f.destCountry && f.destCountry !== business.country), contract: Boolean(contract), today: todayIn(NOW) })).toEqual([]);
  const ends = loadEnds(SITES, f, env.receiving);
  expect(ends).not.toBeNull();
  return { body: loadBody(f, { country: business.country, ...ends!, receiving: env.receiving, contract }), walked };
}

const CASES: Array<{ name: string; answers: Partial<PostForm>; business?: BusinessView; contracts?: CarriageContract[]; clients?: Client[]; receiving?: typeof RECEIVING; walked: PostStep[] }> = [
  { name: 'a plain load on the board', answers: { description: 'Coffee, green beans', fromSiteId: 's1', toSiteId: 's2', weightKg: '18000' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
  {
    name: 'every answer a load in the country can have, for a client, priced at the board',
    business: business({ activities: ['shipper', 'expeditor'] }),
    clients: [CLIENT],
    answers: {
      forClientId: 'cl_1',
      description: '  Maize flour, 2 kg packets ',
      fromSiteId: 's1',
      toSiteId: 's2',
      consigneeName: ' Tana Mills ',
      consigneeAddress: 'Plot 4, Thika',
      natureCode: 'FOD',
      weightKg: '12000',
      packaging: 'palletised',
      packages: '24',
      volumeM3: '33.5',
      fragile: true,
      pickupOn: '2026-11-10',
      deliveryWindow: ' Weekdays 8–17 ',
      commitMode: 'instant',
      declaredValue: '1250000',
      specialInterest: '50000',
      valueCurrency: 'KES',
      noTranshipment: true,
      coverRequired: true,
      truckFlight: true,
      flightAwb: ' 176-12345675 ',
      flightNo: 'EK722',
      flightAirline: 'Emirates SkyCargo',
      instructions: 'Ring at the gate; forklift on site.',
      contactName: 'Joseph',
      contactPhone: '+254712345678',
    },
    walked: ['carrier', 'route', 'goods', 'when', 'value', 'day'],
  },
  { name: 'dangerous goods', answers: { description: 'Paint', fromSiteId: 's1', toSiteId: 's2', weightKg: '800', natureCode: 'HAZ-FLAM', unNumber: ' UN1263 ', properShippingName: 'Paint', hazardClass: '3', packingGroup: 'II', packaging: 'boxed', packages: '40' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
  { name: 'a load abroad', answers: { description: 'Cement', fromSiteId: 's1', toSiteId: 's2', weightKg: '28000', destCountry: 'UG', consigneeName: 'Kampala Build Co', consigneeAddress: 'Plot 9, Jinja Road, Kampala', packaging: 'bagged', packages: '500', customsInstructions: 'Cleared at Malaba by Swift Clearing' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
  { name: 'a load abroad, packed loose', answers: { description: 'Gravel', fromSiteId: 's1', toSiteId: 's2', weightKg: '30000', destCountry: 'TZ', consigneeName: 'Arusha Roads', consigneeAddress: 'Arusha', packaging: 'loose' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
  {
    name: 'an order under a contract (a collection day given before is dropped, as the page dropped it)',
    contracts: [CONTRACT],
    answers: { contractId: 'c1', deliverOn: '2026-11-05', orderRef: ' PO-7781 ', deliveryWindow: '08:00–12:00', description: 'Sugar', fromSiteId: 's1', toSiteId: 's2', weightKg: '15000', pickupOn: '2026-11-04', declaredValue: '900000', valueCurrency: 'KES' },
    walked: ['carrier', 'route', 'goods', 'value', 'day'],
  },
  { name: 'to another business’s receiving point, by its code', receiving: RECEIVING, answers: { description: 'Wheat', fromSiteId: 's1', receivingPoint: '7KQ3-PX9M', receiverRef: 'ORD-55', weightKg: '20000', commitMode: 'negotiate' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
  { name: 'a trucked flight ticked with no waybill: left out, as the page left it', answers: { description: 'Flowers', fromSiteId: 's1', toSiteId: 's2', weightKg: '300', truckFlight: true, flightNo: 'KQ100' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
  // 2026-11-03 — loads with no temperature given send the page's request still, byte for byte.
  { name: 'fresh food with no temperature given: kept at the usual 2–8 °C, the page’s request', answers: { description: 'Avocados', fromSiteId: 's1', toSiteId: 's2', weightKg: '900', natureCode: 'FOP', packaging: 'palletised', packages: '12' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
  { name: 'a range typed, then the goods changed to ones not carried cold: the range is not sent', answers: { description: 'Rice', fromSiteId: 's1', toSiteId: 's2', weightKg: '900', natureCode: 'FOD', tempMinC: '-25', tempMaxC: '-18' }, walked: ['route', 'goods', 'when', 'value', 'day'] },
];

describe('the same request as the one page, for the same answers', () => {
  it('starts from the same answers the page started from — and the temperature, which it never asked, empty', () => {
    expect(EMPTY_POST).toEqual({ ...OLD_EMPTY, tempMinC: '', tempMaxC: '' });
    expect(Object.keys(EMPTY_POST)).toEqual([...Object.keys(OLD_EMPTY), 'tempMinC', 'tempMaxC']);
    expect(startForm('KE', NOW)).toEqual({ ...OLD_EMPTY, destCountry: 'KE', deliverOn: '2026-11-04', tempMinC: '', tempMaxC: '' });
  });

  // 2026-11-03 — the one key the page never sent: the range fresh or frozen food is kept in, when it is given.
  it('sends a cold load the page’s request and its range — the range the one key more', () => {
    const env = { business: business(), contracts: [], clients: [], receiving: null };
    const answers = { description: 'Frozen tilapia', fromSiteId: 's1', toSiteId: 's2', weightKg: '900', natureCode: 'FOP', packaging: 'palletised', packages: '40', commitMode: 'instant' as const, tempMinC: '-25', tempMaxC: '-18' };
    const old = onePage(answers as Partial<OldForm>, env)!;
    const { body, walked } = stepByStep(answers, env);
    expect(walked).toEqual(['route', 'goods', 'when', 'value', 'day']);
    const { tempRange, ...rest } = body;
    expect(tempRange).toEqual({ minC: -25, maxC: -18 });
    expect(JSON.stringify(rest)).toBe(JSON.stringify(old));
    // Said with the goods, after what kind they are.
    expect(Object.keys(body).indexOf('tempRange')).toBe(Object.keys(body).indexOf('natureCode') + 1);
    // Under a contract as on the board: an order carries it too.
    const order = stepByStep({ ...answers, contractId: 'c1', deliverOn: '2026-11-05' }, { ...env, contracts: [CONTRACT] });
    expect(order.body).toMatchObject({ contractId: 'c1', tempRange: { minC: -25, maxC: -18 } });
  });

  for (const c of CASES) {
    it(c.name, () => {
      const env = { business: c.business ?? business(), contracts: c.contracts ?? [], clients: c.clients ?? [], receiving: c.receiving ?? null };
      const old = onePage(c.answers as Partial<OldForm>, env);
      expect(old).not.toBeNull();
      const { body, walked } = stepByStep(c.answers, env);
      expect(walked).toEqual(c.walked);
      expect(JSON.stringify(body)).toBe(JSON.stringify(old));
    });
  }

  it('keeps a price chosen on the board when the load is then ordered under a contract, as the page did', () => {
    const env = { business: business(), contracts: [CONTRACT], clients: [], receiving: null };
    const answers = { description: 'Tea', fromSiteId: 's1', toSiteId: 's2', weightKg: '5000', commitMode: 'instant' as const, contractId: 'c1' };
    const old = onePage(answers, env)!;
    const f = { ...startForm('KE', NOW), ...answers };
    expect(JSON.stringify(loadBody(f, { country: 'KE', ...loadEnds(SITES, f, null)!, receiving: null, contract: CONTRACT }))).toBe(JSON.stringify(old));
    expect(old.commitMode).toBe('instant');
  });
});

describe('nothing is sent before Post the load', () => {
  const io = (over: Partial<SendIo> = {}) => {
    const post = vi.fn(async () => ({ data: { freightId: 'fr_1', code: 'FRT-7QX2', status: 'available' } }));
    const sites = vi.fn(async () => ({ data: { sites: SITES } }));
    return { io: { sites, post, ...over } as SendIo, post, sites };
  };
  const ready = form({ description: 'Coffee', fromSiteId: 's1', toSiteId: 's2', weightKg: '18000' });
  const owner = draftOwner('ent_kudu', 'mem_1');

  it('sends nothing — not even a read — while an answer is missing', async () => {
    const { io: x, post, sites } = io();
    expect(await sendLoad(x, form({ description: 'Coffee' }), { country: 'KE', ctx: ctx(ready), receiving: null, contract: null, owner, store: memoryStore() })).toEqual({ refused: 'gaps' });
    expect(post).not.toHaveBeenCalled();
    expect(sites).not.toHaveBeenCalled();
  });

  it('sends the page’s own request once, and forgets the load kept on the phone only once the server has it', async () => {
    const store = memoryStore();
    keepLoadDraft(owner, { step: 'check', form: ready, toReceiver: false, typedCode: '' }, NOW.getTime(), store);
    const { io: x, post } = io();
    const sent = await sendLoad(x, ready, { country: 'KE', ctx: ctx(ready), receiving: null, contract: null, owner, store });
    expect(sent).toEqual({ posted: { freightId: 'fr_1', code: 'FRT-7QX2', status: 'available' } });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(loadBody(ready, { country: 'KE', from: SITES[0], to: SITES[1], receiving: null, contract: null }));
    expect(keptLoadDraft(owner, NOW.getTime(), store)).toBeNull();
  });

  it('sends a cold load’s range with it, and nothing while the range still needs something', async () => {
    const cold = { ...ready, natureCode: 'FOP', tempMinC: '1', tempMaxC: '4' };
    const { io: x, post } = io();
    await sendLoad(x, cold, { country: 'KE', ctx: ctx(cold), receiving: null, contract: null, owner, store: memoryStore() });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ natureCode: 'FOP', tempRange: { minC: 1, maxC: 4 } }));
    const upside = io();
    expect(await sendLoad(upside.io, { ...cold, tempMinC: '4', tempMaxC: '1' }, { country: 'KE', ctx: ctx(cold), receiving: null, contract: null, owner, store: memoryStore() })).toEqual({ refused: 'gaps' });
    expect(upside.post).not.toHaveBeenCalled();
  });

  it('keeps the load on the phone when the server refuses it, and says a place gone before sending anything', async () => {
    const store = memoryStore();
    keepLoadDraft(owner, { step: 'check', form: ready, toReceiver: false, typedCode: '' }, NOW.getTime(), store);
    const refused = io({ post: vi.fn(async () => ({ error: { title: 'Refused', detail: 'That day has gone — an order is for today or later' } })) });
    expect(await sendLoad(refused.io, ready, { country: 'KE', ctx: ctx(ready), receiving: null, contract: null, owner, store })).toEqual({ refused: 'server', error: 'That day has gone — an order is for today or later' });
    expect(keptLoadDraft(owner, NOW.getTime(), store)?.form.description).toBe('Coffee');
    const gone = io({ sites: vi.fn(async () => ({ data: { sites: [SITES[0]] } })) });
    expect(await sendLoad(gone.io, ready, { country: 'KE', ctx: ctx(ready), receiving: null, contract: null, owner, store })).toEqual({ refused: 'placeGone' });
    expect(gone.post).not.toHaveBeenCalled();
  });

  it('is sent from the last step only: one call, behind the check step’s button', () => {
    const src = readFileSync(join(HERE, 'screens/PostLoad.tsx'), 'utf8');
    expect(src.match(/sendLoad\(/g)).toHaveLength(1);
    expect(src.match(/\.postLoad\(/g)).toHaveLength(1);
    expect(src.match(/\bpost\(\)/g)).toHaveLength(1);
    expect(src).toContain("if (step === 'check') return post();");
    // Every other step's button goes on; only the check's posts.
    for (const step of ['route', 'goods', 'when', 'value', 'day'] as const) {
      const html = at({ step, form: ready });
      expect(html).not.toContain(t('business.post.postCta'));
      expect(html).toContain(`>${t('common.next')}</button>`);
    }
    expect(at({ step: 'check', form: ready, sites: SITES })).toContain(`>${t('business.post.postCta')}</button>`);
    expect(at({ step: 'check', form: { ...ready, contractId: 'c1' }, contracts: [CONTRACT], sites: SITES })).toContain(`>${t('business.post.orderCta', { fleet: 'Kilima Haulage' })}</button>`);
  });
});

describe('the check says who will see it', () => {
  const ready = form({ description: 'Coffee', fromSiteId: 's1', toSiteId: 's2', weightKg: '18000' });

  it('the board at once, read by every carrier, taken or priced as chosen — and that nothing is posted yet', () => {
    const html = at({ step: 'check', form: ready, sites: SITES });
    expect(html).toContain(t('business.post.l.check'));
    expect(html).toContain(t('business.post.seeBoardNow', { how: t('business.post.howNegotiate') }));
    expect(at({ step: 'check', form: { ...ready, commitMode: 'instant' }, sites: SITES })).toContain(t('business.post.seeBoardNow', { how: t('business.post.howInstant') }));
    // What it will say: the places by name, the kind of goods in words.
    expect(html).toContain('Kudu Mombasa Road');
    expect(html).toContain('Kudu Thika');
    expect(html).toContain('18,000 kg');
  });

  it('a collection day: seen by no carrier until 08:00 that day', () => {
    expect(at({ step: 'check', form: { ...ready, pickupOn: '2026-11-10' }, sites: SITES })).toContain(t('business.post.seeBoardFrom', { day: '2026-11-10', how: t('business.post.howNegotiate') }));
  });

  it('a contract: only that carrier, never the board; cover and a receiving point said as well', () => {
    const order = at({ step: 'check', form: { ...ready, contractId: 'c1', coverRequired: true }, contracts: [CONTRACT], sites: SITES });
    expect(order).toContain(t('business.post.seeContract', { fleet: 'Kilima Haulage', day: '2026-11-04' }));
    expect(order).toContain(t('business.post.seeCover'));
    expect(order).not.toContain(t('business.post.seeBoardNow', { how: t('business.post.howNegotiate') }));
    const to = at({ step: 'check', form: { ...ready, toSiteId: '', receivingPoint: RECEIVING.code }, toReceiver: true, receiving: RECEIVING, sites: SITES });
    expect(to).toContain(t('business.post.seeReceiver', { name: 'Tana Mills' }));
  });
});

describe('the load kept on the phone', () => {
  const owner = draftOwner('ent_kudu', 'mem_1');
  const started = form({ description: 'Coffee', weightKg: '18000' });

  it('keeps what was typed and where, per business and per person — and never what the server said', () => {
    const store = memoryStore();
    keepLoadDraft(owner, { step: 'goods', form: { ...started, receivingPoint: '7KQ3-PX9M' }, toReceiver: true, typedCode: '7kq3 px9m' }, NOW.getTime(), store);
    const back = keptLoadDraft(owner, NOW.getTime() + 3600_000, store)!;
    expect(back.step).toBe('goods');
    expect(back.form.description).toBe('Coffee');
    expect(back.typedCode).toBe('7kq3 px9m');
    // The point's code is looked up again when it is carried on: what it named is not on the phone.
    expect(back.form.receivingPoint).toBe('');
    expect([...store.m.values()].join('')).not.toContain('Tana Mills');
    expect(keptLoadDraft(draftOwner('ent_kudu', 'mem_2'), NOW.getTime(), store)).toBeNull();
    expect(keptLoadDraft(draftOwner('ent_other', 'mem_1'), NOW.getTime(), store)).toBeNull();
  });

  it('keeps a load only once something is typed', () => {
    const fresh = startForm('KE', NOW);
    expect(draftTouched({ form: fresh, toReceiver: false, typedCode: '' }, fresh)).toBe(false);
    expect(draftTouched({ form: { ...fresh, description: 'C' }, toReceiver: false, typedCode: '' }, fresh)).toBe(true);
    expect(draftTouched({ form: fresh, toReceiver: true, typedCode: '' }, fresh)).toBe(true);
  });

  it('forgets one older than three days, as it is read', () => {
    const store = memoryStore();
    keepLoadDraft(owner, { step: 'route', form: started, toReceiver: false, typedCode: '' }, NOW.getTime(), store);
    expect(keptLoadDraft(owner, NOW.getTime() + DRAFT_KEEP_MS - 1000, store)).not.toBeNull();
    expect(keptLoadDraft(owner, NOW.getTime() + DRAFT_KEEP_MS + 1000, store)).toBeNull();
    expect(store.m.size).toBe(0);
  });

  it('opens a load kept by an older version with what still fits, and nothing that does not', () => {
    const store = memoryStore();
    store.setItem(`sbg-load-draft:${owner}`, JSON.stringify({ step: 'nowhere', savedAt: NOW.getTime(), form: { description: 'Tea', weightKg: 900, commitMode: 'auction', gone: 'x' } }));
    const d = keptLoadDraft(owner, NOW.getTime(), store)!;
    expect(d.step).toBe('route');
    expect(d.form.description).toBe('Tea');
    expect(d.form.weightKg).toBe('');
    expect(d.form.commitMode).toBe('negotiate');
    expect('gone' in d.form).toBe(false);
    store.setItem(`sbg-load-draft:${owner}`, '{not json');
    expect(keptLoadDraft(owner, NOW.getTime(), store)).toBeNull();
  });

  it('drops one started again, and every one at sign-out — nothing else on the phone', () => {
    const store = memoryStore();
    keepLoadDraft(owner, { step: 'route', form: started, toReceiver: false, typedCode: '' }, NOW.getTime(), store);
    keepLoadDraft(draftOwner('ent_b', 'mem_9'), { step: 'route', form: started, toReceiver: false, typedCode: '' }, NOW.getTime(), store);
    store.setItem('sbg.lang', 'en');
    dropLoadDraft(owner, store);
    expect(keptLoadDraft(owner, NOW.getTime(), store)).toBeNull();
    expect(store.m.size).toBe(2);
    dropLoadDrafts(store);
    expect([...store.m.keys()]).toEqual(['sbg.lang']);
    const hook = readFileSync(join(HERE, 'useBusinessApp.ts'), 'utf8');
    expect(hook).toMatch(/signOut: \(\) => \{[^}]*dropLoadDrafts\(\);/);
  });

  it('is offered on opening Loads: carry on with it, or start again — and only to somebody who can post', () => {
    phone.m.clear();
    const loads = (b: BusinessView) => renderToString(<LoadsScreen business={b} actions={{} as never} client={null} />);
    expect(loads(business())).toContain(`>${t('business.loads.newCta')}</button>`);
    keepLoadDraft(owner, { step: 'goods', form: started, toReceiver: false, typedCode: '' });
    const html = loads(business());
    expect(html).toContain(t('business.post.keptTitle'));
    expect(html).toContain('Coffee');
    expect(html).toContain(`>${t('business.post.carryOn')}</button>`);
    expect(html).toContain(`>${t('business.post.startAgain')}</button>`);
    expect(html).not.toContain(`>${t('business.loads.newCta')}</button>`);
    expect(loads(business({ you: { ...business().you, role: 'viewer' } }))).not.toContain(t('business.post.carryOn'));
    phone.m.clear();
  });

  it('carries on at the step it was left on, with its answers', () => {
    const html = renderToString(<PostLoad business={business()} client={null} resume={{ step: 'goods', form: started, toReceiver: false, typedCode: '', savedAt: NOW.getTime() }} start={{ now: NOW, contracts: [], clients: [] }} onLeave={noop} onPosted={noop} onOpen={noop} onAnother={noop} />);
    expect(html).toContain(`tabindex="-1">${t('business.post.t.goods')}`);
    expect(html).toContain('value="Coffee"');
    expect(html).toContain('step 2 of 6');
  });
});

// 2026-11-03 — once posted, the load's own record says the range it is kept in, and whose range it is.
describe('the load’s Overview, kept cold', () => {
  const row = (over: Partial<PostedLoad> = {}) => ({ freightId: 'frt_9', code: 'FRT-9', description: 'Frozen tilapia', destLabel: 'Nakuru cold store', weightKg: 900, status: 'available', openProposals: 0, commitMode: 'instant', createdAt: '2026-11-03T08:00:00.000Z', ...over }) as unknown as PostedLoad;
  const detail = (r: PostedLoad) => renderToString(<LoadDetail row={r} business={business()} client={null} act onClose={noop} onChanged={noop} />);
  const facts = (html: string) => html.slice(html.indexOf('cons__facts'), html.indexOf('</dl>', html.indexOf('cons__facts')));

  it('says “Kept between” in the Overview, after the weight — the business’s own range, or the usual one', () => {
    const own = facts(detail(row({ keptBetween: { minC: -25, maxC: -18, own: true } })));
    expect(own).toContain(`<dt class="cons__factk">${t('business.post.k.temp')}</dt>`);
    expect(own).toContain('-25 °C and -18 °C');
    expect(own).toContain(t('business.loads.fact.keptOwn'));
    expect(own.indexOf(t('business.post.k.temp'))).toBeGreaterThan(own.indexOf(t('business.loads.fact.weight')));
    const usual = facts(detail(row({ keptBetween: { minC: 2, maxC: 8, own: false } })));
    expect(usual).toContain('2 °C and 8 °C');
    expect(usual).toContain(t('business.loads.fact.keptUsual'));
    expect(usual).not.toContain(t('business.loads.fact.keptOwn'));
    expect(detail(row())).not.toContain(t('business.post.k.temp'));
  });
});

describe('the done screen', () => {
  it('gives the load’s code, where it is now, and the two ways on — with no step bar and no Back', () => {
    const html = at({ step: 'done', form: form(), posted: { freightId: 'fr_1', code: 'FRT-7QX2', status: 'available', commitMode: 'negotiate' } });
    expect(html).toContain(t('business.post.doneTitle'));
    expect(html).toContain(`<p class="biz-post__code">FRT-7QX2</p>`);
    expect(html).toContain(`${t('business.post.doneBoard')} ${t('business.post.doneNegotiate')}`);
    expect(html).toContain(`>${t('business.post.open')}</button>`);
    expect(html).toContain(`>${t('business.post.another')}</button>`);
    expect(html).not.toContain('steps--pinned');
    expect(html).not.toContain(`>${t('common.back')}</button>`);
    expect(html).not.toContain(t('business.post.leave'));
  });

  it('says an order is with its carrier, and a load with a collection day waits for it', () => {
    const order = at({ step: 'done', form: form(), posted: { freightId: 'fr_2', code: 'FRT-8AB1', status: 'ordered', commitMode: 'negotiate', fleet: 'Kilima Haulage', day: '2026-11-05' } });
    expect(order).toContain(t('business.post.doneOrdered'));
    expect(order).toContain(t('business.post.doneContract', { fleet: 'Kilima Haulage', day: '2026-11-05' }));
    const at8 = new Date('2026-11-10T08:00:00').toISOString();
    expect(at({ step: 'done', form: form(), posted: { freightId: 'fr_3', code: 'FRT-9CD2', status: 'scheduled', commitMode: 'instant', scheduledPickupAt: at8 } })).toContain(t('business.post.doneFrom', { day: '2026-11-10' }));
  });
});

describe('a step up in type and room, inside the wizard only', () => {
  const css = readFileSync(join(HERE, 'business.css'), 'utf8');
  it('sets the console’s own tokens a step up on the wizard, and draws the wizard inside it', () => {
    const block = css.slice(css.indexOf('.biz-post {'), css.indexOf('}', css.indexOf('.biz-post {')));
    expect(block).toContain('--c-fs: 16px;');
    expect(block).toContain('--c-fs-sm: 14px;');
    expect(block).toContain('--c-ctl-h: 44px;');
    expect(css).toMatch(/\.biz-post \.cfield__label \{\s*margin-bottom: 6px;\s*font-size: 15px;/);
    expect(css).toMatch(/\.biz-post \.cfield \{\s*margin-bottom: 24px;/);
    expect(at({ step: 'route', form: form() })).toMatch(/^<form class="biz-post biz-wiz"/);
  });

  it('changes nothing else in the console: every new rule is the wizard’s, and the console keeps its own scale', () => {
    // The wizard's block is the file's last: from its heading to the end, comments set aside, every rule's selector.
    const part = css.slice(css.lastIndexOf('/*', css.indexOf('posting a load, one step per screen (2026-11-03)'))).replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...part.matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(20);
    expect(selectors.filter((s) => !s.split(',').every((one) => /^\.biz-post|^\.biz \.cons__main:has\(\.biz-post\)$/.test(one.trim())))).toEqual([]);
    const console_ = readFileSync('src/shared/console.css', 'utf8');
    expect(console_).toMatch(/--c-fs: 13px;\s*--c-fs-sm: 12px;/);
  });

  it('pins its step bar under the console’s mast', () => {
    expect(css).toMatch(/\.biz-post \.steps--pinned \{\s*top: var\(--c-mast-h\);/);
    expect(css).toMatch(/\.biz \.cons__main:has\(\.biz-post\) \{\s*overflow-x: clip;/);
  });
});
