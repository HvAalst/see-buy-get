import { useEffect, useState } from 'preact/hooks';
import { narrow, type ConversationsApi } from '../../lib/sbg';
import { useT } from '../i18n';
import { onLaunch } from '../launch';
import { Button, Note, Sheet } from '../ui';
import { ConversationSheet } from './Conversations';
import type { ChatThread } from './logic';

/**
 * 2026-11-02 — THE CHAT A NOTICE POINTS AT (the owner: "on the notifications on the start screen I need a 'mark as read'
 * or 'respond' button, is that possible?").
 *
 * A message notice carries `?chat=<conversation>`. Tapped on the phone, the app opens at that address; Reply under it in
 * the bell hands the same link over inside the page (shared/launch.ts). Either way the chat opens here, over whatever
 * screen the person is on — found among their OWN chats, so a link to somebody else's opens nothing. Mounted once signed
 * in, in each app with chats (AppLayer); a link that came before the sign-in waits for it.
 *
 * Reply that cannot reach the chat says so, rather than closing the bell on nothing: with no signal, Try again; a chat no
 * longer theirs, the same words and no retry.
 */
export function LinkedChat({ api }: { api: ConversationsApi }) {
  const t = useT();
  const [want, setWant] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatThread | null>(null);
  const [failed, setFailed] = useState<{ id: string; retry: boolean } | null>(null);

  useEffect(() => onLaunch('chat', (id) => setWant(id)), []);

  useEffect(() => {
    if (!want) return undefined;
    let live = true;
    void findChat(api, want).then((r) => {
      if (!live) return;
      setWant(null);
      if ('thread' in r) {
        setFailed(null);
        setChat(r.thread);
      } else setFailed({ id: want, retry: r.retry });
    });
    return () => {
      live = false;
    };
  }, [want, api]);

  return (
    <>
      <ConversationSheet api={api} thread={chat} onClose={() => setChat(null)} />
      <Sheet open={failed !== null} onClose={() => setFailed(null)} title={t('common.chat.listTitle')}>
        <Note tone="warn" icon="warning" title={t('common.chat.loadFailed')} />
        {failed?.retry ? (
          <Button
            variant="outline"
            chevron={false}
            onClick={() => {
              const id = failed.id;
              setFailed(null);
              setWant(id);
            }}
          >
            {t('common.retry')}
          </Button>
        ) : null}
      </Sheet>
    </>
  );
}

/**
 * The chat a link names, among this person's own: found, or not — and whether trying again could help (no signal), or
 * not (no chat of theirs by that name: somebody else's, or one that is gone).
 */
export async function findChat(api: Pick<ConversationsApi, 'mine'>, id: string): Promise<{ thread: ChatThread } | { retry: boolean }> {
  const r = await api.mine();
  if (r.error) return { retry: true };
  const found = (narrow<ChatThread[]>(r.data) ?? []).find((x) => x.conversationId === id);
  return found ? { thread: found } : { retry: false };
}
