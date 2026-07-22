import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Fallback map center — Metro Manila / Rizal (matches the tracking test point). */
const DEFAULT_CENTER: L.LatLngTuple = [14.6, 121.0];

/** Brand-green teardrop pin (divIcon — no external image assets to bundle). */
const pinIcon = L.divIcon({
  className: 'ebd-drop-pin',
  html:
    '<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="#6DBE22"/>' +
    '<circle cx="15" cy="15" r="6" fill="#fff"/></svg>',
  iconSize: [30, 42],
  iconAnchor: [15, 42],
});

export interface LatLngValue { lat: number; lng: number }

/**
 * Drop-off location picker for checkout. Auto-centres on the customer's current
 * position, then lets them click or drag to set the exact delivery point — this
 * drives the distance-based delivery fee (store pin → drop-off).
 */
export function LocationPicker({
  value, onChange, height = 220,
}: { value: LatLngValue | null; onChange: (v: LatLngValue) => void; height?: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const start: L.LatLngTuple = value ? [value.lat, value.lng] : DEFAULT_CENTER;
    const map = L.map(elRef.current).setView(start, value ? 16 : 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);

    const place = (lat: number, lng: number) => {
      if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
      else {
        const m = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);
        m.on('dragend', () => {
          const p = m.getLatLng();
          onChangeRef.current({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
        });
        markerRef.current = m;
      }
      onChangeRef.current({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
    };

    if (value) place(value.lat, value.lng);
    map.on('click', (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);

    // On first mount with no value, offer to centre on the device location.
    if (!value && navigator.geolocation) {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => { map.setView([pos.coords.latitude, pos.coords.longitude], 16); setLocating(false); },
        () => setLocating(false),
        { timeout: 8000 },
      );
    }

    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      mapRef.current?.setView([lat, lng], 16);
      if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
      else if (mapRef.current) {
        markerRef.current = L.marker([lat, lng], { icon: pinIcon, draggable: true })
          .addTo(mapRef.current)
          .on('dragend', function (this: L.Marker) {
            const p = this.getLatLng();
            onChangeRef.current({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
          });
      }
      onChangeRef.current({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
      setLocating(false);
    }, () => setLocating(false));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Delivery location</span>
        <button type="button" onClick={useMyLocation}
          className="rounded-lg bg-brand-purple px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          disabled={locating}>
          {locating ? 'Locating…' : '📍 Use my location'}
        </button>
      </div>
      <div ref={elRef} style={{ height }} className="w-full overflow-hidden rounded-lg ring-1 ring-black/10" />
      <p className="mt-1.5 text-xs text-black/50">
        {value
          ? 'Tap or drag the pin to set your exact drop-off.'
          : 'Tap the map (or use your location) to set your drop-off point.'}
      </p>
    </div>
  );
}
