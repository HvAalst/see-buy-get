import { assertReachable, isBlockedAddress } from './guard';

/**
 * THE GUARD IN FRONT OF THE FIRST OUTBOUND REQUEST THIS BACKEND EVER MAKES.
 *
 * Delivering to somebody's own storage means fetching an address they typed, which is SSRF in its
 * textbook form. The address that matters most is 169.254.169.254 — the cloud metadata service, which
 * hands out instance credentials to anything that asks from inside.
 */
describe('where this server may be asked to reach', () => {
  describe('the blocked ranges', () => {
    it('refuses the cloud metadata service, which is the whole reason this exists', () => {
      expect(isBlockedAddress('169.254.169.254')).toBe(true);
      expect(isBlockedAddress('169.254.0.1')).toBe(true);
    });

    it('refuses ourselves and our own network', () => {
      for (const ip of ['127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '172.16.4.4', '172.31.255.1', '192.168.1.1', '100.64.0.1']) {
        expect(isBlockedAddress(ip)).toBe(true);
      }
    });

    it('refuses the IPv6 equivalents, including an IPv4 address wearing an IPv6 coat', () => {
      for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254']) {
        expect(isBlockedAddress(ip)).toBe(true);
      }
    });

    it('allows an ordinary public address', () => {
      for (const ip of ['8.8.8.8', '1.1.1.1', '52.95.110.1', '2606:4700::1111', '172.32.0.1', '11.0.0.1']) {
        expect(isBlockedAddress(ip)).toBe(false);
      }
    });

    it('does not mistake a neighbouring range for a private one', () => {
      // 172.16/12 ends at 172.31.255.255 — 172.32 is public, and an off-by-one here would refuse a
      // perfectly good customer endpoint with a message about private networks.
      expect(isBlockedAddress('172.15.255.255')).toBe(false);
      expect(isBlockedAddress('172.32.0.0')).toBe(false);
      expect(isBlockedAddress('9.255.255.255')).toBe(false);
      expect(isBlockedAddress('11.0.0.0')).toBe(false);
    });
  });

  describe('a destination somebody typed', () => {
    it('refuses something that is not a web address at all', async () => {
      await expect(assertReachable('not a url')).rejects.toThrow(/not a web address/);
    });

    it('RESOLVES THE NAME IN PRODUCTION, because a name is not an address', async () => {
      /*
       * The oldest trick here: point a hostname you control at 127.0.0.1 and let the server do the
       * reaching. Checking the string would pass this; checking what it RESOLVES to does not.
       * localtest.me is a public name that answers 127.0.0.1, so it is the real shape of the attack.
       */
      const was = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'production';
      try {
        await expect(assertReachable('https://localtest.me/bucket')).rejects.toThrow(/private network/);
      } finally {
        process.env.GLOS_ENV = was;
      }
    });

    it('allows loopback ONLY in a sandbox, and the gate is the point', async () => {
      // A driven check needs to reach a server on this machine. That convenience is exactly the kind
      // left switched on in production by accident, so it is gated rather than assumed.
      const was = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'sandbox';
      try {
        await expect(assertReachable('http://localtest.me/bucket')).resolves.toMatchObject({ host: 'localtest.me' });
      } finally {
        process.env.GLOS_ENV = was;
      }
    });

    it('still refuses the metadata service in a sandbox — only LOOPBACK is forgiven', async () => {
      const was = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'sandbox';
      try {
        await expect(assertReachable('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private network/);
      } finally {
        process.env.GLOS_ENV = was;
      }
    });

    it('refuses plain http outside a sandbox', async () => {
      const was = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'production';
      try {
        await expect(assertReachable('http://s3.eu-west-1.amazonaws.com/b')).rejects.toThrow(/has to be https/);
      } finally {
        process.env.GLOS_ENV = was;
      }
    });

    it('refuses a name that answers for nothing, rather than trying it anyway', async () => {
      await expect(assertReachable('https://no-such-host.invalid/x')).rejects.toThrow(/Nothing answers/);
    });

    it('accepts an ordinary public https address', async () => {
      const at = await assertReachable('https://s3.eu-west-1.amazonaws.com/my-bucket/notes');
      expect(at.host).toBe('s3.eu-west-1.amazonaws.com');
      expect(at.addresses.length).toBeGreaterThan(0);
    });
  });
});
