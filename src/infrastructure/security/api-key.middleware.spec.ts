import { Request, Response } from "express";
import apiKeyAuth from "./api-key.middleware";

function buildReq(headers: Record<string, string> = {}): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function buildRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("apiKeyAuth middleware", () => {
  const originalApiKey = process.env.API_KEY;

  afterEach(() => {
    process.env.API_KEY = originalApiKey;
  });

  it("calls next() when the provided key matches the configured one", () => {
    process.env.API_KEY = "secret-1";
    const req = buildReq({ "x-api-key": "secret-1" });
    const res = buildRes();
    const next = jest.fn();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts any key from a comma-separated list of configured keys", () => {
    process.env.API_KEY = "secret-1, secret-2";
    const req = buildReq({ "x-api-key": "secret-2" });
    const res = buildRes();
    const next = jest.fn();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("rejects with 401 when no key header is sent", () => {
    process.env.API_KEY = "secret-1";
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    apiKeyAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects with 401 when the key doesn't match", () => {
    process.env.API_KEY = "secret-1";
    const req = buildReq({ "x-api-key": "wrong" });
    const res = buildRes();
    const next = jest.fn();

    apiKeyAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("falls back to the documented dev default when API_KEY isn't configured at all", () => {
    delete process.env.API_KEY;

    const matchingNext = jest.fn();
    apiKeyAuth(buildReq({ "x-api-key": "local-dev-key" }), buildRes(), matchingNext);
    expect(matchingNext).toHaveBeenCalled();

    const mismatchedRes = buildRes();
    const mismatchedNext = jest.fn();
    apiKeyAuth(buildReq({ "x-api-key": "anything-else" }), mismatchedRes, mismatchedNext);
    expect(mismatchedNext).not.toHaveBeenCalled();
    expect(mismatchedRes.status).toHaveBeenCalledWith(401);
  });
});
