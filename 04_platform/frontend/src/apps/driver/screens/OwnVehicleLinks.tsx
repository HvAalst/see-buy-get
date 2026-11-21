import { Button, Card } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';

/**
 * 2026-11-21 — THE WAY IN to their own vehicles on the driver's home (the owner: "can't edit the car details when I made a mistake
 * in the number plate, also I can't add a second car of mine"): under "Which vehicle today?", "Correct or remove …" for each of
 * their own and, for a courier, "Add another vehicle of mine". With none on the list, a card of its own to add the one they ride.
 */
export function OwnVehicleLinks<V extends { vehicleId: string; plate: string; own?: boolean }>({ vehicles, adds, onOpen, onAdd }: { vehicles: V[]; adds: boolean; onOpen: (v: V) => void; onAdd: () => void }) {
  const t = useT();
  if (!vehicles.length) {
    return adds ? (
      <Card title={t('driver.own.noneTitle')}>
        <p class="card__note">{t('driver.own.none')}</p>
        <Button variant="outline" chevron={false} onClick={onAdd}>
          {t('driver.own.add')}
        </Button>
      </Card>
    ) : null;
  }
  return (
    <>
      {vehicles
        .filter((v) => v.own)
        .map((v) => (
          <Button key={`own-${v.vehicleId}`} variant="link" full={false} onClick={() => onOpen(v)}>
            {t('driver.own.open', { plate: v.plate })}
          </Button>
        ))}
      {adds ? (
        <Button variant="link" full={false} onClick={onAdd}>
          {t('driver.own.add')}
        </Button>
      ) : null}
    </>
  );
}
