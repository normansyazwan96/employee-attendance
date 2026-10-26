export const defaultLeaveDayMinutes = 480;

export function leaveDaysToMinutes(days: number, dayMinutes = defaultLeaveDayMinutes): number {
  return Math.round(days * dayMinutes);
}

export function leaveMinutesToDays(minutes: number, dayMinutes = defaultLeaveDayMinutes): number {
  return minutes / dayMinutes;
}
