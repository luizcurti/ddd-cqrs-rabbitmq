import { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";

const API_KEY_HEADER = "x-api-key";

// Same pattern as every other credential in this project (DB_PASSWORD,
// RABBITMQ_URL's guest/guest, ...): a working dev default so the app and
// its test suites run out of the box, documented in .env.example as
// dev-only. Set a real API_KEY before exposing this anywhere else.
const DEV_DEFAULT_KEY = "local-dev-key";

/**
 * Constant-time string comparison so a wrong guess can't be narrowed down
 * character-by-character via response timing. Hashing both sides first
 * (rather than comparing the raw strings) also equalizes their length before
 * timingSafeEqual sees them — it throws on a length mismatch, which a raw
 * comparison would hit for almost every wrong-length guess.
 */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Service-to-service API key auth — not full user authentication (no
 * accounts, no sessions, no per-user permissions). That's a deliberately
 * bigger feature than this scope; this closes the "anyone can hit this API"
 * gap for now. Reads the allowed key(s) from API_KEY lazily (not at import
 * time) so tests can set it via jest env setup before this ever runs.
 */
export default function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const configuredKeys = (process.env.API_KEY || DEV_DEFAULT_KEY)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const providedKey = req.header(API_KEY_HEADER);
  const isValid =
    providedKey !== undefined && configuredKeys.some((key) => safeEqual(providedKey, key));

  if (isValid) {
    next();
    return;
  }

  res.status(401).json({ error: "Missing or invalid API key" });
}
