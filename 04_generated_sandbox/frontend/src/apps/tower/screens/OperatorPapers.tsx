import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { formatDate, useT, type Translate } from '../../../shared/i18n';
import { paperDay, paperKindLabel, paperLine, papersToShow, type PaperView } from '../../../shared/papers';
import { ConsoleDetail } from '../ConsoleDetail';
import { Fig } from './PapersScreen';
import type { CarrierPaperRow } from '../papers';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * THE OPERATORS' OWN PAPERS — the licence that lets a company run lorries, and its cover.
 *
 * Listed whether or not any sister enforces them, and that is the point of the section. Until this existed
 * the transport-operator licence was a number with no date: read once at vetting and then unfalsifiable by
 * time, while the same network took a lorry off the road for a lapsed inspection. What a sister decides is
 * the CONSEQUENCE of a lapse (Rates → carrier papers); whether we look is not up for decision.
 *
 * Every row therefore answers three different things a reader must not confuse: whether the paper is in
 * date, whether anybody enforces it, and whether it is costing the fleet work right now.
 */
export function OperatorPapersPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.papers?.carrierPapers ?? [];
  const refused = rows.filter((r) => r.notOffered.length).length;
  const open = rows.find((r) => r.did === state.openId) ?? null;

  return (
    <>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.carrierPapers.listTitle', { n: rows.length })}</span>
          {refused ? <span class="ctag ctag--danger">{t('tower.carrierPapers.refusedCount', { n: refused })}</span> : null}
        </div>
        <p class="chint" style="margin:0 0 8px">{t('tower.carrierPapers.listHint')}</p>
        {state.papers === null ? (
          <p class="cons__empty">{t('tower.papers.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('tower.carrierPapers.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((row) => (
              <OperatorRow key={row.did} row={row} on={state.openId === row.did} actions={actions} />
            ))}
          </div>
        )}
      </section>
      {open ? (
        <ConsoleDetail openKey={open.did} title={t('tower.carrierPapers.sheetTitle')} onClose={() => actions.open(null)}>
          <OperatorSheet row={open} state={state} actions={actions} />
        </ConsoleDetail>
      ) : null}
    </>
  );
}

/**
 * The one tag a row earns — only for a state that needs somebody: refused, then a lapse nobody enforces.
 *
 * NOT for "no date recorded". That is where nearly every fleet starts, and the first version tagged ten of
 * eleven rows with it: a tag on everything marks nothing, and it cut every company's name short to make
 * room. The line under the name already says it.
 */
function operatorTag(row: CarrierPaperRow, t: Translate): { cls: string; text: string } | null {
  if (row.notOffered.length) return { cls: 'ctag--danger', text: t('tower.carrierPapers.tagRefused') };
  if (row.papers.some((p) => p.state === 'lapsed')) return { cls: 'ctag--warn', text: t('tower.carrierPapers.tagLapsedUnenforced') };
  return null;
}

/** What the row says under the name. Two undated papers are ONE fact, said once rather than truncated twice. */
function operatorLine(row: CarrierPaperRow, t: Translate): string {
  if (row.papers.length && row.papers.every((p) => p.state === 'none')) return t('tower.carrierPapers.noDates');
  const shown = papersToShow(row.papers);
  return shown.length ? shown.map((p) => paperLine(p, t)).join(' · ') : t('tower.papers.inDate');
}

function OperatorRow({ row, on, actions }: { row: CarrierPaperRow; on: boolean; actions: TowerActions }) {
  const t = useT();
  const tag = operatorTag(row, t);
  const line = operatorLine(row, t);
  return (
    <button type="button" class={`crow${on ? ' crow--on' : ''}`} aria-expanded={on} onClick={() => actions.open(on ? null : row.did)}>
      <span class="cface" aria-hidden="true">
        <Icon name="truck" size={18} />
      </span>
      <span class="crow__body">
        <span class="crow__top">
          <span class="crow__name">{row.companyName}</span>
          {tag ? <span class={`ctag ${tag.cls}`}>{tag.text}</span> : null}
        </span>
        <span class="crow__sub">{line}</span>
      </span>
      <span class="crow__tail">
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  );
}

function OperatorSheet({ row, state, actions }: { row: CarrierPaperRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  useEffect(() => setRecording(false), [row.did]);
  const [licence, insurance] = row.papers;
  const enforcedWords = row.enforced.length
    ? row.enforced.map((k) => paperKindLabel(k as PaperView['kind'], t)).join(', ')
    : t('tower.carrierPapers.enforcedNone');

  return (
    <>
      <div class="twr-person">
        <span class="cface cface--lg" aria-hidden="true">
          <Icon name="truck" size={24} />
        </span>
        <div class="twr-person__body">
          <p class="twr-person__name">{row.companyName}</p>
          <p class="twr-person__sub">{[row.jurisdiction, row.status.toLowerCase()].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {row.notOffered.length ? (
        <p class="cerr" style="margin:0 0 12px">
          <b>{t('tower.carrierPapers.notOfferedTitle')}</b> — {row.notOffered.join('; ')}
        </p>
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.sec.papers')}</span>
        </div>
        <div class="twr-facts">
          <Fig label={paperKindLabel('operator_licence', t)} sub={licence?.reference ? t('tower.papers.refNo', { ref: licence.reference }) : undefined}>
            {licence?.expiresAt ? paperDay(licence.expiresAt.slice(0, 10)) : t('tower.carrierPapers.noDate')}
          </Fig>
          <Fig label={paperKindLabel('carrier_insurance', t)} sub={insurance?.reference ? t('tower.papers.refNo', { ref: insurance.reference }) : undefined}>
            {insurance?.expiresAt ? paperDay(insurance.expiresAt.slice(0, 10)) : t('tower.carrierPapers.noDate')}
          </Fig>
          {/* What the sister behind them ACTS on — "nothing" is the usual answer and is said, never implied. */}
          <Fig label={t('tower.carrierPapers.enforcedLabel')}>{enforcedWords}</Fig>
        </div>
        {row.recordedBy ? (
          <p class="chint">{t('tower.carrierPapers.recordedBy', { who: row.recordedBy, when: row.recordedAt ? formatDate(row.recordedAt) : '' })}</p>
        ) : null}
        {recording ? (
          <OperatorForm row={row} state={state} actions={actions} onCancel={() => setRecording(false)} />
        ) : (
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRecording(true)}>
            {t('tower.papers.recordPapers')}
          </button>
        )}
      </section>
    </>
  );
}

function OperatorForm({ row, state, actions, onCancel }: { row: CarrierPaperRow; state: TowerState; actions: TowerActions; onCancel: () => void }) {
  const t = useT();
  const [licence, insurance] = row.papers;
  const [d, setD] = useState({
    licenceExpiresAt: licence?.expiresAt?.slice(0, 10) ?? '',
    insurancePolicy: insurance?.reference ?? '',
    insuranceExpiresAt: insurance?.expiresAt?.slice(0, 10) ?? '',
  });
  const [touched, setTouched] = useState(false);
  const patch = (p: Partial<typeof d>) => {
    setD({ ...d, ...p });
    setTouched(true);
  };
  const busy = state.busyId === row.did;
  const field = (key: keyof typeof d, label: string, date = false) => (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <input class="cinput" type={date ? 'date' : 'text'} value={d[key]} onInput={(e) => patch({ [key]: (e.target as HTMLInputElement).value } as Partial<typeof d>)} />
    </label>
  );
  // An emptied box is a CLEAR (null), an untouched one is left alone — the server tells the two apart.
  const value = (now: string, before?: string) => (now.trim() ? now.trim() : before ? null : undefined);
  return (
    <div class="twr-clear">
      <p class="twr-clear__b">{t('tower.carrierPapers.formBody')}</p>
      <div class="twr-facts">
        {field('licenceExpiresAt', t('tower.carrierPapers.licenceExpires'), true)}
        {field('insurancePolicy', t('tower.carrierPapers.insurancePolicy'))}
        {field('insuranceExpiresAt', t('tower.carrierPapers.insuranceExpires'), true)}
      </div>
      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={!touched || busy}
          onClick={() =>
            void actions.recordCarrierPapers(row.did, {
              licenceExpiresAt: value(d.licenceExpiresAt, licence?.expiresAt),
              insurancePolicy: value(d.insurancePolicy, insurance?.reference),
              insuranceExpiresAt: value(d.insuranceExpiresAt, insurance?.expiresAt),
            })
          }
        >
          {t('tower.papers.savePapers')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
          {t('tower.papers.cancel')}
        </button>
      </div>
    </div>
  );
}
