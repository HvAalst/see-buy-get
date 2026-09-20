import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';

export interface NoteView {
  number: string;
  kind: 'cmr' | 'national';
  sender: { name: string; address?: string; country?: string };
  consignee: { name: string; address?: string; country?: string };
  delivery: { place: string; country?: string; at?: string };
  takingOver: { place: string; country?: string; at?: string };
  documents: string[];
  goods: { description: string; grossKg: number; dangerous: boolean };
  carrier?: { name: string; driverName?: string; plate?: string };
}

type Api = { freightNote: (freightId: string) => Promise<{ data?: unknown; error?: unknown }> };

/**
 * THE ONE DOCUMENT THE LOAD CARRIES, shown where the load is made.
 *
 * The user's sentence is the design: "the waybill is a legal document and the information should be a
 * reliable source of truth." A note typed separately from the record it describes is two records that
 * will disagree, and the one that travels is the one nobody can check.
 *
 * So nothing here is a field. Every box is DERIVED — the importer is the sender, the saved places are
 * the taking-over and delivery, the accepted clearance papers are box 5, the container's declaration is
 * the goods. This card is a window onto it, shown from the moment the leg exists so that whatever is
 * wrong is wrong where somebody can still fix it.
 *
 * AND IT NAMES WHAT IS STILL OPEN. The carrier, the driver and the plate cannot be known before a
 * driver claims the load; the date of taking over cannot be known before they arrive. A note that showed
 * those as blanks would look like a finished document with holes in it. Saying which boxes are waiting,
 * and on what, is the difference between an incomplete document and a broken one.
 */
export function ConsignmentNoteCard({ freightId, api }: { freightId: string; api: Api | null }) {
  const t = useT();
  const [note, setNote] = useState<NoteView | null>(null);

  useEffect(() => {
    let live = true;
    if (!api) return undefined;
    void api.freightNote(freightId).then((r) => {
      if (!live || r.error || !r.data) return;
      setNote(r.data as NoteView);
    });
    return () => {
      live = false;
    };
  }, [api, freightId]);

  if (!note) return null;

  // What cannot be filled yet, and why — said in the same words the boxes use.
  const open: string[] = [];
  if (!note.carrier?.name) open.push(t('tower.imports.noteCarrier'));
  if (!note.takingOver.at) open.push(t('tower.imports.noteTakingOver'));

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.imports.noteTitle')}</span>
        <span class="ctag ctag--quiet">{note.number}</span>
      </div>

      <div class="cons__facts">
        <div class="cons__fact">
          <span class="cons__factk">1</span>
          <span class="cons__factv">{note.sender.name}</span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">2 / 3</span>
          <span class="cons__factv">
            {note.consignee.name}
            <span class="chint">{note.delivery.place}</span>
          </span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">4</span>
          <span class="cons__factv">{note.takingOver.place}</span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">5</span>
          <span class="cons__factv">
            {/* The clearance pack, each paper named with the first characters of its fingerprint, so
                somebody holding a copy can tell whether it is the copy this note means. */}
            {note.documents.length === 0 ? '—' : note.documents.map((d) => <span class="chint">{d}</span>)}
          </span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">6–12</span>
          <span class="cons__factv">
            {note.goods.description}
            <span class="chint">{note.goods.grossKg} kg</span>
          </span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">16</span>
          <span class="cons__factv">{note.carrier?.name ?? <span class="chint">{t('tower.imports.noteCarrier')}</span>}</span>
        </div>
      </div>

      <p class="chint">{open.length ? t('tower.imports.noteOpenBoxes', { what: open.join(', ') }) : t('tower.imports.noteNothingOpen')}</p>
      <p class="chint">{t('tower.imports.noteBasis')}</p>
    </section>
  );
}
