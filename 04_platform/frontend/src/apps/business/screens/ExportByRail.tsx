import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { SitePicker } from '../../tower/screens/SitePicker';
import type { BusinessClient, BusinessView } from '../api';
import { fromUtcInput, utcWords, type ExportDetail } from '../exports';

type Problem = { detail?: string; title: string } | null | undefined;

/**
 * BY RAIL TO THE PORT (the user, 2026-10-29: "build the clock with the blocker as you said"). Only where the box goes to
 * the port by train: our truck then takes it to the rail terminal, timed to the train's cut-off there — which must fall
 * before the port gate closes. Set before the load to the terminal is posted; once a truck is sent, its destination stands.
 * Once the train brought the box inside the port gate, the exporter says when: the line's clock counts it inside from then.
 */
export function ExportByRail({ d, business, client, mine, onChanged }: { d: ExportDetail; business: BusinessView; client: BusinessClient; mine: boolean; onChanged: () => void | Promise<void> }) {
  const t = useT();
  const c = d.consignment;
  const r = c.byRail;
  const sent = Boolean(d.ladenLeg && d.ladenLeg.status !== 'cancelled');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ site: '', cutoff: '', reference: '' });
  const [atPort, setAtPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<{ error?: Problem }>) => {
    setBusy(true);
    setError(null);
    const out = await fn();
    setBusy(false);
    if (out.error) return setError(out.error.detail || out.error.title);
    setOpen(false);
    await onChanged();
  };
  const cutoffAt = fromUtcInput(form.cutoff);

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.exports.byRail.title')}</span>
      </div>
      {r ? (
        <>
          <p class="cons__lede">
            {t('business.exports.byRail.set', { terminal: r.terminal.label, cutoff: utcWords(r.cutoffAt), gate: utcWords(c.booking.gateCutoffAt) })}
            {r.reference ? ` ${t('business.exports.byRail.train', { reference: r.reference })}` : ''}
          </p>
          {r.atPort ? (
            <p class="chint">{t('business.exports.byRail.atPortSaid', { when: utcWords(r.atPort.at) })}</p>
          ) : d.timing.gatedInAt && mine ? (
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.byRail.atPort')}</span>
                <input class="cinput" type="datetime-local" value={atPort} onInput={(e) => setAtPort((e.target as HTMLInputElement).value)} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !fromUtcInput(atPort)} onClick={() => void act(() => client.exports.atPort(c.exportId, fromUtcInput(atPort)!))}>
                  {t('business.exports.byRail.atPortSave')}
                </button>
              </div>
            </div>
          ) : d.timing.gatedInAt ? (
            <p class="chint">{t('business.exports.byRail.onTrain')}</p>
          ) : null}
        </>
      ) : (
        <p class="chint">{t('business.exports.byRail.hint')}</p>
      )}
      {mine && !sent && !open ? (
        <div class="twr-panelend">
          {r ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void act(() => client.exports.clearByRail(c.exportId))}>
              {t('business.exports.byRail.byRoad')}
            </button>
          ) : null}
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen(true)}>
            {t(r ? 'business.exports.byRail.change' : 'business.exports.byRail.open')}
          </button>
        </div>
      ) : null}
      {mine && !sent && open ? (
        <>
          <SitePicker kind="clearance" entityId={business.entityId} api={client.api as never} value={form.site} onChange={(site) => setForm({ ...form, site })} label={t('business.exports.byRail.terminal')} addLabel={t('business.exports.f.addPlace')} />
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.byRail.cutoff')}</span>
              <input class="cinput" type="datetime-local" value={form.cutoff} onInput={(e) => setForm({ ...form, cutoff: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.byRail.reference')}</span>
              <input class="cinput" maxLength={60} value={form.reference} onInput={(e) => setForm({ ...form, reference: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen(false)}>{t('business.exports.byRail.cancel')}</button>
            <button
              type="button"
              class="cbtn cbtn--primary cbtn--sm"
              disabled={busy || !form.site || !cutoffAt}
              onClick={() => void act(() => client.exports.byRail(c.exportId, { terminalSiteId: form.site, cutoffAt: cutoffAt!, ...(form.reference.trim() ? { reference: form.reference.trim() } : {}) }))}
            >
              {t('business.exports.byRail.save')}
            </button>
          </div>
        </>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}
    </section>
  );
}
