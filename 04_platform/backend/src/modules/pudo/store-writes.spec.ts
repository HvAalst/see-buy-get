import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * EVERY ROUTE THAT CHANGES A STORE IS THE STORE'S ALONE — the user, 2026-10-12: "better that staff does not have
 * that door to make changes."
 *
 * A staff sign-in passes every `@Scopes` label (the guard lets an operator through them all), so nothing on the door
 * keeps staff off a store's own routes: only the check INSIDE does. `assertVendorOwner` admits staff, and it stood on
 * the writes as well as the reads. The writes now ask `assertVendorSelf`, which admits the store and nobody else.
 *
 * This reads the controller the way a reviewer would, so that the NEXT route that changes a store cannot be written
 * with the gate that lets staff in — which is the gate somebody copying a neighbouring route would reach for.
 */
const SOURCE = readFileSync(join(__dirname, 'pudo.controller.ts'), 'utf8');

/** Routes that act in a store's name without sitting under `vendors/:id`: each bills the store's float. */
const ALSO = ['POST inbound/orders', 'POST parcels/:id/settle'];

/**
 * The exceptions, each with its reason. A reason may not outlive its route (the last test).
 */
const EXEMPT: Record<string, string> = {
  'POST vendors/:id/account': 'refuses staff by name with a check of its own: “A store sets up its own account, signed in as that store”',
};

interface Route {
  key: string;
  body: string;
}

function routes(): Route[] {
  const lines = SOURCE.split(/\r?\n/);
  const out: Route[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*@(Post|Patch|Put|Delete)\('([^']*)'\)/);
    if (!m) continue;
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    if (!m[2].startsWith('vendors/:id') && !ALSO.includes(key)) continue;
    let end = i + 1;
    while (end < lines.length && !/^ {2}\}\s*$/.test(lines[end])) end++;
    out.push({ key, body: lines.slice(i + 1, end).join('\n') });
  }
  return out;
}

/** The body with comments removed, so a gate named in a comment does not count as a gate. */
const code = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const found = routes();

describe('who may change a store', () => {
  it('read the controller at all — a guard that saw nothing proves nothing', () => {
    expect(found.length).toBeGreaterThanOrEqual(15);
    for (const key of ['PATCH vendors/:id', 'POST vendors/:id/api-keys', 'DELETE vendors/:id/api-keys/:keyId', 'POST vendors/:id/top-up', ...ALSO]) {
      expect({ key, found: found.some((r) => r.key === key) }).toEqual({ key, found: true });
    }
  });

  it('asks for the store itself on every one of them, or says in writing why not', () => {
    const open = found
      .filter((r) => !EXEMPT[r.key])
      .filter((r) => !code(r.body).includes('this.assertVendorSelf('))
      .map((r) => r.key);
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
      const body = code(r.body);
      const before = body.slice(0, body.indexOf('this.assertVendorSelf('));
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
function reads(): Route[] {
  const lines = SOURCE.split(/\r?\n/);
  const out: Route[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*@Get\('(vendors\/:id[^']*)'\)/);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !/^ {2}\}\s*$/.test(lines[end])) end++;
    out.push({ key: `GET ${m[1]}`, body: lines.slice(i + 1, end).join('\n') });
  }
  return out;
}

/** Staff's own doors onto a store, each made for staff. */
const STAFF_VIEWS = ['GET vendors/:id/desk'];

const read = reads();

describe('who may read a store’s own records', () => {
  it('read the controller at all — a guard that saw nothing proves nothing', () => {
    expect(read.length).toBeGreaterThanOrEqual(16);
    for (const key of ['GET vendors/:id', 'GET vendors/:id/orders', 'GET vendors/:id/orders/:parcelId', 'GET vendors/:id/orders/export', 'GET vendors/:id/checkouts', 'GET vendors/:id/callbacks', 'GET vendors/:id/returns', 'GET vendors/:id/ledger', ...STAFF_VIEWS]) {
      expect({ key, found: read.some((r) => r.key === key) }).toEqual({ key, found: true });
    }
  });

  it('asks for the store itself on every one, apart from staff’s own desk', () => {
    const open = read.filter((r) => !STAFF_VIEWS.includes(r.key)).filter((r) => !code(r.body).includes('this.assertVendorReads(')).map((r) => r.key);
    expect(open).toEqual([]);
  });

  it('never with the gate that lets staff through', () => {
    expect(read.filter((r) => code(r.body).includes('this.assertVendorOwner(')).map((r) => r.key)).toEqual([]);
  });

  it('refuses staff by the rule, saying where theirs is — not as a wrong id', () => {
    const gate = SOURCE.slice(SOURCE.indexOf('private assertVendorReads('), SOURCE.indexOf('private assertVendorSelf('));
    expect(gate).toMatch(/actor\?\.role === 'operator'\) throw new GlosError\('FORBIDDEN', 'A store’s own records are the store’s/);
    expect(gate).toMatch(/Staff read a store under Stores, and a parcel under Find a parcel/);
  });
});
