import { useEffect, useRef } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PlaceMapProps } from './PlaceMap';

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

export function PlaceMapLeaflet({ pins = [], selectedId, onPick, reference, onDrop, dropped, label }: PlaceMapProps) {
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
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
    for (const pin of pins) {
      const marker = L.marker([pin.point.lat, pin.point.lng], { icon: dotIcon(pin.id === selectedId ? 'on' : 'pin', pin.label) });
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
    const sig = points
      .map((p) => `${(p as [number, number])[0]},${(p as [number, number])[1]}`)
      .sort()
      .join('|');
    if (sig !== fittedSigRef.current) {
      fittedSigRef.current = sig;
      if (points.length === 1) map.setView(points[0], 15);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
    }
  }, [pins, selectedId, reference, dropped]);

  return <div ref={hostRef} class="pmap-leaflet" role={onDrop ? 'button' : 'img'} aria-label={label} />;
}

/** A custom marker: a coloured dot + a name chip, drawn in HTML (no external PNGs, no emoji). */
function dotIcon(kind: 'pin' | 'on' | 'ref' | 'dropped', text: string): L.DivIcon {
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
