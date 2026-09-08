import { Client } from "pg";

const MAX_RETRIES = 15;
const RETRY_DELAY_MS = 2000;

export default async function globalSetup() {
  // eslint-disable-next-line no-console
  console.log("\n🐳 [E2E] Waiting for PostgreSQL...");

  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "ddd_project",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.connect();
      await client.end();
      // eslint-disable-next-line no-console
      console.log(`✅ [E2E] PostgreSQL available after ${attempt} attempt(s)`);
      return;
    } catch {
      // eslint-disable-next-line no-console
      console.log(`⏳ [E2E] Attempt ${attempt}/${MAX_RETRIES} — waiting ${RETRY_DELAY_MS}ms...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  throw new Error(
    `❌ [E2E] PostgreSQL not available after ${MAX_RETRIES} attempts.\n` +
      "  Run: npm run docker:up",
  );
}
