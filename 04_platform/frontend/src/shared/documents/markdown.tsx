import type { ComponentChildren } from 'preact';

/**
 * THE TEXT STAFF WRITE, DRAWN — a small, closed part of Markdown and nothing else (the user, 2026-10-25: the terms of
 * use, the data notice and the cookie statement are written in the console).
 *
 * A paragraph per blank line; `## ` and `### ` (and `# `) a heading; `- `, `* ` or `1. ` a list item; `**bold**`; and
 * `[words](/path)` or `[words](https://…)` a link. Everything else is text — no HTML, no images, no scripts — and every
 * piece is drawn as an element, never as markup handed to the browser, so nothing written in the console can run here.
 */
export type MarkdownBlock = { kind: 'h2' | 'h3' | 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** The blocks of a text, in order. */
export function markdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trim());
    if (heading) {
      flush();
      blocks.push({ kind: heading[1].length === 3 ? 'h3' : 'h2', text: heading[2].trim() });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const item = (bullet ?? numbered)![1].trim();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/** A link goes only to a page of ours or to a web address: anything else stays words. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h)) return h;
  if (/^https?:\/\/[^\s]+$/i.test(h)) return h;
  return null;
}

/** One line of text with its bold and its links. */
export function inlineParts(text: string): Array<{ kind: 'text' | 'bold'; text: string } | { kind: 'link'; text: string; href: string }> {
  const parts: Array<{ kind: 'text' | 'bold'; text: string } | { kind: 'link'; text: string; href: string }> = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) parts.push({ kind: 'text', text: text.slice(at, m.index) });
    if (m[1] !== undefined) parts.push({ kind: 'bold', text: m[1] });
    else {
      const href = safeHref(m[3]);
      parts.push(href ? { kind: 'link', text: m[2], href } : { kind: 'text', text: m[0] });
    }
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((p, i): ComponentChildren =>
        p.kind === 'bold' ? (
          <strong key={i}>{p.text}</strong>
        ) : p.kind === 'link' ? (
          <a key={i} href={p.href} {...(/^https?:/i.test(p.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {p.text}
          </a>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

/** The whole text, drawn. `headingLevel` 2 makes `## ` an <h2>; a sheet whose title is the <h2> passes 3. */
export function Markdown({ text, class: cls, headingLevel = 2 }: { text: string; class?: string; headingLevel?: 2 | 3 }) {
  return (
    <div class={cls ?? 'md'}>
      {markdownBlocks(text).map((b, i) => {
        if ('items' in b) {
          const items = b.items.map((item, j) => (
            <li key={j}>
              <Inline text={item} />
            </li>
          ));
          return b.kind === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
        }
        if (b.kind === 'p') {
          return (
            <p key={i}>
              <Inline text={b.text} />
            </p>
          );
        }
        const level = (b.kind === 'h2' ? headingLevel : headingLevel + 1) as 2 | 3 | 4;
        const H = (`h${level}` as unknown) as 'h2';
        return (
          <H key={i}>
            <Inline text={b.text} />
          </H>
        );
      })}
    </div>
  );
}

/** The same text as words alone — for reading aloud, and for a search engine's plain copy. */
export function markdownWords(text: string): string {
  return markdownBlocks(text)
    .map((b) => ('items' in b ? b.items : [b.text]).map((t) => inlineParts(t).map((p) => p.text).join('')).join('\n'))
    .join('\n\n');
}
