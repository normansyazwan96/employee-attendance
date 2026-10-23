import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";

type ErrorContext = { requestId?: string; method: string; path: string };

export async function reportError(error: unknown, context: ErrorContext): Promise<void> {
  if (!env.SENTRY_DSN) return;
  try {
    const dsn = new URL(env.SENTRY_DSN);
    const projectId = dsn.pathname.split("/").filter(Boolean).at(-1);
    if (!projectId || !dsn.username) return;
    const endpoint = `${dsn.protocol}//${dsn.host}${dsn.pathname.slice(0, -(projectId.length + 1))}/api/${projectId}/envelope/`;
    const eventId = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const caught = error instanceof Error ? error : new Error("Unknown error");
    const envelope = [
      JSON.stringify({ event_id: eventId, dsn: env.SENTRY_DSN, sent_at: now }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({ event_id: eventId, timestamp: now, platform: "javascript", level: "error", environment: env.APP_ENV, exception: { values: [{ type: caught.name, value: caught.message, stacktrace: { frames: caught.stack?.split("\n").slice(1, 20).map((line) => ({ filename: line.trim() })) ?? [] } }] }, request: { method: context.method, url: context.path }, tags: { request_id: context.requestId ?? "unknown" } }),
    ].join("\n");
    await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-sentry-envelope" }, body: envelope, signal: AbortSignal.timeout(1_500) });
  } catch {
    // Error reporting must never replace the original application response.
  }
}
