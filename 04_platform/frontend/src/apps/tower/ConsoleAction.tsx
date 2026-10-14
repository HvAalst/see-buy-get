import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Icon, Sheet } from '../../shared/ui';

/**
 * A TITLE THAT OPENS A FORM, instead of a form that is always open.
 *
 * Two forms sat at the top of the containers screen — what a company says it clears, and the fields for
 * recording a container. Each is a page long in a hand, and neither is a thing anybody does on most
 * visits, so between somebody and the list they came for stood two screens of fields for jobs they were
 * not doing. The user's report: "Record a container fills a whole mobile page now... just a title,
 * click, slide up sheet."
 *
 * AT EVERY WIDTH, not only in a hand. The argument is not about room — a form nobody opened is noise on
 * a desk too, and the screen it pushes down is the one the work is on. The sheet is the same slide-up
 * this console already uses for its navigation and its detail.
 *
 * `children` is a FUNCTION taking a close, so the form can shut its own sheet when the save lands. A
 * form that saves and sits there leaves somebody wondering whether it took.
 */
export function ConsoleAction({ title, hint, children }: { title: string; hint?: string; children: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="cdo" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span class="cdo__body">
          <span class="cdo__t">{title}</span>
          {hint ? <span class="cdo__sub">{hint}</span> : null}
        </span>
        <Icon name="chevronRight" size={16} class="cdo__go" />
      </button>
      {/* Mounted only while open: these forms hold their own state, and one kept alive behind a closed
          sheet is a half-typed record waiting to surprise somebody. */}
      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={title}>
          {children(() => setOpen(false))}
        </Sheet>
      ) : null}
    </>
  );
}
