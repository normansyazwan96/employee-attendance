import type { RequestHandler } from "express";

type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();
const windowMs = 15 * 60 * 1000;
const maxAttempts = 10;

export const loginRateLimit: RequestHandler = (request, response, next) => {
  const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const current = attempts.get(key);
  const attempt = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  if (attempt.count >= maxAttempts) {
    response.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }
  response.on("finish", () => {
    if (response.statusCode >= 400 && response.statusCode < 500) {
      attempt.count += 1;
      attempts.set(key, attempt);
    }
  });
  next();
};