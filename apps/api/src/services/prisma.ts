import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient as D1PrismaClient } from "../generated/d1/client.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../config/env.js";
import type { D1DatabaseBinding } from "./d1-shadow.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const requestClient = new AsyncLocalStorage<PrismaClient>();
let configuredConnectionString: string | undefined;
let configuredD1Database: D1DatabaseBinding | undefined;
let client = process.env.NODE_ENV !== "production" ? globalForPrisma.prisma : undefined;

export function configureDatabaseConnection(connectionString: string | undefined): void {
  if (connectionString) configuredConnectionString = connectionString;
}

export function configureD1Database(binding: D1DatabaseBinding | undefined): void {
  configuredD1Database = binding;
}

export function isD1Database(): boolean {
  return Boolean(configuredD1Database);
}

export async function executeD1Batch(statements: Array<{ sql: string; values?: unknown[] }>): Promise<void> {
  if (!configuredD1Database) throw new Error("Cloudflare D1 is not configured");
  await configuredD1Database.batch(statements.map(({ sql, values = [] }) => configuredD1Database!.prepare(sql).bind(...values)));
}

export async function queryD1Batch(statements: Array<{ sql: string; values?: unknown[] }>): Promise<Array<Record<string, unknown>[]>> {
  if (!configuredD1Database) throw new Error("Cloudflare D1 is not configured");
  const results = await configuredD1Database.batch<Record<string, unknown>>(
    statements.map(({ sql, values = [] }) => configuredD1Database!.prepare(sql).bind(...values)),
  );
  return results.map((result) => result.results ?? []);
}

function createClient(connectionString: string, maximumConnections = 5): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: maximumConnections,
    }),
  });
}

function createD1Client(binding: D1DatabaseBinding): PrismaClient {
  const adapter = new PrismaD1(binding as never);
  return new D1PrismaClient({ adapter }) as unknown as PrismaClient;
}

export async function withDatabaseRequest<T>(callback: () => Promise<T>): Promise<T> {
  if (configuredD1Database) {
    const scopedClient = createD1Client(configuredD1Database);
    return requestClient.run(scopedClient, async () => {
      try {
        return await callback();
      } finally {
        await scopedClient.$disconnect();
      }
    });
  }
  if (!configuredConnectionString) return callback();
  const scopedClient = createClient(configuredConnectionString, 1);
  return requestClient.run(scopedClient, async () => {
    try {
      return await callback();
    } finally {
      await scopedClient.$disconnect();
    }
  });
}

export async function acquireDatabaseLock(transaction: Pick<PrismaClient, "$queryRaw">, key: string): Promise<void> {
  if (configuredD1Database) return;
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
}

function prismaClient(): PrismaClient {
  const scopedClient = requestClient.getStore();
  if (scopedClient) return scopedClient;
  if (!client) {
    if (configuredConnectionString) throw new Error("Database access must run inside the current Worker handler");
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required when Cloudflare D1 is not configured");
    client = createClient(env.DATABASE_URL);
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const value = Reflect.get(prismaClient(), property);
    return typeof value === "function" ? value.bind(prismaClient()) : value;
  },
});
