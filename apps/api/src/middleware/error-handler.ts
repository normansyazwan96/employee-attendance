import type { ErrorRequestHandler, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../services/logger.js";
import { reportError } from "../services/error-reporting.js";

const requestIdPattern = /^[A-Za-z0-9._-]{8,128}$/;

export const requestLogger: RequestHandler = (request, response, next) => {
  const suppliedRequestId = request.header("x-request-id");
  const requestId = suppliedRequestId && requestIdPattern.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();
  const startedAt = performance.now();

  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  response.on("finish", () => {
    logger.info("http_request", {
      requestId,
      method: request.method,
      path: request.originalUrl,
      status: response.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  });
  next();
};

export const notFound: RequestHandler = (request, response) => {
  const message = `Route ${request.method} ${request.originalUrl} was not found`;
  if (request.originalUrl.startsWith("/api/v2/")) {
    response.status(404).json({ error: { code: "ROUTE_NOT_FOUND", message }, requestId: response.locals.requestId });
    return;
  }
  response.status(404).json({ error: message });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  void _next;
  const message = error instanceof Error ? error.message : "Unknown error";
  logger.error("unhandled_error", {
    requestId: response.locals.requestId,
    method: request.method,
    path: request.originalUrl,
    errorName: error instanceof Error ? error.name : "UnknownError",
    message,
  });
  void reportError(error, { requestId: response.locals.requestId, method: request.method, path: request.originalUrl });

  if (request.originalUrl.startsWith("/api/v2/")) {
    response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      requestId: response.locals.requestId,
    });
    return;
  }
  response.status(500).json({ error: "An unexpected error occurred" });
};
