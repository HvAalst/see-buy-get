import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { confirmTwoStep, startTwoStep, type TwoStepSetup } from '../api';
import type { TowerActions, TowerState } from '../useTowerApp';
import { CompanyPasswordPanel } from './CompanyPasswordPanel';
import { TwoStepSetupPanel } from './TwoStepSetup';

/**
 * A MEMBER OF STAFF'S OWN SETTINGS — how they sign in. The password, and two-step sign-in.
 *
 * Staff act for nobody, so there is nothing else here: no places, no contact card. What there is matters a great
 * deal, because a staff account reaches every country and every company's money.
 */
export function StaffSettings({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.nav.settings')}</h1>
        <p class="cons__lede">{t('tower.twoStep.settingsLede')}</p>
      </header>
      <TwoStepPanel state={state} actions={actions} />
      <CompanyPasswordPanel actions={actions} />
    </>
  );
}

/** On: says so, and what to do if the phone is lost. Off (a sandbox): the same three steps as at sign-in. */
function TwoStepPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await startTwoStep(client);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    setSetup(r.data);
    setCode('');
  };

  const confirm = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await confirmTwoStep(client, code);
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title);
    setSetup(null);
    actions.noteStaffTwoStep(true);
  };

  return (
    <section class="cons__panel" style="margin-bottom:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.twoStep.title')}</span>
        {state.staffTwoStep ? <span class="ctag ctag--ok">{t('tower.twoStep.on')}</span> : <span class="ctag ctag--warn">{t('tower.twoStep.off')}</span>}
      </div>
      {state.staffTwoStep ? (
        <>
          <p class="twr-done" style="margin:12px 0">
            <Icon name="check" size={16} />
            {t('tower.twoStep.onBody')}
          </p>
          <p class="chint">{t('tower.twoStep.lost')}</p>
        </>
      ) : setup ? (
        <>
          <TwoStepSetupPanel setup={setup} code={code} onCode={setCode} disabled={busy} />
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <div class="twr-panelend" style="margin-top:12px">
            <button type="button" class="cbtn cbtn--primary" disabled={busy || code.length !== 6} onClick={() => void confirm()}>
              {t('tower.twoStep.turnOn')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setSetup(null)}>
              {t('tower.presence.cancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="cons__lede">{t('tower.twoStep.offBody')}</p>
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <button type="button" class="cbtn cbtn--primary" style="margin-top:12px" disabled={busy} onClick={() => void start()}>
            {t('tower.twoStep.setUp')}
          </button>
        </>
      )}
    </section>
  );
}
