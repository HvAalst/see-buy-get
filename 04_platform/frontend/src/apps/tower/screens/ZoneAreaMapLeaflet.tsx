import { useEffect, useRef } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { decodePolygon, type ZoneAreaShape } from '../zones';

export interface ZoneAreaMapProps {
  areas: ZoneAreaShape[];
  /** The set the shapes belong to: the view is fitted to them again only when this changes. */
  setId: string;
  /** Each area's fill, by its zone's group. */
  fillOf: (area: ZoneAreaShape) => string;
  /** What hovering an area says: its name, its zone and its group, in words. */
  labelOf: (area: ZoneAreaShape) => string;
  /** Areas chosen (to move), and the zone whose areas are shown: both drawn with an orange edge, the colour of a choice. */
  chosen: ReadonlySet<string>;
  focusZone?: string;
  /** Tapping an area chooses it, or lets it go. Absent: the map is only read. */
  onPick?: (areaId: string) => void;
}

const ORANGE = '#fb6200';
const EDGE = '#3d4258';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * A COUNTRY'S AREAS ON A MAP, coloured by the group of the zone each is in (2026-11-08). The online half of ZoneAreaMap,
 * loaded only when the screen opens. Drawn on a canvas: a country's wards are over a thousand shapes. Names come from a
 * boundary file somebody uploaded, so they are escaped before they become a tooltip.
 */
export function ZoneAreaMapLeaflet({ areas, setId, fillOf, labelOf, chosen, focusZone, onPick }: ZoneAreaMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const shapesRef = useRef(new Map<string, L.Polygon>());
  const fittedRef = useRef('');
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([0, 20], 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      shapesRef.current.clear();
    };
  }, []);

  // The shapes, drawn again when the areas or their zones change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    shapesRef.current.clear();
    const bounds = L.latLngBounds([]);
    for (const area of areas) {
      const rings = area.polygons.map(decodePolygon);
      const shape = L.polygon(rings as L.LatLngExpression[][][], { color: EDGE, weight: 0.6, fillColor: fillOf(area), fillOpacity: 0.35 });
      shape.bindTooltip(escapeHtml(labelOf(area)), { sticky: true });
      shape.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        onPickRef.current?.(area.id);
      });
      shape.addTo(layer);
      shapesRef.current.set(area.id, shape);
      bounds.extend(shape.getBounds());
    }
    const sig = `${setId}:${areas.length}`;
    if (bounds.isValid() && fittedRef.current !== sig) {
      map.fitBounds(bounds, { padding: [12, 12] });
      fittedRef.current = sig;
    }
  }, [areas, setId, fillOf, labelOf]);

  // What is chosen, drawn over the fills without drawing everything again.
  useEffect(() => {
    for (const area of areas) {
      const shape = shapesRef.current.get(area.id);
      if (!shape) continue;
      const on = chosen.has(area.id) || (!!focusZone && area.zone === focusZone);
      shape.setStyle(on ? { color: ORANGE, weight: 2.4, fillOpacity: 0.5 } : { color: EDGE, weight: 0.6, fillOpacity: 0.35 });
      if (on) shape.bringToFront();
    }
  }, [areas, chosen, focusZone]);

  return <div ref={hostRef} class="twr-zonemap__map" />;
}
