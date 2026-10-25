import type { Location } from "./attendance";

export type LocationFailureCode = "GPS_UNAVAILABLE" | "GPS_PERMISSION_DENIED" | "GPS_TIMEOUT";

export class LocationFailure extends Error {
  constructor(readonly code: LocationFailureCode, message: string, readonly browserErrorCode?: number) {
    super(message);
    this.name = "LocationFailure";
  }
}

export function getBrowserLocation(): Promise<Location> {
  if (!navigator.geolocation) return Promise.reject(new LocationFailure("GPS_UNAVAILABLE", "Geolocation is not supported by this browser"));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
    (error) => {
      if (error.code === error.PERMISSION_DENIED) reject(new LocationFailure("GPS_PERMISSION_DENIED", "Location permission is required to clock in or out", error.code));
      else if (error.code === error.TIMEOUT) reject(new LocationFailure("GPS_TIMEOUT", "GPS did not respond in time", error.code));
      else reject(new LocationFailure("GPS_UNAVAILABLE", "Your GPS location is unavailable", error.code));
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
  ));
}
