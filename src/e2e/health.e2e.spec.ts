import "reflect-metadata";
import request from "supertest";
import app from "../api/app";

describe("Health E2E", () => {
  describe("GET /health", () => {
    it("always reports ok — a liveness check, no dependency touched", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("GET /health/ready", () => {
    it("reports ready when the database is reachable", async () => {
      const res = await request(app).get("/health/ready");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok", checks: { database: "ok" } });
    });
  });
});
