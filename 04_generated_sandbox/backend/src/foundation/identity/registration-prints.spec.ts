import { createHash } from 'crypto';
import { RegistrationPrints, normalizeIdentifier, printOf } from './registration-prints';

/**
 * ONE ID, ONE PHONE, ONE LICENCE — the store that makes it stay true.
 *
 * Written against the three ways the old in-memory check failed without a sound: a restart emptied it, the
 * same phone typed two ways counted as two people, and a bare hash of a phone number is only a phone number
 * waiting to be guessed.
 */
describe('the registration prints', () => {
  describe('the same detail typed two ways', () => {
    it('is one phone, however it is written', () => {
      const one = printOf('driver', 'phone', '+254712345678');
      for (const typed of ['0712 345 678', '254712345678', '0712-345-678', '(0712) 345678']) expect(printOf('driver', 'phone', typed)).toBe(one);
    });

    it('is one national ID or licence, whatever the case and the separators', () => {
      expect(normalizeIdentifier('nationalId', ' 12-345.678 ')).toBe('12345678');
      expect(printOf('driver', 'licence', 'dl 4471/23')).toBe(printOf('driver', 'licence', 'DL4471-23'));
    });

    it('keeps something that is not a phone number as typed, rather than collapsing it to a bare dialling code', () => {
      // Stripped of its letters, every such entry would shrink to +254 and then all be the same phone.
      expect(printOf('shop', 'phone', '+254KYC')).not.toBe(printOf('shop', 'phone', '+254DUP'));
      expect(printOf('shop', 'phone', '+254KYC')).not.toBe(printOf('shop', 'phone', '+254'));
    });

    it('prints nothing for nothing — a blank field matches no one', () => {
      expect(printOf('shop', 'device', '   ')).toBe('');
      const prints = new RegistrationPrints('shop');
      prints.claim([['device', '']], 'did:glos:a');
      expect(prints.taken([['device', '']])).toBeUndefined();
    });
  });

  describe('a print says nothing about the person on its own', () => {
    it('is keyed with the server secret — not a hash anybody could rebuild from a guessed number', () => {
      const bare = createHash('sha256').update('+254712345678').digest('hex');
      const bareOld = createHash('sha256').update('0712345678').digest('hex');
      const print = printOf('driver', 'phone', '0712345678');
      expect(print).not.toBe(bare);
      expect(print).not.toBe(bareOld);
      expect(print).not.toContain('712345678');
    });

    it('differs between the registers, so a person’s driver print and shop print cannot be joined', () => {
      expect(printOf('driver', 'nationalId', '12345678')).not.toBe(printOf('shop', 'nationalId', '12345678'));
    });
  });

  describe('who holds it', () => {
    it('names the first detail somebody else already holds, in the order asked', () => {
      const prints = new RegistrationPrints('driver');
      prints.claim([['nationalId', '111'], ['phone', '0700000001']], 'did:glos:first');
      expect(prints.taken([['nationalId', '222'], ['phone', '+254700000001']])).toBe('phone');
      expect(prints.taken([['nationalId', '111'], ['phone', '+254700000001']])).toBe('nationalId');
      expect(prints.taken([['nationalId', '333'], ['phone', '0700000009']])).toBeUndefined();
    });

    it('is no clash with the person who holds it — their licence re-typed is still theirs', () => {
      const prints = new RegistrationPrints('driver');
      prints.claim([['licence', 'DL-1']], 'did:glos:amos');
      expect(prints.taken([['licence', 'dl 1']], 'did:glos:amos')).toBeUndefined();
      expect(prints.taken([['licence', 'dl 1']], 'did:glos:grace')).toBe('licence');
    });

    it('is released only by its holder', () => {
      const prints = new RegistrationPrints('driver');
      prints.claim([['licence', 'DL-1']], 'did:glos:amos');
      prints.release('licence', 'DL-1', 'did:glos:grace');
      expect(prints.taken([['licence', 'DL-1']])).toBe('licence');
      prints.release('licence', 'DL-1', 'did:glos:amos');
      expect(prints.taken([['licence', 'DL-1']])).toBeUndefined();
    });
  });

  /*
   * THE DEFECT ITSELF. Persistence is off under Jest by design, so the guard is lifted and the data directory
   * pointed at a temp folder for this test alone; the modules are loaded fresh so they read that directory.
   */
  describe('after a restart', () => {
    const origWorker = process.env.JEST_WORKER_ID;
    const origDir = process.env.GLOS_DATA_DIR;
    let dir: string;

    beforeEach(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { mkdtempSync } = require('fs') as typeof import('fs');
      const { tmpdir } = require('os') as typeof import('os');
      const { join } = require('path') as typeof import('path');
      /* eslint-enable @typescript-eslint/no-require-imports */
      dir = mkdtempSync(join(tmpdir(), 'glos-prints-'));
      process.env.GLOS_DATA_DIR = dir;
      delete process.env.JEST_WORKER_ID;
    });
    afterEach(() => {
      if (origWorker !== undefined) process.env.JEST_WORKER_ID = origWorker;
      if (origDir === undefined) delete process.env.GLOS_DATA_DIR;
      else process.env.GLOS_DATA_DIR = origDir;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('fs') as typeof import('fs')).rmSync(dir, { recursive: true, force: true });
    });

    it('still knows who is registered — and the file holds no ID, no number and no bare hash of either', () => {
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { RegistrationPrints: Prints } = require('./registration-prints') as typeof import('./registration-prints');
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        /* eslint-enable @typescript-eslint/no-require-imports */
        new Prints('driver').claim([['nationalId', '27781234'], ['phone', '0712345678']], 'did:glos:peer');

        // A new process: nothing carried over in memory.
        const afterRestart = new Prints('driver');
        expect(afterRestart.taken([['nationalId', '27-781-234']])).toBe('nationalId');
        expect(afterRestart.taken([['phone', '+254 712 345 678']])).toBe('phone');

        const onDisk = readFileSync(join(dir, 'identity-prints-driver.json'), 'utf8');
        expect(onDisk).toContain('did:glos:peer');
        expect(onDisk).not.toContain('27781234');
        expect(onDisk).not.toContain('712345678');
        expect(onDisk).not.toContain(createHash('sha256').update('27781234').digest('hex'));
      });
    });

    it('is what the driver service itself asks — a courier registered before a restart is refused after it', () => {
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { DriverService: Drivers } = require('../../modules/pudo/driver.service') as typeof import('../../modules/pudo/driver.service');
        /* eslint-enable @typescript-eslint/no-require-imports */
        let n = 0;
        const build = () =>
          new Drivers(
            { generate: () => ({ id: 'did:glos:courier-' + ++n }) } as never,
            { store: () => ({ vaultRef: 'vault-' + n }) } as never,
            { upsert: () => undefined } as never,
            { publish: () => Promise.resolve() } as never,
            { requireActive: () => undefined } as never,
            { forJurisdiction: () => undefined } as never,
            { can: () => true } as never,
          );
        const courier = { displayName: 'Peer D.', fullName: 'Peer Dan', nationalId: '27781234', mobile: '+254712345678', licenceClasses: ['motorcycle'] as never };
        build().register(courier);
        // The same person, the next morning, after a deploy.
        expect(() => build().register({ ...courier, mobile: '+254700000001' })).toThrow(/national ID already exists/);
      });
    });
  });
});
