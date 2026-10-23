import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const requestClient = new AsyncLocalStorage<PrismaClient>();
let configuredConnectionString: string | undefined;
let client = process.env.NODE_ENV !== "production" ? globalForPrisma.prisma : undefined;

export function configureDatabaseConnection(connectionString: string | undefined): void {
  if (connectionString) configuredConnectionString = connectionString;
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

export async function withDatabaseRequest<T>(callback: () => Promise<T>): Promise<T> {
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

function prismaClient(): PrismaClient {
  const scopedClient = requestClient.getStore();
  if (scopedClient) return scopedClient;
  if (!client) {
    if (configuredConnectionString) throw new Error("Database access must run inside the current Worker handler");
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
