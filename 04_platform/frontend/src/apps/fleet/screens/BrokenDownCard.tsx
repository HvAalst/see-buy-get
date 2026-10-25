import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, PlaceMap } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import type { SbgClient } from '../../../lib/sbg';
import { CAUSE_WORD, careApi, whereWords, type VehicleBreakdown } from '../../../shared/upkeep/care';

/**
 * BROKEN DOWN NOW, at the top of the office's vehicles: each one, where it is on a map, who is out with it and what
 * is aboard — a tap from its upkeep sheet, where the office says how it ended. Nothing at all when nothing is broken down.
 */
export function BrokenDownCard({ sbg, fleetDid, reload, onOpen }: { sbg: SbgClient | null; fleetDid: string | undefined; reload: number; onOpen: (vehicleId: string) => void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? careApi(sbg) : null), [sbg]);
  const [list, setList] = useState<VehicleBreakdown[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!api || !fleetDid) return;
    void api.fleetBreakdowns(fleetDid).then((r) => (r.error || !r.data ? setError(r.error) : (setError(null), setList(r.data))));
  }, [api, fleetDid, reload]);
  if (error) return <ErrorNote error={error as never} />;
  if (!list.length) return null;
  const pins = list.filter((b) => b.location).map((b) => ({ id: b.vehicleId, label: b.plate, point: b.location!, tone: 'warn' as const }));
  return (
    <Card title={t('fleet.brk.cardTitle', { n: list.length })}>
      {pins.length ? <PlaceMap pins={pins} onPick={onOpen} label={t('fleet.brk.cardMapAria', { n: pins.length })} /> : null}
      <ul class="rows">
        {list.map((b) => (
          <li key={b.breakdownId} class="row row--static">
            <span class="row__body">
              <span class="row__t">{b.plate}</span>
              <span class="row__s">
                {t(CAUSE_WORD[b.cause])}: “{b.note}”
              </span>
              <span class="row__s">{t('fleet.brk.reported', { who: b.driverName ?? b.reportedBy, when: formatDate(b.reportedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
              <span class="row__s">{whereWords(b, t)}</span>
              {b.aboard.length ? <span class="row__s">{t('fleet.brk.aboard', { n: b.aboard.length, list: b.aboard.map((l) => l.label).join(', ') })}</span> : null}
            </span>
            <span class="row__end">
              <Button variant="link" full={false} onClick={() => onOpen(b.vehicleId)}>
                {t('fleet.vehicles.careBtn')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
