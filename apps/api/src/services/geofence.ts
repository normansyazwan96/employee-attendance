import { prisma } from "./prisma.js";

export type Location = { latitude: number; longitude: number; accuracy: number };
type LocationValidation = { valid: boolean; reason?: string; worksite?: { id: string; name: string; distanceMeters: number; radiusMeters: number } };

function distanceMeters(from: Location, to: { latitude: number; longitude: number }): number {
  const radians = (value: number): number => value * Math.PI / 180;
  const earthRadius = 6_371_000;
  const latitudeDifference = radians(to.latitude - from.latitude);
  const longitudeDifference = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDifference / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDifference / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function validateLocation(clientId: string | null, location: Location): Promise<LocationValidation> {
  if (!clientId) return { valid: false, reason: "Your account is not assigned to a client" };
  const worksites = await prisma.worksite.findMany({ where: { clientId, isActive: true } });
  if (worksites.length === 0) return { valid: false, reason: "No active worksite has been configured" };
  const nearest = worksites.map((worksite) => ({ worksite, distanceMeters: distanceMeters(location, worksite) })).sort((first, second) => first.distanceMeters - second.distanceMeters)[0];
  if (!nearest) return { valid: false, reason: "No active worksite has been configured" };
  const valid = nearest.distanceMeters <= nearest.worksite.radiusMeters;
  return { valid, reason: valid ? undefined : "You are outside the allowed worksite area", worksite: { id: nearest.worksite.id, name: nearest.worksite.name, distanceMeters: Math.round(nearest.distanceMeters), radiusMeters: nearest.worksite.radiusMeters } };
}
