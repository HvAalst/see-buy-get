import { useCallback, useEffect, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useT } from '../../../shared/i18n';
import { cleanLine, listingLink, listingState, listingWhy, type DirectoryListingView } from '../../../shared/directoryListing';
import type { BusinessClient } from '../api';
import type { BusinessActions } from '../useBusinessApp';

/**
 * IN THE LOGISTICS DIRECTORY (the user, 2026-10-30) — whether the business is shown on SeeBuyGet's public directory, and
 * its own line there. An owner's to say; everybody in the business reads it; staff never write it. The ways to reach the
 * business there are its contact entry, on this same screen.
 */
export function DirectoryPanel({ client, owner, actions }: { client: BusinessClient | null; owner: boolean; actions: BusinessActions }) {
  const t = useT();
  const [view, setView] = useState<DirectoryListingView | null>(null);
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.directory();
    if (r.data) setView(r.data);
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: { listed?: boolean; words?: string }) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await client.setDirectory(body);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setView(r.data);
    setEditing(false);
    actions.say(t('directory.app.saved'));
  };

  if (!view) return null;
  const state = listingState(view);
  const why = listingWhy(state, 'business');

  return (
    <section class="cons__panel" id="directory">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('directory.app.title')}</span>
        <a class="chint" href={listingLink(view)} target="_blank" rel="noopener">
          {t('directory.app.view')}
        </a>
      </div>
      <p class="cons__lede">{t('directory.app.lede')}</p>
      <p class="crow__sub">{state === 'shown' ? t('directory.app.shown', { kinds: view.kinds.map((k) => t(`directory.kind.${k}`)).join(', ') }) : why ? t(why) : null}</p>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ words: cleanLine(words) });
          }}
        >
          <label class="cfield">
            <span class="cfield__label">{t('directory.app.line')}</span>
            <textarea id="directory-line" class="cinput" rows={3} maxLength={240} value={words} onInput={(e) => setWords((e.target as HTMLTextAreaElement).value)} />
            <span class="chint">{t('directory.app.lineHint')}</span>
          </label>
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <div style="display:flex;gap:8px;margin-top:10px">
            <button type="submit" class="cbtn cbtn--primary" disabled={busy}>
              {t('directory.app.save')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t('directory.app.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl class="cons__facts">
            <div class="cons__fact">
              <dt class="cons__factk">{t('directory.app.line')}</dt>
              <dd class="cons__factv">{view.words ? `“${view.words}”` : t('directory.app.lineNone')}</dd>
            </div>
          </dl>
          <p class="chint">{t('directory.app.contactFromCard')}</p>
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          {owner ? (
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <button
                type="button"
                class="cbtn cbtn--ghost"
                onClick={() => {
                  setWords(view.words ?? '');
                  setError(null);
                  setEditing(true);
                }}
              >
                {t('directory.app.edit')}
              </button>
              {state === 'shown' ? (
                <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void save({ listed: false })}>
                  {t('directory.app.takeOff')}
                </button>
              ) : state === 'off' ? (
                <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void save({ listed: true })}>
                  {t('directory.app.putBack')}
                </button>
              ) : null}
            </div>
          ) : (
            <p class="chint">{t('directory.app.ownerOnly')}</p>
          )}
        </>
      )}
    </section>
  );
}
