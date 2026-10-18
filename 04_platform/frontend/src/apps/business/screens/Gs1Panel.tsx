import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { BusinessClient, BusinessView } from '../api';
import { cleanPrefix, gs1Line } from '../papers';
import type { BusinessActions } from '../useBusinessApp';

/**
 * THE BUSINESS'S GS1 COMPANY PREFIX — what puts the global barcode on its packages beside our code.
 *
 * Its own, like everything else on this screen: an owner sets it, everybody in the business reads it, staff never
 * change it. The prefix is the one GS1 licensed to the business; the extension digit is the one it sets aside for
 * labels printed here, so its own systems never give the same code.
 */
export function Gs1Panel({ business, actions, client, owner }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null; owner: boolean }) {
  const t = useT();
  const gs1 = business.gs1;
  const [editing, setEditing] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [digit, setDigit] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setPrefix(gs1?.companyPrefix ?? '');
    setDigit(String(gs1?.extensionDigit ?? 0));
    setError(null);
    setEditing(true);
  };
  const save = async (e: Event) => {
    e.preventDefault();
    const clean = cleanPrefix(prefix);
    if (!clean) return setError(t('business.gs1.badPrefix'));
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await client.setGs1(clean, Number(digit));
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    actions.setBusiness(r.data);
    setEditing(false);
    actions.say(t('business.gs1.saved'));
  };
  const remove = async () => {
    if (!client) return;
    setBusy(true);
    const r = await client.clearGs1();
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    actions.setBusiness(r.data);
    actions.say(t('business.gs1.removed'));
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.gs1.title')}</span>
      </div>
      <p class="cons__lede">{t('business.gs1.lede')}</p>
      {editing ? (
        <form onSubmit={(e) => void save(e)}>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.gs1.prefix')}</span>
              <input id="gs1-prefix" class="cinput" inputMode="numeric" maxLength={24} value={prefix} onInput={(e) => setPrefix((e.target as HTMLInputElement).value)} />
              <span class="chint">{t('business.gs1.prefixHint')}</span>
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.gs1.digit')}</span>
              <select id="gs1-digit" class="cinput" value={digit} onChange={(e) => setDigit((e.target as HTMLSelectElement).value)}>
                {Array.from({ length: 10 }, (_, d) => (
                  <option key={d} value={String(d)}>
                    {d}
                  </option>
                ))}
              </select>
              <span class="chint">{t('business.gs1.digitHint')}</span>
            </label>
          </div>
          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t('business.gs1.cancel')}
            </button>
            <button type="submit" class="cbtn cbtn--primary" disabled={busy}>
              {t('business.gs1.save')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p class="crow__sub">{gs1 ? gs1Line(gs1, t) : t('business.gs1.none')}</p>
          {owner ? (
            <div class="twr-panelend">
              {gs1 ? (
                <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void remove()}>
                  {t('business.gs1.remove')}
                </button>
              ) : null}
              <button type="button" class={`cbtn ${gs1 ? 'cbtn--ghost' : 'cbtn--primary'}`} disabled={busy} onClick={start}>
                {t(gs1 ? 'business.gs1.change' : 'business.gs1.set')}
              </button>
            </div>
          ) : (
            <p class="chint">{t('business.gs1.ownerOnly')}</p>
          )}
          {error ? <p class="cerr">{error}</p> : null}
        </>
      )}
    </section>
  );
}
