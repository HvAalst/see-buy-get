import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ConsoleFold } from '../ConsoleFold';
import { CountrySelect } from './CountrySelect';
import { DocumentStrip } from './DocumentStrip';
import { EMPTY_FLEET_FORM, FLEET_PAPERS, fleetCountries, fleetFormBlocker, fleetStep, fleetsWaitingOnMe, papersOf, type FleetForm, type FleetPaperKey, type FleetSetupRow, type FleetStep } from '../fleets';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * FLEETS, AND HOW ONE COMES TO BE — the set-up that had no screen.
 *
 * A fleet does not sign itself up: staff register it, and its office then signs in with the code it is given. The
 * server has taken every step of that the whole time — register, papers, a decision, the bond — and nothing in any
 * console did one of them. The seeder did, for the demo fleet. On a server with nothing on it there could be no fleet.
 *
 * It sits with the other people joining (shops, drivers), because it is the same question — who do we let carry for
 * us — and because two of the four steps are somebody waiting on us.
 *
 * TWO PEOPLE. Whoever puts a fleet's papers on record is not the one who approves them: the row says so to that
 * person and offers no button, and the server refuses it anyway.
 */
export function FleetsPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.fleets;

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.fleets.title')}</span>
        {/* Null is "not read yet" and must never render as a zero. */}
        {rows === null ? null : <span class="ctbl__sub">{t('tower.fleets.count', { n: rows.length, waiting: fleetsWaitingOnMe(rows) ?? 0 })}</span>}
      </div>
      <p class="cons__lede">{t('tower.fleets.lede')}</p>

      {state.fleetNote ? (
        state.fleetNote.tone === 'ok' ? (
          <p class="twr-done">
            <Icon name="check" size={16} />
            {state.fleetNote.text}
          </p>
        ) : (
          <p class="cerr" role="alert">
            {state.fleetNote.text}
          </p>
        )
      ) : null}

      <RegisterFleet state={state} actions={actions} />

      {rows === null ? (
        <p class="cons__empty">{t('tower.fleets.loading')}</p>
      ) : rows.length === 0 ? (
        <p class="cons__empty">{t('tower.fleets.none')}</p>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.fleets.col.fleet')}</th>
              <th>{t('tower.fleets.col.numbers')}</th>
              <th>{t('tower.fleets.col.stands')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FleetRow key={row.did} row={row} state={state} actions={actions} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const FIELD_LABEL: Record<keyof FleetForm, MessageKey> = {
  companyName: 'tower.fleets.f.companyName',
  jurisdiction: 'tower.fleets.f.jurisdiction',
  contactPhone: 'tower.fleets.f.contactPhone',
  ownerFullName: 'tower.fleets.f.ownerFullName',
  ownerNationalId: 'tower.fleets.f.ownerNationalId',
  depotAddress: 'tower.fleets.f.depotAddress',
  businessRegistrationNo: 'tower.fleets.f.businessRegistrationNo',
  transportOperatorLicence: 'tower.fleets.f.transportOperatorLicence',
  taxId: 'tower.fleets.f.taxId',
};

/** The form a fleet is registered with. Folded shut: on most days nobody is registering one. */
function RegisterFleet({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [form, setForm] = useState<FleetForm>(EMPTY_FLEET_FORM);
  const [open, setOpen] = useState(false);
  const countries = fleetCountries(state.catalogue);
  // One country switched on is the answer; nobody should have to pick the only thing on a list.
  const filled: FleetForm = form.jurisdiction || countries.length !== 1 ? form : { ...form, jurisdiction: countries[0].code };
  const blocker = fleetFormBlocker(filled);
  const busy = state.busyId === 'fleet-new';
  const field = (key: Exclude<keyof FleetForm, 'jurisdiction'>, extra: { inputMode?: 'tel'; autoComplete?: string } = {}) => (
    <label class="twr-knob cfield">
      <span class="cfield__label">{t(FIELD_LABEL[key])}</span>
      <input class="cinput" value={form[key]} disabled={busy} inputMode={extra.inputMode} autoComplete={extra.autoComplete ?? 'off'} onInput={(e) => setForm({ ...form, [key]: e.currentTarget.value })} />
    </label>
  );

  return (
    <ConsoleFold title={t('tower.fleets.newTitle')} hint={t('tower.fleets.newHint')} open={open} onOpenChange={setOpen}>
      {countries.length === 0 ? (
        <p class="cons__empty">{t('tower.fleets.noCountry')}</p>
      ) : (
        <>
          <div class="twr-knobs__row">
            {field('companyName')}
            {countries.length > 1 ? (
              <div class="twr-knob">
                <CountrySelect value={form.jurisdiction} onChange={(jurisdiction) => setForm({ ...form, jurisdiction })} label={t('tower.fleets.f.jurisdiction')} options={countries} />
              </div>
            ) : null}
            {field('contactPhone', { inputMode: 'tel' })}
            {field('depotAddress')}
            {field('ownerFullName')}
            {field('ownerNationalId')}
            {field('businessRegistrationNo')}
            {field('transportOperatorLicence')}
            {field('taxId')}
          </div>
          <p class="chint">{t('tower.fleets.newPhoneHint')}</p>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--primary"
              disabled={busy || blocker !== null}
              onClick={async () => {
                if (!(await actions.registerFleet(filled))) return;
                setForm(EMPTY_FLEET_FORM);
                setOpen(false);
              }}
            >
              {t('tower.fleets.register')}
            </button>
            {blocker ? <span class="ctbl__sub">{t('tower.fleets.stillNeeded', { what: t(FIELD_LABEL[blocker]) })}</span> : null}
          </div>
        </>
      )}
    </ConsoleFold>
  );
}

const STEP_TAG: Record<FleetStep, { tone: string; key: MessageKey }> = {
  papers: { tone: 'warn', key: 'tower.fleets.step.papers' },
  approve: { tone: 'warn', key: 'tower.fleets.step.approve' },
  colleague: { tone: 'info', key: 'tower.fleets.step.colleague' },
  bond: { tone: 'warn', key: 'tower.fleets.step.bond' },
  active: { tone: 'ok', key: 'tower.fleets.step.active' },
  suspended: { tone: 'danger', key: 'tower.fleets.step.suspended' },
};
const PAPER_LABEL: Record<FleetPaperKey, MessageKey> = {
  businessRegCertRef: 'tower.fleets.paper.registration',
  operatorLicenceRef: 'tower.fleets.paper.licence',
  ownerIdRef: 'tower.fleets.paper.ownerId',
  proofOfAddressRef: 'tower.fleets.paper.address',
};

function FleetRow({ row, state, actions }: { row: FleetSetupRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const step = fleetStep(row);
  const busy = state.busyId === row.did;
  const [pictures, setPictures] = useState<Partial<Record<FleetPaperKey, string>>>({});
  const [why, setWhy] = useState<string | null>(null);
  const allFour = FLEET_PAPERS.every(([key]) => Boolean(pictures[key]));

  const pick = (key: FleetPaperKey, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPictures((p) => ({ ...p, [key]: String(reader.result ?? '') }));
    reader.readAsDataURL(file);
  };

  return (
    <>
      <tr>
        <td>
          <div class="ctbl__strong">{row.companyName}</div>
          <div class="ctbl__sub">
            {row.contactPhone}
            {row.jurisdiction ? ` · ${row.jurisdiction}` : ''}
          </div>
          {row.depotAddress ? <div class="ctbl__sub">{row.depotAddress}</div> : null}
        </td>
        <td class="ctbl__sub">
          <span class="ctbl__lbl">{t('tower.fleets.col.numbers')}</span>
          <div class="ctbl__mono">{row.requirements.businessRegistrationNo}</div>
          <div class="ctbl__mono">{row.requirements.transportOperatorLicence}</div>
          <div class="ctbl__mono">{row.requirements.taxId}</div>
        </td>
        <td>
          <span class="ctbl__lbl">{t('tower.fleets.col.stands')}</span>
          <span class={`ctag ctag--${STEP_TAG[step].tone}`}>{t(STEP_TAG[step].key)}</span>
        </td>
      </tr>
      <tr class="ctbl__editor">
        <td colSpan={3}>
          {step === 'papers' ? (
            <>
              {row.refused ? (
                <p class="cerr">
                  <b>{t('tower.fleets.sentBack', { by: row.refused.by ?? t('tower.fleets.aColleague') })}</b> {row.refused.reason}
                </p>
              ) : null}
              <p class="chint">{t('tower.fleets.papersHint')}</p>
              <div class="twr-knobs__row">
                {FLEET_PAPERS.map(([key]) => (
                  <label class="twr-knob cfield" key={key}>
                    <span class="cfield__label">
                      {t(PAPER_LABEL[key])}
                      {pictures[key] ? ` · ${t('tower.fleets.chosen')}` : ''}
                    </span>
                    <input id={`fleet-${key}-${row.did}`} class="cinput" type="file" accept="image/*" disabled={busy} onChange={(e) => pick(key, (e.target as HTMLInputElement).files?.[0] ?? null)} />
                  </label>
                ))}
              </div>
              <div class="twr-panelend">
                <button
                  type="button"
                  class="cbtn cbtn--primary cbtn--sm"
                  disabled={busy || !allFour}
                  onClick={async () => {
                    if (await actions.putFleetPapers(row.did, pictures as Record<FleetPaperKey, string>)) setPictures({});
                  }}
                >
                  {t('tower.fleets.putOnRecord')}
                </button>
                {!allFour ? <span class="ctbl__sub">{t('tower.fleets.allFour')}</span> : null}
              </div>
            </>
          ) : null}

          {step === 'approve' || step === 'colleague' ? (
            <>
              {/* Open on the row: approving a fleet without having looked at its licence is a rubber stamp. */}
              <DocumentStrip refs={papersOf(row)} state={state} actions={actions} emptyKey="tower.fleets.nothingToSee" titleKey="tower.fleets.onRecord" />
              <p class="chint">
                {t('tower.fleets.enteredBy', { by: row.papers?.enteredBy ?? t('tower.fleets.aColleague'), date: row.papers?.submittedAt.slice(0, 10) ?? '' })}{' '}
                {step === 'colleague' ? t('tower.fleets.notYours') : ''}
              </p>
              <span class="twr-clear__act">
                {step === 'approve' ? (
                  <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void actions.decideFleet(row.did, true)}>
                    {/* Not "Let them in": approving its papers lets nobody in — the bond does. */}
                    {t('tower.fleets.approve')}
                  </button>
                ) : null}
                {/* Taking one's own entry back is not approving it: whoever put them on record may send them back too. */}
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} aria-expanded={why != null} onClick={() => setWhy(why == null ? '' : null)}>
                  {t('tower.fleets.sendBack')}
                </button>
              </span>
              {why != null ? (
                <>
                  <label class="cfield">
                    <span class="cfield__label">{t('tower.fleets.whyLabel')}</span>
                    <textarea class="ctextarea" rows={2} value={why} disabled={busy} onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)} />
                  </label>
                  <span class="twr-clear__act">
                    <button
                      type="button"
                      class="cbtn cbtn--danger cbtn--sm"
                      disabled={busy || !why.trim()}
                      onClick={() => {
                        void actions.decideFleet(row.did, false, why.trim());
                        setWhy(null);
                      }}
                    >
                      {t('tower.fleets.sendBackConfirm')}
                    </button>
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setWhy(null)}>
                      {t('common.close')}
                    </button>
                  </span>
                </>
              ) : null}
            </>
          ) : null}

          {step === 'bond' ? (
            <>
              <p class="chint">{t('tower.fleets.bondHint')}</p>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void actions.recordFleetBond(row.did)}>
                  {t('tower.fleets.recordBond')}
                </button>
              </div>
            </>
          ) : null}

          {step === 'active' && row.loginCode ? (
            <p class="chint">
              {t('tower.fleets.codeIs')} <b class="ctbl__mono">{row.loginCode}</b> — {t('tower.fleets.codeHint')}
            </p>
          ) : null}
        </td>
      </tr>
    </>
  );
}
