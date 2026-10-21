import request from "supertest";
import { Application } from "express";

// Matches the dev-default api-key.middleware falls back to when API_KEY
// isn't set — see src/infrastructure/security/api-key.middleware.ts.
export const TEST_API_KEY = process.env.API_KEY || "local-dev-key";

/**
 * A supertest wrapper that attaches X-API-Key to every request, so e2e specs
 * don't have to repeat `.set(...)` on every single call. health.e2e.spec.ts
 * deliberately does NOT use this — /health and /health/ready are exempt from
 * auth and should stay proven that way.
 */
export function authedRequest(app: Application) {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set("X-API-Key", TEST_API_KEY),
    post: (url: string) => agent.post(url).set("X-API-Key", TEST_API_KEY),
    put: (url: string) => agent.put(url).set("X-API-Key", TEST_API_KEY),
    delete: (url: string) => agent.delete(url).set("X-API-Key", TEST_API_KEY),
  };
}
