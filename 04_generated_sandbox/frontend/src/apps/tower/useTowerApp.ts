import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type SbgError } from '../../lib/sbg';
import { t } from '../../shared/i18n'; // plain t(): these strings are built at action time
import { clearCreds, createTowerClient, readCreds, saveCreds, type OperatorCreds, type TowerClient } from './api';
import type { ConstraintView } from './logic';
import type { EntityPricing, EntityRow } from './money';

export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';
export type Screen = 'hazards' | 'rates';

export interface TowerState {
  phase: Phase;
  screen: Screen;
  operator: OperatorCreds | null;
  /** The disputed queue, longest wait first — the server's order, kept as it arrives. */
  hazards: ConstraintView[] | null;
  loading: boolean;
  /** A failed READ. The screen keeps whatever it last knew and says the read failed. */
  error: SbgError | null;
  signInError: string | null;
  /** constraintId of the row whose clear form is open. */
  openId: string | null;
  /** constraintId currently being cleared — single-flight, so a double-click cannot clear twice. */
  busyId: string | null;
  clearError: SbgError | null;
  /** The last thing this session did, kept on screen until the next action replaces it. */
  done: string | null;
  readAt: number | null;

  /* ---- what each sister charges (the rates screen) ---- */
  entities: EntityRow[] | null;
  /** Which sister is being looked at. Null until the list arrives and the first one is chosen. */
  entityId: string | null;
  pricing: EntityPricing | null;
  /** What each rate DID: the spells either side of every change. Null when it has not been read. */
  rateImpact: RateImpactView | null;
  /** A refused SAVE, which is a different thing from a failed read and must not clear the form. */
  saveError: SbgError | null;
}

/** `GET /entities/:id/rate-impact` is untyped in the contract; these are the fields the screen reads. */
export interface RateImpactView {
  currentPct: number;
  currency?: string;
  spells: { feePct: number; shipments: number; gross: number; margin: number; avgMargin: number; from: string; to: string }[];
  /** Shipments carrying no margin at all — walk-up cash, priced by a different product. */
  unpriced: number;
}

export interface TowerActions {
  signIn(name: string, key: string): Promise<void>;
  signOut(): void;
  go(screen: Screen): void;
  refresh(): Promise<void>;
  open(rowId: string | null): void;
  clear(constraintId: string, reason: string, hazard: string): Promise<void>;
  chooseEntity(entityId: string): Promise<void>;
  saveRates(body: { lane?: string; costOfRiskPct: number | null; profitOnRiskPct: number | null; marginPct: number | null }, lane?: string): Promise<void>;
  saveTax(body: { lane?: string; ratePct: number | null; label: string | null; registration: string | null }, lane?: string): Promise<void>;
  saveCover(body: { lane?: string; freeLimit: number | null; premiumPct: number | null }, lane?: string): Promise<void>;
}

const INITIAL: TowerState = {
  phase: 'boot',
  screen: 'hazards',
  operator: null,
  hazards: null,
  loading: false,
  error: null,
  signInError: null,
  openId: null,
  busyId: null,
  clearError: null,
  done: null,
  readAt: null,
  entities: null,
  entityId: null,
  pricing: null,
  rateImpact: null,
  saveError: null,
};

/**
 * The operator console's one hook.
 *
 * Deliberately without an offline story. The seven field apps queue writes and show what they last knew,
 * because a shop in a dead spot has no alternative; this console runs at a desk, and everything on it is
 * a queue somebody is about to act on. A cached list here would let an operator clear a dispute that was
 * resolved an hour ago from a screen that looked current. So there is no service worker, no outbox, and
 * a failed read says it failed.
 */
export function useTowerApp(): { state: TowerState; actions: TowerActions } {
  const [state, setState] = useState<TowerState>(INITIAL);
  const clientRef = useRef<TowerClient | null>(null);

  const loadHazards = useCallback(async (client: TowerClient) => {
    setState((s) => ({ ...s, loading: true }));
    const { data, error } = await client.api.disputedConstraints();
    if (error) {
      // 426 is the version handshake: the server is newer than this build. With no service worker in
      // the way, a plain reload is the whole fix — which is the honest upside of not installing.
      if (error.code === 'CLIENT_OUTDATED') {
        setState((s) => ({ ...s, phase: 'outdated', loading: false }));
        return;
      }
      setState((s) => ({ ...s, loading: false, error }));
      return;
    }
    const items = narrow<{ items: ConstraintView[]; total: number }>(data)?.items ?? [];
    setState((s) => ({ ...s, loading: false, error: null, hazards: items, readAt: Date.now() }));
  }, []);

  /**
   * Read one sister's whole pricing picture, and what its rates have done.
   *
   * Two calls rather than one because they answer different questions and fail independently: the knobs
   * are configuration and always exist, while the impact is history and a young sister has none. A screen
   * that lost its knobs because there were no shipments yet would be unusable on the day it was needed.
   */
  const loadPricing = useCallback(async (client: TowerClient, entityId: string) => {
    setState((s) => ({ ...s, loading: true, entityId }));
    const [pricing, impact] = await Promise.all([client.api.pricing(entityId), client.api.rateImpact(entityId)]);
    if (pricing.error) {
      setState((s) => ({ ...s, loading: false, error: pricing.error }));
      return;
    }
    setState((s) => ({
      ...s,
      loading: false,
      error: null,
      pricing: narrow<EntityPricing>(pricing.data),
      // The impact is allowed to be missing without taking the screen down with it.
      rateImpact: impact.error ? null : narrow<RateImpactView>(impact.data),
      readAt: Date.now(),
    }));
  }, []);

  /** The sister list, then the first sister that can actually transact — the group has no rates to show. */
  const loadEntities = useCallback(
    async (client: TowerClient) => {
      const { data, error } = await client.api.entities();
      if (error) {
        setState((s) => ({ ...s, error }));
        return;
      }
      const rows = narrow<EntityRow[]>(data) ?? [];
      setState((s) => ({ ...s, entities: rows }));
      const first = rows.find((e) => e.kind === 'sister') ?? rows[0];
      if (first) await loadPricing(client, first.entityId);
    },
    [loadPricing],
  );

  // Boot: a credential in this tab means the console picks up where it left off; nothing means sign-in.
  useEffect(() => {
    const creds = readCreds();
    if (!creds) {
      setState((s) => ({ ...s, phase: 'signin' }));
      return;
    }
    clientRef.current = createTowerClient(creds);
    setState((s) => ({ ...s, phase: 'ready', operator: creds }));
    void loadHazards(clientRef.current);
    void loadEntities(clientRef.current);
  }, [loadHazards, loadEntities]);

  const signIn = useCallback(
    async (name: string, key: string) => {
      const creds: OperatorCreds = { name: name.trim(), key };
      const client = createTowerClient(creds);
      setState((s) => ({ ...s, loading: true, signInError: null }));
      // The queue read is the sign-in test: it needs a token AND the operator role, so a key the server
      // rejects fails here rather than after the shell has already claimed the person is signed in.
      const { error } = await client.api.disputedConstraints();
      if (error) {
        setState((s) => ({ ...s, loading: false, signInError: error.detail || t('tower.signIn.rejected') }));
        return;
      }
      clientRef.current = client;
      saveCreds(creds);
      setState((s) => ({ ...s, phase: 'ready', operator: creds, signInError: null }));
      await loadHazards(client);
      await loadEntities(client);
    },
    [loadHazards, loadEntities],
  );

  const signOut = useCallback(() => {
    clearCreds();
    clientRef.current = null;
    setState({ ...INITIAL, phase: 'signin' });
  }, []);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    // Refresh what is on screen, not everything: an operator pressing this on the rates table is asking
    // about rates, and re-reading the hazard queue underneath them would move a list they are not looking at.
    if (state.screen === 'rates' && state.entityId) await loadPricing(client, state.entityId);
    else await loadHazards(client);
  }, [loadHazards, loadPricing, state.screen, state.entityId]);

  const open = useCallback((constraintId: string | null) => {
    setState((s) => ({ ...s, openId: constraintId, clearError: null }));
  }, []);

  const clear = useCallback(
    async (constraintId: string, reason: string, hazard: string) => {
      const client = clientRef.current;
      if (!client) return;
      setState((s) => ({ ...s, busyId: constraintId, clearError: null }));
      const { error } = await client.api.clearConstraint(constraintId, reason.trim(), state.operator?.name);
      if (error) {
        setState((s) => ({ ...s, busyId: null, clearError: error }));
        return;
      }
      // Drop the row here rather than re-reading the whole queue: the answer is authoritative (the write
      // succeeded), and a refetch would make the row a moving target under the operator's cursor.
      setState((s) => ({
        ...s,
        busyId: null,
        openId: null,
        clearError: null,
        hazards: (s.hazards ?? []).filter((h) => h.constraintId !== constraintId),
        done: t('tower.hazards.cleared', { hazard }),
      }));
    },
    [state.operator?.name],
  );

  /**
   * Save one knob group, then RE-READ rather than patching the row from the response.
   *
   * The response is the stored Entity, not the resolved picture: what a lane now charges depends on
   * fallbacks this screen would have to re-derive to update itself, and re-deriving resolution in a client
   * is exactly what the pricing read model exists to avoid.
   */
  const saveKnob = useCallback(
    async (lane: string | undefined, run: (client: TowerClient, entityId: string) => Promise<{ error: SbgError | null }>) => {
      const client = clientRef.current;
      const entityId = state.entityId;
      if (!client || !entityId) return;
      const rowId = lane ?? 'default';
      setState((s) => ({ ...s, busyId: rowId, saveError: null }));
      const { error } = await run(client, entityId);
      if (error) {
        // The form stays open and holding what was typed: a refused rate is a number somebody still means.
        setState((s) => ({ ...s, busyId: null, saveError: error }));
        return;
      }
      setState((s) => ({ ...s, busyId: null, saveError: null, done: t('tower.rates.saved', { lane: rowId }) }));
      await loadPricing(client, entityId);
    },
    [loadPricing, state.entityId],
  );

  return {
    state,
    actions: {
      signIn,
      signOut,
      go: (screen) => setState((s) => ({ ...s, screen, openId: null, done: null, saveError: null })),
      refresh,
      open,
      clear,
      chooseEntity: async (entityId: string) => {
        const client = clientRef.current;
        // Closing the open editor is not tidiness: its boxes hold another sister's numbers.
        setState((s) => ({ ...s, openId: null, saveError: null, done: null, pricing: null, rateImpact: null }));
        if (client) await loadPricing(client, entityId);
      },
      saveRates: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setRates(entityId, body)),
      saveTax: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setTax(entityId, body)),
      saveCover: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setInsurance(entityId, body)),
    },
  };
}
