import { EventEmitter } from "events";
import { Request, Response } from "express";
import httpMetrics from "./http-metrics.middleware";
import { httpRequestDuration, register } from "./metrics";

function buildRes(statusCode: number): Response {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { statusCode }) as unknown as Response;
}

async function observationCount(labels: Record<string, string>): Promise<number> {
  const snapshot = await httpRequestDuration.get();
  const found = snapshot.values.find(
    (v) =>
      v.metricName?.endsWith("_count") &&
      v.labels.method === labels.method &&
      v.labels.route === labels.route &&
      v.labels.status_code === labels.status_code,
  );
  return found?.value ?? 0;
}

describe("httpMetrics middleware", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("records an observation labeled by the matched route pattern, not the raw URL", async () => {
    const req = {
      method: "GET",
      path: "/orders/abc-123",
      baseUrl: "",
      route: { path: "/orders/:id" },
    } as unknown as Request;
    const res = buildRes(200);

    httpMetrics(req, res, jest.fn());
    res.emit("finish");

    expect(
      await observationCount({ method: "GET", route: "/orders/:id", status_code: "200" }),
    ).toBe(1);
  });

  it("falls back to req.path when no route matched (e.g. a 404)", async () => {
    const req = {
      method: "GET",
      path: "/does-not-exist",
      baseUrl: "",
      route: undefined,
    } as unknown as Request;
    const res = buildRes(404);

    httpMetrics(req, res, jest.fn());
    res.emit("finish");

    expect(
      await observationCount({ method: "GET", route: "/does-not-exist", status_code: "404" }),
    ).toBe(1);
  });

  it("calls next() synchronously so the request isn't blocked", () => {
    const req = { method: "GET", path: "/x", baseUrl: "", route: undefined } as unknown as Request;
    const res = buildRes(200);
    const next = jest.fn();

    httpMetrics(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
