import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Markdown, inlineParts, markdownBlocks, markdownWords, safeHref } from './markdown';

/*
 * The text staff write in the console, drawn: a small closed part of Markdown, and never markup handed to the browser.
 */
describe('the text staff write', () => {
  it('reads paragraphs, headings and both kinds of list', () => {
    const blocks = markdownBlocks('One line\nand its next.\n\n## A heading\n\n- first\n- second\n\n1. one\n2. two\n\n### Smaller');
    expect(blocks).toEqual([
      { kind: 'p', text: 'One line and its next.' },
      { kind: 'h2', text: 'A heading' },
      { kind: 'ul', items: ['first', 'second'] },
      { kind: 'ol', items: ['one', 'two'] },
      { kind: 'h3', text: 'Smaller' },
    ]);
  });

  it('draws bold and links — and only links to a page of ours or a web address', () => {
    expect(inlineParts('A **bold** word and [Your data](/privacy/).')).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' word and ' },
      { kind: 'link', text: 'Your data', href: '/privacy/' },
      { kind: 'text', text: '.' },
    ]);
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//evil.example/x')).toBeNull();
    expect(safeHref('https://seebuyget.com/help/')).toBe('https://seebuyget.com/help/');
    expect(inlineParts('[click](javascript:alert(1))').every((p) => p.kind === 'text')).toBe(true);
  });

  it('never hands markup to the browser: whatever is written is drawn as words', () => {
    const html = renderToString(<Markdown text={'<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))'} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&lt;script>');
    // Links out open apart from the page; a page of ours opens in place.
    expect(renderToString(<Markdown text="[a](https://x.example/) [b](/terms/)" />)).toMatch(/href="https:\/\/x\.example\/" target="_blank" rel="noopener noreferrer".*href="\/terms\/"/);
  });

  it('gives the words alone, for reading aloud', () => {
    expect(markdownWords('## Title\n\nSee [Your data](/privacy/), **now**.\n\n- one\n- two')).toBe('Title\n\nSee Your data, now.\n\none\ntwo');
  });
});
