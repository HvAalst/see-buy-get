import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { hostname, tmpdir } from 'os';
import { join } from 'path';
import { claimFiles, claimPostgres, type Querier } from './one-writer';

/**
 * ONE SERVER WRITES THE STORE (one-writer.ts): a second one does not start, and says which one holds it; a lock whose
 * process has gone is taken over; on Postgres a server that has lost its lock to another stops.
 */
describe('one server writes the store', () => {
  describe('on files', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'glos-writer-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const lock = () => join(dir, '.writer.lock');

    it('claims a free store, names itself in it, and lets it go on the way out', () => {
      const claim = claimFiles(dir, process.pid, 0);
      expect(JSON.parse(readFileSync(lock(), 'utf8'))).toMatchObject({ pid: process.pid, host: hostname() });
      claim.release();
      expect(existsSync(lock())).toBe(false);
    });

    it('does not start while another live process holds it — and names that process', () => {
      // The parent of this test is alive for as long as the test runs: another server, as far as the lock can tell.
      writeFileSync(lock(), JSON.stringify({ pid: process.ppid, host: hostname(), since: '2026-10-18T08:00:00Z' }));
      expect(() => claimFiles(dir, process.pid, 0)).toThrow(new RegExp(`Another server is already writing to .* \\(process ${process.ppid}, since 2026-10-18T08:00:00Z\\)`));
      expect(JSON.parse(readFileSync(lock(), 'utf8')).pid).toBe(process.ppid);
    });

    it('takes over a lock whose process has gone — a server that died', () => {
      writeFileSync(lock(), JSON.stringify({ pid: 2147483646, host: hostname(), since: '2026-10-01T08:00:00Z' }));
      claimFiles(dir, process.pid, 0);
      expect(JSON.parse(readFileSync(lock(), 'utf8')).pid).toBe(process.pid);
    });
  });

  it('is claimed by the server before a single record is loaded — and a refusal stops it', () => {
    // Unit tests never boot the app (lesson-unit-tests-never-boot-the-app): the order is read off main.ts itself.
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    const claimed = main.indexOf('claim = claimTheStore()');
    expect(claimed).toBeGreaterThan(0);
    expect(claimed).toBeLessThan(main.indexOf('NestFactory.create('));
    expect(main.slice(claimed, main.indexOf('NestFactory.create('))).toMatch(/process\.exit\(1\)/);
  });

  describe('on Postgres', () => {
    /** A database that answers the claim's three questions as each test says. */
    const db = (answers: { take: boolean[]; held?: boolean[] }): Querier & { asked: string[] } => {
      const asked: string[] = [];
      return {
        asked,
        query: <T>(sql: string) => {
          asked.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
          if (sql.includes('pg_try_advisory_lock')) return [{ got: answers.take.shift() ?? false }] as T[];
          if (sql.includes('pg_backend_pid')) return [{ held: answers.held?.shift() ?? true }] as T[];
          if (sql.includes('pg_stat_activity')) return [{ pid: 4242, application_name: null, client_addr: '10.0.0.7', backend_start: '2026-10-18 07:59:00+00' }] as T[];
          return [] as T[];
        },
      };
    };

    it('does not start while another session holds the lock — and says where it is', () => {
      expect(() => claimPostgres(db({ take: [false] }), () => undefined, 60_000, 0)).toThrow('Another server is already writing to this database (database session 4242 from 10.0.0.7, connected since 2026-10-18 07:59:00+00)');
    });

    it('stops a server that has lost its lock to another — and not one whose connection merely came back', async () => {
      let stopped = 0;
      // Claimed; then the connection was made again and the lock is free: taken again, nothing stops.
      const fine = claimPostgres(db({ take: [true, true], held: [false] }), () => (stopped += 1), 10, 0);
      await new Promise((r) => setTimeout(r, 40));
      fine.release();
      expect(stopped).toBe(0);
      // Claimed; then somebody else has it: this one stops rather than be a second writer.
      const lost = claimPostgres(db({ take: [true, false, false, false, false, false], held: [false, false, false, false, false] }), () => (stopped += 1), 10, 0);
      await new Promise((r) => setTimeout(r, 40));
      lost.release();
      expect(stopped).toBeGreaterThan(0);
    });
  });
});
