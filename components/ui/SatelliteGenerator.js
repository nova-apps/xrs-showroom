'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

const SIZE_OPTIONS = [
  { value: 1024, label: '1K' },
  { value: 2048, label: '2K' },
  { value: 4096, label: '4K' },
  { value: 8192, label: '8K' },
];

function estimateWeight(size, zoom) {
  // WebP lossy q90 ~ 0.4-0.8 bytes/px for satellite
  const bpp = 0.35 + (zoom - 16) * 0.08;
  const pixels = size * size;
  const bytes = pixels * bpp;
  if (bytes < 1024 * 1024) return `~${(bytes / 1024).toFixed(0)} KB`;
  return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Parse Google Maps URL to extract lat,lng
function parseLocation(input) {
  if (!input || !input.trim()) return null;
  const s = input.trim();

  // @LAT,LNG,ZOOMz
  let m = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)z/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), zoom: parseInt(m[3]) };

  // @LAT,LNG
  m = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // ?q=LAT,LNG or ?ll=LAT,LNG
  m = s.match(/[?&](?:q|ll|center)=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // /place/LAT,LNG
  m = s.match(/\/place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // Plain "LAT,LNG"
  m = s.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  return null;
}

// Tile coordinate conversions (same math as map2tex.py)
function latlngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = ((lng + 180.0) / 360.0) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) * n;
  return { x, y };
}

function tileToLatLng(tx, ty, zoom) {
  const n = Math.pow(2, zoom);
  const lng = (tx / n) * 360.0 - 180.0;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}

// Compute capture bounds — symmetric around center, matching map2tex.py crop logic
function captureBounds(lat, lng, zoom, size) {
  const tilesX = Math.ceil(size / 256);
  const tilesY = tilesX; // ratio 1:1
  const center = latlngToTile(lat, lng, zoom);
  // Symmetric: half the tile span in each direction from the exact center
  const nw = tileToLatLng(center.x - tilesX / 2, center.y - tilesY / 2, zoom);
  const se = tileToLatLng(center.x + tilesX / 2, center.y + tilesY / 2, zoom);
  return {
    north: nw.lat,
    south: se.lat,
    east: se.lng,
    west: nw.lng,
  };
}

/**
 * Interactive Leaflet map component for satellite floor generation.
 */
function SatelliteMap({ center, zoom, size, onCenterChange, onZoomChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const rectRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [center.lat, center.lng],
        zoom: Math.min(zoom, 18), // Leaflet max practical satellite zoom
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        subdomains: '0123',
        maxZoom: 21,
      }).addTo(map);

      // Capture rectangle
      const bounds = captureBounds(center.lat, center.lng, zoom, size);
      const rect = L.rectangle(
        [[bounds.south, bounds.west], [bounds.north, bounds.east]],
        { color: '#4488ff', weight: 2, fillOpacity: 0.1, dashArray: '6 4' }
      ).addTo(map);
      rectRef.current = rect;

      // Crosshair
      const crosshairIcon = L.divIcon({
        className: 'sat-crosshair',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const marker = L.marker([center.lat, center.lng], { icon: crosshairIcon, interactive: false }).addTo(map);

      map.on('moveend', () => {
        const c = map.getCenter();
        marker.setLatLng(c);
        onCenterChange({ lat: c.lat, lng: c.lng });
      });

      map.on('zoomend', () => {
        onZoomChange(map.getZoom());
      });

      map.on('click', (e) => {
        map.panTo(e.latlng);
      });

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        rectRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update rectangle when capture zoom or size changes
  useEffect(() => {
    if (!mapRef.current || !rectRef.current) return;
    const c = mapRef.current.getCenter();
    const bounds = captureBounds(c.lat, c.lng, zoom, size);
    rectRef.current.setBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]]);
  }, [zoom, size]);

  // Fly to new center when set externally
  useEffect(() => {
    if (!mapRef.current) return;
    const mc = mapRef.current.getCenter();
    const dist = Math.abs(mc.lat - center.lat) + Math.abs(mc.lng - center.lng);
    if (dist > 0.0001) {
      mapRef.current.setView([center.lat, center.lng], mapRef.current.getZoom());
    }
  }, [center.lat, center.lng]);

  // Update rect when map moves
  useEffect(() => {
    if (!mapRef.current || !rectRef.current) return;
    const update = () => {
      const c = mapRef.current.getCenter();
      const bounds = captureBounds(c.lat, c.lng, zoom, size);
      rectRef.current.setBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]]);
    };
    mapRef.current.on('move', update);
    return () => mapRef.current?.off('move', update);
  }, [zoom, size]);

  return <div ref={containerRef} className="sat-map-container" />;
}

export default function SatelliteGenerator({ onGenerated, savedSatelliteUrl, onSaveSatelliteUrl }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [center, setCenter] = useState({ lat: -34.6037, lng: -58.3816 }); // Buenos Aires default
  const [captureZoom, setCaptureZoom] = useState(19);
  const [size, setSize] = useState(4096);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapViewZoom, setMapViewZoom] = useState(17);
  const urlAppliedRef = useRef(false);

  // Load saved URL when modal opens
  useEffect(() => {
    if (modalOpen && savedSatelliteUrl && !urlAppliedRef.current) {
      setUrl(savedSatelliteUrl);
      const parsed = parseLocation(savedSatelliteUrl);
      if (parsed) {
        setCenter({ lat: parsed.lat, lng: parsed.lng });
        if (parsed.zoom) setCaptureZoom(parsed.zoom);
      }
      urlAppliedRef.current = true;
    }
    if (!modalOpen) {
      urlAppliedRef.current = false;
      setMapReady(false);
    }
  }, [modalOpen, savedSatelliteUrl]);

  const handleUrlSubmit = useCallback(() => {
    const parsed = parseLocation(url);
    if (parsed) {
      setCenter({ lat: parsed.lat, lng: parsed.lng });
      if (parsed.zoom) setCaptureZoom(Math.min(21, parsed.zoom));
      setError(null);
    } else if (url.trim()) {
      setError('No se pudo interpretar la URL o coordenadas');
    }
  }, [url]);

  const handleUrlKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleUrlSubmit();
  }, [handleUrlSubmit]);

  const handleMapCenter = useCallback((c) => {
    setCenter(c);
  }, []);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgress('Descargando tiles satelitales...');

    try {
      const coordStr = `${center.lat},${center.lng}`;

      const res = await fetch('/api/map2tex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: center.lat, lng: center.lng, zoom: captureZoom, size, ratio: '1:1' }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Error ${res.status}`);
      }

      setProgress('Procesando imagen...');
      const blob = await res.blob();
      const file = new File([blob], `satellite_floor_${Date.now()}.webp`, { type: 'image/webp' });

      // Save location for next time
      onSaveSatelliteUrl?.(coordStr);

      setLoading(false);
      setProgress('');
      setModalOpen(false);
      onGenerated(file);
    } catch (err) {
      setError(err.message);
      setProgress('');
      setLoading(false);
    }
  }, [center, captureZoom, size, onGenerated, onSaveSatelliteUrl]);

  const handleClose = useCallback(() => {
    if (loading) return;
    setModalOpen(false);
  }, [loading]);

  return (
    <>
      <button className="satellite-gen-toggle" onClick={() => setModalOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        Generar desde mapa satelital
      </button>

      {modalOpen && (
        <div className="sat-modal-overlay" onClick={handleClose}>
          <div className="sat-modal sat-modal-wide" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="sat-modal-header">
              <span className="sat-modal-title">Generar piso satelital</span>
              <div className="sat-modal-coords">
                {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
              </div>
              <button className="sat-modal-close" onClick={handleClose} disabled={loading}>✕</button>
            </div>

            <div className="sat-modal-body">
              {/* Left: interactive map */}
              <div className="sat-modal-map-area">
                <div className="sat-url-bar">
                  <input
                    type="text"
                    className="sat-input"
                    placeholder="Pegar URL de Google Maps o lat,lng y presionar Enter"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleUrlKeyDown}
                    disabled={loading}
                  />
                  <button className="sat-url-go" onClick={handleUrlSubmit} disabled={loading} title="Ir">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
                <SatelliteMap
                  center={center}
                  zoom={captureZoom}
                  size={size}
                  onCenterChange={handleMapCenter}
                  onZoomChange={setMapViewZoom}
                />
              </div>

              {/* Right: controls */}
              <div className="sat-modal-controls">
                <div className="sat-field">
                  <label className="sat-label">Zoom de captura</label>
                  <div className="sat-zoom-row">
                    <input
                      type="range"
                      min={16}
                      max={21}
                      step={1}
                      value={captureZoom}
                      onChange={(e) => setCaptureZoom(parseInt(e.target.value))}
                      disabled={loading}
                      className="sat-zoom-slider"
                    />
                    <span className="sat-zoom-value">{captureZoom}</span>
                  </div>
                  <div className="sat-zoom-labels">
                    <span>Ciudad</span>
                    <span>Detalle</span>
                  </div>
                </div>

                <div className="sat-field">
                  <label className="sat-label">Resolucion</label>
                  <div className="sat-sizes">
                    {SIZE_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        className={`sat-size-btn ${size === o.value ? 'active' : ''}`}
                        onClick={() => setSize(o.value)}
                        disabled={loading}
                      >
                        <span className="sat-size-name">{o.label}</span>
                        <span className="sat-size-weight">{estimateWeight(o.value, captureZoom)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sat-format-info">
                  WebP &middot; {size}x{size}px
                </div>

                {error && <div className="sat-error">{error}</div>}

                <button
                  className="sat-generate-btn"
                  onClick={handleGenerate}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="satellite-gen-spinner" />
                      {progress}
                    </>
                  ) : (
                    'Generar piso'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
