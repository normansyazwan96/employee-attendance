import { Router } from "express";
import { breakEndV2, breakStartV2, clockInV2, clockOutV2, getMyScheduleV2, getTodayTimesheetV2, listMyTimesheetsV2 } from "../controllers/attendance-v2.controller.js";
import { requireAuth, requireCurrentSession, requirePasswordChangeCompleted } from "../middleware/auth.js";

export const attendanceV2Router = Router();
attendanceV2Router.use("/attendance", requireAuth, requireCurrentSession, requirePasswordChangeCompleted);
attendanceV2Router.get("/attendance/today", getTodayTimesheetV2);
attendanceV2Router.get("/attendance/timesheets", listMyTimesheetsV2);
attendanceV2Router.get("/attendance/schedule", getMyScheduleV2);
attendanceV2Router.post("/attendance/events/clock-in", clockInV2);
attendanceV2Router.post("/attendance/events/clock-out", clockOutV2);
attendanceV2Router.post("/attendance/events/break-start", breakStartV2);
attendanceV2Router.post("/attendance/events/break-end", breakEndV2);
