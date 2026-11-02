import type { GeoPoint } from '../geo';

/**
 * A SMALL MAP OF ONE PLACE, TO LOOK AT — never to pan, zoom or drop a pin on (the owner, 2026-11-02: "I prefer the map if
 * the connection is good").
 *
 * Six of OpenStreetMap's own tiles laid side by side with the place in the middle: no Leaflet, no script to download,
 * nothing to drag — the lightest map there is. Three columns and two rows of 256-pixel tiles always cover a box up to
 * 512 pixels wide and 256 high around the place, so the box is capped at that (an app is 560 wide at most, and a card
 * narrower). The tiles are fetched only when the box nears the screen (`loading="lazy"`), and while they come — or if
 * they never do — the box shows the simple map's grid with the pin on it, so it never stands empty. Credited the way
 * OpenStreetMap asks: its name and a link to its copyright page.
 *
 * Whether a map is shown at all is not this component's say: see shared/mapOrWords.ts.
 */
export const STATIC_ZOOM = 15;
const TILE = 256;

export interface StaticTile {
  x: number;
  y: number;
  /** Where the tile sits in the 3 × 2 layer, in pixels. */
  left: number;
  top: number;
  src: string;
}

export interface StaticTiles {
  zoom: number;
  tiles: StaticTile[];
  /** Where the place falls in the layer, in pixels: the layer is moved so that this point is the box's middle. */
  at: { x: number; y: number };
}

/** Web Mercator, as every tiled map draws the world: a point → its pixel on the world at this zoom. */
function worldPixel(p: GeoPoint, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
  const rad = (lat * Math.PI) / 180;
  const x = ((p.lng + 180) / 360) * size;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size;
  return { x, y };
}

/**
 * The six tiles around a place, and where the place falls among them. Pure, for the test. The columns are the place's
 * tile and one either side (so at least 256 pixels on each side of it); the rows are its tile and the one nearer to it
 * above or below (so at least 128 above and below).
 */
export function staticTiles(point: GeoPoint, zoom: number = STATIC_ZOOM): StaticTiles {
  const n = 2 ** zoom;
  const { x, y } = worldPixel(point, zoom);
  const tx = Math.floor(x / TILE);
  const ty = Math.min(n - 1, Math.max(0, Math.floor(y / TILE)));
  const px = x - tx * TILE;
  const py = y - ty * TILE;
  const firstRow = Math.max(0, Math.min(n - 2, py < TILE / 2 ? ty - 1 : ty));
  const tiles: StaticTile[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const tileX = (((tx - 1 + col) % n) + n) % n; // round the back of the world, as the map does
      const tileY = firstRow + row;
      tiles.push({ x: tileX, y: tileY, left: col * TILE, top: row * TILE, src: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png` });
    }
  }
  return { zoom, tiles, at: { x: TILE + px, y: (ty - firstRow) * TILE + py } };
}

export interface StaticMapProps {
  point: GeoPoint;
  /** What the map shows, for a screen reader: "Map of where this hub is". */
  label: string;
}

export function StaticMap({ point, label }: StaticMapProps) {
  const s = staticTiles(point);
  return (
    <div class="smap">
      <div class="smap__view" role="img" aria-label={label}>
        <div class="smap__tiles" style={`left:calc(50% - ${Math.round(s.at.x)}px);top:calc(50% - ${Math.round(s.at.y)}px)`}>
          {s.tiles.map((tile) => (
            <img
              key={`${tile.x}/${tile.y}`}
              class="smap__tile"
              src={tile.src}
              alt=""
              width={TILE}
              height={TILE}
              loading="lazy"
              decoding="async"
              draggable={false}
              style={`left:${tile.left}px;top:${tile.top}px`}
            />
          ))}
        </div>
        <span class="smap__pin" />
      </div>
      <a class="smap__credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
