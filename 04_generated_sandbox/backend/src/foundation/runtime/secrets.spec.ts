import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { DEPLOYMENT_SECRETS, DeploymentSecret, SECRET_MIN_LENGTH, deploymentSecret, secretProblem } from './secrets';
import { AuthService } from '../auth/auth.service';
import { FieldEncryption } from '../data-firewall/field-encryption.service';
import { SandboxFundingRail } from '../funding/sandbox-funding-rail.adapter';

const NAMES = Object.keys(DEPLOYMENT_SECRETS) as DeploymentSecret[];
/** A value a generator made: sixty-four hex characters, a different one for each name. */
const real = (name: string) => Buffer.from(`${name}-a-real-one-from-the-deployment-0123456789`).toString('hex').slice(0, 64);
const production = (over: Record<string, string | undefined> = {}) => ({ GLOS_ENV: 'production', ...Object.fromEntries(NAMES.map((n) => [n, real(n)])), ...over });

describe('the secrets this server signs, seals and hashes with', () => {
  it('in a sandbox: the deployment’s value, or the one printed in the source', () => {
    expect(deploymentSecret('GLOS_AUTH_SECRET', 'printed', {})).toBe('printed');
    expect(deploymentSecret('GLOS_AUTH_SECRET', 'printed', { GLOS_ENV: 'sandbox' })).toBe('printed');
    expect(deploymentSecret('GLOS_AUTH_SECRET', 'printed', { GLOS_AUTH_SECRET: 'mine' })).toBe('mine');
  });

  it('outside a sandbox: the deployment’s value and nothing else — for every one of them', () => {
    for (const name of NAMES) {
      expect(deploymentSecret(name, 'printed', production())).toBe(real(name));
      // Not set, set to nothing, and set to spaces are the same thing.
      for (const empty of [undefined, '', '   ']) {
        expect(() => deploymentSecret(name, 'printed', production({ [name]: empty }))).toThrow(new RegExp(`^${name} is not set`));
      }
    }
  });

  it('refuses a value anybody could know: the printed one, the example file’s, a placeholder', () => {
    const printed = 'glos-dev-secret-change-me';
    // The example environment file sets the variable — to the printed value. "Is it set?" is not the question.
    expect(secretProblem('GLOS_AUTH_SECRET', printed, production({ GLOS_AUTH_SECRET: printed }))).toBe('is a value printed in the source');
    // Another secret's printed value, however long it is made.
    expect(secretProblem('GLOS_AUTH_SECRET', printed, production({ GLOS_AUTH_SECRET: 'glos-dev-vault-key-change-me-glos-dev-vault-key-change-me' }))).toBe('is a value printed in the source');
    expect(secretProblem('GLOS_AUTH_SECRET', printed, production({ GLOS_AUTH_SECRET: 'CHANGE-ME-before-you-deploy-this-server-please-ok' }))).toBe('is a value printed in the source');
    expect(secretProblem('GLOS_AUTH_SECRET', 'whatever-is-printed-here-is-refused-too', production({ GLOS_AUTH_SECRET: 'whatever-is-printed-here-is-refused-too' }))).toBe('is a value printed in the source');
  });

  it('refuses one somebody typed: short, or one character over and over', () => {
    expect(secretProblem('GLOS_AUTH_SECRET', 'printed', production({ GLOS_AUTH_SECRET: 'a-real-key-from-the-deployment' }))).toBe(`is shorter than ${SECRET_MIN_LENGTH} characters`);
    expect(secretProblem('GLOS_AUTH_SECRET', 'printed', production({ GLOS_AUTH_SECRET: 'x'.repeat(31) }))).toBe(`is shorter than ${SECRET_MIN_LENGTH} characters`);
    expect(secretProblem('GLOS_AUTH_SECRET', 'printed', production({ GLOS_AUTH_SECRET: 'abab'.repeat(16) }))).toBe('is not random');
    expect(secretProblem('GLOS_AUTH_SECRET', 'printed', production())).toBeNull();
  });

  it('refuses one value used for two things: whoever gets one of them has both', () => {
    const shared = real('shared');
    expect(secretProblem('GLOS_AUTH_SECRET', 'printed', production({ GLOS_AUTH_SECRET: shared, GLOS_VAULT_KEY: shared }))).toBe('is the same value as GLOS_VAULT_KEY: each needs its own');
    expect(secretProblem('GLOS_VAULT_KEY', 'printed', production({ GLOS_AUTH_SECRET: shared, GLOS_VAULT_KEY: shared }))).toBe('is the same value as GLOS_AUTH_SECRET: each needs its own');
  });

  it('says, when it refuses, what the secret is for and every one it will ask for — so the next start is not the next refusal', () => {
    let said = '';
    try {
      deploymentSecret('GLOS_AUTH_SECRET', 'printed', { GLOS_ENV: 'production' });
    } catch (e) {
      said = (e as Error).message;
    }
    expect(said).toContain('signs every sign-in token');
    for (const name of NAMES) expect(said).toContain(name);
    expect(said).toContain('openssl rand -hex 32');
  });
});

describe('the server, started outside a sandbox', () => {
  const kept: Record<string, string | undefined> = {};
  const KEYS = ['GLOS_ENV', ...NAMES];
  beforeEach(() => {
    for (const k of KEYS) kept[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (kept[k] === undefined) delete process.env[k];
      else process.env[k] = kept[k];
    }
  });
  const asProduction = (over: Record<string, string | undefined> = {}) => {
    for (const [k, v] of Object.entries(production(over))) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const auth = () => new AuthService({ exists: () => true } as never, {} as never);

  it('does not make the service that signs tokens without a real signing secret — the one of the seven that used to start on the printed value', () => {
    asProduction({ GLOS_AUTH_SECRET: undefined });
    expect(auth).toThrow(/^GLOS_AUTH_SECRET is not set/);
    asProduction({ GLOS_AUTH_SECRET: 'glos-dev-secret-change-me' });
    expect(auth).toThrow(/^GLOS_AUTH_SECRET is a value printed in the source/);
    asProduction();
    expect(auth).not.toThrow();
  });

  it('signs with the deployment’s secret: a token signed with the printed one opens nothing', () => {
    // A token made on a laptop, with the printed secret — what anybody who has read the source can make.
    delete process.env.GLOS_ENV;
    delete process.env.GLOS_AUTH_SECRET;
    const forged = auth().mintOperatorToken().access_token;
    expect(auth().introspect(forged).active).toBe(true);
    asProduction();
    expect(auth().introspect(forged).active).toBe(false);
  });

  it('does not make the vault or the stand-in payment rail on the printed key either — set to it or not set at all', () => {
    asProduction({ GLOS_VAULT_KEY: 'glos-dev-vault-key-change-me' });
    expect(() => new FieldEncryption()).toThrow(/^GLOS_VAULT_KEY is a value printed in the source/);
    asProduction({ GLOS_FUNDING_SECRET: undefined });
    expect(() => new SandboxFundingRail()).toThrow(/^GLOS_FUNDING_SECRET is not set/);
    asProduction();
    expect(() => new FieldEncryption()).not.toThrow();
    expect(() => new SandboxFundingRail()).not.toThrow();
  });
});

/**
 * THE GUARD ON THE NEXT ONE. Five of seven secrets fell back on a printed value because each was written the way the
 * one before it was: `process.env.X || 'a-default'`. This reads the source for that shape on anything named like a
 * secret, so the eighth is refused by a test and not found by a stranger.
 */
describe('no secret falls back on a value printed in the source', () => {
  const SRC = join(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) files.push(path);
    }
  };
  walk(SRC);
  // `process.env.SOMETHING_SECRET || '…'` (or ??), for names that are a secret, a key, a pepper, a token or a password —
  // or the PRIVATE half of a pair; and whether what it falls back on is written there in quotes or kept in a CONSTANT.
  // The eighth secret (the key every push is signed with) had both of those and walked past this test for that reason.
  const FALLBACK = /process\.env\.([A-Z0-9_]*(?:SECRET|KEY|PEPPER|TOKEN|PASSWORD|PRIVATE)[A-Z0-9_]*)\s*(?:\|\||\?\?)\s*(?:['"`]|[A-Z][A-Z0-9_]{2,}\b)/g;
  const found = (text: string) => [...text.matchAll(FALLBACK)].map((m) => m[1]);

  it('read the source, and knows the shape when it sees it', () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((f) => f.endsWith('auth.service.ts'))).toBe(true);
    expect(readFileSync(files.find((f) => f.endsWith('auth.service.ts'))!, 'utf8').length).toBeGreaterThan(2000);
    // What it was written to catch, as it stood in auth.service.ts:
    expect(found("private readonly secret = process.env.GLOS_AUTH_SECRET || 'glos-dev-secret-change-me';")).toEqual(['GLOS_AUTH_SECRET']);
    expect(found('const k = process.env.GLOS_LABEL_KEY ?? "x";')).toEqual(['GLOS_LABEL_KEY']);
    // …and as the eighth stood in notification.service.ts, which the first form of this test did not see:
    expect(found('const VAPID_PRIVATE = process.env.GLOS_VAPID_PRIVATE || BUILT_IN_PRIVATE;')).toEqual(['GLOS_VAPID_PRIVATE']);
    // Its public half is not a secret, and a secret read with nothing to fall back on is the rule being kept.
    expect(found('const pub = process.env.GLOS_VAPID_PUBLIC || BUILT_IN_PUBLIC; const t = process.env.ZEPTOMAIL_TOKEN;')).toEqual([]);
    // …and what is not a secret is not its business.
    expect(found("const port = process.env.PORT ?? '3000'; const dial = process.env.GLOS_DEFAULT_DIAL_CODE || '+254';")).toEqual([]);
  });

  it('finds none', () => {
    const offenders = files.flatMap((file) => found(readFileSync(file, 'utf8')).map((name) => `${name} in ${file.slice(SRC.length + 1)}`));
    expect(offenders).toEqual([]);
  });

  it('and every secret that is read through the rule is one the rule knows by name', () => {
    const READ = /deploymentSecret\('([A-Z0-9_]+)'/g;
    const read = new Set(files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(READ)].map((m) => m[1])));
    expect([...read].sort()).toEqual([...NAMES].sort());
  });
});
