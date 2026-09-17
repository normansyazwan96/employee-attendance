import type { Location } from "./attendance";

export function getBrowserLocation(): Promise<Location> {
  if (!navigator.geolocation) return Promise.reject(new Error("Geolocation is not supported by this browser"));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
    () => reject(new Error("Location permission is required to clock in or out")),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
  ));
}
