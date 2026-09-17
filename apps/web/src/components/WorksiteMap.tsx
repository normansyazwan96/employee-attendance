import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import { useEffect } from "react";

type WorksiteMapProps = { latitude: number; longitude: number; radiusMeters: number; onLocationChange: (latitude: number, longitude: number) => void };
const fallbackCenter: LatLngExpression = [40.7128, -74.006];

function MapClick({ onLocationChange }: Pick<WorksiteMapProps, "onLocationChange">): null {
  useMapEvents({ click: (event) => onLocationChange(event.latlng.lat, event.latlng.lng) });
  return null;
}

function MapCenter({ latitude, longitude }: Pick<WorksiteMapProps, "latitude" | "longitude">): null {
  const map = useMap();
  useEffect(() => { map.setView([latitude, longitude]); }, [latitude, longitude, map]);
  return null;
}

export function WorksiteMap({ latitude, longitude, radiusMeters, onLocationChange }: WorksiteMapProps): JSX.Element {
  const center: LatLngExpression = Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : fallbackCenter;
  return <MapContainer center={center} zoom={15} scrollWheelZoom className="h-full min-h-72 w-full"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><MapClick onLocationChange={onLocationChange} /><MapCenter latitude={latitude} longitude={longitude} /><Marker position={[latitude, longitude]} /><Circle center={[latitude, longitude]} radius={radiusMeters} pathOptions={{ color: "#0f766e", fillColor: "#14b8a6", fillOpacity: 0.18 }} /></MapContainer>;
}
