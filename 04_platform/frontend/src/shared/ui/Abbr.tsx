import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { abbrAbout, abbrName, splitAbbr, type Abbreviation } from '../abbr';
import { useT } from '../i18n';
import { ReadAloud } from './ReadAloud';

/**
 * A TERM OF THE TRADE, SAID IN FULL WHERE IT STANDS (shared/abbr.ts; the user, 2026-10-26: "Tap the word itself").
 *
 * The term keeps its place in the sentence, with a dotted line under it. On a computer, the pointer over it shows what it
 * stands for and a line on what it is; on a phone, a tap shows the same under the word, with a way to hear it — a tap
 * away or Escape puts it away. A bubble and not the sheet the (i) opens: a sheet cannot open over another sheet, and the
 * help, where most of these words are, is one. A screen reader hears the full words with the term.
 *
 * Never inside a button, a link or a form's label: a button inside those is no button. There the term stays plain, and
 * it is explained where it first comes in the screen's own sentences.
 */
/** `text`: the term as it was written in the sentence ("empties"), where that is not the term itself. */
export function Abbr({ term, text }: { term: Abbreviation; text?: string }) {
  const t = useT();
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  // Shown while the pointer is over it, or kept open by a tap (or a click) until a tap elsewhere.
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [shift, setShift] = useState(0);
  // Above the word where below it would run off the screen (the browser test, 2026-10-30).
  const [up, setUp] = useState(false);
  const open = hover || pinned;
  const name = t(abbrName(term));
  const about = t(abbrAbout(term));

  // Kept inside the screen: a bubble that would run off its right edge is moved back by as much.
  useLayoutEffect(() => {
    if (!open || !tip.current) {
      setUp(false);
      return setShift(0);
    }
    const r = tip.current.getBoundingClientRect();
    const room = (typeof window !== 'undefined' ? window.innerWidth : r.right) - 12;
    setShift((s) => Math.min(0, s + room - r.right));
    const word = wrap.current?.getBoundingClientRect();
    const height = typeof window !== 'undefined' ? window.innerHeight : r.bottom;
    if (!up && word && r.bottom > height - 8 && word.top - r.height - 6 > 8) setUp(true);
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const away = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setPinned(false);
    };
    // On the window, in the capture phase: before a sheet around it hears Escape — the bubble goes, the sheet stays.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setPinned(false);
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [pinned]);

  return (
    <span class="abbr" ref={wrap} onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)} onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}>
      <button
        type="button"
        class="abbr__term"
        aria-label={t('abbr.aria', { term: text ?? term, name })}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
      >
        {text ?? term}
      </button>
      {open ? (
        <span id={id} ref={tip} class={up ? 'abbr__tip abbr__tip--up' : 'abbr__tip'} role="note" style={shift ? `transform:translateX(${shift}px)` : undefined}>
          <b class="abbr__name">{name}</b>
          <span class="abbr__about">{about}</span>
          {pinned ? <ReadAloud text={() => `${text ?? term}: ${name}. ${about}`} label={t('abbr.hear')} /> : null}
        </span>
      ) : null}
    </span>
  );
}

/** A sentence with the glossary's terms marked, each the first time it comes. Plain words otherwise. */
export function Abbreviated({ text }: { text: string }) {
  const pieces = splitAbbr(text);
  if (pieces.length === 1 && typeof pieces[0] === 'string') return <>{text}</>;
  return <>{pieces.map((p, i) => (typeof p === 'string' ? p : <Abbr key={i} term={p.term} text={p.text} />))}</>;
}
