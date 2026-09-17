import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { DocumentStrip } from './DocumentStrip';
import { paperLine, papersToShow, paperTone, renewalBlocker } from '../../../shared/papers';
import { isStuck, type CourierPaperRow, type LooseVehicleRow } from '../papers';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * FP4 — the papers only network staff can put right.
 *
 * A fleet records its own renewals in the Fleet app. A courier who rides without a fleet, and a vehicle no
 * fleet owns, have no office to do that for them: a licence that lapses puts them off the road with nobody
 * to tell. This screen is that office. It also runs the six-hourly check by hand and says when it last ran —
 * a check that is silent is indistinguishable from one that is not running.
 */
export function PapersScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const r = state.papers;
  const stuckCouriers = r?.couriers.filter(isStuck).length ?? 0;
  const stuckVehicles = r?.vehicles.filter(isStuck).length ?? 0;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.papers.title')}</h1>
        <p class="cons__lede">{t('tower.papers.lede')}</p>
      </header>

      {state.done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {state.done}
        </p>
      ) : null}
      {state.queueError ? (
        <p class="cerr" style="margin:0 0 12px">
          <b>{t('tower.papers.refused')}</b> — {state.queueError}
        </p>
      ) : null}
      {state.error ? (
        <p class="cerr" style="margin:0 0 12px">
          <b>{t('tower.papers.failedTitle')}</b> — {state.error.detail || state.error.title}
        </p>
      ) : null}

      {/* The check itself — when it last looked, and a way to make it look now. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.sweepTitle')}</span>
          <span class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.runPapersSweep()} disabled={state.busyId === 'sweep' || r === null}>
              <Icon name="refresh" size={16} />
              {t('tower.papers.sweepRun')}
            </button>
          </span>
        </div>
        <p class="cons__empty" style="text-align:left">
          {r === null
            ? t('tower.papers.loading')
            : r.sweep
              ? t('tower.papers.sweepLast', { time: new Date(r.sweep.at).toLocaleString(), shifts: r.sweep.shiftsEnded, told: r.sweep.notified, mails: r.sweep.mails, hours: r.sweepEveryHours })
              : t('tower.papers.sweepNever', { hours: r.sweepEveryHours })}
        </p>
        {r ? (
          <p class="cons__empty" style="text-align:left;padding-top:0">
            {t('tower.papers.fleetsLine', { count: r.fleets.count, withLapsed: r.fleets.withLapsed, lapsed: r.fleets.lapsed, due: r.fleets.due })}
          </p>
        ) : null}
      </section>

      {/* Couriers without a fleet. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.couriersTitle', { n: r?.couriers.length ?? 0, stuck: stuckCouriers })}</span>
        </div>
        {r === null ? (
          <p class="cons__empty">{t('tower.papers.loading')}</p>
        ) : r.couriers.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.papers.noCouriersTitle')}</p>
            <p>{t('tower.papers.noCouriersBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.papers.col.courier')}</th>
                <th>{t('tower.papers.col.licence')}</th>
                <th>{t('tower.papers.col.today')}</th>
                <th aria-label={t('tower.papers.recordLicence')} />
              </tr>
            </thead>
            <tbody>
              {r.couriers.map((row) => (
                <CourierRow key={row.did} row={row} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Vehicles no fleet owns. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.vehiclesTitle', { n: r?.vehicles.length ?? 0, stuck: stuckVehicles })}</span>
        </div>
        {r === null ? (
          <p class="cons__empty">{t('tower.papers.loading')}</p>
        ) : r.vehicles.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.papers.noVehiclesTitle')}</p>
            <p>{t('tower.papers.noVehiclesBody')}</p>
          </div>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.papers.col.vehicle')}</th>
                <th>{t('tower.papers.col.papers')}</th>
                <th>{t('tower.papers.col.today')}</th>
                <th aria-label={t('tower.papers.recordPapers')} />
              </tr>
            </thead>
            <tbody>
              {r.vehicles.map((row) => (
                <VehicleRow key={row.vehicleId} row={row} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function PaperTags({ papers }: { papers: CourierPaperRow['papers'] }) {
  const t = useT();
  const shown = papersToShow(papers);
  if (shown.length === 0) return <span class="ctag ctag--ok">{t('tower.papers.inDate')}</span>;
  return (
    <>
      {shown.map((p) => {
        const tone = paperTone(p.state);
        return (
          <div key={p.kind}>
            <span class={'ctag ' + (tone === 'danger' ? 'ctag--danger' : tone === 'warn' ? 'ctag--warn' : 'ctag--quiet')}>{paperLine(p, t)}</span>
          </div>
        );
      })}
    </>
  );
}

function CourierRow({ row, state, actions }: { row: CourierPaperRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.did;
  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong">{row.displayName}</div>
          <div class="ctbl__sub">
            {[row.badgeId, row.registry, row.jurisdiction, row.status.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}
          </div>
          {row.drives.length ? <div class="ctbl__sub">{t('tower.papers.drives', { plates: row.drives.join(', ') })}</div> : null}
        </td>
        <td>
          <div class="ctbl__mono">{row.licence.number ?? '—'}</div>
          <div class="ctbl__sub">{row.licence.expiresAt ? row.licence.expiresAt.slice(0, 10) : t('tower.papers.noDate')}</div>
        </td>
        <td>
          <PaperTags papers={row.papers} />
          {isStuck(row) ? <div class="ctbl__sub">{t('tower.papers.stuckCourier')}</div> : null}
          {row.onShift ? <div class="ctbl__sub">{t('tower.papers.onShift')}</div> : null}
        </td>
        <td class="ctbl__num">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => actions.open(open ? null : row.did)}>
            {open ? t('tower.papers.cancel') : t('tower.papers.recordLicence')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={4}>
            <LicenceForm row={row} state={state} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The renewal, recorded by staff who have seen the paper. The date is the whole of it. */
function LicenceForm({ row, state, actions }: { row: CourierPaperRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [number, setNumber] = useState(row.licence.number ?? '');
  const [expiresAt, setExpiresAt] = useState('');
  const blocker = renewalBlocker(expiresAt);
  const busy = state.busyId === row.did;
  return (
    <div class="twr-clear">
      <p class="twr-clear__t">{t('tower.papers.licenceTitle', { name: row.displayName })}</p>
      <p class="twr-clear__b">{t('tower.papers.licenceBody')}</p>
      {/* THE PAPER, above the field. This form's own comment has always said "recorded by staff who have
          seen the paper" and the screen showed them none — so the date was typed against nothing, on the
          one control that decides whether somebody may legally be on the road. */}
      <DocumentStrip
        refs={[row.documents?.licenceCopyRef].filter((x): x is string => Boolean(x))}
        state={state}
        actions={actions}
        titleKey="tower.papers.licenceProof"
        emptyKey="tower.papers.licenceNoProof"
      />
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <label class="cfield">
          <span class="cfield__label">{t('tower.papers.licenceNumber')}</span>
          <input class="cinput" value={number} onInput={(e) => setNumber((e.target as HTMLInputElement).value)} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.papers.licenceExpires')}</span>
          <input class="cinput" type="date" value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={blocker !== null || busy}
          onClick={() => {
            const n = number.trim();
            void actions.recordCourierLicence(row.did, { expiresAt, ...(n && n !== row.licence.number ? { number: n } : {}) }, row.displayName);
          }}
        >
          {t('tower.papers.saveLicence')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={() => actions.open(null)} disabled={busy}>
          {t('tower.papers.cancel')}
        </button>
        {blocker && expiresAt ? <span class="chint">{t(blocker)}</span> : null}
      </div>
    </div>
  );
}

function VehicleRow({ row, state, actions }: { row: LooseVehicleRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.vehicleId;
  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong ctbl__mono">{row.plate}</div>
          <div class="ctbl__sub">{[row.vehicleClass, row.status.toLowerCase()].join(' · ')}</div>
        </td>
        <td>
          <div class="ctbl__sub">{t('tower.papers.insuranceLine', { ref: row.documents.insuranceRef ?? '—', date: row.documents.insuranceExpiresAt?.slice(0, 10) ?? t('tower.papers.noDate') })}</div>
          <div class="ctbl__sub">{t('tower.papers.inspectionLine', { ref: row.documents.inspectionRef ?? '—', date: row.documents.inspectionExpiresAt?.slice(0, 10) ?? t('tower.papers.noDate') })}</div>
        </td>
        <td>
          <PaperTags papers={row.papers} />
          {isStuck(row) ? <div class="ctbl__sub">{t('tower.papers.stuckVehicle')}</div> : null}
          {row.onShiftWith ? <div class="ctbl__sub">{t('tower.papers.onShiftWith', { name: row.onShiftWith })}</div> : null}
        </td>
        <td class="ctbl__num">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => actions.open(open ? null : row.vehicleId)}>
            {open ? t('tower.papers.cancel') : t('tower.papers.recordPapers')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={4}>
            <VehicleForm row={row} state={state} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function VehicleForm({ row, state, actions }: { row: LooseVehicleRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [d, setD] = useState({
    insuranceRef: row.documents.insuranceRef ?? '',
    insuranceExpiresAt: row.documents.insuranceExpiresAt?.slice(0, 10) ?? '',
    inspectionRef: row.documents.inspectionRef ?? '',
    inspectionExpiresAt: row.documents.inspectionExpiresAt?.slice(0, 10) ?? '',
  });
  const [touched, setTouched] = useState(false);
  const patch = (p: Partial<typeof d>) => {
    setD({ ...d, ...p });
    setTouched(true);
  };
  const busy = state.busyId === row.vehicleId;
  const field = (key: keyof typeof d, labelKey: 'tower.papers.insuranceRef' | 'tower.papers.insuranceExpires' | 'tower.papers.inspectionRef' | 'tower.papers.inspectionExpires', date = false) => (
    <label class="cfield">
      <span class="cfield__label">{t(labelKey)}</span>
      <input class="cinput" type={date ? 'date' : 'text'} value={d[key]} onInput={(e) => patch({ [key]: (e.target as HTMLInputElement).value } as Partial<typeof d>)} />
    </label>
  );
  return (
    <div class="twr-clear">
      <p class="twr-clear__t">{t('tower.papers.vehicleTitle', { plate: row.plate })}</p>
      <p class="twr-clear__b">{t('tower.papers.vehicleBody')}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        {field('insuranceRef', 'tower.papers.insuranceRef')}
        {field('insuranceExpiresAt', 'tower.papers.insuranceExpires', true)}
        {field('inspectionRef', 'tower.papers.inspectionRef')}
        {field('inspectionExpiresAt', 'tower.papers.inspectionExpires', true)}
      </div>
      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={!touched || busy}
          onClick={() =>
            void actions.recordVehiclePapers(
              row.vehicleId,
              {
                insuranceRef: d.insuranceRef.trim() || undefined,
                insuranceExpiresAt: d.insuranceExpiresAt || undefined,
                inspectionRef: d.inspectionRef.trim() || undefined,
                inspectionExpiresAt: d.inspectionExpiresAt || undefined,
              },
              row.plate,
            )
          }
        >
          {t('tower.papers.savePapers')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={() => actions.open(null)} disabled={busy}>
          {t('tower.papers.cancel')}
        </button>
      </div>
    </div>
  );
}
