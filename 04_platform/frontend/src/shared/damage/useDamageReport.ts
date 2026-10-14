import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { narrow, type SbgClient } from '../../lib/sbg';
import { createDamageReportApi } from '../../lib/sbg/personas/damage';
import type { DamageReportView, MadeReportLink, ReportLinkRow } from './damageReport';

export interface DamageReportState {
  /** `idle` — not asked for yet · `error` — it could not be fetched. */
  phase: 'idle' | 'loading' | 'ready' | 'error';
  report: DamageReportView | null;
  /** Fetch the report to read it. Asked for when somebody opens it, not before: most people never do. */
  load: () => Promise<void>;
  /** The file, to keep or to hand on. Null when it could not be had. */
  takeFile: () => Promise<Blob | null>;
  taking: boolean;
  /** The links this reader made on the report. */
  links: ReportLinkRow[];
  /** A link just made: its address, held only while this parcel is the one being looked at. The server kept no copy. */
  made: MadeReportLink | null;
  making: boolean;
  makeLink: () => Promise<void>;
  cancelling: string;
  cancelLink: (linkId: string) => Promise<void>;
  /** Why something could not be done, in the server's own words — it has limits, and says what to do. */
  problem: string;
  /** The receiver adds a note, after handover. Resolves to whether it was kept; the report is read again with it. */
  addNote: (text: string, photoRefs?: string[]) => Promise<boolean>;
  noting: boolean;
}

/**
 * ONE PARCEL'S DAMAGE CLAIM REPORT, for whoever it is for: read it, take the file, and hand it on by a link.
 *
 * Everything here belongs to the parcel it was asked for. When the parcel changes, or is put away, it all goes —
 * the address of a link just made most of all: that was only ever on the screen.
 */
export function useDamageReport(client: SbgClient | null, parcelId: string | undefined): DamageReportState {
  const api = useMemo(() => (client ? createDamageReportApi(client) : null), [client]);
  const [phase, setPhase] = useState<DamageReportState['phase']>('idle');
  const [report, setReport] = useState<DamageReportView | null>(null);
  const [links, setLinks] = useState<ReportLinkRow[]>([]);
  const [made, setMade] = useState<MadeReportLink | null>(null);
  const [making, setMaking] = useState(false);
  const [taking, setTaking] = useState(false);
  const [cancelling, setCancelling] = useState('');
  const [problem, setProblem] = useState('');

  // Which parcel an answer is for, read when the answer arrives: one that comes back after the reader has moved on
  // must not put its report — or its link — on another parcel.
  const current = useRef(parcelId);
  current.current = parcelId;

  const loadLinks = useCallback(async () => {
    if (!api || !parcelId) return;
    const r = await api.links(parcelId);
    if (current.current !== parcelId || r.error || !r.data) return;
    setLinks(narrow<{ items: ReportLinkRow[] }>(r.data).items ?? []);
  }, [api, parcelId]);

  useEffect(() => {
    setPhase('idle');
    setReport(null);
    setLinks([]);
    setMade(null);
    setProblem('');
    setCancelling('');
    setMaking(false);
    void loadLinks();
  }, [loadLinks]);

  const load = useCallback(async () => {
    if (!api || !parcelId) return;
    setPhase('loading');
    const r = await api.report(parcelId);
    if (current.current !== parcelId) return;
    if (r.error || !r.data) return setPhase('error');
    setReport(narrow<DamageReportView>(r.data));
    setPhase('ready');
  }, [api, parcelId]);

  const takeFile = useCallback(async () => {
    if (!api || !parcelId) return null;
    setTaking(true);
    const r = await api.file(parcelId);
    setTaking(false);
    return r.error || !r.data ? null : r.data;
  }, [api, parcelId]);

  const makeLink = useCallback(async () => {
    if (!api || !parcelId) return;
    setMaking(true);
    setProblem('');
    const r = await api.makeLink(parcelId);
    if (current.current !== parcelId) return;
    setMaking(false);
    if (r.error || !r.data) return setProblem(r.error?.detail ?? '');
    setMade(narrow<MadeReportLink>(r.data));
    await loadLinks();
  }, [api, parcelId, loadLinks]);

  const cancelLink = useCallback(
    async (linkId: string) => {
      if (!api || !parcelId) return;
      setCancelling(linkId);
      setProblem('');
      const r = await api.cancelLink(parcelId, linkId);
      if (current.current !== parcelId) return;
      setCancelling('');
      if (r.error) return setProblem(r.error.detail ?? '');
      // The address on the screen may be the one just cancelled: it is not left there looking like a way in.
      setMade((m) => (m && m.link.linkId === linkId ? null : m));
      await loadLinks();
    },
    [api, parcelId, loadLinks],
  );

  const [noting, setNoting] = useState(false);
  const addNote = useCallback(
    async (text: string, photoRefs?: string[]) => {
      if (!api || !parcelId) return false;
      setNoting(true);
      setProblem('');
      const r = await api.addNote(parcelId, { text, ...(photoRefs?.length ? { photoRefs } : {}) });
      if (current.current !== parcelId) return false;
      setNoting(false);
      if (r.error) {
        setProblem(r.error.detail ?? '');
        return false;
      }
      await load();
      return true;
    },
    [api, parcelId, load],
  );

  return { phase, report, load, takeFile, taking, links, made, making, makeLink, cancelling, cancelLink, problem, addNote, noting };
}
