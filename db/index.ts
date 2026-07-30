import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.",
    );
  }

  // Database migrations are applied from drizzle/*.sql by Sites during
  // deployment. Running schema creation and upgrade statements inside every
  // request can lock D1 during a cold start and leave the UI waiting forever.
  return drizzle(env.DB, { schema });
}
