import { crc32, zip } from './zip';

/**
 * A ZIP WRITER IS ONLY WORTH ANYTHING IF SOMETHING ELSE CAN READ IT.
 *
 * Which is the trap in testing one: parse the output with the same code that wrote it and every field
 * agrees with itself while the file opens nowhere. So the checksum is checked against the published test
 * vector rather than against our own second opinion, and the headers are read by offset against the
 * format as documented — not against a reader we also wrote. The end-to-end proof is the driven check,
 * which hands the bytes to the operating system's own unzip.
 */
describe('the zip writer', () => {
  describe('crc32', () => {
    it('matches the published check value for "123456789"', () => {
      // The standard CRC-32 check value. If this drifts, every archive we write is silently corrupt —
      // most tools would refuse it, and the ones that do not would hand somebody damaged evidence.
      expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    });

    it('is zero for nothing and stable for the same bytes', () => {
      expect(crc32(Buffer.alloc(0))).toBe(0);
      expect(crc32(Buffer.from('a note'))).toBe(crc32(Buffer.from('a note')));
      expect(crc32(Buffer.from('a note'))).not.toBe(crc32(Buffer.from('a vote')));
    });
  });

  describe('the archive', () => {
    const entries = [
      { name: 'README.txt', bytes: Buffer.from('what is in here') },
      { name: 'copies/01-taken_over.html', bytes: Buffer.from('<h1>CMR-AB12</h1>') },
      { name: 'photographs/med_1.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
    ];

    it('starts with a local file header and ends with the end-of-central-directory record', () => {
      const out = zip(entries);
      expect(out.readUInt32LE(0)).toBe(0x04034b50);
      expect(out.readUInt32LE(out.length - 22)).toBe(0x06054b50);
    });

    it('counts every entry in the end record, twice, the way the format asks', () => {
      const out = zip(entries);
      const end = out.length - 22;
      expect(out.readUInt16LE(end + 8)).toBe(3); // entries on this disk
      expect(out.readUInt16LE(end + 10)).toBe(3); // entries in total
    });

    it('points the end record at a central directory that is actually there', () => {
      const out = zip(entries);
      const end = out.length - 22;
      const size = out.readUInt32LE(end + 12);
      const offset = out.readUInt32LE(end + 16);
      expect(offset + size).toBe(end);
      expect(out.readUInt32LE(offset)).toBe(0x02014b50); // central directory header
    });

    it('stores each entry uncompressed, with its real size and checksum', () => {
      const out = zip([entries[0]]);
      expect(out.readUInt16LE(8)).toBe(0); // method: stored
      expect(out.readUInt32LE(14)).toBe(crc32(entries[0].bytes));
      expect(out.readUInt32LE(18)).toBe(entries[0].bytes.length); // compressed
      expect(out.readUInt32LE(22)).toBe(entries[0].bytes.length); // uncompressed
    });

    it('writes the payload bytes verbatim, which is the point of storing', () => {
      const out = zip([entries[2]]);
      const nameLen = out.readUInt16LE(26);
      const start = 30 + nameLen;
      expect(out.subarray(start, start + entries[2].bytes.length)).toEqual(entries[2].bytes);
    });

    it('flags names as UTF-8, so a note number with a dash is not mangled somewhere else', () => {
      const out = zip([entries[0]]);
      expect(out.readUInt16LE(6) & 0x0800).toBe(0x0800);
    });

    it('keeps forward slashes, because a backslash is a filename on the other side', () => {
      const out = zip([{ name: 'copies\\01.html', bytes: Buffer.from('x') }]);
      expect(out.subarray(30, 30 + out.readUInt16LE(26)).toString('utf8')).toBe('copies/01.html');
    });

    it('writes a readable empty archive rather than nothing at all', () => {
      const out = zip([]);
      expect(out).toHaveLength(22);
      expect(out.readUInt32LE(0)).toBe(0x06054b50);
    });
  });
});
