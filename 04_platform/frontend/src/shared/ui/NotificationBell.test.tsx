import { afterEach, describe, expect, it } from 'vitest';
import { options, type VNode } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { ConversationsApi } from '../../lib/sbg';
import { findChat } from '../conversation/LinkedChat';
import { t } from '../i18n';
import { onLaunch, resetLaunchForTests, type LinkKind } from '../launch';
import type { InboxItem } from '../push';
import { NotificationRow, noticeAction, type NoticeAct, type NotificationRowProps } from './NotificationBell';
import { driverNoticeAct } from '../../apps/driver/notices';

/*
 * 2026-11-02 — A NOTICE'S OWN BUTTONS (the owner: "on the notifications on the start screen I need a 'mark as read' or
 * 'respond' button, is that possible?"). Under each notice in the bell: Mark as read while it is unread, which marks that
 * one and opens nothing; and the one thing to do about it — the app's own act, Reply for a chat, Open for a place in the
 * app — which marks it read and goes where the notice points, the way a tapped notification does.
 */

const notice = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'n-1',
  kind: 'claim_opened',
  title: 'A claim on BK-1',
  body: 'Damaged: two cartons crushed. Answer it under Runs: accept it, or refuse it with your reason.',
  link: '/?go=runs',
  createdAt: '2026-11-02T08:00:00.000Z',
  ...over,
});

/** Every element made while rendering — so a test can press a button a string of HTML cannot. */
function captureWhile(render: () => string): { html: string; made: VNode[] } {
  const made: VNode[] = [];
  const before = options.vnode;
  options.vnode = (v) => {
    made.push(v);
    before?.(v);
  };
  try {
    return { html: render(), made };
  } finally {
    options.vnode = before;
  }
}

const noop = () => undefined;
const row = (over: Partial<NotificationRowProps> = {}) => {
  const props: NotificationRowProps = { item: notice(), open: false, onToggle: noop, onRead: noop, ...over };
  return captureWhile(() => renderToString(<NotificationRow {...props} />));
};
/** The buttons under the notice, by their words. */
const actsOf = (made: VNode[]) =>
  made.filter((v) => (v.type === 'button' || v.type === 'a') && (v.props as { class?: string }).class === 'nitem__act') as Array<VNode<{ onClick?: () => void; href?: string; children?: unknown }>>;
const labelled = (made: VNode[], words: string) => actsOf(made).find((v) => v.props.children === words);
/** The notice itself — the row a tap lands on. */
const rowOf = (made: VNode[]) =>
  made.find((v) => (v.type === 'button' || v.type === 'a') && /^nitem( |$)/.test(String((v.props as { class?: string }).class))) as VNode<{ onClick: () => void; href?: string; 'aria-expanded'?: boolean }>;

/** The places an app opens from a link, as its screens and layers listen for them (shared/launch.ts). */
const APP_LISTENS: Record<string, LinkKind[]> = {
  driver: ['go', 'offer', 'chat'],
  fleet: ['go', 'chat'],
  agent: ['go', 'chat', 'load', 'run'],
  vendor: ['go', 'chat', 'load'],
  send: ['go', 'parcel', 'chat'],
  business: ['go', 'load', 'run', 'export', 'import'],
  mdp: ['go'],
};
const asApp = (app: keyof typeof APP_LISTENS) => {
  resetLaunchForTests();
  const got: Array<[LinkKind, unknown]> = [];
  for (const k of APP_LISTENS[app]) onLaunch(k, (v) => got.push([k, v]));
  return got;
};

afterEach(() => resetLaunchForTests());

describe('a notice in the bell: one tap opens where it leads', () => {
  it('a notice with somewhere to go is itself the button, and says where it goes; Mark as read under it — never a solid button', () => {
    asApp('fleet');
    const { html, made } = row();
    expect(rowOf(made).type).toBe('button');
    expect(html).toContain(`<span class="nitem__go">${t('notify.open')}`);
    // It does not open in full: the place it leads to says it all.
    expect(rowOf(made).props['aria-expanded']).toBeUndefined();
    expect(labelled(made, t('notify.markRead'))).toBeTruthy();
    // The one thing to do is the row: not a second button under it.
    expect(labelled(made, t('notify.open'))).toBeUndefined();
    expect(html).toContain('class="nrow nrow--unread"');
    expect(html).not.toMatch(/class="btn/);
    expect(html).toContain(`aria-label="${t('notify.markRead')}: A claim on BK-1"`);
  });

  it('one tap marks it read, closes the bell and goes where the link points', () => {
    const got = asApp('fleet');
    const read: string[] = [];
    const toggled: string[] = [];
    let closed = 0;
    const { made } = row({ onRead: () => read.push('n-1'), onToggle: () => toggled.push('n-1'), onActed: () => (closed += 1) });
    rowOf(made).props.onClick();
    expect(read).toEqual(['n-1']);
    expect(closed).toBe(1);
    expect(toggled).toEqual([]);
    expect(got).toEqual([['go', 'runs']]);
  });

  it('a notice with nowhere to go opens in full on a tap, and is marked read — it goes nowhere', () => {
    const got = asApp('fleet');
    const read: string[] = [];
    const toggled: string[] = [];
    let closed = 0;
    const { html, made } = row({ item: notice({ kind: 'security', link: '/' }), onRead: () => read.push('n-1'), onToggle: () => toggled.push('n-1'), onActed: () => (closed += 1) });
    expect(html).not.toContain('nitem__go');
    expect(rowOf(made).props['aria-expanded']).toBe(false);
    rowOf(made).props.onClick();
    expect(toggled).toEqual(['n-1']);
    expect(read).toEqual(['n-1']);
    expect(closed).toBe(0);
    expect(got).toEqual([]);
  });

  it('a read notice: no Mark as read; a tap still opens its place', () => {
    const got = asApp('fleet');
    const { made } = row({ item: notice({ readAt: '2026-11-02T09:00:00.000Z' }) });
    expect(labelled(made, t('notify.markRead'))).toBeUndefined();
    rowOf(made).props.onClick();
    expect(got).toEqual([['go', 'runs']]);
  });

  it('a shared inbox read by somebody who may not mark it: no Mark as read, and a tap opens without marking', () => {
    const got = asApp('business');
    const { made } = row({ item: notice({ kind: 'contract_offered', link: '/?go=contracts' }), onRead: undefined });
    expect(labelled(made, t('notify.markRead'))).toBeUndefined();
    rowOf(made).props.onClick();
    expect(got).toEqual([['go', 'contracts']]);
  });

  it('nothing under a notice that only says something, once it is read', () => {
    asApp('fleet');
    const { html } = row({ item: notice({ kind: 'security', link: '/', readAt: '2026-11-02T09:00:00.000Z' }) });
    expect(html).not.toContain('nitem__acts');
  });

  it('Mark as read marks that one only, and opens nothing', () => {
    const got = asApp('fleet');
    const read: string[] = [];
    const toggled: string[] = [];
    const acted: string[] = [];
    const two = [notice({ id: 'a' }), notice({ id: 'b', title: 'Space sold on Nairobi–Mombasa', kind: 'space_sold' })].map((item) =>
      row({ item, onRead: () => read.push(item.id), onToggle: () => toggled.push(item.id), onActed: () => acted.push(item.id) }),
    );
    labelled(two[1].made, t('notify.markRead'))!.props.onClick!();
    expect(read).toEqual(['b']);
    expect(toggled).toEqual([]);
    expect(acted).toEqual([]);
    expect(got).toEqual([]);
  });

  it('a long notice with a place offers all of it under it — shown in the bell, and nothing followed', () => {
    const got = asApp('fleet');
    const toggled: string[] = [];
    const long = 'Damaged: two cartons crushed — they put it at 4,500 KES. Answer it under Runs: accept it, or refuse it with your reason, before the shipper asks again.';
    const { made } = row({ item: notice({ body: long }), onToggle: () => toggled.push('n-1') });
    // 2026-11-12 — the owner: it opens the rest of a long notice, so it says "Show more", never "Show all".
    expect(t('notify.showAll')).toBe('Show more');
    labelled(made, t('notify.showAll'))!.props.onClick!();
    expect(toggled).toEqual(['n-1']);
    expect(got).toEqual([]);
    // A short one has nothing more to show.
    expect(labelled(row({ item: notice({ body: 'Answer it under Runs.' }) }).made, t('notify.showAll'))).toBeUndefined();
  });

  it('a chat message is answered in its chat: Reply, into that conversation', () => {
    const got = asApp('driver');
    const { html, made } = row({ item: notice({ kind: 'message', title: 'New message about FR-001', link: '/?chat=cv_1a2b', data: { conversationId: 'cv_1a2b' } }) });
    expect(html).toContain(`<span class="nitem__go">${t('notify.reply')}`);
    rowOf(made).props.onClick();
    expect(got).toEqual([['chat', 'cv_1a2b']]);
  });

  it('the page of a new version of the terms: the row is a link to it, outside the app — and reading it is reading the notice', () => {
    asApp('agent');
    const read: string[] = [];
    const { made } = row({ item: notice({ kind: 'terms_updated', link: '/terms/ke' }), onRead: () => read.push('n-1') });
    const a = rowOf(made);
    expect(a.type).toBe('a');
    expect(a.props.href).toBe('/terms/ke');
    a.props.onClick();
    expect(read).toEqual(['n-1']);
  });
});

describe('what each kind of notice offers, in the app that reads it', () => {
  // The apps' own acts, as their shells give them (apps/fleet/app.tsx, apps/driver/app.tsx).
  const fleetAct: NoticeAct = (it) => (it.kind === 'contract_asked' && typeof it.data?.entityId === 'string' ? { label: 'Record a contract with Jenga', run: noop } : null);
  // The Driver app's own, as its shell gives it: what is answered in its fleet sheet.
  const driverAct: NoticeAct = driverNoticeAct(t, noop);
  const ACTS: Partial<Record<keyof typeof APP_LISTENS, NoticeAct>> = { fleet: fleetAct, driver: driverAct };

  // [kind, the link the server sends, the app that reads it, what the row offers (null: Mark as read alone)]
  const TABLE: Array<[string, string | undefined, keyof typeof APP_LISTENS, string | null, Record<string, unknown>?]> = [
    ['message', '/?chat=cv_1', 'driver', 'notify.reply'],
    ['message', '/?chat=cv_1', 'agent', 'notify.reply'],
    ['message', '/?chat=cv_1', 'vendor', 'notify.reply'],
    ['message', '/?chat=cv_1', 'send', 'notify.reply'],
    // Sent before message notices carried a link: its conversation still names where it is answered.
    ['message', undefined, 'driver', 'notify.reply', { conversationId: 'cv_1' }],
    // A business has no chats: nothing to offer but Mark as read.
    ['message', '/?chat=cv_1', 'business', null],
    ['claim_opened', '/?go=runs', 'fleet', 'notify.open'],
    ['space_sold', '/?go=runs', 'fleet', 'notify.open'],
    ['order_handed_on', '/?go=orders', 'fleet', 'notify.open'],
    ['contract_asked', '/?go=orders', 'fleet', 'Record a contract with Jenga', { entityId: 'biz_1', name: 'Jenga' }],
    ['contract_answered', '/?go=orders', 'fleet', 'notify.open'],
    ['contract_offered', '/?go=contracts', 'business', 'notify.open'],
    ['papers_sent', '/?go=drivers', 'fleet', 'notify.open'],
    ['vehicle_defect', '/?go=vehicles', 'fleet', 'notify.open'],
    ['freight_paid_direct', '/?go=earnings', 'driver', 'notify.open'],
    ['freight_paid_direct', '/?go=earnings', 'fleet', 'notify.open'],
    ['load_nearby', '/?offer=ofr_1', 'driver', 'notify.open'],
    ['load_nearby', '/?go=board', 'driver', 'notify.open'],
    ['fleet_offer', '/', 'driver', 'driver.home.offerSee', { offerId: 'fo_1', fleetDid: 'did:fleet:1' }],
    // The offer taken back: nothing left to answer.
    ['fleet_offer', '/', 'driver', null, { offerId: 'fo_1' }],
    ['parcel_ready', '/?parcel=PUD-1', 'send', 'notify.open'],
    ['parcel_late', '/?parcel=PUD-1', 'send', 'notify.open'],
    ['parcel_lost', '/?parcel=PUD-1', 'send', 'notify.open'],
    ['parcel_withdrawn', '/?parcel=PUD-1', 'send', 'notify.open'],
    ['door_delivery', '/?parcel=PUD-1', 'send', 'notify.open'],
    ['claim_decided', '/?parcel=PUD-1', 'send', 'notify.open'],
    // A parcel's link in an app with no parcels to open: nothing that would go nowhere.
    ['claim_decided', '/', 'agent', null],
    ['parcel_door_short', '/?go=parcels', 'business', 'notify.open'],
    ['inbound', '/?go=inbound', 'business', 'notify.open'],
    ['hub_arrival', '/?go=dock', 'vendor', 'notify.open'],
    ['terms_updated', '/terms/ke', 'driver', 'notify.readIt'],
    // Home is where the bell already is.
    ['security', '/', 'driver', null],
    // 2026-11-02 — a driver's shift: the home screen, where it is.
    ['shift_hours', '/?go=home', 'driver', 'notify.open'],
    ['bus_inbound', '/', 'mdp', null],
    ['money_in', '/', 'agent', null],
    ['test', '/', 'vendor', null],
    // 2026-11-02 — to whoever posted a load: the load itself, in the shop, the store and the business alike.
    ['freight_paid_direct', '/?load=frt_1', 'agent', 'notify.open'],
    ['freight_paid_direct', '/?load=frt_1', 'vendor', 'notify.open'],
    ['freight_paid_direct', '/?load=frt_1', 'business', 'notify.open'],
    ['freight_problem', '/?load=frt_1&about=road', 'business', 'notify.open'],
    ['freight_problem', '/?load=frt_1&about=seals', 'agent', 'notify.open'],
    ['claim_decided', '/?load=frt_1&about=claim', 'business', 'notify.open'],
    ['freight_delivered', '/?load=frt_1', 'vendor', 'notify.open'],
    ['load_assigned', '/?load=frt_1&about=road', 'agent', 'notify.open'],
    // A load's link where no load of the reader's is opened (a fleet that carries it): nothing that would go nowhere.
    ['freight_problem', '/?load=frt_1', 'fleet', null],
    ['freight_problem', '/?load=frt_1', 'driver', null],
    // 2026-11-02 — SPACE BOOKED ON A RUN: the booking, in the shop and the business; nowhere in an app that books none.
    ['load_cancelled', '/?run=dep_1', 'agent', 'notify.open'],
    ['load_cancelled', '/?run=dep_1&booking=bk_1', 'business', 'notify.open'],
    ['claim_answered', '/?run=dep_1&booking=bk_1', 'business', 'notify.open'],
    ['freight_delivered', '/?run=dep_1', 'agent', 'notify.open'],
    ['load_assigned', '/?run=dep_1', 'business', 'notify.open'],
    ['load_cancelled', '/?run=dep_1', 'vendor', null],
    // EXPORTS AND IMPORTS: the business's own, opened.
    ['freight_problem', '/?export=exp_1', 'business', 'notify.open'],
    ['freight_problem', '/?import=imp_1', 'business', 'notify.open'],
    ['box_due', '/?import=imp_1', 'business', 'notify.open'],
    ['freight_problem', '/?export=exp_1', 'agent', null],
    // A DRIVER'S: each where the driver acts on it.
    ['load_assigned', '/?go=loads', 'driver', 'notify.open'],
    ['load_instructions', '/?go=loads', 'driver', 'notify.open'],
    ['load_cancelled', '/?go=board', 'driver', 'notify.open'],
    ['load_nearby', '/?go=route', 'driver', 'notify.open'],
    ['vehicle_today', '/?go=home', 'driver', 'notify.open'],
    ['takeover_nearby', '/?go=home', 'driver', 'notify.open'],
    ['vehicle_defect', '/?go=home', 'driver', 'notify.open'],
    ['vehicle_breakdown', '/?go=loads', 'driver', 'notify.open'],
    ['vehicle_breakdown', '/?go=earnings', 'driver', 'notify.open'],
    ['papers_due', '/?go=home', 'driver', 'notify.open'],
    ['papers_lapsed', '/?go=home', 'driver', 'notify.open'],
    ['papers_checked', '/?go=home', 'driver', 'notify.open'],
    ['roster_changed', '/', 'driver', 'driver.fleet.row', { fleetDid: 'did:fleet:1' }],
    ['driver_roster', '/', 'driver', 'driver.fleet.row', { day: '2026-11-04' }],
    ['papers_checked', '/', 'driver', 'driver.fleet.row', { did: 'd', about: 'ride_alone', approved: false }],
    // Changing how they sign in asks for typing: not opened at the wheel — it opens in full, Settings named in it.
    ['security', '/', 'driver', null],
  ];

  it.each(TABLE)('%s (%s) in the %s app → %s', (kind, link, app, offers, data) => {
    asApp(app);
    const action = noticeAction(notice({ kind, link, data }), ACTS[app], t);
    if (offers === null) expect(action).toBeNull();
    else expect(action?.label).toBe(/^(notify|driver)\./.test(offers) ? t(offers as 'notify.open') : offers);
  });
});

describe('the chat a Reply opens', () => {
  const thread = { conversationId: 'cv_1', freightCode: 'FR-001', freightLabel: 'Gikomba to Nakuru', role: 'poster', lastSeq: 2, unread: 1, createdAt: '2026-11-02T08:00:00.000Z' };
  const api = (answer: { data?: unknown; error?: unknown }) => ({ mine: async () => ({ data: answer.data ?? null, error: answer.error ?? null, status: answer.error ? 503 : 200 }) }) as unknown as ConversationsApi;

  it('is found among the person’s own chats', async () => {
    expect(await findChat(api({ data: [thread] }), 'cv_1')).toEqual({ thread });
  });

  it('a chat not theirs opens nothing, and is not tried again', async () => {
    expect(await findChat(api({ data: [thread] }), 'cv_someone_else')).toEqual({ retry: false });
  });

  it('with no signal, says so and can be tried again', async () => {
    expect(await findChat(api({ error: { status: 503, title: 'Offline' } }), 'cv_1')).toEqual({ retry: true });
  });
});
