import { Router } from "express";
import { clockIn, clockOut, getAttendanceHistory, getLocationStatus, getTodayAttendance } from "../controllers/attendance.controller.js";
import { requireAuth, requireCurrentSession, requirePasswordChangeCompleted } from "../middleware/auth.js";

export const attendanceRouter = Router();
attendanceRouter.use("/attendance", requireAuth, requireCurrentSession, requirePasswordChangeCompleted);
attendanceRouter.get("/attendance/today", getTodayAttendance);
attendanceRouter.get("/attendance/history", getAttendanceHistory);
attendanceRouter.post("/attendance/location-status", getLocationStatus);
attendanceRouter.post("/attendance/clock-in", clockIn);
attendanceRouter.post("/attendance/clock-out", clockOut);
