import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type SbgError } from '../../lib/sbg';
import { t } from '../../shared/i18n'; // plain t(): these strings are built at action time
import { clearCreds, companyLogin, createTowerClient, readCreds, saveCreds, type TowerClient, type TowerCreds } from './api';
import type { ConstraintView } from './logic';
import type { EntityPricing, EntityRow } from './money';

export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';
export type Screen = 'hazards' | 'rates' | 'companies';

export interface TowerState {
  phase: Phase;
  screen: Screen;
  creds: TowerCreds | null;
  /** WHO the network says this is, once a token exists. Drives the rail: an operator sees the whole
   *  network, a company administrator sees their own company and whatever sits under it. */
  who: { mode: 'operator' | 'company'; name: string; entityId?: string } | null;
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

  /* ---- the companies, side by side (the group's view) ---- */
  companies: CompanyRow[] | null;
  /** Who administers the company being looked at, and the ONE-TIME password a new login just produced. */
  admins: EntityAdminRow[] | null;
  newAdmin: (EntityAdminRow & { password: string }) | null;
}

/** One company on the side-by-side view: what it charges, and what its books say. */
export interface CompanyRow {
  entity: EntityRow;
  pricing: EntityPricing | null;
  books: BooksView | null;
}

export interface EntityAdminRow {
  adminId: string;
  email: string;
  name: string;
  entityId: string;
  createdAt: string;
  lastSeenAt?: string;
}

/** `GET /entities/:id/books` is untyped in the contract; these are the fields the overview reads. */
export interface BooksView {
  entityId: string;
  integrity: { balanced: boolean; drift: number };
  coverage: { currency: string; held: number; lent: number; owed: number; cover: number };
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
  signInAsCompany(email: string, password: string): Promise<void>;
  addAdmin(entityId: string, email: string, name: string): Promise<void>;
  dismissNewAdmin(): void;
  revokeAdmin(entityId: string, adminId: string): Promise<void>;
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
  creds: null,
  who: null,
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
  companies: null,
  admins: null,
  newAdmin: null,
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
  // The latest state, for callbacks that must not be re-created every time anything changes.
  const stateRef = useRef(state);
  stateRef.current = state;

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
    const [pricing, impact, admins] = await Promise.all([client.api.pricing(entityId), client.api.rateImpact(entityId), client.api.admins(entityId)]);
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
      admins: admins.error ? null : (narrow<{ items: EntityAdminRow[] }>(admins.data)?.items ?? []),
      readAt: Date.now(),
    }));
  }, []);

  /**
   * Every company this caller reaches, with what it charges and what its books say.
   *
   * Read in PARALLEL per company and tolerant per company: a books read that fails takes that column's
   * money away, not the whole table. What it must never do is silently drop a company — a comparison
   * with a row missing is worse than one with a hole in it, because nothing on screen says it is short.
   */
  const loadCompanies = useCallback(async (client: TowerClient, rows: EntityRow[]) => {
    const results = await Promise.all(
      rows.map(async (entity) => {
        const [pricing, books] = await Promise.all([client.api.pricing(entity.entityId), client.api.books(entity.entityId)]);
        return {
          entity,
          pricing: pricing.error ? null : narrow<EntityPricing>(pricing.data),
          books: books.error ? null : narrow<BooksView>(books.data),
        };
      }),
    );
    setState((s) => ({ ...s, companies: results }));
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
      // The side-by-side view only means anything with more than one company in it, and only somebody
      // who reaches more than one ever sees it. Reading it for a lone sister would be a table of one row.
      if (rows.length > 1) await loadCompanies(client, rows);
    },
    [loadPricing, loadCompanies],
  );

  // Boot: a credential in this tab means the console picks up where it left off; nothing means sign-in.
  useEffect(() => {
    const creds = readCreds();
    if (!creds) {
      setState((s) => ({ ...s, phase: 'signin' }));
      return;
    }
    const client = createTowerClient(creds);
    clientRef.current = client;
    if (creds.mode === 'operator') {
      setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'operator', name: creds.name } }));
      void loadHazards(client);
      void loadEntities(client);
      return;
    }
    // A company login has to ask the server who it is again — the stored credential says how to sign in,
    // never what it may reach, and a console that assumed the second would be guessing at somebody's
    // authority from a value in their own browser.
    void companyLogin(creds.email, creds.password).then(({ data, error }) => {
      if (error || !data) {
        clearCreds();
        setState((s) => ({ ...s, phase: 'signin', signInError: error?.detail ?? null }));
        return;
      }
      setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'company', name: data.name, entityId: data.entityId }, screen: 'rates' }));
      void loadEntities(client);
    });
  }, [loadHazards, loadEntities]);

  const signIn = useCallback(
    async (name: string, key: string) => {
      const creds: TowerCreds = { mode: 'operator', name: name.trim(), key };
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
      setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'operator', name: creds.name }, signInError: null }));
      await loadHazards(client);
      await loadEntities(client);
    },
    [loadHazards, loadEntities],
  );

  /**
   * A company's administrator signs in.
   *
   * The login is called DIRECTLY here rather than through the client's own re-mint, because this is where
   * the answer is needed: it says which company this person administers and what their name is, and the
   * shell renders a different console depending on the first of those.
   */
  const signInAsCompany = useCallback(
    async (email: string, password: string) => {
      setState((s) => ({ ...s, loading: true, signInError: null }));
      const { data, error } = await companyLogin(email.trim(), password);
      if (error || !data) {
        setState((s) => ({ ...s, loading: false, signInError: error?.detail || t('tower.signIn.rejected') }));
        return;
      }
      const creds: TowerCreds = { mode: 'company', email: email.trim(), password };
      const client = createTowerClient(creds);
      clientRef.current = client;
      saveCreds(creds);
      setState((s) => ({
        ...s,
        phase: 'ready',
        creds,
        who: { mode: 'company', name: data.name, entityId: data.entityId },
        // A company administrator is not network staff: the hazard queue is not theirs to work, and the
        // rail must not offer a section whose every row would answer 403.
        screen: 'rates',
        signInError: null,
        loading: false,
      }));
      await loadEntities(client);
    },
    [loadEntities],
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
      const { error } = await client.api.clearConstraint(constraintId, reason.trim(), state.who?.name);
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
    [state.who?.name],
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
      // The overview holds the same numbers from a different angle; leaving it stale would put two
      // different answers to one question on two tabs of the same console.
      const rows = stateRef.current.entities;
      if (rows && rows.length > 1) await loadCompanies(client, rows);
    },
    [loadPricing, loadCompanies, state.entityId],
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
      signInAsCompany,
      addAdmin: async (entityId: string, email: string, name: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: 'admin', saveError: null, newAdmin: null }));
        const { data, error } = await client.api.createAdmin(entityId, { email, name });
        if (error) {
          setState((s) => ({ ...s, busyId: null, saveError: error }));
          return;
        }
        // The password is held in state and shown until somebody closes it BY HAND. A toast would take
        // the only copy of a credential away on a timer.
        setState((s) => ({ ...s, busyId: null, newAdmin: narrow<EntityAdminRow & { password: string }>(data) }));
        const listed = await client.api.admins(entityId);
        if (!listed.error) setState((s) => ({ ...s, admins: narrow<{ items: EntityAdminRow[] }>(listed.data)?.items ?? [] }));
      },
      dismissNewAdmin: () => setState((s) => ({ ...s, newAdmin: null })),
      revokeAdmin: async (entityId: string, adminId: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: adminId, saveError: null }));
        const { error } = await client.api.revokeAdmin(entityId, adminId);
        if (error) {
          setState((s) => ({ ...s, busyId: null, saveError: error }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, admins: (s.admins ?? []).filter((a) => a.adminId !== adminId) }));
      },
      saveRates: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setRates(entityId, body)),
      saveTax: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setTax(entityId, body)),
      saveCover: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setInsurance(entityId, body)),
    },
  };
}
