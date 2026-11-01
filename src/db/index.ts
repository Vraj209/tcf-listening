import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb(connectionString: string) {
  const client = neon(connectionString);
  return drizzle(client, { schema });
}

let database: ReturnType<typeof createDb> | undefined;

/** Server-only credentials are read lazily so a local catalog needs no database. */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
  database ??= createDb(process.env.DATABASE_URL);
  return database;
}
