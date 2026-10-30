import { useCallback, useEffect, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { formatDate, useT } from '../../../shared/i18n';
import { publicPageUrl } from '../../../lib/sbg/config';
import { checkedLine, type DirectoryChoice } from '../../tower/directoryChoice';
import type { BusinessClient } from '../api';

/** A business may ask the same haulier again a week after it last asked (the server's own rule). */
const ASK_AGAIN_MS = 7 * 24 * 3_600_000;

/** A phone as a `tel:` address: its digits and a leading plus. */
const telOf = (phone: string) => `tel:${phone.trim().startsWith('+') ? '+' : ''}${phone.replace(/\D/g, '')}`;

/**
 * FIND A HAULIER — the logistics directory inside the Business app (the user, 2026-10-30: "when a business … looks for a
 * carrier, let it pick from the directory"). The fleets our staff checked, every country, alphabetical, each one's own
 * line beside what we have seen of its work. Reaching one is a button (never a printed number); asking one for a contract
 * tells it in its app — and, as ever, it is the fleet that records the contract and sends the code linked above.
 */
export function FindHaulier({ client, owner, onAsked, initial }: { client: BusinessClient | null; owner: boolean; onAsked: (fleet: string) => void; initial?: DirectoryChoice[] }) {
  const t = useT();
  const [rows, setRows] = useState<DirectoryChoice[] | null>(initial ?? null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.chooseFromDirectory('haulier');
    setRows(((r.data as { items?: DirectoryChoice[] } | null | undefined)?.items ?? []) as DirectoryChoice[]);
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  const ask = async (h: DirectoryChoice) => {
    if (!client) return;
    setBusy(h.id);
    setError(null);
    const r = await client.askContract(h.id);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    const askedAt = r.data.askedAt;
    setRows((was) => (was ?? []).map((x) => (x.id === h.id ? { ...x, askedAt } : x)));
    onAsked(r.data.fleetName);
  };

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((h) => !q || [h.name, h.country, h.words ?? ''].some((s) => s.toLowerCase().includes(q)));

  return (
    <section class="cons__panel" id="find-haulier">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.contracts.findTitle')}</span>
        {rows ? <span class="chint">{t('business.contracts.findCount', { n: rows.length })}</span> : null}
      </div>
      <p class="cons__lede">{t('business.contracts.findLede')}</p>
      {rows && rows.length > 5 ? (
        <input class="cinput" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} placeholder={t('business.contracts.findSearch')} aria-label={t('business.contracts.findSearch')} />
      ) : null}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      {rows === null ? (
        <p class="cons__empty">{t('business.contracts.findReading')}</p>
      ) : shown.length === 0 ? (
        <p class="cons__empty">{q ? t('business.contracts.findNoMatch') : t('business.contracts.findNone')}</p>
      ) : (
        <div class="crows">
          {shown.map((h) => {
            const recent = h.askedAt && Date.now() - Date.parse(h.askedAt) < ASK_AGAIN_MS;
            const page = publicPageUrl(h.handle);
            const checked = checkedLine(h.checks, t);
            return (
              <div class="crow" key={h.id}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{h.name}</span>
                    <span class="ctag ctag--quiet">{h.country}</span>
                  </span>
                  {/* Their words, then what we saw, then what our staff checked — the directory's order. */}
                  {h.words ? <span class="crow__sub">“{h.words}”</span> : null}
                  <span class="chint">{h.seen.delivered ? t('business.contracts.findSeen', { n: h.seen.delivered }) : t('business.contracts.findSeenNone')}</span>
                  {checked ? <span class="chint">{checked}</span> : null}
                  <span class="twr-panelend" style="justify-content:flex-start;margin-top:6px">
                    {h.contact?.phone ? (
                      <a class="cbtn cbtn--ghost cbtn--sm" href={telOf(h.contact.phone)}>
                        {t('business.contracts.call')}
                      </a>
                    ) : null}
                    {h.contact?.email ? (
                      <a class="cbtn cbtn--ghost cbtn--sm" href={`mailto:${h.contact.email}`}>
                        {t('business.contracts.email')}
                      </a>
                    ) : null}
                    {h.contact?.website ? (
                      <a class="cbtn cbtn--ghost cbtn--sm" href={h.contact.website} target="_blank" rel="noopener noreferrer nofollow">
                        {t('business.contracts.website')}
                      </a>
                    ) : null}
                    {page ? (
                      <a class="cbtn cbtn--ghost cbtn--sm" href={page} target="_blank" rel="noopener noreferrer">
                        {t('business.contracts.page')}
                      </a>
                    ) : null}
                  </span>
                </span>
                {owner ? (
                  recent ? (
                    <span class="chint">{t('business.contracts.askedOn', { date: formatDate(h.askedAt!) })}</span>
                  ) : (
                    <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null} onClick={() => void ask(h)}>
                      {t('business.contracts.ask')}
                    </button>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {!owner ? <p class="chint">{t('business.contracts.askOwner')}</p> : null}
    </section>
  );
}
