import { defineConfig } from "prisma/config";

// Load backend/.env locally; on Vercel the variables come from project settings.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

// Migrations use the direct (unpooled) Neon connection.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
});
