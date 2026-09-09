import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type SbgError } from '../../lib/sbg';
import { t } from '../../shared/i18n'; // plain t(): these strings are built at action time
import { clearCreds, createTowerClient, readCreds, saveCreds, type OperatorCreds, type TowerClient } from './api';
import type { ConstraintView } from './logic';

export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';
export type Screen = 'hazards';

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
}

export interface TowerActions {
  signIn(name: string, key: string): Promise<void>;
  signOut(): void;
  go(screen: Screen): void;
  refresh(): Promise<void>;
  open(constraintId: string | null): void;
  clear(constraintId: string, reason: string, hazard: string): Promise<void>;
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
  }, [loadHazards]);

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
    },
    [loadHazards],
  );

  const signOut = useCallback(() => {
    clearCreds();
    clientRef.current = null;
    setState({ ...INITIAL, phase: 'signin' });
  }, []);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (client) await loadHazards(client);
  }, [loadHazards]);

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

  return {
    state,
    actions: { signIn, signOut, go: (screen) => setState((s) => ({ ...s, screen })), refresh, open, clear },
  };
}
