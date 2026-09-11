import { defineConfig } from "drizzle-kit";

const connectionString =
  process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Set POSTGRES_URL or DATABASE_URL before running drizzle-kit against your Supabase database.",
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
