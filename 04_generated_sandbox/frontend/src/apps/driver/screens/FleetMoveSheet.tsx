import { useState } from 'preact/hooks';
import { Button, ErrorNote, Note, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { DriverActions, DriverState, FleetMoveCheck } from '../useDriverApp';

/**
 * DRIVE FOR ANOTHER FLEET — with that fleet's code, from the driver's own phone.
 *
 * The user's answer, once registration stopped forgetting who is registered: a driver moving to another fleet
 * enters its code, the same code drivers join a fleet with. Two steps, one of them a look: the code is checked
 * first and the sheet names the fleet it belongs to, so a mistyped code joins nobody; then it happens at once.
 * Nothing is sent to the fleet and nothing waits on an answer — the code IS the fleet's say-so.
 *
 * Whatever is unfinished is said before they commit, in the server's own words: a shift running, a load in
 * hand, a run of their current fleet's still to go. Those are finished first, never left behind.
 */
export function FleetMoveSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [check, setCheck] = useState<FleetMoveCheck | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [checking, setChecking] = useState(false);
  const driver = state.driver;
  const courier = Boolean(driver) && !driver?.managerDid;

  const close = () => {
    setCode('');
    setCheck(null);
    setError(null);
    onClose();
  };
  const look = async () => {
    setChecking(true);
    const r = await actions.checkFleetMove(code);
    setChecking(false);
    setError(r.error ?? null);
    setCheck(r.check ?? null);
  };

  return (
    <Sheet open={open} onClose={close} title={t('driver.fleet.title')}>
      <p class="t-body">{driver?.fleetName ? t('driver.fleet.now', { company: driver.fleetName }) : t('driver.fleet.nowOwn')}</p>
      <p class="hint">{t('driver.fleet.lede')}</p>
      {error ? <ErrorNote error={error} showDetail /> : null}

      {!check ? (
        <>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="fleet-code">
              {t('driver.fleet.codeLabel')}
            </label>
            <input
              id="fleet-code"
              class="input"
              value={code}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              onInput={(e) => {
                setCode(e.currentTarget.value);
                setError(null);
              }}
            />
          </div>
          <Button chevron={false} disabled={!code.trim()} busy={checking} onClick={() => void look()}>
            {t('driver.fleet.check')}
          </Button>
        </>
      ) : check.blockers.length ? (
        <>
          <Note tone="warn" icon="clock" title={t('driver.fleet.blockedTitle', { company: check.companyName })} detail={check.blockers.map((b) => b.charAt(0).toUpperCase() + b.slice(1)).join('. ') + '.'} />
          <Button variant="outline" chevron={false} onClick={() => setCheck(null)}>
            {t('driver.fleet.changeCode')}
          </Button>
        </>
      ) : (
        <>
          {/* What happens, said before it does. A courier joining a fleet changes who the network pays and whether
              they have a public page — consequences they would otherwise discover afterwards. */}
          <div style="margin:12px 0">
            <Note
              tone="info"
              icon="truck"
              title={t('driver.fleet.confirmTitle', { company: check.companyName })}
              detail={[
                t('driver.fleet.keeps'),
                check.fromCompany ? t('driver.fleet.confirmFrom', { from: check.fromCompany }) : '',
                courier ? t('driver.fleet.confirmCourier', { company: check.companyName }) : '',
                t('driver.fleet.signedInAgain'),
              ]
                .filter(Boolean)
                .join(' ')}
            />
          </div>
          <Button
            chevron={false}
            busy={state.busy === 'fleet-move'}
            onClick={async () => {
              const failed = await actions.moveFleet(code);
              if (failed) setError(failed);
              else close();
            }}
          >
            {t('driver.fleet.cta', { company: check.companyName })}
          </Button>
          <Button variant="link" onClick={() => setCheck(null)}>
            {t('driver.fleet.changeCode')}
          </Button>
        </>
      )}
      <Button variant="link" onClick={close}>
        {t('driver.fleet.notNow')}
      </Button>
    </Sheet>
  );
}
