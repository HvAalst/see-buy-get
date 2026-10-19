import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { keyLine, keysInOrder, keyTitle, type CompanyKey } from '../../../shared/companyKeys';
import type { BusinessClient } from '../api';

/**
 * KEYS FOR YOUR OWN SYSTEMS (the user, round 12: "An API for businesses and fleets"; "Post, send in, take at its price";
 * "Same as the system"). An owner makes a key — live, or a test key that runs every check and posts nothing — and sees it
 * once; an owner takes one away; everybody in the business reads which keys there are, who made them and when each was
 * last used. Never the key itself after the answer that made it.
 */
export function KeysPanel({ client, owner }: { client: BusinessClient | null; owner: boolean }) {
  const t = useT();
  const [keys, setKeys] = useState<CompanyKey[] | null>(null);
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.keys();
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setKeys(r.data.items);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!keys) return null;

  const make = async (mode: 'live' | 'test') => {
    if (!client) return;
    setBusy(mode);
    setError(null);
    const r = await client.issueKey(mode, label.trim() || undefined);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setSecret(r.data.secret);
    setLabel('');
    await load();
  };
  const revoke = async (keyId: string) => {
    if (!client) return;
    setBusy(keyId);
    setError(null);
    const r = await client.revokeKey(keyId);
    setBusy(null);
    setConfirm(null);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    await load();
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.keys.title')}</span>
      </div>
      <p class="cons__lede">{t('business.keys.lede')}</p>

      {/* The key, the one time it is shown. */}
      {secret ? (
        <div class="cons__caveat">
          <span>
            <b>{t('business.keys.secretOnce')}</b> <code class="ctbl__mono" style="overflow-wrap:anywhere">{secret}</code>
          </span>
        </div>
      ) : null}

      {owner ? (
        <div class="twr-knobs__row">
          <label class="cfield">
            <span class="cfield__label">{t('business.keys.label')}</span>
            <input id="key-label" class="cinput" value={label} maxLength={60} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
            <span class="chint">{t('business.keys.labelHint')}</span>
          </label>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} onClick={() => void make('test')}>
              {t('business.keys.makeTest')}
            </button>
            <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void make('live')}>
              {t('business.keys.makeLive')}
            </button>
          </div>
        </div>
      ) : (
        <p class="chint">{t('business.keys.ownerOnly')}</p>
      )}
      {error ? <p class="cerr">{error}</p> : null}

      {keys.length ? (
        <table class="ctbl ctbl--stack">
          <tbody>
            {keysInOrder(keys).map((k) => (
              <tr key={k.keyId}>
                <td>
                  <span class={k.revokedAt ? 'ctbl__sub' : 'ctbl__strong'}>{keyTitle(k, t)}</span>
                  <span class="ctbl__sub" style="display:block">
                    {keyLine(k, t)}
                  </span>
                </td>
                <td class="ctbl__num">
                  {owner && !k.revokedAt ? (
                    confirm === k.keyId ? (
                      <span class="twr-panelend">
                        <span class="ctbl__sub">{t('business.keys.revokeWarn')}</span>
                        <button type="button" class="cbtn cbtn--danger cbtn--sm" disabled={busy !== null} onClick={() => void revoke(k.keyId)}>
                          {t('business.keys.revokeConfirm')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setConfirm(null)}>
                          {t('business.system.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => setConfirm(k.keyId)}>
                        {t('business.keys.revoke')}
                      </button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="cons__empty">{t('business.keys.none')}</p>
      )}
    </section>
  );
}
