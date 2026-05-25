import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;

const globalForPrisma = globalThis;

let prisma;

try {
  if (!databaseUrl) {
    console.warn("DATABASE_URL or DIRECT_URL not configured");
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl || "postgresql://localhost/postgres"
  });

  prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
  }
} catch (err) {
  console.error("Prisma initialization error:", err.message);
  throw err;
}

export default prisma;
