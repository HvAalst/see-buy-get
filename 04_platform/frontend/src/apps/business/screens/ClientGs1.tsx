import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { BusinessClient, Client } from '../api';
import { PREFIX_TAKEN } from '../gs1Dispute';
import { cleanPrefix, gs1Line } from '../papers';
import { ClaimPrefix } from './Gs1Panel';

/**
 * Round 20 — A CLIENT'S OWN GS1 PREFIX ("A client's own GS1 prefix"; "The forwarder, on the client's record").
 *
 * The barcode on a client's packages is the client's, never the forwarder's: the forwarder enters the client's prefix and
 * the extension digit the client set aside for it, and every load it posts for the client is coded under it. The same
 * rules as its own: an owner sets it, a digit another business prints under is refused — and a prefix that is really the
 * client's is claimed with the client's GS1 licence.
 */
export function ClientGs1({ row, client, owner, onRow }: { row: Client; client: BusinessClient | null; owner: boolean; onRow: (c: Client) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [digit, setDigit] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ prefix: string; digit: number } | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const start = () => {
    setPrefix(row.gs1?.companyPrefix ?? '');
    setDigit(String(row.gs1?.extensionDigit ?? 0));
    setError(null);
    setTaken(null);
    setSaid(null);
    setEditing(true);
  };
  const save = async (e: Event) => {
    e.preventDefault();
    const clean = cleanPrefix(prefix);
    if (!clean) return setError(t('business.gs1.badPrefix'));
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await client.setClientGs1(row.clientId, clean, Number(digit));
    setBusy(false);
    if (r.error?.code === PREFIX_TAKEN) setTaken({ prefix: clean, digit: Number(digit) });
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setEditing(false);
    setSaid(t('business.gs1.saved'));
    onRow(r.data);
  };
  const remove = async () => {
    if (!client) return;
    setBusy(true);
    const r = await client.clearClientGs1(row.clientId);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setSaid(t('business.gs1.removed'));
    onRow(r.data);
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.clients.gs1.title')}</span>
      </div>
      <p class="cons__lede">{t('business.clients.gs1.lede', { name: row.name })}</p>
      {editing ? (
        <form onSubmit={(e) => void save(e)}>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.gs1.prefix')}</span>
              <input id="client-gs1-prefix" class="cinput" inputMode="numeric" maxLength={24} value={prefix} onInput={(e) => setPrefix((e.target as HTMLInputElement).value)} />
              <span class="chint">{t('business.clients.gs1.prefixHint', { name: row.name })}</span>
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.gs1.digit')}</span>
              <select id="client-gs1-digit" class="cinput" value={digit} onChange={(e) => setDigit((e.target as HTMLSelectElement).value)}>
                {Array.from({ length: 10 }, (_, d) => (
                  <option key={d} value={String(d)}>
                    {d}
                  </option>
                ))}
              </select>
              <span class="chint">{t('business.clients.gs1.digitHint', { name: row.name })}</span>
            </label>
          </div>
          {error ? <p class="cerr">{error}</p> : null}
          {taken && client ? (
            <ClaimPrefix
              client={client}
              prefix={taken.prefix}
              digit={taken.digit}
              forClient={{ clientId: row.clientId, name: row.name }}
              onOpened={() => {
                setTaken(null);
                setError(null);
                setEditing(false);
                setSaid(t('business.gs1.claimSent'));
              }}
            />
          ) : null}
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
          <p class="crow__sub">{row.gs1 ? gs1Line(row.gs1, t) : t('business.clients.gs1.none', { name: row.name })}</p>
          {owner ? (
            <div class="twr-panelend">
              {row.gs1 ? (
                <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void remove()}>
                  {t('business.gs1.remove')}
                </button>
              ) : null}
              <button type="button" class={`cbtn ${row.gs1 ? 'cbtn--ghost' : 'cbtn--primary'}`} disabled={busy} onClick={start}>
                {t(row.gs1 ? 'business.gs1.change' : 'business.clients.gs1.set')}
              </button>
            </div>
          ) : (
            <p class="chint">{t('business.gs1.ownerOnly')}</p>
          )}
          {said ? <p class="chint">{said}</p> : null}
          {error ? <p class="cerr">{error}</p> : null}
        </>
      )}
    </section>
  );
}
