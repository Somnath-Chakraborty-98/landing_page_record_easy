import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL or DIRECT_URL must be configured");
}

const adapter = new PrismaPg({
  connectionString: databaseUrl
});

const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
