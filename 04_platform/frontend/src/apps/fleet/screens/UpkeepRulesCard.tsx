import { useEffect, useMemo, useState } from 'preact/hooks';
import { Card, ErrorNote } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgClient } from '../../../lib/sbg';
import { careApi, type CareSettings } from '../../../shared/upkeep/care';

/**
 * A FLEET'S UPKEEP RULES, for all its vehicles: whether a driver must check a vehicle before a shift, and whether a
 * vehicle overdue for a service stays off the road. Both off unless the office turns them on; what each does is said
 * under its switch, on and off.
 */
export function UpkeepRulesCard({ sbg, fleetDid }: { sbg: SbgClient | null; fleetDid: string | undefined }) {
  const t = useT();
  const api = useMemo(() => (sbg ? careApi(sbg) : null), [sbg]);
  const [rules, setRules] = useState<CareSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!api || !fleetDid) return;
    void api.settings(fleetDid).then((r) => (r.error || !r.data ? setError(r.error) : setRules(r.data)));
  }, [api, fleetDid]);

  if (!rules) return error ? <ErrorNote error={error as never} /> : null;

  const change = async (next: Partial<CareSettings>) => {
    setBusy(true);
    setError(null);
    const r = await api!.setSettings(fleetDid!, next);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    setRules(r.data);
  };
  const offRoad = rules.serviceOverdue === 'off_road';

  return (
    <Card title={t('fleet.checks.title')}>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      <label class="checkline">
        <input type="checkbox" checked={rules.requireDailyCheck} disabled={busy} onChange={(e) => void change({ requireDailyCheck: e.currentTarget.checked })} />
        <span>{t('fleet.checks.require')}</span>
      </label>
      <p class="hint">{t(rules.requireDailyCheck ? 'fleet.checks.hintOn' : 'fleet.checks.hintOff')}</p>
      <label class="checkline" style="margin-top:12px">
        <input type="checkbox" checked={offRoad} disabled={busy} onChange={(e) => void change({ serviceOverdue: e.currentTarget.checked ? 'off_road' : 'warn' })} />
        <span>{t('fleet.checks.serviceOffRoad')}</span>
      </label>
      <p class="hint">{t(offRoad ? 'fleet.checks.serviceHintOn' : 'fleet.checks.serviceHintOff')}</p>
    </Card>
  );
}
