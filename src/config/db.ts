import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const url =
  process.env.DATABASE_URL ||
  "";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: ["error", "warn"],
  });

globalForPrisma.prisma = prisma;
