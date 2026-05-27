import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

// Fix the default marker icon URLs broken by Vite's bundler.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Pick a zoom level from the bounding box latitude span.
function zoomFromBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return 8;
  const [s, n] = [Number(bbox[0]), Number(bbox[1])];
  const span = Math.abs(n - s);
  if (span > 8) return 5;      // country
  if (span > 2) return 7;      // region / large state
  if (span > 0.5) return 10;   // city
  return 12;                   // neighborhood / village
}

// Renders a single-marker OSM map for a navigational result.
export default function MapCard({ lat, lon, displayName, boundingBox, query }) {
  const center = useMemo(() => [lat, lon], [lat, lon]);
  const zoom = useMemo(() => zoomFromBox(boundingBox), [boundingBox]);
  return (
    <div className="mapcard">
      <div className="mapcard-head">
        <span className="pin" aria-hidden>📍</span>
        <span className="mapcard-title">{query}</span>
        <span className="mapcard-sub">{displayName}</span>
      </div>
      <div className="mapcard-canvas">
        <MapContainer center={center} zoom={zoom} scrollWheelZoom={false} style={{ height: 260, width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          />
          <Marker position={center}>
            <Popup>{displayName}</Popup>
          </Marker>
        </MapContainer>
      </div>
    </div>
  );
}
