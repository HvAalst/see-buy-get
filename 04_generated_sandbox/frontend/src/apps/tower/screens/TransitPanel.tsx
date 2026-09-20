import { useState } from 'preact/hooks';
import { Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ConsoleAction } from '../ConsoleAction';
import { ConsolePick } from '../ConsolePick';
import { CountryPicker } from './CountryPicker';
import { useCountryAtlas } from './CountrySelect';
import { transitNeedingAttention, type CarrierOption, type TransitAuthorityRow } from '../papers';

/**
 * BL1 — WHO MAY CARRY UNCLEARED GOODS, and the desk that records it.
 *
 * It belongs on the Papers screen because it is exactly what that screen is for: a paper only network
 * staff can put right. Everything else there belongs to somebody with no office — a courier without a
 * fleet, a vehicle no fleet owns. A customs transit licence has no office at all, and when it lapses the
 * carrier simply stops being offered bonded work, in silence. That is the quietest way there is for a
 * container to sit on a quay, which is why this screen exists at all.
 *
 * WORST FIRST, from the server. The reason to open this screen is that something needs putting right,
 * and a list sorted by name buries the one lapsed licence among forty good ones.
 *
 * WITHDRAWN ROWS STAY. Somebody asking "why can this carrier no longer take bonded work" is owed the
 * answer, and a deleted row answers nothing — so they sink to the bottom carrying their reason.
 */
export function TransitPanel({
  transit,
  carriers,
  busyId,
  atlasApi,
  onRecord,
  onWithdraw,
}: {
  transit: TransitAuthorityRow[];
  carriers: CarrierOption[];
  busyId: string | null;
  /** The client the country atlas is read through — 243 countries, public, fetched once. */
  atlasApi: Parameters<typeof useCountryAtlas>[0];
  onRecord: (carrier: CarrierOption, body: { country: string; reference: string; expiresAt: string }) => Promise<void>;
  onWithdraw: (carrierDid: string, authorityId: string, reason: string) => Promise<void>;
}) {
  const t = useT();
  const atlas = useCountryAtlas(atlasApi);
  const [form, setForm] = useState({ carrierDid: '', country: '', reference: '', expiresAt: '' });
  const [withdrawing, setWithdrawing] = useState<TransitAuthorityRow | null>(null);
  const [why, setWhy] = useState('');

  const attention = transitNeedingAttention(transit).length;
  const chosen = carriers.find((c) => c.did === form.carrierDid);
  const complete = chosen && form.country && form.reference.trim() && form.expiresAt;

  const tone = (state: TransitAuthorityRow['state']) => (state === 'lapsed' ? 'ctag--danger' : state === 'due' ? 'ctag--warn' : state === 'withdrawn' ? 'ctag--quiet' : 'ctag--ok');

  const when = (a: TransitAuthorityRow) =>
    a.state === 'withdrawn'
      ? t('tower.papers.transitGone', { reason: a.withdrawnReason ?? '' })
      : a.state === 'lapsed'
        ? t('tower.papers.transitLapsed', { n: Math.abs(a.daysLeft) })
        : t('tower.papers.transitDays', { n: a.daysLeft });

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.papers.transitTitle')}</span>
        <span class={`ctag ${attention > 0 ? 'ctag--warn' : 'ctag--quiet'}`}>{t('tower.papers.transitCount', { n: transit.length, attention })}</span>
      </div>
      <p class="cons__lede">{t('tower.papers.transitLede')}</p>
      {/* Said before anybody reads a row as cover: this is what the carrier told us. */}
      <p class="chint">{t('tower.papers.transitBasis')}</p>

      <ConsoleAction title={t('tower.papers.transitAdd')}>
        {(close) => (
          <>
            <ConsolePick
              label={t('tower.papers.transitCarrier')}
              value={form.carrierDid}
              onChange={(carrierDid) => setForm({ ...form, carrierDid })}
              // A NAME and what kind of carrier they are. Nobody types a DID on this network.
              options={carriers.map((c) => ({ value: c.did, label: c.name, tag: t(c.kind === 'fleet' ? 'tower.papers.transitFleet' : 'tower.papers.transitOwner') }))}
              placeholder={t('tower.papers.transitPickCarrier')}
            />
            <CountryPicker value={form.country} onChange={(country) => setForm({ ...form, country })} label={t('tower.papers.transitCountry')} options={atlas} />
            <label class="cfield">
              <span class="cfield__label">{t('tower.papers.transitRef')}</span>
              <input class="cinput" value={form.reference} onChange={(e) => setForm({ ...form, reference: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('tower.papers.transitExpires')}</span>
              <input class="cinput" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: (e.target as HTMLInputElement).value })} />
            </label>
            <div class="twr-panelend">
              <button
                type="button"
                class="cbtn cbtn--primary"
                disabled={!complete || busyId === form.carrierDid}
                onClick={async () => {
                  if (!chosen) return;
                  await onRecord(chosen, { country: form.country, reference: form.reference.trim(), expiresAt: form.expiresAt });
                  setForm({ carrierDid: '', country: '', reference: '', expiresAt: '' });
                  close();
                }}
              >
                {t('tower.papers.transitSave')}
              </button>
            </div>
          </>
        )}
      </ConsoleAction>

      {transit.length === 0 ? (
        <p class="cons__empty">{t('tower.papers.transitNone')}</p>
      ) : (
        <div class="crows">
          {transit.map((a) => (
            <div key={a.authorityId} class="crow">
              <span class="crow__body">
                <span class="crow__top">
                  {/* A NAME, or a plain sentence saying we have none — never the DID it is keyed by.
                      A carrier can leave the network while the licence they held stays on the record. */}
                  <span class="crow__name">{a.carrierName ?? t('tower.papers.transitUnknown')}</span>
                  <span class={`ctag ${tone(a.state)}`}>{when(a)}</span>
                </span>
                <span class="crow__sub">
                  {t('tower.papers.transitRow', { country: a.country, reference: a.reference })} · {t('tower.papers.transitTo', { date: a.expiresAt })}
                </span>
                <span class="chint">{t('tower.papers.transitBy', { who: a.recordedBy })}</span>
              </span>
              {!a.withdrawnAt ? (
                <span class="crow__tail">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busyId === a.authorityId} onClick={() => setWithdrawing(a)}>
                    {t('tower.papers.transitWithdraw')}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* A reason is asked in a sheet, never in a browser dialog — the console's own rule, and the
          reason is kept forever against the row, so it is typed rather than clicked past. */}
      {withdrawing ? (
        <Sheet open onClose={() => setWithdrawing(null)} title={t('tower.papers.transitWithdraw')}>
          <p class="cons__lede">{withdrawing.carrierName ?? t('tower.papers.transitUnknown')}</p>
          <p class="chint">{t('tower.papers.transitRow', { country: withdrawing.country, reference: withdrawing.reference })}</p>
          <label class="cfield">
            <span class="cfield__label">{t('tower.papers.transitWhy')}</span>
            <input class="cinput" value={why} onChange={(e) => setWhy((e.target as HTMLInputElement).value)} />
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--primary"
              disabled={!why.trim() || busyId === withdrawing.authorityId}
              onClick={async () => {
                await onWithdraw(withdrawing.carrierDid, withdrawing.authorityId, why.trim());
                setWhy('');
                setWithdrawing(null);
              }}
            >
              {t('tower.papers.transitWithdraw')}
            </button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
