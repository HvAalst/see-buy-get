/**
 * A MINIMAL ZIP WRITER — enough to hand somebody a folder they can open anywhere.
 *
 * An export that arrives as a document pointing at URLs is not an export: the links need an account, and
 * the photographs behind them are on a retention clock the document outlives. What a party, an insurer or
 * a magistrate needs is the whole thing in one file that still works on a laptop with no network.
 *
 * NO DEPENDENCY. The backend has eight production packages and none of them compresses; adding one to
 * concatenate a few JPEGs and an HTML page would be a poor trade. This writes the STORED method (no
 * compression at all), which every unzip tool on earth reads and which costs nothing to produce — the
 * payload is mostly JPEG, and a JPEG does not compress twice.
 *
 * The format, for anybody maintaining this: a local header and the bytes for each entry, then a central
 * directory repeating each header, then an end-of-central-directory record pointing at it. Sizes are
 * known before writing (everything is in memory), so no data descriptors and no ZIP64 — the guard below
 * refuses a bundle big enough to need them rather than writing a file that silently truncates.
 */

/** ZIP64 territory. A consignment bundle is a page of HTML and a handful of photographs; nothing here is close. */
const MAX_TOTAL_BYTES = 0xffffffff;

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string;
  bytes: Buffer;
  /** Defaults to now. Stored in DOS format, which has two-second resolution and no timezone. */
  at?: Date;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** DOS date/time, which is what a ZIP header carries: local time, two-second resolution, epoch 1980. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Build the archive. Entry order is preserved, which is the order a reader sees the folder in. */
export function zip(entries: ZipEntry[]): Buffer {
  const now = new Date();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const { time, date } = dosTime(entry.at ?? now);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // offset of the local header
    centrals.push(central, name);

    offset += local.length + name.length + size;
    if (offset > MAX_TOTAL_BYTES) throw new Error('Bundle too large for a ZIP without ZIP64');
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, ...centrals, end]);
}
