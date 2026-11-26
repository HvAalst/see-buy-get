import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { NOTIFICATION_KINDS } from '../notification.types';

/*
 * 2026-11-26 — EVERY NOTICE IS PHRASES (the owner: "go ahead and translate the notices as well"). A notice whose title or body is
 * written into the code as English text would be said in English to every reader again, so none is: every call that sends a
 * notice gives its words through `noticeOf(said(…), said(…))` (notice-words/say.ts), and this reads the source to hold it.
 */
const SRC = join(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'notice-words' ? [] : sources(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** What a call is given: from its opening bracket to the one that closes it. */
function argumentsAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

describe('every notice is sent as phrases', () => {
  const calls: Array<{ where: string; args: string }> = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (let at = text.indexOf('.notify('); at >= 0; at = text.indexOf('.notify(', at + 1)) {
      if (text.slice(Math.max(0, at - 7), at) === 'Atomics') continue;
      calls.push({ where: `${relative(SRC, file)}:${text.slice(0, at).split('\n').length}`, args: argumentsAt(text, at + '.notify'.length) });
    }
  }

  it('finds the calls that send a notice', () => {
    expect(calls.length).toBeGreaterThan(100);
  });

  it('no call writes a notice’s title or body as text: its words are phrases, said in each reader’s language', () => {
    // A title given as a phrase (a button's), or handed on beside its phrases (`say:`), is phrases; anything else is text.
    const written = calls.filter((c) => /\b(title|body)\s*:\s*(?!\s|said\()/.test(c.args) && !/\bsay\s*:/.test(c.args)).map((c) => c.where);
    expect(written).toEqual([]);
  });

  it('nor is a notice made up as text anywhere else and handed on: an object naming a notice’s kind writes no title', () => {
    const kinds = new RegExp(`\\bkind:\\s*'(${NOTIFICATION_KINDS.join('|')})'`, 'g');
    const written: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(kinds)) {
        const object = enclosingObject(text, m.index ?? 0);
        if (/\btitle\s*:\s*(?!\s|said\()[^,}]*[`'"]/.test(object) && !/\bsay\s*:/.test(object)) written.push(`${relative(SRC, file)}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(written).toEqual([]);
  });
});

/** The object literal around a position: from the brace that opens it to the one that closes it. */
function enclosingObject(text: string, at: number): string {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{' && --depth < 0) {
      start = i;
      break;
    }
  }
  if (start < 0) return '';
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}
