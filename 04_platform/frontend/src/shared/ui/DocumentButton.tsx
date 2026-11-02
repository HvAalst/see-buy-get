import type { Result, SbgClient } from '../../lib/sbg';
import { useNoteLinks } from '../archive/useNoteLinks';
import { Button } from './Button';
import { Icon } from './Icon';
import { fetchPaper, PaperSheet, usePaper, type KeptDocument, type PaperLook } from './PaperSheet';

export type { KeptDocument } from './PaperSheet';

/**
 * A button that opens a DOCUMENT the server renders — the consignment note, an invoice, a letter of instruction —
 * inside the app, with a way to print or save it. Self-contained: it fetches when tapped, so no screen has to hold a
 * document in its state, and the token stays in the app (a document behind a bearer cannot simply be a link).
 *
 * 2026-11-02 — it opens in the paper's own slide-up (PaperSheet.tsx; the owner: "can we have a print preview of the
 * consignment note? and the print function in slide up"): the pages as they will print, Print under them. The copy
 * kept on the phone for no signal is shown as before, saying when it was kept. `look="console"` dresses the button as
 * the Business app draws its own.
 *
 * `note` — where the server named the note this party's archive keeps for the load: then Share passes on a link to it,
 * the same links its archive lists. They are read only while the sheet is open, so a list of fifty loads asks for none.
 */
export function DocumentButton({ label, title, fetch, variant = 'link', kept, look = 'app', note }: { label: string; title: string; fetch: () => Promise<Result<unknown>>; variant?: 'link' | 'outline'; kept?: KeptDocument; look?: PaperLook; note?: { client: SbgClient | null; noteId?: string; title: string } }) {
  const paper = usePaper();
  const shares = Boolean(note?.client && note.noteId);
  const links = useNoteLinks(paper.open && shares ? note!.client : null, paper.open && shares ? note!.noteId : undefined);
  const open = () => paper.show(title, () => fetchPaper(fetch, kept));
  return (
    <>
      {look === 'console' ? (
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={paper.loading} onClick={open}>
          {label}
        </button>
      ) : (
        <Button variant={variant} full={false} chevron={false} busy={paper.loading} onClick={open}>
          <Icon name="edit" size={18} /> {label}
        </Button>
      )}
      <PaperSheet state={paper} look={look} share={shares ? { links, title: note!.title } : undefined} />
    </>
  );
}
