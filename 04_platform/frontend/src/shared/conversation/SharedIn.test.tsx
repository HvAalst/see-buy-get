import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { options, type VNode } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { ConversationsApi, SbgError } from '../../lib/sbg';
import { t } from '../i18n';
import { refusalSentence } from '../ui';
import { AppLayer } from '../ui/AppLayer';
import type { InstallApp } from '../ui/InstallBar';
import type { ChatThread } from './logic';
import { SharedInLayer, SharedInSheet, SharedInView, type SharedInViewProps } from './SharedIn';
import { SHARE_APPS, hold, holdKey, sendShared, type SendOutcome } from './sharedInLogic';

// The install bar asks the browser about itself; what is under test here is what is shared to the app.
vi.mock('../ui/InstallBar', () => ({ InstallBar: () => null }));

/*
 * 2026-11-02 — SHARED WITH SEEBUYGET (the owner: "it should show up in the share list especially when we will start sharing
 * in in-chat if that becomes necessary"): what was shared, the person's chats to send it into, and Copy — never a dead end.
 */

const thread = (over: Partial<ChatThread> = {}): ChatThread => ({
  conversationId: 'c-1',
  freightCode: 'FRT-101',
  freightLabel: 'Gikomba to Nakuru, 2 pallets',
  role: 'asker',
  counterpartName: 'Mama Njeri Stores',
  lastSeq: 3,
  unread: 0,
  createdAt: '2026-11-01T08:00:00.000Z',
  blocked: false,
  blockedByMe: false,
  ...over,
});

const noop = () => undefined;
const view = (over: Partial<SharedInViewProps> = {}) => {
  const props: SharedInViewProps = {
    app: 'driver',
    link: 'https://maps.app.goo.gl/AbC123',
    message: 'Pick up at Gikomba gate 3\nhttps://maps.app.goo.gl/AbC123',
    editing: false,
    threads: [thread(), thread({ conversationId: 'c-2', freightCode: 'FRT-202', freightLabel: 'Thika to Eldoret, 1 crate', counterpartName: undefined, role: 'asker' })],
    loadError: null,
    busy: null,
    results: {},
    last: null,
    copied: null,
    onEdit: noop,
    onStartEditing: noop,
    onPick: noop,
    onCopy: noop,
    onRetry: noop,
    onOpenChat: noop,
    onClose: noop,
    ...over,
  };
  return props;
};

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

const fakeApi = (answer: { data?: unknown; error?: SbgError } = {}) => {
  const sent: Array<{ id: string; message: { body?: string; writtenAt?: string } }> = [];
  const api = {
    mine: async () => ({ data: [], error: null, status: 200 }),
    send: async (id: string, message: { body?: string; writtenAt?: string }) => {
      sent.push({ id, message });
      return answer.error ? { data: null, error: answer.error, status: answer.error.status } : { data: answer.data ?? { seq: 4 }, error: null, status: 201 };
    },
  } as unknown as ConversationsApi;
  return { api, sent };
};

describe('shared with SeeBuyGet, with chats', () => {
  it('shows what was shared, the link as a link that only the browser opens, and each chat by who and which load', () => {
    const html = renderToString(<SharedInView {...view()} />);
    expect(html).toContain(t('sharedIn.what'));
    expect(html).toContain('Pick up at Gikomba gate 3');
    expect(html).toContain('<a class="sharedin__link" href="https://maps.app.goo.gl/AbC123" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain(t('sharedIn.chatsTitle'));
    expect(html).toContain('FRT-101 · Mama Njeri Stores');
    expect(html).toContain('Gikomba to Nakuru, 2 pallets');
    // No name shown: the other side by role.
    expect(html).toContain(`FRT-202 · ${t('common.chat.poster')}`);
    expect(html).toContain(t('sharedIn.copy'));
  });

  it('a link that is not a web link is never made one', () => {
    const html = renderToString(<SharedInView {...view({ link: undefined, message: 'javascript:alert(1)' })} />);
    expect(html).not.toContain('href=');
    expect(html).toContain('javascript:alert(1)');
  });

  it('tapping a chat sends what was shared into THAT chat, as a text message', async () => {
    const { api, sent } = fakeApi();
    const shared = { text: 'Pick up at Gikomba gate 3', url: 'https://maps.app.goo.gl/AbC123' };
    // The sheet as it is mounted; its own pick is what a tapped row calls.
    const { made } = captureWhile(() => renderToString(<SharedInSheet app="driver" api={api} shared={shared} onClose={noop} onOpenChat={noop} />));
    const drawn = made.find((v) => v.type === SharedInView);
    expect(drawn).toBeTruthy();
    (drawn!.props as unknown as SharedInViewProps).onPick(thread({ conversationId: 'c-2' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe('c-2');
    expect(sent[0].message.body).toBe('Pick up at Gikomba gate 3\nhttps://maps.app.goo.gl/AbC123');
    expect(typeof sent[0].message.writtenAt).toBe('string');

    // And the row is what calls it, with its own chat.
    const picked: string[] = [];
    const rows = captureWhile(() => renderToString(<SharedInView {...view({ onPick: (x) => picked.push(x.conversationId) })} />)).made.filter(
      (v) => v.type === 'button' && (v.props as { class?: string }).class === 'row',
    );
    expect(rows).toHaveLength(2);
    (rows[1].props as unknown as { onClick: () => void }).onClick();
    expect(picked).toEqual(['c-2']);
  });

  it('it went: said with whom and about which load, the chat a tap away — and that chat is not offered twice', () => {
    const results: Record<string, SendOutcome> = { 'c-1': { state: 'sent' } };
    const html = renderToString(<SharedInView {...view({ results, last: thread() })} />);
    expect(html).toContain(t('sharedIn.sent', { who: 'Mama Njeri Stores', code: 'FRT-101' }));
    expect(html).toContain(t('sharedIn.openChat'));
    expect(html).toContain(t('sharedIn.sentPill'));
    const sentRow = captureWhile(() => renderToString(<SharedInView {...view({ results, last: thread() })} />)).made.find(
      (v) => v.type === 'button' && (v.props as { class?: string }).class === 'row',
    );
    expect((sentRow!.props as { disabled?: boolean }).disabled).toBe(true);
  });

  it('no signal: it waits on the phone and goes by itself', () => {
    const html = renderToString(<SharedInView {...view({ results: { 'c-1': { state: 'queued' } }, last: thread() })} />);
    expect(html).toContain(t('sharedIn.queued', { who: 'Mama Njeri Stores' }));
    expect(html).toContain(t('sharedIn.waitingPill'));
  });

  it('a refusal from the server is shown under its chat, in the words it came with', async () => {
    const { api } = fakeApi({ error: { code: 'FORBIDDEN', status: 403, title: 'Forbidden', detail: 'This conversation is closed', retryable: false } });
    const outcome = await sendShared(api, 'c-1', 'hello', refusalSentence);
    expect(outcome).toEqual({ state: 'refused', why: 'This conversation is closed' });
    const html = renderToString(<SharedInView {...view({ results: { 'c-1': outcome } })} />);
    expect(html).toContain(t('common.chat.unsent', { why: 'This conversation is closed' }));
    expect(html).toContain('role="alert"');
  });

  it('a closed chat says so and cannot be tapped', () => {
    const { made, html } = captureWhile(() => renderToString(<SharedInView {...view({ threads: [thread({ blocked: true })] })} />));
    expect(html).toContain(t('common.chat.closedPill'));
    const row = made.find((v) => v.type === 'button' && (v.props as { class?: string }).class === 'row');
    expect((row!.props as { disabled?: boolean }).disabled).toBe(true);
  });

  it('too long for one message: said, the words open to shorten, and no chat can be tapped until it fits', () => {
    const long = 'a'.repeat(1001);
    const { made, html } = captureWhile(() => renderToString(<SharedInView {...view({ message: long, editing: true })} />));
    expect(html).toContain(t('common.chat.tooLong', { max: 1000 }));
    expect(html).toContain('<textarea');
    const rows = made.filter((v) => v.type === 'button' && (v.props as { class?: string }).class === 'row');
    expect(rows.every((r) => (r.props as { disabled?: boolean }).disabled)).toBe(true);
  });
});

describe('shared with SeeBuyGet, with no chats yet', () => {
  it('says what a chat is and how one starts — and Copy still takes it anywhere', () => {
    const html = renderToString(<SharedInView {...view({ threads: [] })} />);
    expect(html).toContain(t('sharedIn.none.title'));
    expect(html).toContain(t('sharedIn.none.driver'));
    expect(t('sharedIn.none.driver')).toContain('A chat is about a load');
    expect(html).toContain(t('sharedIn.copy'));
    expect(html).not.toContain(t('sharedIn.chatsLede'));
  });

  it('every app that receives shares says it in its own words', () => {
    for (const app of SHARE_APPS) {
      const words = t(`sharedIn.none.${app}` as 'sharedIn.none.driver');
      expect(words).not.toBe(`sharedIn.none.${app}`);
      expect(renderToString(<SharedInView {...view({ app, threads: [] })} />)).toContain(words);
    }
  });

  it('the list could not be read: said, with a retry, and Copy still there', () => {
    const html = renderToString(<SharedInView {...view({ threads: null, loadError: { code: 'NETWORK', status: 0, title: 'Network', detail: '', retryable: true } })} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain(t('sharedIn.copy'));
  });
});

describe('shared while signed out', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('waits, says so, and opens in the sheet once signed in', () => {
    hold('send', { text: 'Gikomba gate 3' });
    const out = renderToString(<SharedInLayer app="send" chats={null} onSignIn={noop} />);
    expect(out).toContain(t('sharedIn.held.title'));
    expect(out).toContain(t('sharedIn.held.signIn'));
    expect(out).toContain(t('sharedIn.held.forget'));
    // Signed in now: the sheet, with what waited.
    const { api } = fakeApi();
    const after = renderToString(<SharedInLayer app="send" chats={api} />);
    expect(after).toContain(t('sharedIn.title'));
    expect(after).toContain('Gikomba gate 3');
    expect(after).not.toContain(t('sharedIn.held.title'));
    expect(store.has(holdKey('send'))).toBe(true);
  });

  it('a session still being restored says nothing yet', () => {
    hold('send', { text: 'Gikomba gate 3' });
    expect(renderToString(<SharedInLayer app="send" chats={undefined} />)).toBe('');
  });
});

describe('exactly the five apps with chats receive shares', () => {
  const APPS: InstallApp[] = ['agent', 'mdp', 'driver', 'fleet', 'vendor', 'send'];

  it('the layer mounts the share sheet in the five, and not in the hub', () => {
    const mounted = APPS.filter((app) => captureWhile(() => renderToString(<AppLayer app={app} chats={null} />)).made.some((v) => v.type === SharedInLayer));
    expect(mounted.sort()).toEqual(['agent', 'driver', 'fleet', 'send', 'vendor']);
  });

  it('each of the five hands its layer its chats — signed out and signed in — and the hub hands it none', () => {
    const folder: Record<InstallApp, string> = { agent: 'agent', mdp: 'mdp', driver: 'driver', fleet: 'fleet', vendor: 'vendor', send: 'genesis' };
    let lines = 0;
    for (const app of APPS) {
      const src = readFileSync(join('src', 'apps', folder[app], 'app.tsx'), 'utf8');
      // One line each, to its own close — an arrow (`=>`) inside it is not its end.
      const layers = src.match(/<AppLayer\b[^\n]*?\/>/g) ?? [];
      expect({ app, found: layers.length > 0 }).toEqual({ app, found: true });
      lines += layers.length;
      for (const line of layers) {
        expect({ app, line, chats: /\bchats=/.test(line) }).toEqual({ app, line, chats: SHARE_APPS.includes(app) });
      }
      if (SHARE_APPS.includes(app)) expect({ app, signedIn: layers.some((l) => /chats=\{[^}]*chatApi/.test(l)) }).toEqual({ app, signedIn: true });
    }
    // Two shells each in five apps (sign-in and signed in), one in the Send app, which signs in from inside.
    expect(lines).toBe(11);
  });
});
