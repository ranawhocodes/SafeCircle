/**
 * Leaflet map with an honest accuracy circle (FR-INC-10).
 *
 * The circle is the point: a responder must be able to see that a Wi-Fi estimate
 * is a 60 m blob and a GPS fix is a tight dot, rather than being shown a
 * confident pin either way.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import L from 'leaflet';

export interface Trail {
  lat: number;
  lng: number;
  accuracyM: number;
  source: string;
}

export function MiniMap({
  center,
  accuracyM,
  label,
  trail,
  tall,
}: {
  center: [number, number];
  accuracyM: number;
  label?: string;
  /** Earlier positions, drawn faintly so movement is visible. */
  trail?: Trail[];
  tall?: boolean;
}): ReactNode {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: true }).setView(
      center,
      17,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    // The trail first, so the current position draws on top.
    for (const p of trail ?? []) {
      L.circleMarker([p.lat, p.lng], {
        radius: 4,
        color: '#5b6b7c',
        weight: 1,
        fillOpacity: 0.5,
      })
        .bindTooltip(`${p.source}, ~${Math.round(p.accuracyM)} m`)
        .addTo(layer);
    }

    L.circle(center, {
      radius: accuracyM,
      color: '#1b9aaa',
      weight: 1,
      fillColor: '#1b9aaa',
      fillOpacity: 0.15,
    }).addTo(layer);

    const marker = L.circleMarker(center, {
      radius: 8,
      color: '#0b2545',
      weight: 2,
      fillColor: '#f4a261',
      fillOpacity: 1,
    }).addTo(layer);
    if (label) marker.bindTooltip(label, { permanent: false });

    map.setView(center, map.getZoom() < 15 ? 17 : map.getZoom());
  }, [center, accuracyM, label, trail]);

  return (
    <div
      ref={divRef}
      className={`map${tall ? ' tall' : ''}`}
      role="img"
      aria-label={
        label
          ? `Map showing ${label} with an accuracy circle of about ${Math.round(accuracyM)} metres`
          : `Map with an accuracy circle of about ${Math.round(accuracyM)} metres`
      }
    />
  );
}
