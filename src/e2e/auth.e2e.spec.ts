import "reflect-metadata";
import request from "supertest";
import { Sequelize } from "sequelize-typescript";
import app from "../api/app";
import { TEST_API_KEY } from "./setup/authenticated-request";
import { setupE2EDatabase } from "./setup/database.helper";

describe("Auth E2E", () => {
  let sequelize: Sequelize;

  // Runs standalone (spec files execute in isolation, order not guaranteed),
  // so it needs the schema in place itself rather than relying on another
  // spec file's beforeAll having run first.
  beforeAll(async () => {
    sequelize = await setupE2EDatabase();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it("rejects a protected route with 401 when no API key is sent", async () => {
    const res = await request(app).get("/customers");

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("rejects a protected route with 401 when the API key is wrong", async () => {
    const res = await request(app).get("/customers").set("X-API-Key", "wrong-key");

    expect(res.status).toBe(401);
  });

  it("allows a protected route through with the correct API key", async () => {
    const res = await request(app).get("/customers").set("X-API-Key", TEST_API_KEY);

    expect(res.status).toBe(200);
  });

  it("never requires an API key for /health or /health/ready", async () => {
    const health = await request(app).get("/health");
    const ready = await request(app).get("/health/ready");

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
  });
});

describe("CORS E2E", () => {
  it("reflects an allowed cross-origin request with the standard CORS headers", async () => {
    const res = await request(app)
      .options("/customers")
      .set("Origin", "https://example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("does not require an API key for the CORS preflight itself", async () => {
    // No X-API-Key set — a browser's preflight never sends one, and it must
    // still succeed or the real cross-origin request never gets attempted.
    const res = await request(app)
      .options("/orders")
      .set("Origin", "https://example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
  });
});

describe("Rate limiting E2E", () => {
  // Proving the wiring (headers present where expected, absent where
  // exempt) rather than actually exhausting the real limit — that would
  // mean hundreds of requests in a test just to re-verify a well-tested
  // third-party library's own counting logic.
  it("sets standard rate-limit headers on a protected route", async () => {
    const res = await request(app).get("/customers").set("X-API-Key", TEST_API_KEY);

    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });

  it("does not rate-limit /health or /health/ready", async () => {
    const health = await request(app).get("/health");
    const ready = await request(app).get("/health/ready");

    expect(health.headers["ratelimit-limit"]).toBeUndefined();
    expect(ready.headers["ratelimit-limit"]).toBeUndefined();
  });
});
