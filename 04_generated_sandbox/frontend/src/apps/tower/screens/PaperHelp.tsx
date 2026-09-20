import { useState } from 'preact/hooks';
import { Icon, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { RequiredPaperView } from '../imports';

/**
 * WHAT THE PAPER IS, AND THE WAY OFF THE LINE WHEN THE LIST IS EMPTY.
 *
 * The user, reading a required line: *"above it say Investment license and the drop down suggests a
 * paper that can be selected. Is it not rather a paper that is uploaded and if there is no paper, then we
 * hit a dead end."*
 *
 * Both halves were right. The dropdown is the importer's OWN REGISTER — a paper is put on record once and
 * attached afterwards, which is why there is no file input on the line — and the screen never said so.
 * Worse, the answer to "what if it is not in the list" was nothing at all: an importer who has put no
 * papers on record sees an empty dropdown, a disabled button, and a form that would fix it sitting in a
 * different panel with no thread back to the line that needs it. **A control whose empty state has no
 * exit is a wall**, which is the fourth time that has been the defect on this console.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS EXPLAIN THE PAPER. "Investment licence" is the AGENT's own words,
 * typed when they published their list; we have never seen that document and have no business telling an
 * importer what their customs authority means by it. So this says who asked, when, how many copies and
 * whatever note the agent left — and where there is no note it says so plainly and says to ask them,
 * because a wrong paper is sent back and the container waits either way.
 */
export function PaperHelp({ paper, hasPapers, onPutOnRecord }: { paper: RequiredPaperView; hasPapers: boolean; onPutOnRecord?: (label: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-label={t('tower.imports.help')} title={t('tower.imports.help')} onClick={() => setOpen(true)}>
        <Icon name="info" size={16} />
      </button>

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={paper.label}>
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.imports.helpWhat')}</span>
            </div>
            <p class="cons__lede">{t('tower.imports.helpAsked', { who: paper.addedBy, when: new Date(paper.addedAt).toLocaleDateString() })}</p>
            {paper.copies ? <p class="cons__lede">{t('tower.imports.helpCopies', { n: paper.copies })}</p> : null}
            {/* Their words where they wrote any; ours saying they wrote none, never ours pretending to be
                theirs. */}
            <p class="cons__lede">{paper.note ? paper.note : t('tower.imports.helpNoNote')}</p>
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.imports.helpNext')}</span>
            </div>
            <p class="cons__lede">{t('tower.imports.helpOnce')}</p>
            {hasPapers ? (
              <>
                <p class="cons__lede">{t('tower.imports.helpPick')}</p>
                <p class="cons__lede">{t('tower.imports.helpNotThere')}</p>
              </>
            ) : (
              <p class="cons__lede">{t('tower.imports.helpEmpty')}</p>
            )}

            {/* THE DOOR. Not "scroll down and find the upload panel" — that is the wall again, one
                sentence politer. This closes the sheet, fills the form in with this paper's name and the
                kind its words describe, and puts the cursor on the only thing left to supply. */}
            {onPutOnRecord ? (
              <div class="twr-panelend">
                <button
                  type="button"
                  class="cbtn cbtn--primary"
                  onClick={() => {
                    setOpen(false);
                    onPutOnRecord(paper.label);
                  }}
                >
                  {t('tower.imports.helpPut')}
                </button>
              </div>
            ) : null}
          </section>
        </Sheet>
      ) : null}
    </>
  );
}
