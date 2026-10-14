import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from './Icon';
import { ReadAloud } from './ReadAloud';
import { Sheet } from './Sheet';
import { useT } from '../i18n';

export interface InfoProps {
  /** The heading of the explanation, and what a screen reader announces on the button. */
  title: string;
  /** The explanation itself. Plain sentences — this is the place for the words a label has no room for. */
  children: ComponentChildren;
  /** What to read aloud. Defaults to the title; give the full prose where it is worth hearing. */
  aloud?: string;
}

/**
 * The little `i` next to something that needs a sentence a label has no room for.
 *
 * It opens a SHEET rather than showing a tooltip, and that is the whole design decision. A hover tooltip
 * has no hover on a phone, no room for a real sentence, and no way to be read aloud — three things this
 * product cannot give up. The sheet is already the pattern for "tell me more": scroll-locked, focus-
 * trapped, Escape closes, focus returns to the `i` that opened it, and it can carry a ReadAloud for
 * somebody who would rather hear it.
 *
 * Use it where a choice is genuinely hard to name in two words — a price that is a CEILING, a rate that is
 * a floor. Not as a place to hide copy that should have been on the screen: if the label needs the bubble
 * to make sense, the label is wrong.
 */
export function Info({ title, children, aloud }: InfoProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="info" aria-label={t('common.whatIsThis', { title })} aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon name="info" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div class="info__body">{children}</div>
        <ReadAloud text={() => aloud ?? title} label={t('common.readAloud')} />
      </Sheet>
    </>
  );
}
