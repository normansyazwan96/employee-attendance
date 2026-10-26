import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler, notFound, requestLogger } from "./middleware/error-handler.js";
import { responseLanguage } from "./middleware/response-language.js";
import { healthRouter, healthV2Router } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { attendanceRouter } from "./routes/attendance.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authV2Router } from "./routes/auth-v2.routes.js";
import { attendanceV2Router } from "./routes/attendance-v2.routes.js";
import { workforceV2Router } from "./routes/workforce-v2.routes.js";
import { requestsV2Router } from "./routes/requests-v2.routes.js";
import { payrollV2Router } from "./routes/payroll-v2.routes.js";
import { notificationsV2Router } from "./routes/notifications-v2.routes.js";

export const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: env.CLIENT_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean), credentials: true }));
app.use(helmet());
app.use(requestLogger);
app.use(responseLanguage);
app.use(express.json({ limit: "100kb" }));
app.use("/api/v1", healthRouter);
app.use("/api/v2", healthV2Router);
app.use("/api/v2", authV2Router);
if (env.FEATURE_ATTENDANCE_V2) app.use("/api/v2", attendanceV2Router);
if (env.FEATURE_WORKFORCE_V2) {
  app.use("/api/v2", workforceV2Router);
  app.use("/api/v2", requestsV2Router);
}
if (env.FEATURE_PAYROLL) app.use("/api/v2", payrollV2Router);
app.use("/api/v2", notificationsV2Router);
app.use("/api/v1", authRouter);
app.use("/api/v1", attendanceRouter);
app.use("/api/v1", adminRouter);
app.use(notFound);
app.use(errorHandler);
