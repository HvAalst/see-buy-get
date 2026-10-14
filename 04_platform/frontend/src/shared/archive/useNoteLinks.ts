import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { narrow, type Result, type SbgClient } from '../../lib/sbg';
import { createArchiveApi } from '../../lib/sbg/personas/archive';
import type { DocumentLinkRow, MadeLink } from './documentLink';

export interface NoteLinksState {
  /** `idle` — no note to ask about · `error` — the links could not be listed (the note itself is still readable). */
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** The links to this note that were made for the reader: emailed with a receipt, or made here to pass on. */
  links: DocumentLinkRow[];
  /** The link being cancelled, while it is. */
  cancelling: string;
  cancelLink: (linkId: string) => Promise<void>;
  /** A link just made: its address, held only while this note is the one being looked at. The server kept no copy. */
  made: MadeLink | null;
  making: boolean;
  makeLink: () => Promise<void>;
  /** Why a link could not be made or cancelled, in the server's own words — it has a limit, and says what to do. */
  problem: string;
}

/**
 * THE LINKS TO ONE NOTE, THE SAME WHEREVER A NOTE IS READ.
 *
 * A note is opened in two places: in the archive (a shop, a fleet office, a store) and on the load itself (a
 * business). Both list its links, make one and cancel one — and a second way onto an act has to carry what the first
 * one does, so there is one of this and both use it.
 *
 * Everything here belongs to the note it was asked for. When the note changes, or is put away, it all goes — the
 * address of a link just made most of all: that was only ever on the screen.
 */
export function useNoteLinks(client: SbgClient | null, docId: string | undefined): NoteLinksState {
  const api = useMemo(() => (client ? createArchiveApi(client) : null), [client]);
  const [phase, setPhase] = useState<NoteLinksState['phase']>('idle');
  const [links, setLinks] = useState<DocumentLinkRow[]>([]);
  const [cancelling, setCancelling] = useState('');
  const [made, setMade] = useState<MadeLink | null>(null);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState('');

  // Which note an answer is for, read when the answer arrives: one that comes back after the reader has moved on to
  // another note must not put its links — or its address — on that one.
  const current = useRef(docId);
  current.current = docId;

  useEffect(() => {
    setLinks([]);
    setMade(null);
    setProblem('');
    setCancelling('');
    setMaking(false);
    if (!api || !docId) return setPhase('idle');
    setPhase('loading');
    void api.noteLinks(docId).then((r: Result<unknown>) => {
      if (current.current !== docId) return;
      if (r.error || !r.data) return setPhase('error');
      setLinks(narrow<{ items: DocumentLinkRow[] }>(r.data).items ?? []);
      setPhase('ready');
    });
  }, [api, docId]);

  /** Make a link. Its address is in the answer and nowhere else, so it is held here to be passed on. */
  const makeLink = useCallback(async () => {
    if (!api || !docId) return;
    setMaking(true);
    setProblem('');
    const r: Result<unknown> = await api.makeNoteLink(docId);
    if (current.current !== docId) return;
    setMaking(false);
    if (r.error || !r.data) return setProblem(r.error?.detail || r.error?.title || '');
    const answer = narrow<{ url: string; link: DocumentLinkRow }>(r.data);
    setMade({ url: answer.url, expiresAt: answer.link.expiresAt });
    setLinks((all) => [answer.link, ...all]);
  }, [api, docId]);

  /** Cancel a link. What comes back is the link as it now stands, and replaces the row. */
  const cancelLink = useCallback(
    async (linkId: string) => {
      if (!api || !docId) return;
      setCancelling(linkId);
      setProblem('');
      const r: Result<unknown> = await api.cancelNoteLink(docId, linkId);
      if (current.current !== docId) return;
      setCancelling('');
      if (r.error || !r.data) return setProblem(r.error?.detail || r.error?.title || '');
      const row = narrow<DocumentLinkRow>(r.data);
      setLinks((all) => all.map((x) => (x.linkId === row.linkId ? row : x)));
    },
    [api, docId],
  );

  return { phase, links, cancelling, cancelLink, made, making, makeLink, problem };
}
