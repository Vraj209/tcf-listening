import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { directDatabaseUrl } from "./src/db/connection";

config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED || directDatabaseUrl(process.env.DATABASE_URL ?? "") },
  strict: true,
});
