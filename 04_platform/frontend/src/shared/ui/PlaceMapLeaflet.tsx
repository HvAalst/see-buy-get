import { useEffect, useRef } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { framedPoints, type PlaceMapProps } from './PlaceMap';

/**
 * The real OpenStreetMap tile map — the online half of PlaceMap (G3a). Loaded LAZILY (PlaceMap imports
 * this module only when the user is on the Map view and online), so apps that never open the map — and
 * every offline session — pay nothing for Leaflet or its tiles. Markers are custom divIcons (styled
 * HTML, no external marker PNGs and no emoji), so the map matches the app and the design contract. The
 * props are identical to the dot-plot, so the two are interchangeable.
 *
 * The Nairobi default view is only a fallback for the empty state; with any pin/reference the map fits
 * to the points.
 */
const NAIROBI: L.LatLngExpression = [-1.2864, 36.8172];

export function PlaceMapLeaflet({ pins = [], lines = [], selectedId, onPick, reference, onDrop, dropped, label, nearest }: PlaceMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // Keep the latest onPick/onDrop without re-initialising the map — the marker/click effects read these.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  // The coordinate set we last fitted the view to. Re-fitting only when this changes keeps the map from
  // snapping back to the bounds on every selection / parent re-render — which would fight a manual pan or
  // zoom (the array identity of `pins` changes on any parent render even when the coordinates do not).
  const fittedSigRef = useRef<string>('');

  // Init the map once, tear it down on unmount.
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { zoomControl: true, attributionControl: true }).setView(NAIROBI, 11);
    // OpenStreetMap's own tiles, at the one address it asks for now (the a/b/c ones are retired), credited with the link
    // to its copyright page, as its tile policy asks — the addresses typed into the Send app are found in the same data.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => onDropRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // (Re)draw markers + fit the view whenever the points change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const points: L.LatLngExpression[] = [];
    /*
     * The lanes go down FIRST, so a marker is never hidden under a stroke, and each one is a straight
     * segment between two ends — see PlaceMapLine: this is a pair of places, not the road between them.
     * Leaflet draws a geodesic-looking line across a Mercator projection, which over a few hundred
     * kilometres is visually a straight line, and that is honest here: it claims a relationship between
     * two dots and nothing about what lies between.
     */
    for (const lane of lines) {
      const on = lane.id === selectedId;
      const line = L.polyline(
        [
          [lane.from.lat, lane.from.lng],
          [lane.to.lat, lane.to.lng],
        ],
        {
          color: on ? '#fb6200' : lane.tone === 'warn' ? '#8a3b00' : '#4c46e0',
          weight: on ? 4 : 1.5 + (lane.weight ?? 0) * 3,
          opacity: on ? 1 : 0.65,
        },
      );
      line.bindTooltip(lane.label, { sticky: true });
      line.on('click', (e: L.LeafletMouseEvent) => {
        // Stopped, or the map's own click handler reads it as a drop on an empty patch of map.
        L.DomEvent.stop(e);
        onPickRef.current?.(lane.id);
      });
      line.addTo(layer);
      points.push([lane.from.lat, lane.from.lng], [lane.to.lat, lane.to.lng]);
    }
    for (const pin of pins) {
      const on = pin.id === selectedId;
      const kind = pin.tone === 'warn' ? (on ? 'warn-on' : 'warn') : pin.tone === 'stop' ? (on ? 'stop-on' : 'stop') : pin.tone === 'down' ? (on ? 'down-on' : 'down') : on ? 'on' : 'pin';
      // Leaflet stacks markers by how far down the screen they stand; a stop goes beneath them all, whatever its place.
      const marker = L.marker([pin.point.lat, pin.point.lng], { icon: dotIcon(kind, pin.label), zIndexOffset: pin.tone === 'stop' ? -1000 : 0 });
      marker.on('click', () => {
        // Tapping a pin flies the map in to it (the fit is signature-gated, so this zoom sticks), then
        // hands the tap to the consumer — which opens its detail sheet.
        const m = mapRef.current;
        if (m) m.flyTo([pin.point.lat, pin.point.lng], Math.max(m.getZoom(), 14), { duration: 0.5 });
        onPickRef.current?.(pin.id);
      });
      marker.addTo(layer);
      points.push([pin.point.lat, pin.point.lng]);
    }
    if (reference) {
      L.marker([reference.lat, reference.lng], { icon: dotIcon('ref', 'here') }).addTo(layer);
      points.push([reference.lat, reference.lng]);
    }
    if (dropped) {
      L.marker([dropped.lat, dropped.lng], { icon: dotIcon('dropped', 'your pin') }).addTo(layer);
      points.push([dropped.lat, dropped.lng]);
    }

    // Fit the view ONLY when the set of coordinates actually changed — never on a mere reselection or an
    // unrelated re-render — so the user's manual pan/zoom (and a tap-to-zoom) survives.
    // A picker of shops near a marked place frames that place and its nearest shops, not the whole network (`nearest`).
    const framed: Array<[number, number]> = reference && nearest ? framedPoints({ pins, reference, dropped, nearest }).map((p) => [p.lat, p.lng]) : (points as Array<[number, number]>);
    const sig = framed
      .map((p) => `${p[0]},${p[1]}`)
      .sort()
      .join('|');
    if (sig !== fittedSigRef.current) {
      fittedSigRef.current = sig;
      if (framed.length === 1) map.setView(framed[0], 15);
      else if (framed.length > 1) map.fitBounds(L.latLngBounds(framed), { padding: [36, 36], maxZoom: 16 });
    }
  }, [pins, lines, selectedId, reference, dropped, nearest]);

  return <div ref={hostRef} class="pmap-leaflet" role={onDrop ? 'button' : 'img'} aria-label={label} />;
}

/** A custom marker: a coloured dot + a name chip, drawn in HTML (no external PNGs, no emoji). */
function dotIcon(kind: 'pin' | 'on' | 'ref' | 'dropped' | 'warn' | 'warn-on' | 'stop' | 'stop-on' | 'down' | 'down-on', text: string): L.DivIcon {
  return L.divIcon({
    className: 'pmap-marker',
    html: `<span class="pmap-marker__dot pmap-marker__dot--${kind}"></span><span class="pmap-marker__lbl">${escapeHtml(text)}</span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
