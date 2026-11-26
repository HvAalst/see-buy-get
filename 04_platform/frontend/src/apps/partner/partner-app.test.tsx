import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { PartnerPeopleBody, type PartnerMemberRow } from '../tower/screens/PartnerPeopleFold';
import type { PartnerMoney, PartnerOwed, PartnerPayouts } from './api';
import { MoneyBody } from './screens/MoneyScreen';
import { openOnArrival } from './logic';
import { OwedBody } from './screens/HomeScreen';
import { HandsBody } from './screens/HandsScreen';
import { ChooseScreen } from './screens/ChooseScreen';

/*
 * 2026-11-20 — THE PARTNER APP (the payments plan, 3c; the owner: "console for staff and partner app with live view"; a
 * separate Partner app). What is held to here: a partner's own people see what it owes — in all, every step with which work,
 * whose and for which parcel or bag, a step taken back marked as such — and per hand, each by its name; live or not live is
 * always said; somebody in no partner yet is told who adds them and which number to give; our staff add a partner's people
 * by number and name and take them out by name; and the app is wired to its own doors, its live view and every app list.
 */
const tt = t as never;
const owed = (over: Partial<PartnerOwed> = {}): PartnerOwed => ({
  partnerEntityId: 'partner-et',
  partnerName: 'Addis Courier PLC',
  currency: 'ETB',
  owed: 340,
  byPayee: [
    { payeeId: 'did:glos:courier', payeeKind: 'driver', amount: 300, steps: 1 },
    { payeeId: 'did:glos:shop-bole', payeeKind: 'shop', amount: 40, steps: 1 },
  ],
  lines: [
    { lineId: 'po_2', partnerName: 'Addis Courier PLC', payeeId: 'did:glos:courier', payeeKind: 'driver', amount: 300, currency: 'ETB', reference: 'T-0412', step: 'haul', work: 'road', at: '2026-11-20T13:05:00Z' },
    { lineId: 'po_1', partnerName: 'Addis Courier PLC', payeeId: 'did:glos:shop-bole', payeeKind: 'shop', amount: 40, currency: 'ETB', reference: 'PUD-1', step: 'labour', work: 'take_in', at: '2026-11-20T09:14:00Z' },
    { lineId: 'po_3', partnerName: 'Addis Courier PLC', payeeId: 'did:glos:shop-bole', payeeKind: 'shop', amount: -40, currency: 'ETB', reference: 'PUD-9', step: 'labour', work: 'take_in', at: '2026-11-20T09:20:00Z', takenBack: true },
  ],
  names: { 'did:glos:courier': 'Driver A.', 'did:glos:shop-bole': 'Bole Duka' },
  ...over,
});

describe('what we owe', () => {
  it('in all, then every step: which work, whose, for which parcel or bag — a step taken back marked', () => {
    const html = renderToString(<OwedBody owed={owed()} failed={false} live="live" t={tt} />);
    expect(html).toContain('What we owe');
    expect(html).toMatch(/ETB.*340.*owed in all/);
    expect(html).toContain('On the road');
    expect(html).toContain('Driver A. · T-0412');
    expect(html).toContain('Taken in');
    expect(html).toContain('Bole Duka · PUD-1');
    expect(html.match(/>taken back</g)).toHaveLength(1);
    expect(html).toContain('>Live<');
    // 4c — each hand is paid once a day.
    expect(html).toContain('Each hand is paid once a day from your account, to the payout number it set.');
  });

  it('not live, or a read that failed: said, the figures kept', () => {
    const html = renderToString(<OwedBody owed={owed()} failed live="connecting" t={tt} />);
    expect(html).toContain('Not live: read again when the connection is back');
    expect(html).toContain('That could not be read. Try again in a moment.');
    expect(html).toMatch(/owed in all/);
  });

  it('nothing owed yet, said as that; before the first read, nothing claimed', () => {
    expect(renderToString(<OwedBody owed={owed({ owed: 0, byPayee: [], lines: [] })} failed={false} live="live" t={tt} />)).toContain('Nothing owed yet. Each step shows here as it is done.');
    const before = renderToString(<OwedBody owed={null} failed={false} live="off" t={tt} />);
    expect(before).toContain('aria-busy="true"');
    expect(before).not.toContain('Nothing owed yet');
  });
});

describe('its payouts (4c)', () => {
  const payouts = (over: Partial<PartnerPayouts> = {}): PartnerPayouts => ({ currency: 'ETB', waiting: 2, waitingAmount: 340, shortAmount: 300, paidAmount: 40, rows: [], ...over });

  it('what waits for the account to hold enough, first and as a warning; what waits in all; paid so far and still to pay; a paid step tagged', () => {
    const paidLine = owed({ lines: owed().lines.map((l) => (l.lineId === 'po_1' ? { ...l, paid: true } : l)) });
    const html = renderToString(<OwedBody owed={paidLine} payouts={payouts()} failed={false} live="live" t={tt} />);
    expect(html).toMatch(/class="cerr">[^<]*300[^<]* of payouts wait for your account to hold enough/);
    expect(html).toMatch(/2 payouts wait, [^<]*340[^<]* in all\./);
    expect(html).toMatch(/Paid out so far: [^<]*40[^<]*\. Still to pay: [^<]*300/);
    expect(html.match(/>paid</g)).toHaveLength(1);
    expect(html.indexOf('of payouts wait')).toBeLessThan(html.indexOf('payouts wait, '));
  });

  it('nothing waiting, nothing paid yet: nothing said of payouts', () => {
    const html = renderToString(<OwedBody owed={owed()} payouts={payouts({ waiting: 0, waitingAmount: 0, shortAmount: 0, paidAmount: 0 })} failed={false} live="live" t={tt} />);
    expect(html).not.toContain('payouts wait');
    expect(html).not.toContain('Paid out so far');
  });
});

describe('per hand', () => {
  it('each shop, hub and driver by its name, what it is owed in all, and for how many steps', () => {
    const html = renderToString(<HandsBody owed={owed()} live="live" t={tt} />);
    expect(html).toContain('Per hand');
    expect(html).toContain('Driver A.');
    expect(html).toContain('Courier');
    expect(html).toContain('Bole Duka');
    expect(html).toContain('1 step');
    expect(html.indexOf('Driver A.')).toBeLessThan(html.indexOf('Bole Duka'));
    // A hand whose name is not known is shown by its id, never left out.
    expect(renderToString(<HandsBody owed={owed({ names: {} })} live="live" t={tt} />)).toContain('did:glos:courier');
  });
});

describe('the partners a person is in', () => {
  const state = (memberships: unknown[], phone = '+251911000111') => ({ memberships, busy: false, error: null, phone }) as never;
  const actions = { accept: () => undefined, decline: () => undefined, open: () => undefined, signOut: () => undefined } as never;

  it('an invitation to answer, a company to open', () => {
    const html = renderToString(<ChooseScreen state={state([{ memberId: 'pm_1', entityId: 'p1', name: 'Addis Courier PLC', country: 'ET', state: 'invited', invitedBy: 'Amina Otieno' }, { memberId: 'pm_2', entityId: 'p2', name: 'Hawassa Express', country: 'ET', state: 'joined', invitedBy: 'Amina Otieno' }])} actions={actions} />);
    expect(html).toContain('You are asked to join');
    expect(html).toContain('Amina Otieno added you · ET');
    expect(html).toContain('>Join<');
    expect(html).toContain('Hawassa Express');
  });

  it('in none yet: who adds them, and the number to give', () => {
    expect(renderToString(<ChooseScreen state={state([])} actions={actions} />)).toContain('SeeBuyGet’s staff add a partner’s people by the phone number they sign in with: ask them to add +251911000111.');
  });

  it('opens by itself only when there is nothing to answer and one company to open', () => {
    const m = (state: 'invited' | 'joined', entityId: string) => ({ memberId: entityId, entityId, name: entityId, country: 'ET', state, invitedBy: 'x' });
    expect(openOnArrival([m('joined', 'p1')], null)).toBe('p1');
    expect(openOnArrival([m('joined', 'p1'), m('joined', 'p2')], null)).toBeNull();
    expect(openOnArrival([m('joined', 'p1'), m('joined', 'p2')], 'p2')).toBe('p2');
    expect(openOnArrival([m('joined', 'p1'), m('invited', 'p2')], 'p1')).toBeNull();
  });
});

describe('a partner’s people, for our staff', () => {
  const row = (over: Partial<PartnerMemberRow> = {}): PartnerMemberRow => ({ memberId: 'pm_1', name: 'Selam Tesfaye', phoneEnds: '111', state: 'joined', invitedBy: 'Amina Otieno', invitedAt: '2026-11-20T10:00:00Z', ...over });

  it('who is in it, invited, said no or taken out — added by number and name, taken out by name', () => {
    const html = renderToString(<PartnerPeopleBody rows={[row(), row({ memberId: 'pm_2', name: 'Dawit', state: 'invited' }), row({ memberId: 'pm_3', name: 'Hana', state: 'removed', removedBy: 'Brian Otieno' })]} t={tt} onAdd={() => undefined} onRemove={() => undefined} />);
    expect(html).toContain('Their phone number');
    expect(html).toContain('>Add<');
    expect(html).toContain('In the app');
    expect(html).toContain('Invited');
    expect(html).toContain('Taken out');
    expect(html).toContain('Number ending 111 · Added by Amina Otieno, 2026-11-20 10:00');
    expect(html).toContain('taken out by Brian Otieno');
    // "Take out" for who is in it or invited — never for who already is out.
    expect(html.match(/>Take out</g)).toHaveLength(2);
    expect(renderToString(<PartnerPeopleBody rows={[]} t={tt} />)).toContain('Nobody yet.');
  });
});

describe('its money (4e)', () => {
  const money = (over: Partial<PartnerMoney> = {}): PartnerMoney => ({
    currency: 'ETB',
    balance: 935,
    test: true,
    paidIn: 1250,
    givenBack: 250,
    paidOut: 65,
    waiting: 1,
    waitingAmount: 300,
    shortAmount: 300,
    feeOwed: 30,
    ins: [
      { reference: 'PUD-2', amount: 1000, currency: 'ETB', state: 'paid', at: '2026-11-21T09:00:00Z' },
      { reference: 'PUD-1', amount: 250, currency: 'ETB', state: 'paid', at: '2026-11-21T08:00:00Z', givenBack: true },
      { reference: 'PUD-3', amount: 250, currency: 'ETB', state: 'asked', at: '2026-11-21T09:30:00Z' },
    ],
    payouts: [
      { payoutId: 'pp_1', payeeId: 'did:glos:shop-bole', payeeKind: 'shop', amount: 65, currency: 'ETB', steps: 2, state: 'paid', day: '2026-11-21' },
      { payoutId: 'pp_2', payeeId: 'did:glos:courier', payeeKind: 'driver', amount: 300, currency: 'ETB', steps: 1, state: 'waiting', why: 'balance', day: '2026-11-21' },
    ],
    names: { 'did:glos:shop-bole': 'Bole Duka', 'did:glos:courier': 'Driver A.' },
    ...over,
  });

  it('paid in, given back, paid out and waiting — what the account holds, test money said, a short account warned, our fee it owes', () => {
    const html = renderToString(<MoneyBody money={money()} failed={false} live="live" t={tt} />);
    expect(html).toMatch(/Your account holds [^<]*935/);
    expect(html).toContain('>Test money<');
    expect(html).toMatch(/Paid in<\/span>[\s\S]*?1,250/);
    expect(html).toMatch(/[^<]*250[^<]* given back/);
    expect(html).toMatch(/Paid out<\/span>[\s\S]*?65/);
    expect(html).toMatch(/1 payout waits, [^<]*300[^<]* in all\./);
    expect(html).toMatch(/class="cerr">[^<]*300[^<]* of payouts wait for your account to hold enough/);
    expect(html).toMatch(/Our fee you owe so far: [^<]*30[^<]*\. It is a loan until a company of ours can invoice it\./);
    expect(html).toContain('>Live<');
  });

  it('each sender’s payment by its parcel — paid, waiting on the phone, given back — never a phone; each payout by the hand’s name, and why it waits', () => {
    const html = renderToString(<MoneyBody money={money()} failed={false} live="live" t={tt} />);
    expect(html).toContain('PUD-2');
    expect(html).toContain('Waiting on the phone');
    expect(html.match(/>given back</g)).toHaveLength(1);
    expect(html).toContain('Bole Duka');
    expect(html).toContain('Driver A.');
    expect(html).toContain('Waits: your account does not hold enough');
    expect(html).toContain('2 steps');
    expect(html).not.toMatch(/did:glos:/);
  });

  it('nothing yet, said as that; before the first read, nothing claimed', () => {
    const none = renderToString(<MoneyBody money={money({ ins: [], payouts: [], paidIn: 0, givenBack: 0, paidOut: 0, waiting: 0, waitingAmount: 0, shortAmount: 0, balance: undefined, test: false })} failed={false} live="off" t={tt} />);
    expect(none).toContain('No payments yet.');
    expect(none).toContain('No payouts yet.');
    expect(none).not.toContain('Your account holds');
    expect(none).not.toContain('class="cerr"');
    expect(renderToString(<MoneyBody money={null} failed={false} live="off" t={tt} />)).toContain('aria-busy="true"');
  });
});

describe('wired', () => {
  const read = (...p: string[]) => readFileSync(join('src', ...p), 'utf8');

  it('4e — a Money section, read with what it owes, from its own door', () => {
    const app = read('apps', 'partner', 'app.tsx');
    expect(app).toContain("const ORDER: Section[] = ['home', 'hands', 'money'];");
    // 2026-11-26 — with the actions, for connecting its own Mollie account (counter-mollie.test.tsx).
    expect(app).toContain("state.section === 'money' ? <MoneyScreen state={state} actions={actions} />");
    expect(read('apps', 'partner', 'api.ts')).toMatch(/money: \(\) => call\(\(c\) => c\.GET\('\/v1\/sbg\/partner\/me\/money'/);
    expect(read('apps', 'partner', 'usePartnerApp.ts')).toContain('partner.current.money()');
    for (const locale of ['sw', 'nl', 'am']) expect(read('shared', 'i18n', 'words', locale, 'partner.ts')).toContain('"partner.app.money.fee"');
  });

  it('to its own doors: a person’s list and invitations, a session for one partner, and what it owes', () => {
    const api = read('apps', 'partner', 'api.ts');
    expect(api).toMatch(/c\.GET\('\/v1\/sbg\/partner\/mine'/);
    expect(api).toMatch(/c\.POST\('\/v1\/sbg\/partner\/invitations\/\{memberId\}\/accept'/);
    expect(api).toMatch(/c\.POST\('\/v1\/sbg\/partner\/\{entityId\}\/session'/);
    expect(api).toMatch(/c\.GET\('\/v1\/sbg\/partner\/me\/owed'/);
    // Both sessions in the tab only; signing out drops both.
    expect(api).toMatch(/const PERSON_TOKEN = 'sbg:partner:person';/);
    expect(api).toMatch(/globalThis\.sessionStorage\?\.removeItem\(PERSON_TOKEN\);\s*globalThis\.sessionStorage\?\.removeItem\(PARTNER_TOKEN\);/);
  });

  it('live: what the partner owes is read again when a step is owed or taken back, and kept no copy of', () => {
    const hook = read('apps', 'partner', 'usePartnerApp.ts');
    expect(hook).toMatch(/openLive\(\{[\s\S]{0,400}if \(topics\.includes\('owed'\)\) reads\.tell\(\);/);
    expect(hook).toMatch(/throttleReads\(refresh, LIVE_READ_GAP_MS\)/);
    expect(read('apps', 'partner', 'main.tsx')).toMatch(/keepNoReads\(\);[\s\S]*render\(<App \/>/);
  });

  it('on our staff’s page for the partner, and in every list of apps', () => {
    expect(read('apps', 'tower', 'screens', 'CompanyRecordScreen.tsx')).toMatch(/<PartnerPeopleFold entityId=\{entityId\} load=\{\(id\) => client\.api\.partnerMembers\(id\)\} add=\{\(id, phone, name\) => client\.api\.invitePartnerMember\(id, phone, name\)\} remove=\{\(id, memberId\) => client\.api\.removePartnerMember\(id, memberId\)\} \/>/);
    expect(read('shared', 'ui', 'AppLauncher.tsx')).toMatch(/\{ id: 'partner', path: 'partner\/', name: 'launcher\.app\.partner' \}/);
    expect(read('apps', 'home', 'logic.ts')).toMatch(/\{ id: 'partner', key: 'glos-partner-did', href: '\/partner\/', icon: 'wallet' \}/);
    expect(readFileSync('Caddyfile', 'utf8')).toMatch(/@app path_regexp app \^\/\(driver\|agent\|send\|fleet\|mdp\|vendor\|business\|partner\)\//);
    expect(readFileSync('scripts/push-sw.js', 'utf8')).toMatch(/'\/partner\/'/);
  });

  it('said the right way round: the partner owes, in every language', () => {
    const words = (l: string) => read('shared', 'i18n', 'words', l, 'partner.ts');
    expect(words('sw')).toContain('"partner.app.owed.total": "{amount} tunadaiwa kwa jumla"');
    expect(words('am')).toContain('"partner.app.owed.total": "በአጠቃላይ {amount} ዕዳ አለብን"');
    expect(words('nl')).toContain('"partner.app.owed.total": "{amount} verschuldigd in totaal"');
    const en = read('shared', 'i18n', 'catalogs', 'en.partner.ts');
    const keys = [...en.matchAll(/'(partner\.app\.[a-zA-Z_.]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(50);
    for (const l of ['sw', 'nl', 'am']) expect(keys.filter((k) => !words(l).includes(`"${k}":`))).toEqual([]);
  });
});
