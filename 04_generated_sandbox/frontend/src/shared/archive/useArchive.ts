import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { narrow, type Result, type SbgClient, type SbgError } from '../../lib/sbg';
import { createArchiveApi } from '../../lib/sbg/personas/archive';
import type { ArchiveQuery, ArchivedNoteDoc, ArchivedNoteRow, ProofAnswer } from '../../lib/sbg/personas/archive';
import { triggerDownload, triggerDownloadBlob } from '../download';

export const ARCHIVE_LIMIT = 20;

export const EMPTY_QUERY: ArchiveQuery = { q: '', path: '', stage: '', from: '', to: '', offset: '0' };

type Phase = 'idle' | 'loading' | 'ready' | 'error';

export interface ArchiveApiState {
  rows: ArchivedNoteRow[];
  total: number;
  phase: Phase;
  error: SbgError | null;
  query: ArchiveQuery;
  /** The document a reader has opened, with its copies. Null when the sheet is shut. */
  open: ArchivedNoteDoc | null;
  openPhase: Phase;
  busy: '' | 'csv' | 'bundle' | 'bundles' | 'print';
  load: () => Promise<void>;
  setQuery: (patch: Partial<ArchiveQuery>) => void;
  openDoc: (docId: string) => Promise<void>;
  closeDoc: () => void;
  exportCsv: () => Promise<void>;
  exportBundle: (docId: string, number: string) => Promise<void>;
  exportAll: () => Promise<void>;
  printCopy: (docId: string, seq: number) => Promise<void>;
  /** Check a note somebody ELSE handed us. Null means the call failed, not that the note is unknown. */
  verifyNote: (sha256: string) => Promise<ProofAnswer | null>;
}

/**
 * THE ARCHIVE, THE SAME IN EVERY APP.
 *
 * Takes a client and nothing else, for the same reason the account hook does: the route answers for
 * whoever is asking, because a document's readers were frozen with it. A shop, a fleet office and an
 * operator run identical code and see their own documents.
 */
export function useArchive(client: SbgClient | null, enabled = true): ArchiveApiState {
  const [rows, setRows] = useState<ArchivedNoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<SbgError | null>(null);
  const [query, setQueryState] = useState<ArchiveQuery>(EMPTY_QUERY);
  const [open, setOpen] = useState<ArchivedNoteDoc | null>(null);
  const [openPhase, setOpenPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState<ArchiveApiState['busy']>('');

  // The archive is not a persona of its own — every app already has one. Built here so the hook takes a
  // client like every other shared hook, rather than making each app remember to pass a facade.
  const api = useMemo(() => (client ? createArchiveApi(client) : null), [client]);

  // The query the fetch should use, read at call time — a patch and its reload happen in one tick, and
  // a state read inside the callback would be the previous value.
  const queryRef = useRef(query);
  queryRef.current = query;

  const fetchPage = useCallback(
    async (q: ArchiveQuery) => {
      if (!api) return;
      setPhase('loading');
      const r: Result<unknown> = await api.notes({ ...q, limit: String(ARCHIVE_LIMIT) });
      if (r.error || !r.data) {
        setPhase('error');
        setError(r.error ?? null);
        return;
      }
      const page = narrow<{ items: ArchivedNoteRow[]; total: number }>(r.data);
      setRows(page.items ?? []);
      setTotal(page.total ?? 0);
      setError(null);
      setPhase('ready');
    },
    [api],
  );

  const load = useCallback(() => fetchPage(queryRef.current), [fetchPage]);

  useEffect(() => {
    if (enabled && api && phase === 'idle') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, api]);

  const setQuery = useCallback(
    (patch: Partial<ArchiveQuery>) => {
      // Any change but paging returns to the first page: page 3 of a filter nobody applied yet is a
      // blank screen that looks like an empty archive.
      const next = { ...queryRef.current, ...patch, ...(patch.offset === undefined ? { offset: '0' } : {}) };
      queryRef.current = next;
      setQueryState(next);
      void fetchPage(next);
    },
    [fetchPage],
  );

  const openDoc = useCallback(
    async (docId: string) => {
      if (!api) return;
      setOpenPhase('loading');
      setOpen(null);
      const r: Result<unknown> = await api.note(docId);
      if (r.error || !r.data) {
        setOpenPhase('error');
        setError(r.error ?? null);
        return;
      }
      setOpen(narrow<ArchivedNoteDoc>(r.data));
      setOpenPhase('ready');
    },
    [api],
  );

  const closeDoc = useCallback(() => {
    setOpen(null);
    setOpenPhase('idle');
  }, []);

  const exportCsv = useCallback(async () => {
    if (!api) return;
    setBusy('csv');
    const r: Result<unknown> = await api.notesExport(queryRef.current);
    setBusy('');
    if (r.error || r.data == null) return setError(r.error ?? null);
    triggerDownload('consignment-notes.csv', narrow<string>(r.data));
  }, [api]);

  const exportBundle = useCallback(
    async (docId: string, number: string) => {
      if (!api) return;
      setBusy('bundle');
      const r: Result<unknown> = await api.noteBundle(docId);
      setBusy('');
      if (r.error || !r.data) return setError(r.error ?? null);
      triggerDownloadBlob(`${number.replace(/[^A-Za-z0-9._-]+/g, '-')}.zip`, narrow<Blob>(r.data));
    },
    [api],
  );

  const exportAll = useCallback(async () => {
    if (!api) return;
    setBusy('bundles');
    const r: Result<unknown> = await api.noteBundles(queryRef.current);
    setBusy('');
    if (r.error || !r.data) return setError(r.error ?? null);
    triggerDownloadBlob(`consignment-notes-${new Date().toISOString().slice(0, 10)}.zip`, narrow<Blob>(r.data));
  }, [api]);

  /**
   * Open one frozen copy as a page somebody can print.
   *
   * Fetched rather than linked: the route is bearer-gated, so a plain anchor would open a sign-in page
   * where the reader expected their consignment note. Same reason an <AuthImage> exists.
   */
  const printCopy = useCallback(
    async (docId: string, seq: number) => {
      if (!api) return;
      setBusy('print');
      const r: Result<unknown> = await api.noteCopyHtml(docId, seq);
      setBusy('');
      if (r.error || r.data == null) return setError(r.error ?? null);
      openHtml(narrow<string>(r.data));
    },
    [api],
  );

  const verifyNote = useCallback(
    async (sha256: string): Promise<ProofAnswer | null> => {
      if (!api) return null;
      const r: Result<unknown> = await api.verifyNote(sha256);
      return r.error || !r.data ? null : narrow<ProofAnswer>(r.data);
    },
    [api],
  );

  return { rows, total, phase, error, query, open, openPhase, busy, load, setQuery, openDoc, closeDoc, exportCsv, exportBundle, exportAll, printCopy, verifyNote };
}

/** Show a fetched page in its own window. Falls back to a download where a popup is blocked. */
function openHtml(html: string): void {
  if (typeof window === 'undefined') return;
  const win = window.open('', '_blank', 'noopener');
  if (win) {
    win.document.write(html);
    win.document.close();
    return;
  }
  triggerDownload('consignment-note.html', html, 'text/html;charset=utf-8');
}
