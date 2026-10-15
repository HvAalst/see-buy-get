import { useEffect, useMemo, useState } from 'preact/hooks';
import { Card, ErrorNote } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgClient } from '../../../lib/sbg';
import { careApi } from '../care';

/**
 * DAILY CHECKS, for the whole fleet: whether a driver must check a vehicle before a shift. Off unless the office turns
 * it on; what it does is said under the switch, on and off.
 */
export function DailyCheckCard({ sbg, fleetDid }: { sbg: SbgClient | null; fleetDid: string | undefined }) {
  const t = useT();
  const api = useMemo(() => (sbg ? careApi(sbg) : null), [sbg]);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!api || !fleetDid) return;
    void api.settings(fleetDid).then((r) => (r.error || !r.data ? setError(r.error) : setOn(r.data.requireDailyCheck)));
  }, [api, fleetDid]);

  if (on === null) return error ? <ErrorNote error={error as never} /> : null;

  const flip = async (next: boolean) => {
    setBusy(true);
    setError(null);
    const r = await api!.setSettings(fleetDid!, next);
    setBusy(false);
    if (r.error || !r.data) return setError(r.error);
    setOn(r.data.requireDailyCheck);
  };

  return (
    <Card title={t('fleet.checks.title')}>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      <label class="checkline">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void flip(e.currentTarget.checked)} />
        <span>{t('fleet.checks.require')}</span>
      </label>
      <p class="hint">{t(on ? 'fleet.checks.hintOn' : 'fleet.checks.hintOff')}</p>
    </Card>
  );
}
