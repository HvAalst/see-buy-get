import { afterEach, describe, expect, it } from 'vitest';
import { options, type VNode } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { ConversationsApi } from '../../lib/sbg';
import { findChat } from '../conversation/LinkedChat';
import { t } from '../i18n';
import { onLaunch, resetLaunchForTests, type LinkKind } from '../launch';
import type { InboxItem } from '../push';
import { NotificationRow, noticeAction, type NoticeAct, type NotificationRowProps } from './NotificationBell';

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

/** The places an app opens from a link, as its screens and layers listen for them (shared/launch.ts). */
const APP_LISTENS: Record<string, LinkKind[]> = {
  driver: ['go', 'offer', 'chat'],
  fleet: ['go', 'chat'],
  agent: ['go', 'chat'],
  vendor: ['go', 'chat'],
  send: ['go', 'parcel', 'chat'],
  business: ['go'],
  mdp: ['go'],
};
const asApp = (app: keyof typeof APP_LISTENS) => {
  resetLaunchForTests();
  const got: Array<[LinkKind, string]> = [];
  for (const k of APP_LISTENS[app]) onLaunch(k, (v) => got.push([k, v as string]));
  return got;
};

afterEach(() => resetLaunchForTests());

describe('a notice in the bell, and the buttons under it', () => {
  it('an unread notice: its act, and Mark as read — small links, never a solid button', () => {
    asApp('fleet');
    const { html, made } = row();
    expect(labelled(made, t('notify.open'))).toBeTruthy();
    expect(labelled(made, t('notify.markRead'))).toBeTruthy();
    expect(html).toContain('class="nrow nrow--unread"');
    // At most one solid-blue button per sheet: none of these is one.
    expect(html).not.toMatch(/class="btn/);
    // Said with the notice it belongs to, for a reader that hears the buttons apart from the list.
    expect(html).toContain(`aria-label="${t('notify.markRead')}: A claim on BK-1"`);
  });

  it('a read notice: no Mark as read — its act stays', () => {
    asApp('fleet');
    const { made } = row({ item: notice({ readAt: '2026-11-02T09:00:00.000Z' }) });
    expect(labelled(made, t('notify.markRead'))).toBeUndefined();
    expect(labelled(made, t('notify.open'))).toBeTruthy();
  });

  it('a shared inbox read by somebody who may not mark it: no Mark as read', () => {
    asApp('business');
    const { made } = row({ item: notice({ kind: 'contract_offered', link: '/?go=contracts' }), onRead: undefined });
    expect(labelled(made, t('notify.markRead'))).toBeUndefined();
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

  it('acting marks it read, closes the bell, and goes where the link points', () => {
    const got = asApp('fleet');
    const read: string[] = [];
    let closed = 0;
    const { made } = row({ onRead: () => read.push('n-1'), onActed: () => (closed += 1) });
    labelled(made, t('notify.open'))!.props.onClick!();
    expect(read).toEqual(['n-1']);
    expect(closed).toBe(1);
    expect(got).toEqual([['go', 'runs']]);
  });

  it('a chat message is answered in its chat: Reply, into that conversation', () => {
    const got = asApp('driver');
    const { made } = row({ item: notice({ kind: 'message', title: 'New message about FR-001', link: '/?chat=cv_1a2b', data: { conversationId: 'cv_1a2b' } }) });
    expect(labelled(made, t('notify.open'))).toBeUndefined();
    labelled(made, t('notify.reply'))!.props.onClick!();
    expect(got).toEqual([['chat', 'cv_1a2b']]);
  });

  it('the page of a new version of the terms is read outside the app — and reading it is reading the notice', () => {
    asApp('agent');
    const read: string[] = [];
    const { made } = row({ item: notice({ kind: 'terms_updated', link: '/terms/ke' }), onRead: () => read.push('n-1') });
    const a = labelled(made, t('notify.readIt'))!;
    expect(a.type).toBe('a');
    expect(a.props.href).toBe('/terms/ke');
    a.props.onClick!();
    expect(read).toEqual(['n-1']);
  });

  it('tapping the notice still opens it in full, and marks it read', () => {
    asApp('fleet');
    const read: string[] = [];
    const toggled: string[] = [];
    const { made } = row({ onRead: () => read.push('n-1'), onToggle: () => toggled.push('n-1') });
    const body = made.find((v) => v.type === 'button' && String((v.props as { class?: string }).class).startsWith('nitem ')) as VNode<{ onClick: () => void }>;
    body.props.onClick();
    expect(toggled).toEqual(['n-1']);
    expect(read).toEqual(['n-1']);
  });
});

describe('what each kind of notice offers, in the app that reads it', () => {
  // The apps' own acts, as their shells give them (apps/fleet/app.tsx, apps/driver/app.tsx).
  const fleetAct: NoticeAct = (it) => (it.kind === 'contract_asked' && typeof it.data?.entityId === 'string' ? { label: 'Record a contract with Jenga', run: noop } : null);
  const driverAct: NoticeAct = (it) => (it.kind === 'fleet_offer' && typeof it.data?.fleetDid === 'string' ? { label: 'See the offer', run: noop } : null);
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
    ['fleet_offer', '/', 'driver', 'See the offer', { offerId: 'fo_1', fleetDid: 'did:fleet:1' }],
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
    ['shift_hours', '/', 'driver', null],
    ['bus_inbound', '/', 'mdp', null],
    ['money_in', '/', 'agent', null],
    ['test', '/', 'vendor', null],
  ];

  it.each(TABLE)('%s (%s) in the %s app → %s', (kind, link, app, offers, data) => {
    asApp(app);
    const action = noticeAction(notice({ kind, link, data }), ACTS[app], t);
    if (offers === null) expect(action).toBeNull();
    else expect(action?.label).toBe(offers.startsWith('notify.') ? t(offers as 'notify.open') : offers);
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
