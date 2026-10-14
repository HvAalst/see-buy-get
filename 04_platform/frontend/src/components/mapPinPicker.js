// MapPinPicker — pick a location by pin instead of typing an address (WS-UX).
// Dependency-free placeholder: a tappable canvas that drops a pin, plus a
// "Use my location" button (Geolocation API). Swap the canvas for a real map
// tile layer later without changing the onChange contract.

import { el } from './dom.js';
import { BigButton } from './bigButton.js';

/**
 * @param {object} props
 * @param {string} [props.label]
 * @param {(coords: {lat:number, lng:number}) => void} [props.onChange]
 */
export function MapPinPicker({ label = 'Choose location', onChange } = {}) {
  const readout = el('div', { className: 'ws-map__readout', attrs: { 'aria-live': 'polite' }, text: 'No location chosen yet' });
  const pin = el('span', { className: 'ws-map__pin', attrs: { 'aria-hidden': 'true', hidden: 'hidden' }, text: '📍' });

  function setCoords(lat, lng, { fromTap, x, y } = {}) {
    readout.textContent = `Location set: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    pin.hidden = false;
    if (fromTap) {
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
    }
    if (onChange) onChange({ lat, lng });
  }

  const surface = el('div', {
    className: 'ws-map__surface',
    attrs: { role: 'application', 'aria-label': `${label}. Tap the map to drop a pin.`, tabindex: '0' },
    onClick: (e) => {
      const rect = surface.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Map tap position to a pseudo lat/lng for the placeholder.
      const lng = (x / rect.width) * 360 - 180;
      const lat = 90 - (y / rect.height) * 180;
      setCoords(lat, lng, { fromTap: true, x, y });
    },
  });
  surface.append(pin);

  const locateBtn = BigButton({
    label: 'Use my location',
    icon: '🎯',
    variant: 'secondary',
    onClick: () => {
      if (!navigator.geolocation) {
        readout.textContent = 'Location not available on this device. Tap the map instead.';
        return;
      }
      readout.textContent = 'Finding your location…';
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords(pos.coords.latitude, pos.coords.longitude),
        () => {
          readout.textContent = 'Could not get your location. Tap the map instead.';
        },
      );
    },
  });

  return el('div', { className: 'ws-map' }, [
    el('div', { className: 'ws-map__title', text: label }),
    surface,
    locateBtn,
    readout,
  ]);
}
