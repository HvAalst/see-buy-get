import { Button, Card, CheckGate, PhotoField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { inspectionDone, inspectionPoints, POINT_KEYS, type InspectionLook } from '../inspection';
import type { Claimable } from '../types';
import type { DriverActions } from '../useDriverApp';

/**
 * Round 40 — THE 7-POINT INSPECTION AT PICKUP (the user: "Cross-border closed loads"). Shown only when the load asks for it:
 * a container or closed body leaving for a border. Each point in walking order — what to look for, its photograph, and the
 * tick that says it was looked at and nothing was found. Something found is not ticked: it is reported, and the load is held
 * where it is until SeeBuyGet operations releases it.
 */
export function InspectionSection({
  claim,
  looks,
  setLooks,
  actions,
  busy,
  onReport,
}: {
  claim: Claimable;
  looks: Record<string, InspectionLook>;
  setLooks: (update: (all: Record<string, InspectionLook>) => Record<string, InspectionLook>) => void;
  actions: DriverActions;
  busy: boolean;
  onReport: () => void;
}) {
  const t = useT();
  const points = inspectionPoints(claim);
  if (!claim.inspection || !points.length) return null;
  const set = (point: string, patch: Partial<InspectionLook>) => setLooks((all) => ({ ...all, [point]: { ...(all[point] ?? { ticked: false, photo: '' }), ...patch } }));
  return (
    <Card title={t(claim.inspection.kind === 'container' ? 'driver.inspection.titleContainer' : 'driver.inspection.titleBody')} tone="soft">
      <p class="t-body">{t('driver.inspection.lede')}</p>
      {points.map((p, i) => {
        const look = looks[p] ?? { ticked: false, photo: '' };
        return (
          <div key={p} class="field" style="margin-top:14px">
            <span class="field__label">{t('driver.inspection.numbered', { n: i + 1, point: t(POINT_KEYS[p].label) })}</span>
            <p class="hint">{t(POINT_KEYS[p].look)}</p>
            <PhotoField
              id={`insp-${claim.ref}-${p}`}
              value={look.photo}
              upload={(f) => actions.uploadPhoto('inspection', f)}
              onCapture={(photo) => set(p, { photo })}
              label={t('driver.inspection.photo')}
              disabled={busy}
            />
            <CheckGate items={[{ key: p, label: t('driver.inspection.nothingFound') }]} checked={look.ticked ? [p] : []} onChange={(keys) => set(p, { ticked: keys.includes(p) })} disabled={busy} />
          </div>
        );
      })}
      <p class="hint" style="margin-top:12px">{t('driver.inspection.done', { n: inspectionDone(claim, looks), of: points.length })}</p>
      <Button variant="link" onClick={onReport}>
        {t('driver.inspection.found')}
      </Button>
    </Card>
  );
}
