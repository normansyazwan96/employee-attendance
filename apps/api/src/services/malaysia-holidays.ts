import { PlatformRole, Role } from "@prisma/client";
import Holidays from "date-holidays";
import { notifyUsers } from "./notifications.js";
import { prisma } from "./prisma.js";

export type MalaysiaHolidayDefinition = {
  year: number;
  stateCode: string;
  date: string;
  name: string;
  type: string;
};

export function malaysiaStates(): Record<string, string> {
  return new Holidays().getStates("MY") as Record<string, string>;
}

export function malaysiaCalendar(year: number, stateCode: string): { states: Record<string, string>; holidays: Array<Omit<MalaysiaHolidayDefinition, "year" | "stateCode">> } | null {
  const engine = new Holidays();
  const states = malaysiaStates();
  if (!states[stateCode]) return null;
  engine.init("MY", stateCode);
  const holidays = engine.getHolidays(year)
    .filter((holiday) => holiday.type === "public")
    .map((holiday) => ({ date: holiday.date.slice(0, 10), name: holiday.name, type: holiday.type }));
  const unique = new Map(holidays.map((holiday) => [`${holiday.date}\u0000${holiday.name}`, holiday]));
  return { states, holidays: [...unique.values()] };
}

export function allMalaysiaHolidays(year: number): MalaysiaHolidayDefinition[] {
  return Object.keys(malaysiaStates()).flatMap((stateCode) => {
    const calendar = malaysiaCalendar(year, stateCode);
    return (calendar?.holidays ?? []).map((holiday) => ({ year, stateCode, ...holiday }));
  });
}

export function isPublicHolidayForState(input: {
  workDate: string;
  stateCode: string;
  organizationHolidays: Array<{ date: string; stateCode: string | null; isWorkingDayOverride: boolean }>;
  malaysiaHolidays: Array<{ date: string; stateCode: string }>;
}): boolean {
  const organizationMatches = input.organizationHolidays.filter((holiday) => holiday.date === input.workDate && (!holiday.stateCode || holiday.stateCode === input.stateCode));
  if (organizationMatches.some((holiday) => holiday.isWorkingDayOverride)) return false;
  return organizationMatches.some((holiday) => !holiday.isWorkingDayOverride)
    || input.malaysiaHolidays.some((holiday) => holiday.date === input.workDate && holiday.stateCode === input.stateCode);
}

export function malaysiaDateParts(now: Date): { month: number; day: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function holidayImportReminderYear(now: Date): number | null {
  const { year, month, day } = malaysiaDateParts(now);
  return month === 12 && day >= 25 ? year + 1 : null;
}

export async function remindDevAdminsToImportNextYearHolidays(now = new Date()): Promise<void> {
  const year = holidayImportReminderYear(now);
  if (!year) return;
  const imported = await prisma.malaysiaHoliday.count({ where: { year } });
  if (imported > 0) return;
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ role: Role.DEV_ADMIN }, { platformRole: PlatformRole.DEV_ADMIN }] },
    select: { id: true },
  });
  if (!users.length) return;
  const entityId = String(year);
  const existing = await prisma.notification.findMany({
    where: { userId: { in: users.map((user) => user.id) }, type: "HOLIDAY_IMPORT_REMINDER", entityType: "MalaysiaHolidayYear", entityId },
    select: { userId: true },
  });
  const notified = new Set(existing.map((item) => item.userId));
  await notifyUsers({
    userIds: users.map((user) => user.id).filter((id) => !notified.has(id)),
    type: "HOLIDAY_IMPORT_REMINDER",
    title: `Import ${year} Malaysian holidays`,
    message: `The Malaysian public holiday catalogue for ${year} has not been imported. Import it before 1 January so worksite attendance, leave, and payroll use the correct dates.`,
    entityType: "MalaysiaHolidayYear",
    entityId,
  });
}
