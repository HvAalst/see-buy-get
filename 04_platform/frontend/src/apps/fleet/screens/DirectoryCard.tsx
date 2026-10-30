import { useCallback, useEffect, useState } from 'preact/hooks';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import { Button, Card, ErrorNote } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { cleanLine, listingLink, listingState, listingWhy, websiteOf, type DirectoryListingView } from '../../../shared/directoryListing';

type Body = { listed?: boolean; words?: string; phone?: string; email?: string; website?: string };

/**
 * IN THE LOGISTICS DIRECTORY (the user, 2026-10-30) — whether the fleet is shown on SeeBuyGet's public directory as a
 * haulier, its own line there, and the ways to reach it it chooses to show: only what it fills in, a phone as a Call
 * button. The fleet office's to say; never staff's.
 */
export function DirectoryCard({ sbg, did }: { sbg: SbgClient | null; did?: string }) {
  const t = useT();
  const [view, setView] = useState<DirectoryListingView | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ words: '', phone: '', email: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const load = useCallback(async () => {
    if (!sbg || !did) return;
    const r = await sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/directory', { params: { path: { did } } }));
    if (r.data) setView(r.data as DirectoryListingView);
  }, [sbg, did]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: Body) => {
    if (!sbg || !did) return;
    setBusy(true);
    setError(null);
    const r = await sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/directory', { params: { path: { did } }, body }));
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? null);
    setView(r.data as DirectoryListingView);
    setEditing(false);
  };

  if (!view) return null;
  const state = listingState(view);
  const why = listingWhy(state, 'fleet');
  const c = view.contact ?? {};
  // Plain boxes with the right keyboard: a refusal is said in our words (ErrorNote), never the browser's bubble.
  const field = (key: 'phone' | 'email' | 'website', inputMode: 'tel' | 'email' | 'url') => (
    <div class="field">
      <label class="field__label" for={`dir-${key}`}>
        {t(`directory.app.${key}`)}
      </label>
      <input id={`dir-${key}`} class="input" type="text" inputMode={inputMode} autoComplete="off" maxLength={key === 'website' ? 200 : 120} value={form[key]} onInput={(e) => setForm((f) => ({ ...f, [key]: e.currentTarget.value }))} />
    </div>
  );

  return (
    <Card
      title={t('directory.app.title')}
      aside={
        <a class="btn btn--link" href={listingLink(view)} target="_blank" rel="noopener">
          {t('directory.app.view')}
        </a>
      }
    >
      <p class="card__note">{state === 'shown' ? t('directory.app.shown', { kinds: t('directory.kind.haulier') }) : why ? t(why) : null}</p>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ words: cleanLine(form.words), phone: form.phone.trim(), email: form.email.trim(), website: websiteOf(form.website) });
          }}
        >
          <div class="field">
            <label class="field__label" for="dir-line">
              {t('directory.app.line')}
            </label>
            <textarea id="dir-line" class="input" rows={3} maxLength={240} value={form.words} onInput={(e) => setForm((f) => ({ ...f, words: e.currentTarget.value }))} />
            <p class="hint">{t('directory.app.lineHint')}</p>
          </div>
          <p class="card__note">
            <b>{t('directory.app.contactTitle')}</b>
          </p>
          <p class="hint">{t('directory.app.contactHint')}</p>
          {field('phone', 'tel')}
          {field('email', 'email')}
          {field('website', 'url')}
          {error ? <ErrorNote error={error} /> : null}
          <Button type="submit" busy={busy}>
            {t('directory.app.save')}
          </Button>
          <Button variant="link" onClick={() => setEditing(false)}>
            {t('directory.app.cancel')}
          </Button>
        </form>
      ) : (
        <>
          <p class="card__note">{view.words ? `“${view.words}”` : t('directory.app.lineNone')}</p>
          {c.phone || c.email || c.website ? (
            <p class="hint">{t('directory.app.contactShown', { what: [c.phone ? t('directory.app.phone') : '', c.email ? t('directory.app.email') : '', c.website ? t('directory.app.website') : ''].filter(Boolean).join(', ') })}</p>
          ) : (
            <p class="hint">{t('directory.app.contactNone')}</p>
          )}
          {error ? <ErrorNote error={error} /> : null}
          <Button
            variant="outline"
            onClick={() => {
              setForm({ words: view.words ?? '', phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '' });
              setError(null);
              setEditing(true);
            }}
          >
            {t('directory.app.edit')}
          </Button>
          {state === 'shown' ? (
            <Button variant="link" busy={busy} onClick={() => void save({ listed: false })}>
              {t('directory.app.takeOff')}
            </Button>
          ) : state === 'off' ? (
            <Button variant="outline" busy={busy} onClick={() => void save({ listed: true })}>
              {t('directory.app.putBack')}
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
