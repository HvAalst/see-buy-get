import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { BusinessClient } from '../api';
import { eventWords, loadCodeOf, systemLine, type SystemView } from '../system';
import type { BusinessActions } from '../useBusinessApp';

/**
 * YOUR SYSTEM (the user, round 10: "Businesses first"; "Only what it sees in its app"; "The company, once a day").
 *
 * The business's own system is told each step of its loads — taken, picked up, delivered, a problem — carrying exactly
 * what the Loads screen shows. An owner gives the address, and with the first one gets the signing secret, shown once;
 * anybody who may act sends one again, or a test; everybody reads what became of each. Staff never change any of it.
 */
export function SystemPanel({ actions, client, owner, works }: { actions: BusinessActions; client: BusinessClient | null; owner: boolean; works: boolean }) {
  const t = useT();
  const [view, setView] = useState<SystemView | null>(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.system();
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setView(r.data);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return null;

  const fail = (r: { error?: { detail?: string; title?: string } | null }) => setError(r.error?.detail || r.error?.title || null);
  const saveAddress = async (e: Event) => {
    e.preventDefault();
    if (!client) return;
    setBusy('address');
    setError(null);
    const r = await client.setSystemAddress(url.trim());
    setBusy(null);
    if (r.error || !r.data) return fail(r);
    if (r.data.secret) setSecret(r.data.secret);
    setView(r.data);
    setEditing(false);
    actions.say(t(url.trim() ? 'business.system.saved' : 'business.system.stopped'));
  };
  const turn = async () => {
    if (!client) return;
    setBusy('secret');
    setError(null);
    const r = await client.turnSystemSecret();
    setBusy(null);
    if (r.error || !r.data) return fail(r);
    setSecret(r.data.secret ?? null);
    setView(r.data);
  };
  const send = async (messageId?: string) => {
    if (!client) return;
    setBusy(messageId ?? 'test');
    setError(null);
    const r = messageId ? await client.resendSystemMessage(messageId) : await client.testSystem();
    setBusy(null);
    if (r.error || !r.data) return fail(r);
    actions.say(t(r.data.state === 'delivered' ? 'business.system.arrived' : 'business.system.notArrived'));
    await load();
  };

  const shown = all ? view.messages : view.messages.slice(0, 8);
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.system.title')}</span>
      </div>
      <p class="cons__lede">{t('business.system.lede', { events: view.events.map((e) => eventWords(e, t).toLowerCase()).join(', ') })}</p>

      {/* The secret, the one time it is shown. */}
      {secret ? (
        <div class="cons__caveat">
          <span>
            <b>{t('business.system.secretOnce')}</b> <code class="ctbl__mono">{secret}</code>
          </span>
        </div>
      ) : null}

      {editing ? (
        <form onSubmit={(e) => void saveAddress(e)}>
          <label class="cfield">
            <span class="cfield__label">{t('business.system.address')}</span>
            <input id="system-url" class="cinput" value={url} placeholder="https://erp.example.com/hooks/seebuyget" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} autocapitalize="none" spellcheck={false} />
            <span class="chint">{t('business.system.addressHint')}</span>
          </label>
          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} onClick={() => setEditing(false)}>
              {t('business.system.cancel')}
            </button>
            <button type="submit" class="cbtn cbtn--primary" disabled={busy !== null}>
              {t('business.system.save')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p class="crow__sub">{view.url ? t('business.system.sendsTo', { url: view.url }) : t('business.system.none')}</p>
          {view.hasSecret ? <p class="chint">{t('business.system.signed', { when: view.secretTurnedAt ? new Date(view.secretTurnedAt).toLocaleDateString() : '' })}</p> : null}
          <div class="twr-panelend">
            {owner && view.hasSecret ? (
              <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} onClick={() => void turn()}>
                {t('business.system.turnSecret')}
              </button>
            ) : null}
            {works && view.url ? (
              <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} onClick={() => void send()}>
                {t('business.system.test')}
              </button>
            ) : null}
            {owner ? (
              <button
                type="button"
                class={`cbtn ${view.url ? 'cbtn--ghost' : 'cbtn--primary'}`}
                disabled={busy !== null}
                onClick={() => {
                  setUrl(view.url ?? '');
                  setError(null);
                  setEditing(true);
                }}
              >
                {t(view.url ? 'business.system.change' : 'business.system.set')}
              </button>
            ) : null}
          </div>
          {!owner ? <p class="chint">{t('business.system.ownerOnly')}</p> : null}
          {error ? <p class="cerr">{error}</p> : null}
        </>
      )}

      {view.messages.length ? (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('business.system.col.what')}</th>
              <th>{t('business.system.col.became')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const line = systemLine(m, t);
              const code = loadCodeOf(m);
              return (
                <tr key={m.id}>
                  <td>
                    {eventWords(m.event, t)}
                    {code ? <span class="ctbl__mono"> · {code}</span> : null}
                    <span class="ctbl__sub" style="display:block">
                      {new Date(m.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </td>
                  <td>
                    <span class="ctbl__lbl">{t('business.system.col.became')}</span>
                    <span class={line.warn ? 'ctbl__sub ctbl__sub--warn' : 'ctbl__sub'}>{line.text}</span>
                  </td>
                  <td class="ctbl__num">
                    {works && view.url ? (
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => void send(m.id)}>
                        {t('business.system.sendAgain')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : view.url ? (
        <p class="cons__empty">{t('business.system.nothingYet')}</p>
      ) : null}
      {!all && view.messages.length > 8 ? (
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setAll(true)}>
          {t('business.system.showAll', { n: view.messages.length })}
        </button>
      ) : null}
    </section>
  );
}
