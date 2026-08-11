import { Button, Card, ErrorNote, Pill, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { driverAction, driverMissing, isHeavySelection, shortDid, statusTone, toggleClass } from '../logic';
import { VEHICLE_CLASSES } from '../types';
import type { FleetActions, FleetState } from '../useFleetApp';

export interface DriversScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/**
 * The drivers pool: onboard (light = active now, heavy = papers first) and follow each
 * driver's stage. The KYC DECISION is SeeBuyGet ops' — this screen submits papers and then
 * says "SeeBuyGet is checking", it never offers an approve button that would 403.
 */
export function DriversScreen({ state, actions }: DriversScreenProps) {
  const t = useT();
  const f = state.dForm;
  const missing = driverMissing(f, t);
  const heavy = isHeavySelection(f.classes);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <Card title={t('fleet.drivers.onboardTitle')}>
        <p class="card__note">{t('fleet.drivers.onboardNote')}</p>
        <div class="grid2">
          <div class="field">
            <label class="field__label" for="d-display">
              {t('fleet.drivers.displayName')}
            </label>
            <input id="d-display" class="input" value={f.displayName} onInput={(e) => actions.setDForm({ displayName: e.currentTarget.value })} placeholder={t('fleet.drivers.displayNamePh')} />
          </div>
          <div class="field">
            <label class="field__label" for="d-full">
              {t('fleet.drivers.fullName')}
            </label>
            <input id="d-full" class="input" value={f.fullName} onInput={(e) => actions.setDForm({ fullName: e.currentTarget.value })} />
          </div>
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="d-id">
              {t('fleet.drivers.nationalId')}
            </label>
            <input id="d-id" class="input input--mono" value={f.nationalId} onInput={(e) => actions.setDForm({ nationalId: e.currentTarget.value })} spellcheck={false} />
          </div>
          <div class="field">
            <label class="field__label" for="d-mobile">
              {t('fleet.drivers.mobile')}
            </label>
            <input id="d-mobile" class="input" type="tel" inputMode="tel" value={f.mobile} onInput={(e) => actions.setDForm({ mobile: e.currentTarget.value })} placeholder="07…" />
          </div>
        </div>
        <div class="field" style="margin-top:12px">
          <span class="field__label">{t('fleet.drivers.clearedToDrive')}</span>
          <div class="chips">
            {VEHICLE_CLASSES.map((c) => {
              const on = f.classes.includes(c);
              return (
                <button key={c} type="button" class={`chip chip--tap${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => actions.setDForm({ classes: toggleClass(f.classes, c) })}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        {heavy ? (
          <>
            <div class="grid2" style="margin-top:12px">
              <div class="field">
                <label class="field__label" for="d-lic">
                  {t('fleet.drivers.licenceNumber')}
                </label>
                <input id="d-lic" class="input input--mono" value={f.licenceNumber} onInput={(e) => actions.setDForm({ licenceNumber: e.currentTarget.value })} spellcheck={false} />
              </div>
              <div class="field">
                <label class="field__label" for="d-exp">
                  {t('fleet.drivers.licenceExpires')}
                </label>
                <input id="d-exp" class="input" type="date" value={f.licenceExpiresAt} onInput={(e) => actions.setDForm({ licenceExpiresAt: e.currentTarget.value })} />
              </div>
            </div>
            <label class="checkline" style="margin-top:12px">
              <input type="checkbox" checked={f.criminalRecordClear} onChange={(e) => actions.setDForm({ criminalRecordClear: e.currentTarget.checked })} />
              <span>{t('fleet.drivers.criminalClear')}</span>
            </label>
          </>
        ) : (
          <p class="hint" style="margin-top:12px">
            {t('fleet.drivers.lightRegistry')}
          </p>
        )}
        <div style="margin-top:14px">
          <Button chevron={false} onClick={() => void actions.submitDriver()} disabled={Boolean(missing)} busy={state.busy === 'driver'}>
            {t('fleet.drivers.onboardCta')}
          </Button>
          {missing ? <p class="hint" style="margin-top:8px">{missing}</p> : null}
        </div>
      </Card>

      <Card title={t('fleet.drivers.poolTitle', { count: state.drivers.length })}>
        {state.drivers.length === 0 ? (
          <p class="hint">{t('fleet.drivers.empty')}</p>
        ) : (
          <div class="rows" role="list">
            {state.drivers.map((d) => {
              const action = driverAction(d);
              return (
                <div key={d.did} class="row row--static" role="listitem">
                  <span class="row__body">
                    <span class="row__t">{d.displayName}</span>
                    <span class="row__s">
                      {`${d.badgeId ?? shortDid(d.did)} · ${d.registry} · ${(d.licence?.classes ?? []).join(', ') || '—'}`}
                    </span>
                  </span>
                  <span class="row__end">
                    <Pill tone={statusTone(d.status)} dot>
                      {d.status === 'KYC_PENDING' ? t('fleet.drivers.beingChecked') : d.status.replace(/_/g, ' ').toLowerCase()}
                    </Pill>
                    {action === 'submit-kyc' ? (
                      <Button variant="link" full={false} busy={state.busy === `kyc:${d.did}`} onClick={() => void actions.submitKyc(d.did)}>
                        {t('fleet.drivers.sendPapers')}
                      </Button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud
          text={() => {
            const pending = state.drivers.filter((d) => d.status === 'KYC_PENDING').length;
            return t('fleet.drivers.aloudPool', { count: state.drivers.length }) + (pending ? t('fleet.drivers.aloudPending', { count: pending }) : '');
          }}
          label={t('fleet.readAloud')}
        />
      </div>
    </div>
  );
}
