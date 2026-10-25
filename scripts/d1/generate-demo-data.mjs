import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = path.join(root, "d1", "data", "demo-data.sql");
const generatedAt = new Date("2026-10-24T12:00:00+08:00");
const generatedAtMs = generatedAt.getTime();

const raw = (value) => ({ raw: value });
const json = (value) => JSON.stringify(value);

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlValue(value) {
  if (value && typeof value === "object" && "raw" in value) return value.raw;
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insert(table, values) {
  const columns = Object.keys(values).map(quoteIdentifier).join(", ");
  const serialized = Object.values(values).map(sqlValue).join(", ");
  return `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${columns}) VALUES (${serialized});`;
}

function update(table, values, where) {
  const assignments = Object.entries(values)
    .map(([column, value]) => `${quoteIdentifier(column)} = ${sqlValue(value)}`)
    .join(", ");
  return `UPDATE ${quoteIdentifier(table)} SET ${assignments} WHERE ${where};`;
}

function byUsername(column, username, table = "User") {
  return raw(`(SELECT ${quoteIdentifier(column)} FROM ${quoteIdentifier(table)} WHERE "username" = ${sqlValue(username)} LIMIT 1)`);
}

function employeeId(username) {
  return raw(`(SELECT e."id" FROM "Employee" e JOIN "User" u ON u."id" = e."userId" WHERE u."username" = ${sqlValue(username)} LIMIT 1)`);
}

function leaveTypeId(clientId, code) {
  return raw(`(SELECT "id" FROM "LeaveType" WHERE "clientId" = ${sqlValue(clientId)} AND "code" = ${sqlValue(code)} LIMIT 1)`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function eachDate(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const final = new Date(`${end}T00:00:00Z`);
  while (cursor <= final) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isWeekday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function localTime(date, time, dayOffset = 0) {
  return new Date(new Date(`${date}T${time}:00+08:00`).getTime() + dayOffset * 86_400_000);
}

function stableId(...parts) {
  return `demo-${parts.join("-").replaceAll(/[^a-zA-Z0-9-]/g, "-")}`;
}

function moneyLines(resultId, amounts, assignmentIds) {
  const rows = [];
  let order = 1;
  const add = (direction, category, code, name, amountSen, basis, assignmentId = null) => {
    if (!amountSen) return;
    rows.push(insert("PayrollCalculationLine", {
      id: stableId("line", resultId, code),
      resultId,
      direction,
      category,
      code,
      name,
      amountSen,
      basis,
      sourceComponentAssignmentId: assignmentId,
      metadata: json({ demo: true }),
      displayOrder: order++,
      createdAt: generatedAtMs,
    }));
  };
  add("EARNING", "BASE_PAY", "BASE_PAY", "Monthly base pay", amounts.base, "Monthly pay profile");
  add("EARNING", "OVERTIME", "OVERTIME", "Approved overtime", amounts.overtime, "Attendance-derived overtime");
  add("EARNING", "ALLOWANCE", "TRANSPORT", "Transport allowance", amounts.allowance, "Fixed monthly allowance", assignmentIds.allowance);
  add("DEDUCTION", "ADVANCE_REPAYMENT", "ADVANCE", "Salary advance repayment", amounts.advance, "Employee-authorized repayment", assignmentIds.advance);
  add("DEDUCTION", "EPF", "EPF_EMPLOYEE", "EPF employee contribution", amounts.epfEmployee, "October 2025 contribution schedule");
  add("DEDUCTION", "SOCSO", "SOCSO_EMPLOYEE", "SOCSO employee contribution", amounts.socsoEmployee, "Contribution table");
  add("DEDUCTION", "EIS", "EIS_EMPLOYEE", "EIS employee contribution", amounts.eisEmployee, "Contribution table");
  add("EMPLOYER_CONTRIBUTION", "EPF", "EPF_EMPLOYER", "EPF employer contribution", amounts.epfEmployer, "October 2025 contribution schedule");
  add("EMPLOYER_CONTRIBUTION", "SOCSO", "SOCSO_EMPLOYER", "SOCSO employer contribution", amounts.socsoEmployer, "Contribution table");
  add("EMPLOYER_CONTRIBUTION", "EIS", "EIS_EMPLOYER", "EIS employer contribution", amounts.eisEmployer, "Contribution table");
  return rows;
}

const organizations = [
  {
    id: "aurora-services",
    name: "Aurora Services",
    admin: "aurora.admin",
    coordinates: { latitude: 3.139, longitude: 101.6869 },
    employees: [
      { username: "aurora.employee1", shift: "day", salary: 320_000, leaveDate: "2026-09-18", leaveCode: "ANNUAL", absenceDate: "2026-10-05", correctionDate: "2026-10-08", correctionStatus: "PENDING" },
      { username: "aurora.employee2", shift: "night", salary: 360_000, leaveDate: "2026-10-02", leaveCode: "SICK", absenceDate: null, correctionDate: "2026-09-10", correctionStatus: "APPROVED" },
    ],
  },
  {
    id: "meridian-works",
    name: "Meridian Works",
    admin: "meridian.admin",
    coordinates: { latitude: 3.1073, longitude: 101.6067 },
    employees: [
      { username: "meridian.employee1", shift: "day", salary: 340_000, leaveDate: "2026-09-25", leaveCode: "ANNUAL", absenceDate: "2026-10-12", correctionDate: "2026-10-13", correctionStatus: "REJECTED" },
      { username: "meridian.employee2", shift: "night", salary: 380_000, leaveDate: "2026-09-08", leaveCode: "SICK", absenceDate: null, correctionDate: "2026-09-22", correctionStatus: "APPROVED" },
    ],
  },
];

const statements = [
  "PRAGMA foreign_keys = ON;",
  "-- Repeatable demo fixtures for 1 September through 23 October 2026.",
];

for (const organization of organizations) {
  const adminId = byUsername("id", organization.admin);
  const departmentId = stableId(organization.id, "operations");
  const worksiteId = stableId(organization.id, "worksite");
  const dayShiftId = stableId(organization.id, "day-shift");
  const nightShiftId = stableId(organization.id, "night-shift");
  const septemberPeriodId = stableId(organization.id, "period-2026-09");
  const octoberPeriodId = stableId(organization.id, "period-2026-10");
  const payrollRunId = stableId(organization.id, "run-2026-09-v1");
  const allowanceComponentId = stableId(organization.id, "component-transport");
  const advanceComponentId = stableId(organization.id, "component-advance");

  statements.push(insert("Department", {
    id: departmentId,
    clientId: organization.id,
    name: "Operations",
    code: "OPS",
    isActive: true,
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("Worksite", {
    id: worksiteId,
    clientId: organization.id,
    ownerAdminId: adminId,
    name: `${organization.name} Main Office`,
    latitude: organization.coordinates.latitude,
    longitude: organization.coordinates.longitude,
    radiusMeters: 180,
    isActive: true,
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("ShiftTemplate", {
    id: dayShiftId,
    clientId: organization.id,
    name: "Weekday Day Shift",
    workDays: json([1, 2, 3, 4, 5]),
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: 60,
    gracePeriodMinutes: 10,
    isOvernight: false,
    isActive: true,
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("ShiftTemplate", {
    id: nightShiftId,
    clientId: organization.id,
    name: "Weekday Overnight Shift",
    workDays: json([1, 2, 3, 4, 5]),
    startTime: "22:00",
    endTime: "07:00",
    breakMinutes: 60,
    gracePeriodMinutes: 10,
    isOvernight: true,
    isActive: true,
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("Holiday", {
    id: stableId(organization.id, "holiday-malaysia-day-2026"),
    clientId: organization.id,
    date: "2026-09-16",
    name: "Malaysia Day",
    stateCode: null,
    isWorkingDayOverride: false,
    source: "FEDERAL",
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("PayrollSettings", {
    id: stableId(organization.id, "payroll-settings"),
    clientId: organization.id,
    jurisdiction: "PENINSULAR_LABUAN",
    currency: "MYR",
    payFrequency: "MONTHLY",
    normalDailyMinutes: 480,
    normalWeeklyMinutes: 2_400,
    salaryDivisor: 26,
    rulePackVersion: "MY-PEN-2023-01",
    statutoryContributionsEnabled: true,
    statutoryRuleVersion: "MY-STAT-2025-10-01",
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("PayrollComponent", {
    id: allowanceComponentId,
    clientId: organization.id,
    code: "TRANSPORT",
    name: "Transport allowance",
    type: "EARNING",
    calculationBasis: "FIXED_AMOUNT",
    defaultAmountSen: 15_000,
    defaultPercentageBps: null,
    epfEligible: true,
    socsoEligible: true,
    eisEligible: true,
    isActive: true,
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("PayrollComponent", {
    id: advanceComponentId,
    clientId: organization.id,
    code: "ADVANCE",
    name: "Salary advance repayment",
    type: "ADVANCE_REPAYMENT",
    calculationBasis: "FIXED_AMOUNT",
    defaultAmountSen: 20_000,
    defaultPercentageBps: null,
    epfEligible: false,
    socsoEligible: false,
    eisEligible: false,
    isActive: true,
    createdAt: generatedAtMs,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("PayPeriod", {
    id: septemberPeriodId,
    clientId: organization.id,
    name: "September 2026",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    status: "LOCKED",
    reviewedByUserId: adminId,
    reviewedAt: generatedAtMs - 10 * 86_400_000,
    reviewedCalculationRunId: payrollRunId,
    approvedByUserId: adminId,
    approvedAt: generatedAtMs - 9 * 86_400_000,
    approvedCalculationRunId: payrollRunId,
    lockedByUserId: adminId,
    lockedAt: generatedAtMs - 8 * 86_400_000,
    createdAt: generatedAtMs - 24 * 86_400_000,
    updatedAt: generatedAtMs - 8 * 86_400_000,
  }));
  statements.push(insert("PayPeriod", {
    id: octoberPeriodId,
    clientId: organization.id,
    name: "October 2026",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    status: "DRAFT",
    reviewedByUserId: null,
    reviewedAt: null,
    reviewedCalculationRunId: null,
    approvedByUserId: null,
    approvedAt: null,
    approvedCalculationRunId: null,
    lockedByUserId: null,
    lockedAt: null,
    createdAt: generatedAtMs - 23 * 86_400_000,
    updatedAt: generatedAtMs,
  }));
  statements.push(insert("PayrollCalculationRun", {
    id: payrollRunId,
    clientId: organization.id,
    payPeriodId: septemberPeriodId,
    version: 1,
    status: "LOCKED",
    rulePackVersion: "MY-PEN-2023-01",
    inputHash: stableId(organization.id, "2026-09-input"),
    totalGrossSen: 0,
    totalDeductionsSen: 0,
    totalCalculatedPaySen: 0,
    warningCount: 0,
    blockingWarningCount: 0,
    calculatedByUserId: adminId,
    lockedAt: generatedAtMs - 8 * 86_400_000,
    createdAt: generatedAtMs - 11 * 86_400_000,
  }));

  let payrollTotals = { gross: 0, deductions: 0, net: 0, warnings: 0 };

  for (let employeeIndex = 0; employeeIndex < organization.employees.length; employeeIndex += 1) {
    const employee = organization.employees[employeeIndex];
    const employeeRef = employeeId(employee.username);
    const userId = byUsername("id", employee.username);
    const shiftId = employee.shift === "night" ? nightShiftId : dayShiftId;
    const scheduleId = stableId(employee.username, "schedule-2026-09");
    const allowanceAssignmentId = stableId(employee.username, "transport-2026");
    const advanceAssignmentId = stableId(employee.username, "advance-2026");

    statements.push(update("Employee", {
      departmentId,
      joinDate: new Date("2026-08-01T00:00:00+08:00"),
      updatedAt: generatedAtMs,
    }, `"id" = ${sqlValue(employeeRef)}`));
    statements.push(insert("EmployeeSchedule", {
      id: stableId(employee.username, "legacy-schedule"),
      employeeId: employeeRef,
      workDays: json([1, 2, 3, 4, 5]),
      startTime: employee.shift === "night" ? "22:00" : "09:00",
      endTime: employee.shift === "night" ? "07:00" : "18:00",
      gracePeriodMinutes: 10,
      isActive: true,
      createdAt: generatedAtMs,
      updatedAt: generatedAtMs,
    }));
    statements.push(insert("ScheduleAssignment", {
      id: scheduleId,
      employeeId: employeeRef,
      shiftTemplateId: shiftId,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      createdAt: generatedAtMs,
      updatedAt: generatedAtMs,
    }));
    statements.push(insert("PayProfile", {
      id: stableId(employee.username, "pay-profile-2026"),
      employeeId: employeeRef,
      payType: "MONTHLY",
      baseRateSen: employee.salary,
      normalDailyMinutes: 480,
      normalWeeklyMinutes: 2_400,
      overtimeEligible: true,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      createdByUserId: adminId,
      createdAt: generatedAtMs,
      updatedAt: generatedAtMs,
    }));
    statements.push(insert("EmployeeStatutoryProfile", {
      id: stableId(employee.username, "statutory-2026"),
      employeeId: employeeRef,
      epfCategory: "STANDARD_UNDER_60",
      socsoCategory: "FIRST",
      eisEligible: true,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      createdByUserId: adminId,
      createdAt: generatedAtMs,
      updatedAt: generatedAtMs,
    }));
    statements.push(insert("EmployeePayComponent", {
      id: allowanceAssignmentId,
      clientId: organization.id,
      employeeId: employeeRef,
      payrollComponentId: allowanceComponentId,
      amountSen: 15_000,
      percentageBasisPoints: null,
      totalAmountSen: null,
      outstandingAmountSen: null,
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      consentReference: null,
      notes: "Monthly transport allowance demo",
      isActive: true,
      createdByUserId: adminId,
      createdAt: generatedAtMs,
      updatedAt: generatedAtMs,
    }));
    if (employeeIndex === 1) {
      statements.push(insert("EmployeePayComponent", {
        id: advanceAssignmentId,
        clientId: organization.id,
        employeeId: employeeRef,
        payrollComponentId: advanceComponentId,
        amountSen: 20_000,
        percentageBasisPoints: null,
        totalAmountSen: 60_000,
        outstandingAmountSen: 40_000,
        effectiveFrom: "2026-09-01",
        effectiveTo: null,
        consentReference: `DEMO-${organization.id.toUpperCase()}-ADVANCE`,
        notes: "Two remaining test instalments",
        isActive: true,
        createdByUserId: adminId,
        createdAt: generatedAtMs,
        updatedAt: generatedAtMs,
      }));
    }

    const approvedLeaveRequestId = stableId(employee.username, "leave-approved");
    const pendingLeaveRequestId = stableId(employee.username, "leave-pending");
    const secondaryLeaveRequestId = stableId(employee.username, "leave-secondary");
    const pendingDate = employeeIndex === 0 ? "2026-10-29" : "2026-10-30";
    statements.push(insert("LeaveRequest", {
      id: approvedLeaveRequestId,
      clientId: organization.id,
      employeeId: employeeRef,
      leaveTypeId: leaveTypeId(organization.id, employee.leaveCode),
      startDate: employee.leaveDate,
      endDate: employee.leaveDate,
      requestedMinutes: 480,
      reason: employee.leaveCode === "SICK" ? "Medical rest (demo)" : "Personal leave (demo)",
      status: "APPROVED",
      reviewedByUserId: adminId,
      reviewNote: "Approved test request",
      reviewedAt: generatedAtMs - 25 * 86_400_000,
      cancelledAt: null,
      createdAt: generatedAtMs - 27 * 86_400_000,
      updatedAt: generatedAtMs - 25 * 86_400_000,
    }));
    statements.push(insert("LeaveRequest", {
      id: pendingLeaveRequestId,
      clientId: organization.id,
      employeeId: employeeRef,
      leaveTypeId: leaveTypeId(organization.id, "ANNUAL"),
      startDate: pendingDate,
      endDate: pendingDate,
      requestedMinutes: 480,
      reason: "Upcoming personal appointment (demo)",
      status: "PENDING",
      reviewedByUserId: null,
      reviewNote: null,
      reviewedAt: null,
      cancelledAt: null,
      createdAt: generatedAtMs - 2 * 86_400_000,
      updatedAt: generatedAtMs - 2 * 86_400_000,
    }));
    statements.push(insert("LeaveRequest", {
      id: secondaryLeaveRequestId,
      clientId: organization.id,
      employeeId: employeeRef,
      leaveTypeId: leaveTypeId(organization.id, "UNPAID"),
      startDate: "2026-10-26",
      endDate: "2026-10-26",
      requestedMinutes: 480,
      reason: "Status workflow example",
      status: employeeIndex === 0 ? "REJECTED" : "CANCELLED",
      reviewedByUserId: employeeIndex === 0 ? adminId : null,
      reviewNote: employeeIndex === 0 ? "Coverage unavailable (demo)" : null,
      reviewedAt: employeeIndex === 0 ? generatedAtMs - 86_400_000 : null,
      cancelledAt: employeeIndex === 1 ? generatedAtMs - 86_400_000 : null,
      createdAt: generatedAtMs - 3 * 86_400_000,
      updatedAt: generatedAtMs - 86_400_000,
    }));

    for (const code of ["ANNUAL", "SICK", "UNPAID"]) {
      const used = code === employee.leaveCode ? 480 : 0;
      const pending = code === "ANNUAL" ? 480 : 0;
      statements.push(insert("LeaveBalance", {
        id: stableId(employee.username, "balance", code, "2026"),
        employeeId: employeeRef,
        leaveTypeId: leaveTypeId(organization.id, code),
        year: 2026,
        entitledMinutes: code === "UNPAID" ? 0 : 6_720,
        usedMinutes: used,
        pendingMinutes: pending,
        updatedAt: generatedAtMs,
      }));
    }

    let workedDays = 0;
    let regularMinutesTotal = 0;
    let overtimeMinutesTotal = 0;
    let lateMinutesTotal = 0;
    let absenceCount = 0;
    let dayIndex = 0;

    for (const date of eachDate("2026-09-01", "2026-10-23").filter(isWeekday)) {
      dayIndex += 1;
      const periodId = date.startsWith("2026-09") ? septemberPeriodId : octoberPeriodId;
      const timesheetId = stableId(employee.username, "timesheet", date);
      const isLocked = date.startsWith("2026-09");
      const isLeave = date === employee.leaveDate;
      const isAbsent = date === employee.absenceDate;
      const isCorrection = date === employee.correctionDate;
      const isMissedPunch = isCorrection && employee.correctionStatus === "PENDING";
      const isLate = !isLeave && !isAbsent && dayIndex % 7 === 0;
      const isEarly = !isLeave && !isAbsent && dayIndex % 11 === 0;
      const isOvertime = !isLeave && !isAbsent && dayIndex % 9 === 0;
      const exceptionCodes = [];
      let regularMinutes = 480;
      let overtimeMinutes = isOvertime ? 120 : 0;
      let lateMinutes = isLate ? 25 : 0;
      let earlyMinutes = isEarly ? 40 : 0;
      let firstClockInAt = null;
      let lastClockOutAt = null;

      if (isLeave) {
        regularMinutes = 0;
        overtimeMinutes = 0;
        lateMinutes = 0;
        earlyMinutes = 0;
      } else if (isAbsent) {
        regularMinutes = 0;
        overtimeMinutes = 0;
        lateMinutes = 0;
        earlyMinutes = 0;
        absenceCount += 1;
        exceptionCodes.push("ABSENT");
      } else {
        workedDays += 1;
        if (isLate) {
          regularMinutes -= 25;
          exceptionCodes.push("LATE_ARRIVAL");
        }
        if (isEarly) {
          regularMinutes -= 40;
          exceptionCodes.push("EARLY_DEPARTURE");
        }
        if (isMissedPunch) {
          regularMinutes = 0;
          overtimeMinutes = 0;
          exceptionCodes.push("MISSED_CLOCK_OUT");
        }
        regularMinutesTotal += regularMinutes;
        overtimeMinutesTotal += overtimeMinutes;
        lateMinutesTotal += lateMinutes;

        const overnight = employee.shift === "night";
        const start = overnight ? "22:00" : "09:00";
        const breakStart = overnight ? "02:00" : "13:00";
        const breakEnd = overnight ? "03:00" : "14:00";
        const end = overnight ? "07:00" : "18:00";
        const startDelayMinutes = isLate ? 25 : -2;
        const endAdjustmentMinutes = isOvertime ? 120 : isEarly ? -40 : 2;
        firstClockInAt = new Date(localTime(date, start).getTime() + startDelayMinutes * 60_000);
        lastClockOutAt = isMissedPunch ? null : new Date(localTime(date, end, overnight ? 1 : 0).getTime() + endAdjustmentMinutes * 60_000);
        const breakStartAt = localTime(date, breakStart, overnight ? 1 : 0);
        const breakEndAt = localTime(date, breakEnd, overnight ? 1 : 0);
        const events = [
          { type: "CLOCK_IN", at: firstClockInAt },
          { type: "BREAK_START", at: breakStartAt },
          { type: "BREAK_END", at: breakEndAt },
          ...(lastClockOutAt ? [{ type: "CLOCK_OUT", at: lastClockOutAt }] : []),
        ];
        for (const event of events) {
          const eventId = stableId(employee.username, date, event.type.toLowerCase());
          statements.push(insert("AttendanceEvent", {
            id: eventId,
            employeeId: employeeRef,
            clientId: organization.id,
            workDate: date,
            type: event.type,
            source: isCorrection && employee.correctionStatus === "APPROVED" && event.type === "CLOCK_OUT" ? "ADMIN_ADJUSTMENT" : "MOBILE_GPS",
            occurredAt: event.at,
            worksiteId,
            latitude: organization.coordinates.latitude + 0.00008,
            longitude: organization.coordinates.longitude - 0.00006,
            accuracyMeters: 14 + (dayIndex % 12),
            distanceMeters: 12 + (dayIndex % 20),
            acceptedRadiusMeters: 180,
            idempotencyKey: `demo:${employee.username}:${date}:${event.type}`,
            createdByUserId: event.type === "CLOCK_OUT" && isCorrection && employee.correctionStatus === "APPROVED" ? adminId : userId,
            deviceDetails: json({ platform: "mobile-web", browser: "Demo Browser", seeded: true }),
            createdAt: event.at,
          }));
          if (event.type === "CLOCK_IN" && dayIndex % 5 === 0) {
            const delivered = dayIndex % 10 !== 0;
            statements.push(insert("WebhookDelivery", {
              id: stableId("webhook", eventId),
              clientId: organization.id,
              attendanceEventId: eventId,
              eventType: "attendance.clock_in",
              payload: json({ eventId, employee: employee.username, workDate: date }),
              status: delivered ? "DELIVERED" : "DEAD_LETTER",
              attempts: delivered ? 1 : 5,
              lastAttemptAt: event.at,
              responseStatus: delivered ? 200 : 503,
              lastError: delivered ? null : "Demo endpoint unavailable",
              deliveredAt: delivered ? event.at : null,
              createdAt: event.at,
              updatedAt: event.at,
            }));
          }
        }
        statements.push(insert("AttendanceRecord", {
          id: stableId(employee.username, "legacy-attendance", date),
          employeeId: employeeRef,
          workDate: date,
          clockInAt: firstClockInAt,
          clockOutAt: lastClockOutAt,
          clockInLatitude: organization.coordinates.latitude + 0.00008,
          clockInLongitude: organization.coordinates.longitude - 0.00006,
          clockInAccuracy: 18,
          clockOutLatitude: lastClockOutAt ? organization.coordinates.latitude + 0.00005 : null,
          clockOutLongitude: lastClockOutAt ? organization.coordinates.longitude - 0.00003 : null,
          clockOutAccuracy: lastClockOutAt ? 16 : null,
          status: lastClockOutAt ? "CLOCKED_OUT" : "CLOCKED_IN",
          createdAt: firstClockInAt,
          updatedAt: lastClockOutAt ?? firstClockInAt,
        }));
      }

      const timesheetState = isLocked
        ? "LOCKED"
        : exceptionCodes.length > 0 || isMissedPunch
          ? "EXCEPTION"
          : "COMPLETE";
      statements.push(insert("TimesheetDay", {
        id: timesheetId,
        employeeId: employeeRef,
        clientId: organization.id,
        workDate: date,
        state: timesheetState,
        firstClockInAt,
        lastClockOutAt,
        regularMinutes,
        overtimeMinutes,
        breakMinutes: isLeave || isAbsent ? 0 : 60,
        lateMinutes,
        earlyDepartureMinutes: earlyMinutes,
        leaveMinutes: isLeave ? 480 : 0,
        paidLeaveMinutes: isLeave ? 480 : 0,
        unpaidLeaveMinutes: 0,
        isAbsent,
        exceptionCodes: json(exceptionCodes),
        version: isCorrection && employee.correctionStatus === "APPROVED" ? 2 : 1,
        approvedAt: isLocked ? generatedAtMs - 10 * 86_400_000 : null,
        lockedAt: isLocked ? generatedAtMs - 8 * 86_400_000 : null,
        createdAt: firstClockInAt ?? new Date(`${date}T09:00:00+08:00`),
        updatedAt: generatedAtMs,
        payPeriodId: periodId,
      }));

      if (isLeave) {
        statements.push(insert("LeaveAllocation", {
          id: stableId(employee.username, "leave-allocation", date),
          leaveRequestId: approvedLeaveRequestId,
          timesheetDayId: timesheetId,
          workDate: date,
          scheduledMinutes: 480,
          minutes: 480,
          paidMinutes: 480,
          unpaidMinutes: 0,
          createdAt: generatedAtMs - 25 * 86_400_000,
        }));
      }
    }

    const correctionTimesheetId = stableId(employee.username, "timesheet", employee.correctionDate);
    const correctionId = stableId(employee.username, "correction", employee.correctionDate);
    statements.push(insert("AttendanceCorrection", {
      id: correctionId,
      employeeId: employeeRef,
      timesheetDayId: correctionTimesheetId,
      reason: employee.correctionStatus === "PENDING" ? "Forgot to clock out" : "Incorrect clock-out time",
      note: "Seeded correction request for workflow testing",
      originalValues: json({ clockOutAt: employee.correctionStatus === "PENDING" ? null : `${employee.correctionDate}T17:30:00+08:00` }),
      requestedValues: json({ clockOutAt: `${employee.correctionDate}T18:00:00+08:00` }),
      status: employee.correctionStatus,
      reviewedByUserId: employee.correctionStatus === "PENDING" ? null : adminId,
      reviewNote: employee.correctionStatus === "APPROVED" ? "Verified with supervisor" : employee.correctionStatus === "REJECTED" ? "Insufficient supporting details" : null,
      reviewedAt: employee.correctionStatus === "PENDING" ? null : generatedAtMs - 2 * 86_400_000,
      createdAt: generatedAtMs - 4 * 86_400_000,
      updatedAt: generatedAtMs - 2 * 86_400_000,
    }));
    if (employee.correctionStatus === "APPROVED" && employee.correctionDate.startsWith("2026-09")) {
      statements.push(insert("PayrollAdjustment", {
        id: stableId(employee.username, "payroll-adjustment", employee.correctionDate),
        payPeriodId: septemberPeriodId,
        timesheetDayId: correctionTimesheetId,
        correctionId,
        adjustmentType: "ATTENDANCE_CORRECTION",
        minutes: 30,
        reason: "Post-lock attendance correction",
        beforeValues: json({ regularMinutes: 450 }),
        afterValues: json({ regularMinutes: 480 }),
        createdByUserId: adminId,
        createdAt: generatedAtMs - 2 * 86_400_000,
      }));
    }

    const allowance = 15_000;
    const overtime = employeeIndex === 0 ? 18_462 : 20_769;
    const advance = employeeIndex === 1 ? 20_000 : 0;
    const gross = employee.salary + allowance + overtime;
    const epfEmployee = Math.round(gross * 0.11);
    const epfEmployer = Math.round(gross * 0.13);
    const socsoEmployee = Math.round(gross * 0.005);
    const socsoEmployer = Math.round(gross * 0.0175);
    const eisEmployee = Math.round(gross * 0.002);
    const eisEmployer = Math.round(gross * 0.002);
    const deductions = advance + epfEmployee + socsoEmployee + eisEmployee;
    const net = gross - deductions;
    const employerContributions = epfEmployer + socsoEmployer + eisEmployer;
    const resultId = stableId(employee.username, "payroll-result-2026-09");
    const warningCodes = absenceCount > 0 ? ["ABSENCE_REVIEWED"] : [];
    payrollTotals.gross += gross;
    payrollTotals.deductions += deductions;
    payrollTotals.net += net;
    payrollTotals.warnings += warningCodes.length;
    statements.push(insert("PayrollCalculationResult", {
      id: resultId,
      runId: payrollRunId,
      employeeId: employeeRef,
      basePaySen: employee.salary,
      regularPaySen: employee.salary,
      overtimePaySen: overtime,
      restDayPaySen: 0,
      publicHolidayPaySen: 0,
      paidLeavePaySen: 0,
      unpaidLeaveDeductionSen: 0,
      additionalEarningsSen: allowance,
      otherDeductionsSen: 0,
      advanceDeductionSen: advance,
      epfWagesSen: gross,
      socsoWagesSen: gross,
      eisWagesSen: gross,
      epfEmployeeSen: epfEmployee,
      epfEmployerSen: epfEmployer,
      socsoEmployeeSen: socsoEmployee,
      socsoEmployerSen: socsoEmployer,
      eisEmployeeSen: eisEmployee,
      eisEmployerSen: eisEmployer,
      employerContributionsSen: employerContributions,
      grossPaySen: gross,
      totalDeductionsSen: deductions,
      calculatedPaySen: net,
      warnings: json(warningCodes),
      blockingWarnings: json([]),
      payProfileSnapshot: json({ payType: "MONTHLY", baseRateSen: employee.salary, effectiveFrom: "2026-09-01" }),
      inputSummary: json({ workedDays, regularMinutes: regularMinutesTotal, overtimeMinutes: overtimeMinutesTotal, lateMinutes: lateMinutesTotal, absences: absenceCount }),
      createdAt: generatedAtMs - 11 * 86_400_000,
    }));
    statements.push(...moneyLines(resultId, {
      base: employee.salary,
      overtime,
      allowance,
      advance,
      epfEmployee,
      epfEmployer,
      socsoEmployee,
      socsoEmployer,
      eisEmployee,
      eisEmployer,
    }, {
      allowance: allowanceAssignmentId,
      advance: employeeIndex === 1 ? advanceAssignmentId : null,
    }));
    if (warningCodes.length > 0) {
      statements.push(insert("PayrollWarningAcknowledgement", {
        id: stableId(employee.username, "warning-absence-2026-09"),
        clientId: organization.id,
        calculationResultId: resultId,
        warningCode: "ABSENCE_REVIEWED",
        note: "Attendance exception reviewed for demo payroll",
        acknowledgedByUserId: adminId,
        acknowledgedByUsername: organization.admin,
        createdAt: generatedAtMs - 10 * 86_400_000,
      }));
    }

    statements.push(insert("Notification", {
      id: stableId(employee.username, "notification-leave-approved"),
      userId,
      clientId: organization.id,
      type: "LEAVE_APPROVED",
      title: "Leave request approved",
      message: `Your ${employee.leaveCode.toLowerCase()} leave request was approved.`,
      entityType: "LeaveRequest",
      entityId: approvedLeaveRequestId,
      readAt: generatedAtMs - 20 * 86_400_000,
      createdAt: generatedAtMs - 25 * 86_400_000,
    }));
    statements.push(insert("Notification", {
      id: stableId(organization.id, employee.username, "notification-admin-leave-pending"),
      userId: adminId,
      clientId: organization.id,
      type: "LEAVE_PENDING",
      title: "Leave request needs review",
      message: `${employee.username} submitted a test leave request.`,
      entityType: "LeaveRequest",
      entityId: pendingLeaveRequestId,
      readAt: null,
      createdAt: generatedAtMs - 2 * 86_400_000,
    }));
    statements.push(insert("AuditLog", {
      id: stableId(employee.username, "audit-leave-approved"),
      actorUserId: adminId,
      clientId: organization.id,
      action: "LEAVE_REQUEST_APPROVED",
      entityType: "LeaveRequest",
      entityId: approvedLeaveRequestId,
      details: json({ seeded: true, employee: employee.username }),
      requestId: `demo-${employee.username}-leave`,
      ipAddress: "127.0.0.1",
      userAgent: "attend+ demo data generator",
      createdAt: generatedAtMs - 25 * 86_400_000,
    }));
  }

  statements.push(update("PayrollCalculationRun", {
    totalGrossSen: payrollTotals.gross,
    totalDeductionsSen: payrollTotals.deductions,
    totalCalculatedPaySen: payrollTotals.net,
    warningCount: payrollTotals.warnings,
  }, `"id" = ${sqlValue(payrollRunId)}`));
  statements.push(insert("AuditLog", {
    id: stableId(organization.id, "audit-payroll-locked-2026-09"),
    actorUserId: adminId,
    clientId: organization.id,
    action: "PAY_PERIOD_LOCKED",
    entityType: "PayPeriod",
    entityId: septemberPeriodId,
    details: json({ seeded: true, calculationRunId: payrollRunId }),
    requestId: `demo-${organization.id}-payroll-lock`,
    ipAddress: "127.0.0.1",
    userAgent: "attend+ demo data generator",
    createdAt: generatedAtMs - 8 * 86_400_000,
  }));
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${statements.join("\n")}\n`, "utf8");
console.log(`Generated ${statements.length} D1 demo statements at ${outputPath}.`);
