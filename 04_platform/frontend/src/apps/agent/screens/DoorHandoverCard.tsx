import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Result, SbgClient } from '../../../lib/sbg';
import { Button, Card, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';

/** A business's parcel here, waiting for the driver of the load that takes it to the business's own door. */
export interface ShopDoorHandover {
  parcelId: string;
  binSlot?: string;
  business: string;
  load: { freightId: string; code: string; status: string; driverName?: string };
}

/** The two calls the card makes: what waits here, and handing one to its driver by their pass. */
export function doorHandoverApi(sbg: SbgClient, shopDid: string) {
  const call = <T,>(fn: Parameters<SbgClient['request']>[0]) => sbg.request(fn) as unknown as Promise<Result<T>>;
  const id = encodeURIComponent(shopDid);
  return {
    list: () => call<ShopDoorHandover[]>((c) => c.GET(`/v1/sbg/agents/${id}/door-handovers` as never, {} as never) as never),
    hand: (parcelId: string, badge: string) => call<ShopDoorHandover[]>((c) => c.POST(`/v1/sbg/agents/${id}/door-handovers/${encodeURIComponent(parcelId)}` as never, { body: { badge } } as never) as never),
  };
}

/** Where one stands: nobody has taken its load yet, or the driver who did, to hand it to. */
export function doorHandoverLine(h: ShopDoorHandover, t: ReturnType<typeof useT>): string {
  if (h.load.status === 'claimed') return h.load.driverName ? t('agent.door.takenBy', { name: h.load.driverName, code: h.load.code }) : t('agent.door.taken', { code: h.load.code });
  return t('agent.door.waiting', { code: h.load.code });
}

/**
 * FOR A BUSINESS'S OWN DOOR (the user, 2026-10-29: "At the nearest shop"). A business had a parcel sent here on its way to
 * one of its own places: it stays on the shelf, and the shop hands it to nobody but the driver who took its load — their
 * pass scanned at the counter, as a bag is handed over. No code is asked: the receiver is not the one collecting.
 */
export function DoorHandoverCard({ sbg, shopDid }: { sbg: SbgClient | null; shopDid: string | undefined }) {
  const t = useT();
  const [items, setItems] = useState<ShopDoorHandover[]>([]);
  const [passes, setPasses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const api = sbg && shopDid ? doorHandoverApi(sbg, shopDid) : null;

  const load = useCallback(async () => {
    if (!api) return;
    const r = await api.list();
    if (!r.error) setItems(r.data ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbg, shopDid]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!items.length && !done) return null;
  const hand = async (h: ShopDoorHandover) => {
    if (!api) return;
    setBusy(h.parcelId);
    setError(null);
    const r = await api.hand(h.parcelId, (passes[h.parcelId] ?? '').trim());
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title);
    setItems(r.data ?? []);
    setDone(t('agent.door.handed', { parcel: h.parcelId, code: h.load.code }));
  };

  return (
    <Card title={t('agent.door.title')} tone="soft">
      <p class={done ? 't-body' : 'hint'} role={done ? 'status' : undefined}>
        {done ?? t('agent.door.lede')}
      </p>
      {error ? <p class="hint" role="alert">{error}</p> : null}
      <ul class="doorhand">
        {items.map((h) => {
          const taken = h.load.status === 'claimed';
          const pass = passes[h.parcelId] ?? '';
          return (
            <li key={h.parcelId}>
              <span class="mono doorhand__line">{t('agent.door.row', { parcel: h.parcelId, slot: h.binSlot ?? '—', business: h.business })}</span>
              <span class="hint doorhand__line">{doorHandoverLine(h, t)}</span>
              {taken ? (
                <>
                  <span class="doorhand__line">
                    <ScanField id={`door-${h.parcelId}`} label={t('agent.door.passLabel')} value={pass} onValue={(v) => setPasses((p) => ({ ...p, [h.parcelId]: v }))} expect="badge" placeholder={t('agent.door.passScan')} upper />
                  </span>
                  <Button full={false} chevron={false} busy={busy === h.parcelId} disabled={!pass.trim()} onClick={() => void hand(h)}>
                    {t('agent.door.hand')}
                  </Button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
