import { readFile } from "node:fs/promises";

const baseUrl = process.env.LOAD_TEST_BASE_URL;
const usersFile = process.env.LOAD_TEST_USERS_FILE;
if (!baseUrl || !usersFile) throw new Error("Set LOAD_TEST_BASE_URL and LOAD_TEST_USERS_FILE");

const users = JSON.parse(await readFile(usersFile, "utf8"));
if (!Array.isArray(users) || users.length < 100) throw new Error("Provide at least 100 isolated test users");
const location = { latitude: Number(process.env.LOAD_TEST_LATITUDE), longitude: Number(process.env.LOAD_TEST_LONGITUDE), accuracy: 10 };
if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw new Error("Set a valid test worksite latitude and longitude");

async function clock(user) {
  const loginStarted = performance.now();
  const login = await fetch(`${baseUrl}/api/v2/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) });
  const session = await login.json();
  if (!login.ok || !session.accessToken) throw new Error(`Login failed for ${user.username}`);
  const response = await fetch(`${baseUrl}/api/v2/attendance/events/clock-in`, { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", "Idempotency-Key": `load-${crypto.randomUUID()}` }, body: JSON.stringify({ location }) });
  if (!response.ok) throw new Error(`Clock action failed for ${user.username}: ${response.status}`);
  return performance.now() - loginStarted;
}

const started = performance.now();
const settled = await Promise.allSettled(users.slice(0, 100).map(clock));
const duration = performance.now() - started;
const latencies = settled.filter((item) => item.status === "fulfilled").map((item) => item.value).sort((a, b) => a - b);
const failures = settled.length - latencies.length;
const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? Infinity;
console.log(JSON.stringify({ requests: settled.length, failures, durationMs: Math.round(duration), p95Ms: Math.round(p95) }));
if (failures > 0 || p95 > 2_500) process.exitCode = 1;
