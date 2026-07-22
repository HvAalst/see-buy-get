import { Button, Card, ErrorNote, Pill, ReadAloud } from '../../../shared/ui';
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
  const f = state.dForm;
  const missing = driverMissing(f);
  const heavy = isHeavySelection(f.classes);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <Card title="Onboard a driver">
        <p class="card__note">Bike and motorcycle riders start immediately. Any heavier class needs a licence and a SeeBuyGet check first.</p>
        <div class="grid2">
          <div class="field">
            <label class="field__label" for="d-display">
              Display name
            </label>
            <input id="d-display" class="input" value={f.displayName} onInput={(e) => actions.setDForm({ displayName: e.currentTarget.value })} placeholder="Driver J." />
          </div>
          <div class="field">
            <label class="field__label" for="d-full">
              Full name (vaulted)
            </label>
            <input id="d-full" class="input" value={f.fullName} onInput={(e) => actions.setDForm({ fullName: e.currentTarget.value })} />
          </div>
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="d-id">
              National ID
            </label>
            <input id="d-id" class="input input--mono" value={f.nationalId} onInput={(e) => actions.setDForm({ nationalId: e.currentTarget.value })} spellcheck={false} />
          </div>
          <div class="field">
            <label class="field__label" for="d-mobile">
              Mobile
            </label>
            <input id="d-mobile" class="input" type="tel" inputMode="tel" value={f.mobile} onInput={(e) => actions.setDForm({ mobile: e.currentTarget.value })} placeholder="07…" />
          </div>
        </div>
        <div class="field" style="margin-top:12px">
          <span class="field__label">Cleared to drive</span>
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
                  Licence number
                </label>
                <input id="d-lic" class="input input--mono" value={f.licenceNumber} onInput={(e) => actions.setDForm({ licenceNumber: e.currentTarget.value })} spellcheck={false} />
              </div>
              <div class="field">
                <label class="field__label" for="d-exp">
                  Licence expires
                </label>
                <input id="d-exp" class="input" type="date" value={f.licenceExpiresAt} onInput={(e) => actions.setDForm({ licenceExpiresAt: e.currentTarget.value })} />
              </div>
            </div>
            <label class="checkline" style="margin-top:12px">
              <input type="checkbox" checked={f.criminalRecordClear} onChange={(e) => actions.setDForm({ criminalRecordClear: e.currentTarget.checked })} />
              <span>Criminal-record check is clear</span>
            </label>
          </>
        ) : (
          <p class="hint" style="margin-top:12px">
            Light registry — no licence or SeeBuyGet check needed.
          </p>
        )}
        <div style="margin-top:14px">
          <Button chevron={false} onClick={() => void actions.submitDriver()} disabled={Boolean(missing)} busy={state.busy === 'driver'}>
            Onboard driver
          </Button>
          {missing ? <p class="hint" style="margin-top:8px">{missing}</p> : null}
        </div>
      </Card>

      <Card title={`Drivers pool · ${state.drivers.length}`}>
        {state.drivers.length === 0 ? (
          <p class="hint">No drivers yet.</p>
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
                      {d.status === 'KYC_PENDING' ? 'Being checked' : d.status.replace(/_/g, ' ').toLowerCase()}
                    </Pill>
                    {action === 'submit-kyc' ? (
                      <Button variant="link" full={false} busy={state.busy === `kyc:${d.did}`} onClick={() => void actions.submitKyc(d.did)}>
                        Send papers
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
            return `${state.drivers.length} drivers in the pool. ${pending ? `${pending} waiting on the SeeBuyGet check.` : ''}`;
          }}
          label="Read this aloud"
        />
      </div>
    </div>
  );
}
