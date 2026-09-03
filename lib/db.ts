import { PrismaClient } from "@prisma/client";

// Next.js dev hot-reloads modules; reuse one PrismaClient per process so
// SQLite connections don't pile up.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
