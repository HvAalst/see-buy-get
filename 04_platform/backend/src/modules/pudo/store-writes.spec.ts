import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * EVERY ROUTE THAT CHANGES A STORE IS THE STORE'S ALONE — the user, 2026-10-12: "better that staff does not have
 * that door to make changes."
 *
 * A staff sign-in passes every `@Scopes` label (the guard lets an operator through them all), so nothing on the door
 * keeps staff off a store's own routes: only the check INSIDE does. `assertVendorOwner` admits staff, and it stood on
 * the writes as well as the reads. The writes now ask `assertVendorSelf`, which admits the store and nobody else.
 *
 * This reads the controllers the way a reviewer would, so that the NEXT route that changes a store cannot be written
 * with the gate that lets staff in — which is the gate somebody copying a neighbouring route would reach for. EVERY
 * controller of this module, not one: until 2026-10-26 it read pudo.controller.ts alone, and a store's routes written in
 * a controller of their own (its messages, its hub arrivals) were checked by nobody. A route there may use a gate of its
 * own file — counted only where that gate itself refuses staff by name, in the rule's words.
 */
const FILES = readdirSync(__dirname).filter((f) => f.endsWith('.controller.ts'));
const SOURCES = FILES.map((file) => ({ file, source: readFileSync(join(__dirname, file), 'utf8') }));
const SOURCE = readFileSync(join(__dirname, 'pudo.controller.ts'), 'utf8');

/** Routes that act in a store's name without sitting under `vendors/:id`: each bills the store's float. */
const ALSO = ['POST inbound/orders', 'POST parcels/:id/settle'];

/**
 * The exceptions, each with its reason. A reason may not outlive its route (the last test).
 */
const EXEMPT: Record<string, string> = {
  'POST vendors/:id/account': 'refuses staff by name with a check of its own: “A store sets up its own account, signed in as that store”',
};

/** The words a gate refuses staff with: for a change, and for a read. */
const WRITE_RULE = /actor\?\.role === 'operator'\) throw new GlosError\('FORBIDDEN', 'A store makes its own changes/;
const READ_RULE = /actor\?\.role === 'operator'\) throw new GlosError\('FORBIDDEN', 'A store’s own records are the store’s/;

/** The body with comments removed, so a gate named in a comment does not count as a gate. */
const code = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** A file's own private methods that keep staff off a store: the method refuses an operator by name, in the rule's words. */
function gatesIn(source: string, rule: RegExp): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^ {2}private ([a-zA-Z]+)\([^)]*\)[^{\n]*\{\r?\n([\s\S]*?)^ {2}\}/gm)) if (rule.test(code(m[2]))) out.push(m[1]);
  return out;
}

interface Route {
  key: string;
  file: string;
  body: string;
  /** The calls in its file that keep staff off it, for this kind of route. */
  gates: string[];
}

function collect(match: (line: string) => string | null, rule: RegExp): Route[] {
  const out: Route[] = [];
  for (const { file, source } of SOURCES) {
    const gates = gatesIn(source, rule);
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const key = match(lines[i]);
      if (!key) continue;
      let end = i + 1;
      while (end < lines.length && !/^ {2}\}\s*$/.test(lines[end])) end++;
      out.push({ key, file, body: lines.slice(i + 1, end).join('\n'), gates });
    }
  }
  return out;
}

const found = collect((line) => {
  const m = line.match(/^\s*@(Post|Patch|Put|Delete)\('([^']*)'\)/);
  if (!m) return null;
  const key = `${m[1].toUpperCase()} ${m[2]}`;
  return m[2].startsWith('vendors/:id') || ALSO.includes(key) ? key : null;
}, WRITE_RULE);

/** The first of its gates a route calls, and where. */
const gateCall = (r: Route) => {
  const body = code(r.body);
  const at = r.gates.map((g) => body.indexOf(`this.${g}(`)).filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
};

describe('who may change a store', () => {
  it('read the controllers at all — a guard that saw nothing proves nothing', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(20);
    expect(found.length).toBeGreaterThanOrEqual(19);
    for (const key of ['PATCH vendors/:id', 'POST vendors/:id/api-keys', 'DELETE vendors/:id/api-keys/:keyId', 'POST vendors/:id/top-up', 'POST vendors/:id/callbacks/:callbackId/resend', 'POST vendors/:id/hub-arrivals', 'POST vendors/:id/hub-arrivals/:arrivalId/withdraw', ...ALSO]) {
      expect({ key, found: found.some((r) => r.key === key) }).toEqual({ key, found: true });
    }
    // And it found each file's own gate, so a route calling it is checked against a gate that was read.
    expect(gatesIn(SOURCE, WRITE_RULE)).toContain('assertVendorSelf');
    for (const file of ['store-messages.controller.ts', 'hub-arrival.controller.ts']) expect({ file, gates: gatesIn(SOURCES.find((s) => s.file === file)!.source, WRITE_RULE).length > 0 }).toEqual({ file, gates: true });
  });

  it('asks for the store itself on every one of them, or says in writing why not', () => {
    const open = found
      .filter((r) => !EXEMPT[r.key])
      .filter((r) => gateCall(r) < 0)
      .map((r) => `${r.file}: ${r.key}`);
    expect(open).toEqual([]);
  });

  it('never with the gate that lets staff through', () => {
    const lax = found.filter((r) => code(r.body).includes('this.assertVendorOwner(')).map((r) => r.key);
    expect(lax).toEqual([]);
  });

  it('asks BEFORE acting — nothing is changed ahead of the check', () => {
    const late: string[] = [];
    for (const r of found) {
      if (EXEMPT[r.key]) continue;
      const before = code(r.body).slice(0, gateCall(r));
      // Finding the record the check is about changes nothing; anything else called first has already acted.
      const calls = [...before.matchAll(/this\.[a-zA-Z]+\.[a-zA-Z]+\(/g)].map((c) => c[0]).filter((c) => !['this.vendors.get(', 'this.parcels.get('].includes(c));
      if (calls.length) late.push(`${r.key}: ${calls.join(', ')}`);
    }
    expect(late).toEqual([]);
  });

  it('keeps no exception for a route that no longer exists', () => {
    const live = new Set(found.map((r) => r.key));
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });
});

/**
 * AND EVERY ROUTE THAT READS A STORE'S OWN RECORDS IS THE STORE'S ALONE — the user, 2026-10-15, after the writes:
 * staff's sign-in answered with every buyer's number, every collection code and every message to the store's systems,
 * and nothing recorded the look. The console reads a store through its own desk (made field by field for staff) and
 * never called these. `assertVendorReads` refuses staff with a sentence that says where theirs is.
 */
const read = collect((line) => {
  const m = line.match(/^\s*@Get\('(vendors\/:id[^']*)'\)/);
  return m ? `GET ${m[1]}` : null;
}, READ_RULE);

/** Staff's own doors onto a store, each made for staff. */
const STAFF_VIEWS = ['GET vendors/:id/desk'];

/** Reads staff share with the store, each with its reason. A reason may not outlive its route. */
const SHARED_READS: Record<string, string> = {
  'GET vendors/:id/parcels/:parcelId/invoice': 'a crossing parcel’s commercial invoice, read by the store and by staff, who answer for the papers at a border (store-papers.controller.ts)',
  'GET vendors/:id/parcels/:parcelId/invoice.html': 'the same invoice, printed',
};

const readGateCall = (r: Route) => r.gates.some((g) => code(r.body).includes(`this.${g}(`));

describe('who may read a store’s own records', () => {
  it('read the controllers at all — a guard that saw nothing proves nothing', () => {
    expect(read.length).toBeGreaterThanOrEqual(20);
    for (const key of ['GET vendors/:id', 'GET vendors/:id/orders', 'GET vendors/:id/orders/:parcelId', 'GET vendors/:id/orders/export', 'GET vendors/:id/checkouts', 'GET vendors/:id/callbacks', 'GET vendors/:id/returns', 'GET vendors/:id/ledger', 'GET vendors/:id/hubs', 'GET vendors/:id/hub-arrivals', ...STAFF_VIEWS, ...Object.keys(SHARED_READS)]) {
      expect({ key, found: read.some((r) => r.key === key) }).toEqual({ key, found: true });
    }
    expect(gatesIn(SOURCE, READ_RULE)).toContain('assertVendorReads');
  });

  it('asks for the store itself on every one, apart from staff’s own desk and the reads shared in writing', () => {
    const open = read
      .filter((r) => !STAFF_VIEWS.includes(r.key) && !SHARED_READS[r.key])
      .filter((r) => !readGateCall(r))
      .map((r) => `${r.file}: ${r.key}`);
    expect(open).toEqual([]);
  });

  it('never with the gate that lets staff through', () => {
    expect(read.filter((r) => code(r.body).includes('this.assertVendorOwner(')).map((r) => r.key)).toEqual([]);
  });

  it('keeps no shared read for a route that no longer exists', () => {
    const live = new Set(read.map((r) => r.key));
    expect(Object.keys(SHARED_READS).filter((k) => !live.has(k))).toEqual([]);
  });

  it('refuses staff by the rule, saying where theirs is — not as a wrong id', () => {
    const gate = SOURCE.slice(SOURCE.indexOf('private assertVendorReads('), SOURCE.indexOf('private assertVendorSelf('));
    expect(gate).toMatch(/actor\?\.role === 'operator'\) throw new GlosError\('FORBIDDEN', 'A store’s own records are the store’s/);
    expect(gate).toMatch(/Staff read a store under Stores, and a parcel under Find a parcel/);
  });
});
