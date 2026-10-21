import { EventEmitter } from "events";
import { Request, Response } from "express";
import { Span, trace } from "@opentelemetry/api";
import httpLogger from "./http-logger.middleware";

function buildReq(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
    method: "POST",
    originalUrl: "/orders",
  } as unknown as Request;
}

function buildRes(): Response {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    setHeader: jest.fn(),
    statusCode: 201,
  }) as unknown as Response;
}

describe("httpLogger middleware", () => {
  it("generates a correlation id, attaches a child logger, and calls next()", () => {
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    httpLogger(req, res, next);

    expect(req.correlationId).toEqual(expect.any(String));
    expect(req.correlationId.length).toBeGreaterThan(0);
    expect(req.log).toBeDefined();
    expect(res.setHeader).toHaveBeenCalledWith("x-correlation-id", req.correlationId);
    expect(next).toHaveBeenCalled();
  });

  it("stamps the correlation id onto the active OTel span, when one exists", () => {
    const setAttribute = jest.fn();
    const fakeSpan = { setAttribute } as unknown as Span;
    const getActiveSpanSpy = jest.spyOn(trace, "getActiveSpan").mockReturnValue(fakeSpan);

    const req = buildReq();
    const res = buildRes();

    httpLogger(req, res, jest.fn());

    expect(setAttribute).toHaveBeenCalledWith("correlation_id", req.correlationId);
    getActiveSpanSpy.mockRestore();
  });

  it("does nothing OTel-related when there's no active span (tracing not initialized)", () => {
    const getActiveSpanSpy = jest.spyOn(trace, "getActiveSpan").mockReturnValue(undefined);

    const req = buildReq();
    const res = buildRes();

    expect(() => httpLogger(req, res, jest.fn())).not.toThrow();
    getActiveSpanSpy.mockRestore();
  });

  it("reuses an incoming x-correlation-id header instead of generating a new one", () => {
    const req = buildReq({ "x-correlation-id": "incoming-id-123" });
    const res = buildRes();

    httpLogger(req, res, jest.fn());

    expect(req.correlationId).toBe("incoming-id-123");
    expect(res.setHeader).toHaveBeenCalledWith("x-correlation-id", "incoming-id-123");
  });

  it("logs once the response finishes, with method/path/status/duration", () => {
    const req = buildReq();
    const res = buildRes();

    httpLogger(req, res, jest.fn());
    const infoSpy = jest.spyOn(req.log, "info");

    res.emit("finish");

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/orders", statusCode: 201 }),
      "request completed",
    );
  });
});
