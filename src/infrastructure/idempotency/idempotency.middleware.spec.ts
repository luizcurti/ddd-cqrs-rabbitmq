import { EventEmitter } from "events";
import { Sequelize } from "sequelize-typescript";
import { Request, Response } from "express";
import IdempotencyKeyModel from "./idempotency-key.model";
import idempotency from "./idempotency.middleware";

function buildReq(headers: Record<string, string> = {}, path = "/orders"): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
    method: "POST",
    baseUrl: "",
    path,
  } as unknown as Request;
}

function buildRes(): Response {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      return body;
    },
  }) as unknown as Response;
}

function runMiddleware(req: Request, res: Response): Promise<void> {
  return idempotency(req, res, (err) => {
    if (err) throw err;
  });
}

describe("idempotency middleware", () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
      sync: { force: true },
    });
    await sequelize.addModels([IdempotencyKeyModel]);
    await sequelize.sync();
  });

  afterEach(async () => {
    // One test below closes the connection itself to force a DB error;
    // closing an already-closed SQLite connection throws, so tolerate that.
    try {
      await sequelize.close();
    } catch {
      // already closed by the test — nothing to do
    }
  });

  it("passes through untouched when no Idempotency-Key header is sent", async () => {
    const req = buildReq();
    const res = buildRes();

    await runMiddleware(req, res);

    expect(await IdempotencyKeyModel.count()).toBe(0);
  });

  it("claims the key, lets the handler respond, and persists a 2xx response", async () => {
    const req = buildReq({ "idempotency-key": "key-1" });
    const res = buildRes();

    await runMiddleware(req, res);
    res.status(201).json({ id: "order-1" });
    await new Promise((r) => setImmediate(r)); // let the persist promise settle

    const record = await IdempotencyKeyModel.findByPk("POST /orders:key-1");
    expect(record?.status).toBe("completed");
    expect(record?.response_status).toBe(201);
    expect(JSON.parse(record!.response_body)).toEqual({ id: "order-1" });
  });

  it("replays the cached response instead of running the handler again", async () => {
    const key = "key-2";
    await IdempotencyKeyModel.create({
      id: `POST /orders:${key}`,
      status: "completed",
      response_status: 201,
      response_body: JSON.stringify({ id: "order-2" }),
    });

    const req = buildReq({ "idempotency-key": key });
    const res = buildRes();
    const statusSpy = jest.spyOn(res, "status");

    await runMiddleware(req, res);

    expect(statusSpy).toHaveBeenCalledWith(201);
  });

  it("returns 409 for a key that's still being processed by another in-flight request", async () => {
    const key = "key-3";
    await IdempotencyKeyModel.create({ id: `POST /orders:${key}`, status: "processing" });

    const req = buildReq({ "idempotency-key": key });
    const res = buildRes();
    const statusSpy = jest.spyOn(res, "status");

    await runMiddleware(req, res);

    expect(statusSpy).toHaveBeenCalledWith(409);
  });

  it("reclaims a 'processing' claim orphaned by a crashed request and lets a fresh retry complete it", async () => {
    // If the process that made the original claim died (killed, OOM) before
    // ever resolving it, the row would otherwise sit "processing" forever,
    // permanently 409-ing every future retry with this key — the opposite of
    // what an idempotency key is supposed to guarantee.
    const key = "key-stale";
    const id = `POST /orders:${key}`;
    await IdempotencyKeyModel.create({
      id,
      status: "processing",
      created_at: new Date(Date.now() - 61_000),
    });

    const req = buildReq({ "idempotency-key": key });
    const res = buildRes();

    await runMiddleware(req, res);
    res.status(201).json({ id: "order-new" });
    await new Promise((r) => setImmediate(r));

    const record = await IdempotencyKeyModel.findByPk(id);
    expect(record?.status).toBe("completed");
    expect(record?.response_status).toBe(201);
    expect(JSON.parse(record!.response_body)).toEqual({ id: "order-new" });
  });

  it("still returns 409 for a 'processing' claim that's merely slow, not stale", async () => {
    const key = "key-slow";
    await IdempotencyKeyModel.create({
      id: `POST /orders:${key}`,
      status: "processing",
      created_at: new Date(),
    });

    const req = buildReq({ "idempotency-key": key });
    const res = buildRes();
    const statusSpy = jest.spyOn(res, "status");

    await runMiddleware(req, res);

    expect(statusSpy).toHaveBeenCalledWith(409);
  });

  it("deletes the claim on a non-2xx response, so a retry with the same key can proceed", async () => {
    const req = buildReq({ "idempotency-key": "key-4" });
    const res = buildRes();

    await runMiddleware(req, res);
    res.status(400).json({ error: "bad request" });
    await new Promise((r) => setImmediate(r));

    expect(await IdempotencyKeyModel.findByPk("POST /orders:key-4")).toBeNull();
  });

  it("forwards an unexpected (non-unique-constraint) error to next() instead of swallowing it", async () => {
    const req = buildReq({ "idempotency-key": "key-5" });
    const res = buildRes();
    await sequelize.close(); // any query now fails with a connection error, not a duplicate key

    await expect(runMiddleware(req, res)).rejects.toThrow();
  });

  it("scopes the same raw key to different routes independently", async () => {
    const key = "shared-key";
    await IdempotencyKeyModel.create({
      id: "POST /orders:shared-key",
      status: "completed",
      response_status: 201,
      response_body: JSON.stringify({ id: "order-1" }),
    });

    const req = buildReq({ "idempotency-key": key }, "/products");
    const res = buildRes();

    await runMiddleware(req, res);

    // A fresh claim for the products route, unaffected by the orders record.
    expect(await IdempotencyKeyModel.findByPk("POST /products:shared-key")).not.toBeNull();
  });
});
