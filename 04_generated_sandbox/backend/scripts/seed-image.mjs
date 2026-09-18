import { deflateSync } from 'node:zlib';

/**
 * A REAL image for the sandbox, built here rather than checked in.
 *
 * Every "photo" in the seeded world used to be a filename — `grace-licence.jpg`, `med_pod`, `id.jpg` —
 * and nothing was ever uploaded behind them. That was invisible while no screen tried to show a document,
 * and the moment three of them did it became the whole problem: the claims queue counted two photos that
 * did not exist, the driver vetting queue offered a licence nobody could look at, and the papers screen
 * asked for a new expiry date beside an image that was never there.
 *
 * So the seed now uploads actual bytes through the actual media route. These are plainly synthetic — a
 * coloured card with a band and some bars where writing would be — and that is deliberate: a sandbox
 * should not carry photographs of real people or real documents, and a reviewer needs to be able to tell
 * at a glance that what they are looking at is demo data rather than somebody's licence.
 *
 * PNG by hand, because the alternative is a dependency for forty lines of arithmetic: signature, IHDR,
 * one zlib-compressed IDAT of raw RGB scanlines, IEND.
 */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** An RGB PNG from a `pixel(x, y) -> [r,g,b]` function. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PALETTE = {
  licence: [38, 74, 122],
  id: [96, 64, 120],
  securement: [58, 92, 58],
  pod: [150, 96, 40],
  damage: [150, 58, 58],
  shop: [40, 100, 110],
};

/**
 * A card that reads as a document at thumbnail size: a coloured ground, a paler panel, and bars where
 * lines of writing would be — plus a corner block standing in for a photograph on an identity document.
 *
 * `seed` shifts the bar layout so two documents in one strip are visibly different images rather than the
 * same picture twice, which would make a reviewer doubt they were looking at two files.
 */
export function documentPng(sort = 'licence', seed = 1, width = 320, height = 200) {
  const base = PALETTE[sort] ?? PALETTE.licence;
  const bars = [];
  for (let i = 0; i < 5; i += 1) {
    const y = 78 + i * 22;
    bars.push({ y, x0: 110, x1: 110 + 60 + ((seed * (i + 3) * 37) % 130) });
  }
  return png(width, height, (x, y) => {
    const border = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
    if (border) return base;
    // The header band, darker than the card.
    if (y < 60) return [Math.max(0, base[0] - 18), Math.max(0, base[1] - 18), Math.max(0, base[2] - 18)];
    // The portrait block, bottom-left — an identity document's photograph.
    if (x >= 24 && x <= 96 && y >= 78 && y <= 170) return [214, 208, 198];
    // Lines of writing.
    for (const b of bars) if (y >= b.y && y <= b.y + 9 && x >= b.x0 && x <= b.x1) return [232, 232, 236];
    return [246, 245, 242];
  });
}

/** …as the data URL the media route takes. */
export function documentDataUrl(sort, seed) {
  return `data:image/png;base64,${documentPng(sort, seed).toString('base64')}`;
}

/**
 * A ROAD, not a document — because a hazard photo is now read by the next driver down that road, and a
 * seeded picture of an identity card under "road washed out" teaches exactly the wrong thing about what
 * this strip is for.
 *
 * Crude on purpose: ground, a carriageway running to a vanishing point, and — for 'washout' — a dark
 * gash across it. What it has to carry at thumbnail size is one bit, which is whether the road is broken
 * or whole, because that is the argument the two accounts on a disputed hazard are having.
 */
export function roadPng(sort = 'washout', width = 320, height = 200) {
  const horizon = 70;
  return png(width, height, (x, y) => {
    if (y < horizon) return [150, 162, 172]; // an overcast sky, which is the weather that does this
    // The carriageway: narrow at the horizon, full width at the driver's feet.
    const t = (y - horizon) / (height - horizon);
    const half = 18 + t * 110;
    const off = Math.abs(x - width / 2);
    if (off > half) return [122, 104, 78]; // the verge
    if (sort === 'washout' && y > horizon + 58 && y < horizon + 92) return [58, 44, 34]; // the gash
    // The centre line, dashed, and gone where the road is.
    if (off < 3 + t * 4 && Math.floor(y / 14) % 2 === 0 && !(sort === 'washout' && y > horizon + 58 && y < horizon + 92)) {
      return [226, 214, 160];
    }
    return [86, 86, 90];
  });
}

export function roadDataUrl(sort) {
  return `data:image/png;base64,${roadPng(sort).toString('base64')}`;
}
