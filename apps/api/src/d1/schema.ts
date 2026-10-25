// Generated from prisma/schema.prisma by scripts/d1/generate-baseline.mjs.

// Do not edit directly; update the Prisma schema and regenerate during the transition.

import { sql } from "drizzle-orm";

import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";



export const clientTable = sqliteTable("Client", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  stateCode: text("stateCode"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const userTable = sqliteTable("User", {
  id: text("id").primaryKey().notNull(),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  passwordHash: text("passwordHash").notNull(),
  passwordVersion: integer("passwordVersion").notNull().default(0),
  mustChangePassword: integer("mustChangePassword", { mode: "boolean" }).notNull().default(false),
  role: text("role", { enum: ["EMPLOYEE","ADMIN","MANAGER","DEV_ADMIN"] }).notNull().default("EMPLOYEE"),
  platformRole: text("platformRole", { enum: ["USER","DEV_ADMIN"] }).notNull().default("USER"),
  isGlobalAdmin: integer("isGlobalAdmin", { mode: "boolean" }).notNull().default(false),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  failedLoginAttempts: integer("failedLoginAttempts").notNull().default(0),
  lockedUntil: integer("lockedUntil", { mode: "timestamp_ms" }),
  lastLoginAt: integer("lastLoginAt", { mode: "timestamp_ms" }),
  displayName: text("displayName"),
  clientId: text("clientId"),
  createdByUserId: text("createdByUserId"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_User_createdByUserId").on(table.createdByUserId),
  ]);
export const organizationMembershipTable = sqliteTable("OrganizationMembership", {
  id: text("id").primaryKey().notNull(),
  userId: text("userId").notNull(),
  clientId: text("clientId").notNull(),
  role: text("role", { enum: ["ADMIN","MANAGER","EMPLOYEE"] }).notNull(),
  status: text("status", { enum: ["ACTIVE","INACTIVE"] }).notNull().default("ACTIVE"),
  managerMembershipId: text("managerMembershipId"),
  canManagePayroll: integer("canManagePayroll", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_OrganizationMembership_userId_clientId").on(table.userId, table.clientId),
    index("idx_OrganizationMembership_clientId_role_status").on(table.clientId, table.role, table.status),
    index("idx_OrganizationMembership_managerMembershipId").on(table.managerMembershipId),
  ]);

export const authSessionTable = sqliteTable("AuthSession", {
  id: text("id").primaryKey().notNull(),
  userId: text("userId").notNull(),
  refreshTokenHash: text("refreshTokenHash").notNull().unique(),
  familyId: text("familyId").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("lastUsedAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
  rotatedFromId: text("rotatedFromId"),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_AuthSession_userId_revokedAt_expiresAt").on(table.userId, table.revokedAt, table.expiresAt),
    index("idx_AuthSession_familyId").on(table.familyId),
  ]);

export const passwordResetTokenTable = sqliteTable("PasswordResetToken", {
  id: text("id").primaryKey().notNull(),
  userId: text("userId").notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("usedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_PasswordResetToken_userId_expiresAt").on(table.userId, table.expiresAt),
  ]);

export const mfaCredentialTable = sqliteTable("MfaCredential", {
  id: text("id").primaryKey().notNull(),
  userId: text("userId").notNull().unique(),
  encryptedSecret: text("encryptedSecret").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  verifiedAt: integer("verifiedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const mfaRecoveryCodeTable = sqliteTable("MfaRecoveryCode", {
  id: text("id").primaryKey().notNull(),
  mfaCredentialId: text("mfaCredentialId").notNull(),
  codeHash: text("codeHash").notNull().unique(),
  usedAt: integer("usedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_MfaRecoveryCode_mfaCredentialId_usedAt").on(table.mfaCredentialId, table.usedAt),
  ]);

export const employeeTable = sqliteTable("Employee", {
  id: text("id").primaryKey().notNull(),
  firstName: text("firstName").notNull(),
  lastName: text("lastName").notNull(),
  userId: text("userId").notNull().unique(),
  employeeNumber: text("employeeNumber"),
  employmentStatus: text("employmentStatus", { enum: ["ACTIVE","ON_LEAVE","TERMINATED"] }).notNull().default("ACTIVE"),
  joinDate: integer("joinDate", { mode: "timestamp_ms" }),
  terminationDate: integer("terminationDate", { mode: "timestamp_ms" }),
  departmentId: text("departmentId"),
  managerEmployeeId: text("managerEmployeeId"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_Employee_departmentId").on(table.departmentId),
    index("idx_Employee_managerEmployeeId").on(table.managerEmployeeId),
    index("idx_Employee_employmentStatus").on(table.employmentStatus),
  ]);

export const departmentTable = sqliteTable("Department", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  name: text("name").notNull(),
  code: text("code"),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_Department_clientId_name").on(table.clientId, table.name),
    uniqueIndex("uq_Department_clientId_code").on(table.clientId, table.code),
  ]);

export const workPolicyTable = sqliteTable("WorkPolicy", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull().unique(),
  gracePeriodMinutes: integer("gracePeriodMinutes").notNull().default(10),
  defaultBreakMinutes: integer("defaultBreakMinutes").notNull().default(60),
  roundingIncrement: integer("roundingIncrement").notNull().default(1),
  overtimeThreshold: integer("overtimeThreshold").notNull().default(480),
  maximumShiftMinutes: integer("maximumShiftMinutes").notNull().default(960),
  missedClockOutMinutes: integer("missedClockOutMinutes").notNull().default(960),
  maximumGpsAccuracy: integer("maximumGpsAccuracy").notNull().default(100),
  exactGpsRetentionDays: integer("exactGpsRetentionDays").notNull().default(90),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const shiftTemplateTable = sqliteTable("ShiftTemplate", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  name: text("name").notNull(),
  workDays: text("workDays", { mode: "json" }).$type<number[]>().notNull(),
  startTime: text("startTime").notNull(),
  endTime: text("endTime").notNull(),
  breakMinutes: integer("breakMinutes").notNull().default(60),
  gracePeriodMinutes: integer("gracePeriodMinutes").notNull().default(10),
  isOvernight: integer("isOvernight", { mode: "boolean" }).notNull().default(false),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_ShiftTemplate_clientId_name").on(table.clientId, table.name),
    index("idx_ShiftTemplate_clientId_isActive").on(table.clientId, table.isActive),
  ]);

export const scheduleAssignmentTable = sqliteTable("ScheduleAssignment", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  shiftTemplateId: text("shiftTemplateId").notNull(),
  effectiveFrom: text("effectiveFrom").notNull(),
  effectiveTo: text("effectiveTo"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_ScheduleAssignment_employeeId_effectiveFrom").on(table.employeeId, table.effectiveFrom),
    index("idx_ScheduleAssignment_shiftTemplateId_effectiveFrom_effectiveTo").on(table.shiftTemplateId, table.effectiveFrom, table.effectiveTo),
  ]);

export const holidayTable = sqliteTable("Holiday", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  date: text("date").notNull(),
  name: text("name").notNull(),
  stateCode: text("stateCode"),
  isWorkingDayOverride: integer("isWorkingDayOverride", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull().default("ORGANIZATION"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_Holiday_clientId_date_name").on(table.clientId, table.date, table.name),
    index("idx_Holiday_clientId_date").on(table.clientId, table.date),
  ]);

export const malaysiaHolidayTable = sqliteTable("MalaysiaHoliday", {
  id: text("id").primaryKey().notNull(),
  year: integer("year").notNull(),
  stateCode: text("stateCode").notNull(),
  date: text("date").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("public"),
  importedByUserId: text("importedByUserId"),
  importedAt: integer("importedAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    uniqueIndex("uq_MalaysiaHoliday_year_stateCode_date_name").on(table.year, table.stateCode, table.date, table.name),
    index("idx_MalaysiaHoliday_year_date_stateCode").on(table.year, table.date, table.stateCode),
  ]);

export const employeeScheduleTable = sqliteTable("EmployeeSchedule", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull().unique(),
  workDays: text("workDays", { mode: "json" }).$type<number[]>().notNull(),
  startTime: text("startTime").notNull(),
  endTime: text("endTime").notNull(),
  gracePeriodMinutes: integer("gracePeriodMinutes").notNull().default(10),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const attendanceRecordTable = sqliteTable("AttendanceRecord", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  workDate: text("workDate").notNull(),
  clockInAt: integer("clockInAt", { mode: "timestamp_ms" }).notNull(),
  clockOutAt: integer("clockOutAt", { mode: "timestamp_ms" }),
  clockInLatitude: real("clockInLatitude"),
  clockInLongitude: real("clockInLongitude"),
  clockInAccuracy: real("clockInAccuracy"),
  clockOutLatitude: real("clockOutLatitude"),
  clockOutLongitude: real("clockOutLongitude"),
  clockOutAccuracy: real("clockOutAccuracy"),
  status: text("status", { enum: ["CLOCKED_IN","CLOCKED_OUT"] }).notNull().default("CLOCKED_IN"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_AttendanceRecord_employeeId_workDate").on(table.employeeId, table.workDate),
    index("idx_AttendanceRecord_workDate").on(table.workDate),
  ]);

export const attendanceEventTable = sqliteTable("AttendanceEvent", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  clientId: text("clientId"),
  workDate: text("workDate").notNull(),
  type: text("type", { enum: ["CLOCK_IN","CLOCK_OUT","BREAK_START","BREAK_END"] }).notNull(),
  source: text("source", { enum: ["MOBILE_GPS","ADMIN_ADJUSTMENT","MIGRATION"] }).notNull().default("MOBILE_GPS"),
  occurredAt: integer("occurredAt", { mode: "timestamp_ms" }).notNull(),
  worksiteId: text("worksiteId"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  accuracyMeters: real("accuracyMeters"),
  distanceMeters: real("distanceMeters"),
  acceptedRadiusMeters: integer("acceptedRadiusMeters"),
  idempotencyKey: text("idempotencyKey").notNull(),
  createdByUserId: text("createdByUserId"),
  deviceDetails: text("deviceDetails", { mode: "json" }).$type<unknown>(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    uniqueIndex("uq_AttendanceEvent_employeeId_idempotencyKey").on(table.employeeId, table.idempotencyKey),
    index("idx_AttendanceEvent_employeeId_workDate_occurredAt").on(table.employeeId, table.workDate, table.occurredAt),
    index("idx_AttendanceEvent_clientId_workDate_occurredAt").on(table.clientId, table.workDate, table.occurredAt),
    index("idx_AttendanceEvent_worksiteId").on(table.worksiteId),
    index("idx_AttendanceEvent_createdByUserId").on(table.createdByUserId),
  ]);

export const webhookDeliveryTable = sqliteTable("WebhookDelivery", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  attendanceEventId: text("attendanceEventId").notNull().unique(),
  eventType: text("eventType").notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
  status: text("status", { enum: ["PENDING","RETRYING","DELIVERED","DEAD_LETTER"] }).notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: integer("lastAttemptAt", { mode: "timestamp_ms" }),
  responseStatus: integer("responseStatus"),
  lastError: text("lastError"),
  deliveredAt: integer("deliveredAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_WebhookDelivery_clientId_status_createdAt").on(table.clientId, table.status, table.createdAt),
    index("idx_WebhookDelivery_status_createdAt").on(table.status, table.createdAt),
  ]);

export const timesheetDayTable = sqliteTable("TimesheetDay", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  clientId: text("clientId"),
  workDate: text("workDate").notNull(),
  state: text("state", { enum: ["OPEN","COMPLETE","EXCEPTION","APPROVED","LOCKED"] }).notNull().default("OPEN"),
  firstClockInAt: integer("firstClockInAt", { mode: "timestamp_ms" }),
  lastClockOutAt: integer("lastClockOutAt", { mode: "timestamp_ms" }),
  regularMinutes: integer("regularMinutes").notNull().default(0),
  overtimeMinutes: integer("overtimeMinutes").notNull().default(0),
  breakMinutes: integer("breakMinutes").notNull().default(0),
  lateMinutes: integer("lateMinutes").notNull().default(0),
  earlyDepartureMinutes: integer("earlyDepartureMinutes").notNull().default(0),
  leaveMinutes: integer("leaveMinutes").notNull().default(0),
  paidLeaveMinutes: integer("paidLeaveMinutes").notNull().default(0),
  unpaidLeaveMinutes: integer("unpaidLeaveMinutes").notNull().default(0),
  isAbsent: integer("isAbsent", { mode: "boolean" }).notNull().default(false),
  exceptionCodes: text("exceptionCodes", { mode: "json" }).$type<string[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  approvedAt: integer("approvedAt", { mode: "timestamp_ms" }),
  lockedAt: integer("lockedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  payPeriodId: text("payPeriodId"),
}, (table) => [
    uniqueIndex("uq_TimesheetDay_employeeId_workDate").on(table.employeeId, table.workDate),
    index("idx_TimesheetDay_clientId_workDate_state").on(table.clientId, table.workDate, table.state),
    index("idx_TimesheetDay_payPeriodId").on(table.payPeriodId),
  ]);

export const attendanceCorrectionTable = sqliteTable("AttendanceCorrection", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  timesheetDayId: text("timesheetDayId").notNull(),
  reason: text("reason").notNull(),
  note: text("note"),
  originalValues: text("originalValues", { mode: "json" }).$type<unknown>().notNull(),
  requestedValues: text("requestedValues", { mode: "json" }).$type<unknown>().notNull(),
  status: text("status", { enum: ["PENDING","APPROVED","REJECTED","CANCELLED"] }).notNull().default("PENDING"),
  reviewedByUserId: text("reviewedByUserId"),
  reviewNote: text("reviewNote"),
  reviewedAt: integer("reviewedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_AttendanceCorrection_employeeId_status_createdAt").on(table.employeeId, table.status, table.createdAt),
    index("idx_AttendanceCorrection_timesheetDayId_status").on(table.timesheetDayId, table.status),
  ]);

export const payPeriodTable = sqliteTable("PayPeriod", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  name: text("name").notNull(),
  startDate: text("startDate").notNull(),
  endDate: text("endDate").notNull(),
  status: text("status", { enum: ["DRAFT","REVIEWED","APPROVED","LOCKED","EXPORTED"] }).notNull().default("DRAFT"),
  reviewedByUserId: text("reviewedByUserId"),
  reviewedAt: integer("reviewedAt", { mode: "timestamp_ms" }),
  reviewedCalculationRunId: text("reviewedCalculationRunId"),
  approvedByUserId: text("approvedByUserId"),
  approvedAt: integer("approvedAt", { mode: "timestamp_ms" }),
  approvedCalculationRunId: text("approvedCalculationRunId"),
  lockedByUserId: text("lockedByUserId"),
  lockedAt: integer("lockedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_PayPeriod_clientId_startDate_endDate").on(table.clientId, table.startDate, table.endDate),
    index("idx_PayPeriod_clientId_status_startDate").on(table.clientId, table.status, table.startDate),
  ]);

export const payrollSettingsTable = sqliteTable("PayrollSettings", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull().unique(),
  jurisdiction: text("jurisdiction", { enum: ["PENINSULAR_LABUAN","SABAH","SARAWAK"] }).notNull().default("PENINSULAR_LABUAN"),
  currency: text("currency").notNull().default("MYR"),
  payFrequency: text("payFrequency", { enum: ["MONTHLY","SEMI_MONTHLY","WEEKLY"] }).notNull().default("MONTHLY"),
  normalDailyMinutes: integer("normalDailyMinutes").notNull().default(480),
  normalWeeklyMinutes: integer("normalWeeklyMinutes").notNull().default(2700),
  salaryDivisor: integer("salaryDivisor").notNull().default(26),
  rulePackVersion: text("rulePackVersion").notNull().default("MY-PEN-2023-01"),
  statutoryContributionsEnabled: integer("statutoryContributionsEnabled", { mode: "boolean" }).notNull().default(false),
  statutoryRuleVersion: text("statutoryRuleVersion").notNull().default("MY-STAT-2025-10-01"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const payProfileTable = sqliteTable("PayProfile", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  payType: text("payType", { enum: ["MONTHLY","DAILY","HOURLY"] }).notNull(),
  baseRateSen: integer("baseRateSen").notNull(),
  normalDailyMinutes: integer("normalDailyMinutes").notNull(),
  normalWeeklyMinutes: integer("normalWeeklyMinutes").notNull(),
  overtimeEligible: integer("overtimeEligible", { mode: "boolean" }).notNull().default(true),
  effectiveFrom: text("effectiveFrom").notNull(),
  effectiveTo: text("effectiveTo"),
  createdByUserId: text("createdByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_PayProfile_employeeId_effectiveFrom").on(table.employeeId, table.effectiveFrom),
    index("idx_PayProfile_employeeId_effectiveFrom_effectiveTo").on(table.employeeId, table.effectiveFrom, table.effectiveTo),
  ]);

export const employeeStatutoryProfileTable = sqliteTable("EmployeeStatutoryProfile", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  epfCategory: text("epfCategory", { enum: ["STANDARD_UNDER_60","PR_OR_PRE_1998_60_PLUS","MALAYSIAN_60_PLUS","NON_MALAYSIAN","EXEMPT"] }).notNull(),
  socsoCategory: text("socsoCategory", { enum: ["FIRST","SECOND","EXEMPT"] }).notNull(),
  eisEligible: integer("eisEligible", { mode: "boolean" }).notNull().default(true),
  effectiveFrom: text("effectiveFrom").notNull(),
  effectiveTo: text("effectiveTo"),
  createdByUserId: text("createdByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_EmployeeStatutoryProfile_employeeId_effectiveFrom").on(table.employeeId, table.effectiveFrom),
    index("idx_EmployeeStatutoryProfile_employeeId_effectiveFrom_effectiveTo").on(table.employeeId, table.effectiveFrom, table.effectiveTo),
  ]);

export const payrollComponentTable = sqliteTable("PayrollComponent", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: ["EARNING","DEDUCTION","ADVANCE_REPAYMENT"] }).notNull(),
  calculationBasis: text("calculationBasis", { enum: ["FIXED_AMOUNT","PER_DAY","PER_HOUR","PERCENTAGE"] }).notNull(),
  defaultAmountSen: integer("defaultAmountSen").notNull().default(0),
  defaultPercentageBps: integer("defaultPercentageBps"),
  epfEligible: integer("epfEligible", { mode: "boolean" }).notNull().default(true),
  socsoEligible: integer("socsoEligible", { mode: "boolean" }).notNull().default(true),
  eisEligible: integer("eisEligible", { mode: "boolean" }).notNull().default(true),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_PayrollComponent_clientId_code").on(table.clientId, table.code),
    index("idx_PayrollComponent_clientId_type_isActive").on(table.clientId, table.type, table.isActive),
  ]);

export const employeePayComponentTable = sqliteTable("EmployeePayComponent", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  employeeId: text("employeeId").notNull(),
  payrollComponentId: text("payrollComponentId").notNull(),
  amountSen: integer("amountSen").notNull().default(0),
  percentageBasisPoints: integer("percentageBasisPoints"),
  totalAmountSen: integer("totalAmountSen"),
  outstandingAmountSen: integer("outstandingAmountSen"),
  effectiveFrom: text("effectiveFrom").notNull(),
  effectiveTo: text("effectiveTo"),
  consentReference: text("consentReference"),
  notes: text("notes"),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdByUserId: text("createdByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_EmployeePayComponent_employeeId_payrollComponentId_effectiveFrom").on(table.employeeId, table.payrollComponentId, table.effectiveFrom),
    index("idx_EmployeePayComponent_clientId_employeeId_isActive").on(table.clientId, table.employeeId, table.isActive),
    index("idx_EmployeePayComponent_payrollComponentId_effectiveFrom_effectiveTo").on(table.payrollComponentId, table.effectiveFrom, table.effectiveTo),
  ]);

export const payrollCalculationRunTable = sqliteTable("PayrollCalculationRun", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  payPeriodId: text("payPeriodId").notNull(),
  version: integer("version").notNull(),
  status: text("status", { enum: ["DRAFT","LOCKED"] }).notNull().default("DRAFT"),
  rulePackVersion: text("rulePackVersion").notNull(),
  inputHash: text("inputHash").notNull(),
  totalGrossSen: integer("totalGrossSen").notNull().default(0),
  totalDeductionsSen: integer("totalDeductionsSen").notNull().default(0),
  totalCalculatedPaySen: integer("totalCalculatedPaySen").notNull().default(0),
  expectedEmployeeCount: integer("expectedEmployeeCount").notNull().default(0),
  warningCount: integer("warningCount").notNull().default(0),
  blockingWarningCount: integer("blockingWarningCount").notNull().default(0),
  calculatedByUserId: text("calculatedByUserId").notNull(),
  lockedAt: integer("lockedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    uniqueIndex("uq_PayrollCalculationRun_payPeriodId_version").on(table.payPeriodId, table.version),
    index("idx_PayrollCalculationRun_clientId_createdAt").on(table.clientId, table.createdAt),
    index("idx_PayrollCalculationRun_payPeriodId_status_version").on(table.payPeriodId, table.status, table.version),
  ]);

export const payrollCalculationResultTable = sqliteTable("PayrollCalculationResult", {
  id: text("id").primaryKey().notNull(),
  runId: text("runId").notNull(),
  employeeId: text("employeeId").notNull(),
  basePaySen: integer("basePaySen").notNull().default(0),
  regularPaySen: integer("regularPaySen").notNull().default(0),
  overtimePaySen: integer("overtimePaySen").notNull().default(0),
  restDayPaySen: integer("restDayPaySen").notNull().default(0),
  publicHolidayPaySen: integer("publicHolidayPaySen").notNull().default(0),
  paidLeavePaySen: integer("paidLeavePaySen").notNull().default(0),
  unpaidLeaveDeductionSen: integer("unpaidLeaveDeductionSen").notNull().default(0),
  additionalEarningsSen: integer("additionalEarningsSen").notNull().default(0),
  otherDeductionsSen: integer("otherDeductionsSen").notNull().default(0),
  advanceDeductionSen: integer("advanceDeductionSen").notNull().default(0),
  epfWagesSen: integer("epfWagesSen").notNull().default(0),
  socsoWagesSen: integer("socsoWagesSen").notNull().default(0),
  eisWagesSen: integer("eisWagesSen").notNull().default(0),
  epfEmployeeSen: integer("epfEmployeeSen").notNull().default(0),
  epfEmployerSen: integer("epfEmployerSen").notNull().default(0),
  socsoEmployeeSen: integer("socsoEmployeeSen").notNull().default(0),
  socsoEmployerSen: integer("socsoEmployerSen").notNull().default(0),
  eisEmployeeSen: integer("eisEmployeeSen").notNull().default(0),
  eisEmployerSen: integer("eisEmployerSen").notNull().default(0),
  employerContributionsSen: integer("employerContributionsSen").notNull().default(0),
  grossPaySen: integer("grossPaySen").notNull().default(0),
  totalDeductionsSen: integer("totalDeductionsSen").notNull().default(0),
  calculatedPaySen: integer("calculatedPaySen").notNull().default(0),
  warnings: text("warnings", { mode: "json" }).$type<string[]>().notNull().default([]),
  blockingWarnings: text("blockingWarnings", { mode: "json" }).$type<string[]>().notNull().default([]),
  payProfileSnapshot: text("payProfileSnapshot", { mode: "json" }).$type<unknown>(),
  inputSummary: text("inputSummary", { mode: "json" }).$type<unknown>().notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    uniqueIndex("uq_PayrollCalculationResult_runId_employeeId").on(table.runId, table.employeeId),
    index("idx_PayrollCalculationResult_employeeId_createdAt").on(table.employeeId, table.createdAt),
  ]);

export const payrollWarningAcknowledgementTable = sqliteTable("PayrollWarningAcknowledgement", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  calculationResultId: text("calculationResultId").notNull(),
  warningCode: text("warningCode").notNull(),
  note: text("note").notNull(),
  acknowledgedByUserId: text("acknowledgedByUserId").notNull(),
  acknowledgedByUsername: text("acknowledgedByUsername").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    uniqueIndex("uq_PayrollWarningAcknowledgement_calculationResultId_warningCode").on(table.calculationResultId, table.warningCode),
    index("idx_PayrollWarningAcknowledgement_clientId_createdAt").on(table.clientId, table.createdAt),
    index("idx_PayrollWarningAcknowledgement_acknowledgedByUserId_createdAt").on(table.acknowledgedByUserId, table.createdAt),
  ]);

export const payrollCalculationLineTable = sqliteTable("PayrollCalculationLine", {
  id: text("id").primaryKey().notNull(),
  resultId: text("resultId").notNull(),
  direction: text("direction", { enum: ["EARNING","DEDUCTION","EMPLOYER_CONTRIBUTION"] }).notNull(),
  category: text("category", { enum: ["BASE_PAY","REGULAR_PAY","OVERTIME","REST_DAY","PUBLIC_HOLIDAY","PAID_LEAVE","UNPAID_LEAVE","ALLOWANCE","DEDUCTION","ADVANCE_REPAYMENT","EPF","SOCSO","EIS"] }).notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  amountSen: integer("amountSen").notNull(),
  basis: text("basis").notNull(),
  sourceComponentAssignmentId: text("sourceComponentAssignmentId"),
  metadata: text("metadata", { mode: "json" }).$type<unknown>(),
  displayOrder: integer("displayOrder").notNull().default(0),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_PayrollCalculationLine_resultId_displayOrder").on(table.resultId, table.displayOrder),
    index("idx_PayrollCalculationLine_sourceComponentAssignmentId").on(table.sourceComponentAssignmentId),
  ]);

export const payrollMonetaryAdjustmentTable = sqliteTable("PayrollMonetaryAdjustment", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  payPeriodId: text("payPeriodId").notNull(),
  calculationResultId: text("calculationResultId").notNull(),
  employeeId: text("employeeId").notNull(),
  direction: text("direction", { enum: ["EARNING","DEDUCTION"] }).notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  amountSen: integer("amountSen").notNull(),
  reason: text("reason").notNull(),
  createdByUserId: text("createdByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_PayrollMonetaryAdjustment_clientId_payPeriodId_createdAt").on(table.clientId, table.payPeriodId, table.createdAt),
    index("idx_PayrollMonetaryAdjustment_employeeId_payPeriodId_createdAt").on(table.employeeId, table.payPeriodId, table.createdAt),
    index("idx_PayrollMonetaryAdjustment_calculationResultId_createdAt").on(table.calculationResultId, table.createdAt),
  ]);

export const payrollMonetaryAdjustmentDecisionTable = sqliteTable("PayrollMonetaryAdjustmentDecision", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  adjustmentId: text("adjustmentId").notNull().unique(),
  outcome: text("outcome", { enum: ["APPROVED","REJECTED"] }).notNull(),
  note: text("note").notNull(),
  decidedByUserId: text("decidedByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_PayrollMonetaryAdjustmentDecision_clientId_outcome_createdAt").on(table.clientId, table.outcome, table.createdAt),
    index("idx_PayrollMonetaryAdjustmentDecision_decidedByUserId_createdAt").on(table.decidedByUserId, table.createdAt),
  ]);

export const payrollStatementDeliveryTable = sqliteTable("PayrollStatementDelivery", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  payPeriodId: text("payPeriodId").notNull(),
  calculationResultId: text("calculationResultId").notNull(),
  employeeId: text("employeeId").notNull(),
  recipientEmail: text("recipientEmail").notNull(),
  language: text("language").notNull().default("en"),
  fileName: text("fileName").notNull(),
  status: text("status", { enum: ["SENT","FAILED"] }).notNull(),
  providerMessageId: text("providerMessageId"),
  failureReason: text("failureReason"),
  requestedByUserId: text("requestedByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_PayrollStatementDelivery_clientId_payPeriodId_createdAt").on(table.clientId, table.payPeriodId, table.createdAt),
    index("idx_PayrollStatementDelivery_employeeId_payPeriodId_createdAt").on(table.employeeId, table.payPeriodId, table.createdAt),
    index("idx_PayrollStatementDelivery_requestedByUserId_createdAt").on(table.requestedByUserId, table.createdAt),
  ]);

export const payrollAdjustmentTable = sqliteTable("PayrollAdjustment", {
  id: text("id").primaryKey().notNull(),
  payPeriodId: text("payPeriodId").notNull(),
  timesheetDayId: text("timesheetDayId").notNull(),
  correctionId: text("correctionId").unique(),
  adjustmentType: text("adjustmentType").notNull(),
  minutes: integer("minutes").notNull().default(0),
  reason: text("reason").notNull(),
  beforeValues: text("beforeValues", { mode: "json" }).$type<unknown>().notNull(),
  afterValues: text("afterValues", { mode: "json" }).$type<unknown>().notNull(),
  createdByUserId: text("createdByUserId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_PayrollAdjustment_payPeriodId_createdAt").on(table.payPeriodId, table.createdAt),
    index("idx_PayrollAdjustment_timesheetDayId").on(table.timesheetDayId),
  ]);

export const exportJobTable = sqliteTable("ExportJob", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  payPeriodId: text("payPeriodId").notNull(),
  format: text("format", { enum: ["CSV","XLSX"] }).notNull(),
  status: text("status", { enum: ["PENDING","PROCESSING","COMPLETED","FAILED","EXPIRED"] }).notNull().default("PENDING"),
  template: text("template", { mode: "json" }).$type<unknown>(),
  r2Key: text("r2Key"),
  fileName: text("fileName"),
  contentType: text("contentType"),
  fileSizeBytes: integer("fileSizeBytes"),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }),
  lastError: text("lastError"),
  requestedByUserId: text("requestedByUserId").notNull(),
  completedAt: integer("completedAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_ExportJob_clientId_status_createdAt").on(table.clientId, table.status, table.createdAt),
    index("idx_ExportJob_payPeriodId_createdAt").on(table.payPeriodId, table.createdAt),
  ]);

export const notificationTable = sqliteTable("Notification", {
  id: text("id").primaryKey().notNull(),
  userId: text("userId").notNull(),
  clientId: text("clientId"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  entityType: text("entityType"),
  entityId: text("entityId"),
  readAt: integer("readAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_Notification_userId_readAt_createdAt").on(table.userId, table.readAt, table.createdAt),
    index("idx_Notification_clientId_createdAt").on(table.clientId, table.createdAt),
  ]);

export const leaveTypeTable = sqliteTable("LeaveType", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isPaid: integer("isPaid", { mode: "boolean" }).notNull().default(true),
  defaultEntitlementMinutes: integer("defaultEntitlementMinutes").notNull().default(0),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_LeaveType_clientId_code").on(table.clientId, table.code),
  ]);

export const leaveBalanceTable = sqliteTable("LeaveBalance", {
  id: text("id").primaryKey().notNull(),
  employeeId: text("employeeId").notNull(),
  leaveTypeId: text("leaveTypeId").notNull(),
  year: integer("year").notNull(),
  entitledMinutes: integer("entitledMinutes").notNull().default(0),
  usedMinutes: integer("usedMinutes").notNull().default(0),
  pendingMinutes: integer("pendingMinutes").notNull().default(0),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    uniqueIndex("uq_LeaveBalance_employeeId_leaveTypeId_year").on(table.employeeId, table.leaveTypeId, table.year),
  ]);

export const leaveRequestTable = sqliteTable("LeaveRequest", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  employeeId: text("employeeId").notNull(),
  leaveTypeId: text("leaveTypeId").notNull(),
  startDate: text("startDate").notNull(),
  endDate: text("endDate").notNull(),
  requestedMinutes: integer("requestedMinutes").notNull(),
  reason: text("reason"),
  status: text("status", { enum: ["PENDING","APPROVED","REJECTED","CANCELLED"] }).notNull().default("PENDING"),
  reviewedByUserId: text("reviewedByUserId"),
  reviewNote: text("reviewNote"),
  reviewedAt: integer("reviewedAt", { mode: "timestamp_ms" }),
  cancelledAt: integer("cancelledAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_LeaveRequest_clientId_status_startDate").on(table.clientId, table.status, table.startDate),
    index("idx_LeaveRequest_employeeId_status_startDate").on(table.employeeId, table.status, table.startDate),
  ]);

export const leaveAllocationTable = sqliteTable("LeaveAllocation", {
  id: text("id").primaryKey().notNull(),
  leaveRequestId: text("leaveRequestId").notNull(),
  timesheetDayId: text("timesheetDayId").notNull(),
  workDate: text("workDate").notNull(),
  scheduledMinutes: integer("scheduledMinutes").notNull(),
  minutes: integer("minutes").notNull(),
  paidMinutes: integer("paidMinutes").notNull().default(0),
  unpaidMinutes: integer("unpaidMinutes").notNull().default(0),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    uniqueIndex("uq_LeaveAllocation_leaveRequestId_workDate").on(table.leaveRequestId, table.workDate),
    index("idx_LeaveAllocation_timesheetDayId").on(table.timesheetDayId),
    index("idx_LeaveAllocation_workDate").on(table.workDate),
  ]);

export const worksiteTable = sqliteTable("Worksite", {
  id: text("id").primaryKey().notNull(),
  clientId: text("clientId").notNull(),
  ownerAdminId: text("ownerAdminId"),
  name: text("name").notNull(),
  stateCode: text("stateCode").notNull().default("14"),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  radiusMeters: integer("radiusMeters").notNull().default(150),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
    index("idx_Worksite_clientId_ownerAdminId_isActive").on(table.clientId, table.ownerAdminId, table.isActive),
  ]);

export const auditLogTable = sqliteTable("AuditLog", {
  id: text("id").primaryKey().notNull(),
  actorUserId: text("actorUserId").notNull(),
  clientId: text("clientId"),
  action: text("action").notNull(),
  entityType: text("entityType").notNull(),
  entityId: text("entityId").notNull(),
  details: text("details", { mode: "json" }).$type<unknown>(),
  requestId: text("requestId"),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
    index("idx_AuditLog_entityType_entityId_createdAt").on(table.entityType, table.entityId, table.createdAt),
    index("idx_AuditLog_actorUserId_createdAt").on(table.actorUserId, table.createdAt),
    index("idx_AuditLog_clientId_createdAt").on(table.clientId, table.createdAt),
  ]);
