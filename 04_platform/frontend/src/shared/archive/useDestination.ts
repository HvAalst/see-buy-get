import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { narrow, type Result, type SbgClient, type SbgError } from '../../lib/sbg';
import { createArchiveApi, type ConnectDestination, type DeliveryRow, type DestinationView } from '../../lib/sbg/personas/archive';

export interface DestinationApiState {
  destination: DestinationView | null;
  deliveries: DeliveryRow[];
  loading: boolean;
  busy: '' | 'connect' | 'test' | 'disconnect';
  error: SbgError | null;
  /** The result of the last test, in the server's own words. */
  tested: { ok: boolean; detail: string; key: string } | null;
  /** The webhook signing secret, fetched once after connecting one. */
  secret: string | null;
  reload: () => Promise<void>;
  connect: (input: ConnectDestination) => Promise<boolean>;
  test: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearTested: () => void;
}

/**
 * WHERE THIS ACCOUNT'S DOCUMENTS GO BESIDES HERE.
 *
 * The same in every app for the same reason the archive is: the route answers for whoever is asking.
 * A fleet, a shop and a store all have exactly one destination and exactly one question about it —
 * is anything actually arriving.
 */
export function useDestination(client: SbgClient | null, enabled = true): DestinationApiState {
  const [destination, setDestination] = useState<DestinationView | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<DestinationApiState['busy']>('');
  const [error, setError] = useState<SbgError | null>(null);
  const [tested, setTested] = useState<DestinationApiState['tested']>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const api = useMemo(() => (client ? createArchiveApi(client) : null), [client]);

  const reload = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    const [d, list]: [Result<unknown>, Result<unknown>] = await Promise.all([api.destination(), api.deliveries()]);
    setLoading(false);
    if (!d.error && d.data) setDestination(narrow<DestinationView>(d.data));
    if (!list.error && list.data) setDeliveries(narrow<{ items: DeliveryRow[] }>(list.data).items ?? []);
  }, [api]);

  useEffect(() => {
    if (enabled && api) void reload();
  }, [enabled, api, reload]);

  const connect = useCallback(
    async (input: ConnectDestination) => {
      if (!api) return false;
      setBusy('connect');
      setTested(null);
      const r: Result<unknown> = await api.connectDestination(input);
      setBusy('');
      if (r.error || !r.data) {
        setError(r.error ?? null);
        return false;
      }
      setError(null);
      setDestination(narrow<DestinationView>(r.data));
      // A webhook's secret is ours and is shown once — fetched here rather than left for a second trip
      // the person has no reason to know they need to make.
      if (input.kind === 'webhook') {
        const s: Result<unknown> = await api.destinationSecret();
        if (!s.error && s.data) setSecret(narrow<{ secret: string }>(s.data).secret);
      }
      return true;
    },
    [api],
  );

  const test = useCallback(async () => {
    if (!api) return;
    setBusy('test');
    const r: Result<unknown> = await api.testDestination();
    setBusy('');
    if (r.error || !r.data) {
      setError(r.error ?? null);
      return;
    }
    setTested(narrow<{ ok: boolean; detail: string; key: string }>(r.data));
    // The attempt changes the destination's own last-tried/last-error, so read it back rather than
    // leaving the card claiming something the server no longer agrees with.
    void reload();
  }, [api, reload]);

  const disconnect = useCallback(async () => {
    if (!api) return;
    setBusy('disconnect');
    const r: Result<unknown> = await api.disconnectDestination();
    setBusy('');
    if (r.error) return setError(r.error);
    setDestination({ connected: false });
    setDeliveries([]);
    setSecret(null);
    setTested(null);
  }, [api]);

  return { destination, deliveries, loading, busy, error, tested, secret, reload, connect, test, disconnect, clearTested: () => setTested(null) };
}
