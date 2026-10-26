import type { ComponentChildren } from 'preact';

/**
 * HELP'S WORDS, WITH WHAT THE READER MUST FIND ON SCREEN MARKED (the review, 2026-10-22: "render every button/label the
 * reader must find as a chip … render navigation as a path"). Nothing but the help's own quotation marks says it, so it
 * survives translation as written:
 *
 *  - a button or a label is in quotation marks — “Send my papers” (or «…», „…“ where a language quotes so) — and is
 *    drawn as a key-cap chip;
 *  - a route through the screens is in quotation marks too, its steps joined by › — “Home › Shop settings › Password” —
 *    and is drawn as a path.
 */
const QUOTED = /“([^”]{1,120})”|«\s?([^»]{1,120}?)\s?»|„([^“”]{1,120})[“”]/g;

export type HelpPiece = { kind: 'text'; text: string } | { kind: 'ui'; text: string } | { kind: 'path'; steps: string[] };

/** Split a sentence into words, chips and routes. Pure, so it is tested without a page. */
export function pieces(s: string): HelpPiece[] {
  const out: HelpPiece[] = [];
  let i = 0;
  for (const m of s.matchAll(QUOTED)) {
    const at = m.index!;
    if (at > i) out.push({ kind: 'text', text: s.slice(i, at) });
    const inner = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const steps = inner.split(/\s*›\s*/).filter(Boolean);
    out.push(steps.length > 1 ? { kind: 'path', steps } : { kind: 'ui', text: inner });
    i = at + m[0].length;
  }
  if (i < s.length) out.push({ kind: 'text', text: s.slice(i) });
  return out;
}

/**
 * The sentence, drawn: chips for what to press, a path for where to go. `renderText` draws the plain words in between —
 * the apps' help marks the trade's short forms there (ui/Abbr.tsx); the front door's help draws them as they are.
 */
export function HelpText({ text, renderText }: { text: string; renderText?: (words: string) => ComponentChildren }) {
  return (
    <>
      {pieces(text).map((p, i) =>
        p.kind === 'ui' ? (
          <kbd key={i} class="hc-ui">
            {p.text}
          </kbd>
        ) : p.kind === 'path' ? (
          <span key={i} class="hc-path">
            {p.steps.map((step, j) => (
              <span key={j}>
                {j > 0 ? <i aria-hidden="true">›</i> : null}
                {step}
              </span>
            ))}
          </span>
        ) : (
          <span key={i}>{renderText ? renderText(p.text) : p.text}</span>
        ),
      )}
    </>
  );
}
