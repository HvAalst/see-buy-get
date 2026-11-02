#!/usr/bin/env node
/**
 * 2026-11-02 — WHAT THE ANDROID BUILD SAID, WHERE IT CAN BE READ.
 *
 * GitHub's build logs are readable only with admin rights; a check run's ANNOTATIONS of this public repository are
 * readable by anyone (api.github.com/repos/<owner>/<repo>/check-runs/<id>/annotations). So everything that went wrong
 * is turned into annotations: Kotlin compiler errors, resource and manifest errors, Gradle's "What went wrong" blocks,
 * R8 and lint errors, and failed unit tests (from their JUnit XML).
 *
 * GitHub shows at most 10 error annotations a step and 50 a job, so this writes them to a file, one workflow command a
 * line — the first a roll-up of every problem in one message, then one per problem with its file and line — and the
 * workflow prints them ten at a time from five steps. It also writes the build's summary to $GITHUB_STEP_SUMMARY.
 *
 *   node ci/report.mjs --outcome failure --log build.log [--log release.log] --tests app/build/test-results \
 *        --problems problems.txt --warnings warnings.txt --summary "$GITHUB_STEP_SUMMARY" \
 *        --root "$GITHUB_WORKSPACE" --project 04_platform/android-driver --fact "Site=seebuyget.com" ...
 *
 * Plain Node, no packages: it runs on the runner's own Node before anything is installed, and on the owner's machine
 * against a saved log without a build.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_PROBLEMS = 49; // + the roll-up = 50, GitHub's limit for a job
const MAX_WARNINGS = 10;
const MAX_MESSAGE = 4000;
const MAX_ROLLUP = 60_000;

// ---- arguments -------------------------------------------------------------------------------------------------------

function args(argv) {
  const out = { log: [], fact: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const name = a.slice(2);
    const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    if (Array.isArray(out[name])) out[name].push(value);
    else out[name] = value;
  }
  return out;
}

// ---- reading the Gradle log -----------------------------------------------------------------------------------------

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** A path as GitHub wants it: relative to the repository. A path outside it is kept as it is. */
function relative(file, root) {
  if (!file) return undefined;
  let f = file;
  if (f.startsWith('file://')) f = f.slice('file://'.length);
  try {
    f = decodeURIComponent(f);
  } catch {
    // kept as written
  }
  f = f.replace(/\\/g, '/');
  const r = (root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (r && f.startsWith(r + '/')) return f.slice(r.length + 1);
  return f;
}

/**
 * Every problem the log names, in the order it names them. Each: { severity: 'error'|'warning', file?, line?, col?,
 * title, message }.
 */
export function readLog(text, root) {
  const lines = text.replace(ANSI, '').replace(/\r/g, '').split('\n');
  const found = [];
  const push = (p) => found.push({ ...p, message: (p.message || '').trim().slice(0, MAX_MESSAGE) });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    // Kotlin 2:  e: file:///…/X.kt:12:5 Unresolved reference 'foo'.   (build scripts: …/build.gradle.kts:12:5: …)
    if ((m = /^([ew]): (file:\/\/\S+?\.(?:kts?|java)):(\d+):(\d+):? (.*)$/.exec(line))) {
      push({ severity: m[1] === 'e' ? 'error' : 'warning', file: relative(m[2], root), line: +m[3], col: +m[4], title: m[1] === 'e' ? 'Kotlin' : 'Kotlin warning', message: m[5] });
      continue;
    }
    // Kotlin, older:  e: /…/X.kt: (12, 5): message
    if ((m = /^([ew]): (\/\S+?\.kts?): \((\d+), (\d+)\): (.*)$/.exec(line))) {
      push({ severity: m[1] === 'e' ? 'error' : 'warning', file: relative(m[2], root), line: +m[3], col: +m[4], title: m[1] === 'e' ? 'Kotlin' : 'Kotlin warning', message: m[5] });
      continue;
    }
    // Java:  /…/X.java:12: error: message
    if ((m = /^(\/\S+?\.java):(\d+): (error|warning): (.*)$/.exec(line))) {
      push({ severity: m[3], file: relative(m[1], root), line: +m[2], title: 'Java', message: m[4] });
      continue;
    }
    // Resources:  ERROR: /…/res/values/strings.xml:5: AAPT: error: unescaped apostrophe in string
    if ((m = /^(?:ERROR:\s*)?(\/\S+?\.xml)(?::(\d+))?(?::[\d-]+)?: AAPT: error: (.*)$/.exec(line))) {
      push({ severity: 'error', file: relative(m[1], root), line: m[2] ? +m[2] : undefined, title: 'Android resources', message: m[3] });
      continue;
    }
    // Manifest merger:  /…/AndroidManifest.xml:20:13-52 Error:   followed by indented lines saying what.
    if ((m = /^(\/\S+?\.xml):(\d+):[\d-]+ Error:\s*(.*)$/.exec(line))) {
      const said = [m[3]];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) said.push(lines[++i].trim());
      push({ severity: 'error', file: relative(m[1], root), line: +m[2], title: 'Android manifest', message: said.filter(Boolean).join(' ') });
      continue;
    }
    // Lint:  /…/X.kt:12: Error: message [IssueId]
    if ((m = /^(\/\S+?):(\d+): Error: (.*)$/.exec(line))) {
      push({ severity: 'error', file: relative(m[1], root), line: +m[2], title: 'Android lint', message: m[3] });
      continue;
    }
    // Gradle's own account of a failure.
    if (/^\* What went wrong:\s*$/.test(line)) {
      const said = [];
      while (i + 1 < lines.length && !/^\* (Try|Exception is|Get more help)/.test(lines[i + 1]) && !/^BUILD FAILED/.test(lines[i + 1])) {
        said.push(lines[++i]);
      }
      const message = said.join('\n').replace(/\n{2,}/g, '\n').trim();
      const where = /Build file '([^']+)' line: (\d+)/.exec(message) || /Script '([^']+)' line: (\d+)/.exec(message);
      push({ severity: 'error', file: where ? relative(where[1], root) : undefined, line: where ? +where[2] : undefined, title: 'Gradle', message });
      continue;
    }
    // R8, D8 and other tools:  ERROR: Missing classes detected while running R8. …
    if ((m = /^ERROR:\s*(.+)$/.exec(line))) {
      push({ severity: 'error', title: 'Build tool', message: m[1] });
      continue;
    }
  }
  return found;
}

// ---- reading the unit tests' JUnit XML ------------------------------------------------------------------------------

function unescapeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : undefined;
}

function xmlFiles(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...xmlFiles(p));
    else if (entry.name.endsWith('.xml')) out.push(p);
  }
  return out;
}

/** Counts, and each failed test as a problem at the line of its test file the stack names. */
export function readTests(dir, root, project) {
  const counts = { tests: 0, failures: 0, errors: 0, skipped: 0, files: 0 };
  const problems = [];
  for (const file of xmlFiles(dir)) {
    const xml = fs.readFileSync(file, 'utf8');
    counts.files++;
    for (const suite of xml.matchAll(/<testsuite\b[^>]*>/g)) {
      for (const k of ['tests', 'failures', 'errors', 'skipped']) counts[k] += +(attr(suite[0], k) || 0);
    }
    for (const tc of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const body = tc[2] || '';
      const failure = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(body);
      if (!failure) continue;
      const head = ' ' + tc[1];
      const name = attr(head, 'name') || '?';
      const classname = attr(head, 'classname') || '';
      const failAttrs = ' ' + (failure[2] || failure[5] || '');
      const stack = unescapeXml(failure[3] || '');
      const said = attr(failAttrs, 'message') || stack.split('\n')[0] || 'failed';
      const simple = classname.split('.').pop();
      const pkg = classname.split('.').slice(0, -1).join('/');
      const frame = new RegExp(`at ${classname.replace(/[.$]/g, '\\$&')}[.$][^(]*\\(([\\w$]+\\.(?:kt|java)):(\\d+)\\)`).exec(stack);
      let rel;
      let line;
      if (frame) {
        rel = [project, 'app/src/test/java', pkg, frame[1]].filter(Boolean).join('/');
        line = +frame[2];
        const abs = path.join(root || '.', rel);
        if (!fs.existsSync(abs)) rel = undefined;
      }
      problems.push({ severity: 'error', file: rel, line, title: `Unit test ${simple}`, message: `${name}: ${said}` });
    }
  }
  return { counts, problems };
}

// ---- writing --------------------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function command(p) {
  const props = [];
  if (p.file) props.push(`file=${escProp(p.file)}`);
  if (p.file && p.line) props.push(`line=${p.line}`);
  if (p.file && p.line && p.col) props.push(`col=${p.col}`);
  if (p.title) props.push(`title=${escProp(p.title)}`);
  return `::${p.severity === 'warning' ? 'warning' : 'error'}${props.length ? ' ' + props.join(',') : ''}::${esc(p.message || p.title || 'failed')}`;
}

const where = (p) => (p.file ? `${p.file}${p.line ? `:${p.line}` : ''}` : p.title);

/** The same problem said twice (a Kotlin error is printed by each task that compiles the file) is said once. */
function unique(problems) {
  const seen = new Set();
  return problems.filter((p) => {
    const k = `${p.severity}|${p.file}|${p.line}|${p.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * "Compilation error. See log for more details" and "Task failed with an exception" add nothing once the error itself
 * was found; they are kept only when nothing else was.
 */
function withoutEchoes(errors) {
  const echo = (p) =>
    p.title === 'Gradle' &&
    /Compilation error\. See log for more details|Compilation finished with errors|There were failing tests|Android resource linking failed|Manifest merger failed/.test(p.message);
  const specific = errors.filter((p) => !echo(p));
  return specific.length > 0 ? specific.concat(errors.filter(echo).slice(0, 1)) : errors;
}

function main() {
  const a = args(process.argv.slice(2));
  const root = a.root || process.env.GITHUB_WORKSPACE || process.cwd();
  const outcome = a.outcome || 'failure';
  const failed = outcome !== 'success';

  let logText = '';
  for (const f of a.log) if (f && fs.existsSync(f)) logText += fs.readFileSync(f, 'utf8') + '\n';
  const fromLog = readLog(logText, root);
  const tests = readTests(a.tests, root, a.project);

  const errors = withoutEchoes(unique([...tests.problems, ...fromLog.filter((p) => p.severity === 'error')]));
  const warnings = unique(fromLog.filter((p) => p.severity === 'warning'));

  // The problems file: the roll-up first, then one a problem.
  const out = [];
  if (failed) {
    const listed = errors.slice(0, 200).map((p, n) => `${n + 1}) ${where(p)} — ${p.message.split('\n').join(' | ')}`);
    let rollup;
    if (errors.length > 0) {
      rollup = `${errors.length} problem${errors.length === 1 ? '' : 's'}:\n` + listed.join('\n');
    } else {
      const tail = logText.replace(ANSI, '').replace(/\r/g, '').trimEnd().split('\n').slice(-40).join('\n');
      rollup = `The build failed, and no known kind of error was found in its log. Its last lines:\n${tail || '(no log was written)'}`;
    }
    out.push(command({ severity: 'error', title: 'Android build failed', message: rollup.slice(0, MAX_ROLLUP) }));
    for (const p of errors.slice(0, MAX_PROBLEMS)) out.push(command(p));
  }
  if (a.problems) fs.writeFileSync(a.problems, out.length ? out.join('\n') + '\n' : '');
  if (a.warnings) fs.writeFileSync(a.warnings, warnings.slice(0, MAX_WARNINGS).map(command).join('\n') + (warnings.length ? '\n' : ''));

  // The summary.
  if (a.summary) {
    const c = tests.counts;
    const rows = [
      ['Result', failed ? '❌ failed' : '✅ built'],
      ['Unit tests', c.files ? `${c.tests} run, ${c.failures + c.errors} failed, ${c.skipped} skipped` : 'no results written'],
      ...a.fact.map((f) => {
        const at = f.indexOf('=');
        return at > 0 ? [f.slice(0, at), f.slice(at + 1)] : [f, ''];
      }),
      ['Kotlin warnings', String(warnings.length)],
    ];
    const md = [
      '## SeeBuyGet Driver — the Android build',
      '',
      '| | |',
      '|---|---|',
      ...rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|')} |`),
      '',
    ];
    if (failed) {
      md.push(`### What went wrong (${errors.length})`, '');
      if (errors.length === 0) md.push('Nothing the reader knows; the annotation "Android build failed" carries the log\'s last lines.');
      for (const p of errors.slice(0, 100)) md.push(`- \`${where(p)}\` — ${p.message.split('\n')[0].slice(0, 300)}`);
      md.push('');
    }
    if (warnings.length) {
      md.push(`<details><summary>Kotlin warnings (${warnings.length})</summary>`, '');
      for (const p of warnings.slice(0, 50)) md.push(`- \`${where(p)}\` — ${p.message.slice(0, 300)}`);
      md.push('', '</details>', '');
    }
    fs.appendFileSync(a.summary, md.join('\n') + '\n');
  }

  console.log(`${errors.length} error(s), ${warnings.length} warning(s); ${tests.counts.tests} test(s) read from ${tests.counts.files} file(s).`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('report.mjs')) main();
