import "reflect-metadata";
import { authedRequest } from "./setup/authenticated-request";
import { Sequelize } from "sequelize-typescript";
import app from "../api/app";
import { setupE2EDatabase, truncateAllTables } from "./setup/database.helper";
import OutboxMessageModel from "../infrastructure/outbox/outbox-message.model";

describe("Product E2E — /products", () => {
  let sequelize: Sequelize;

  beforeAll(async () => {
    sequelize = await setupE2EDatabase();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  // ─────────────────────────────────────────────
  // POST /products
  // ─────────────────────────────────────────────

  describe("POST /products", () => {
    it("should create a product and return 201", async () => {
      const res = await authedRequest(app)
        .post("/products")
        .send({ name: "Notebook", price: 4500 });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe("Notebook");
      expect(res.body.price).toBe(4500);
    });

    it("writes a ProductCreated outbox row tagged with the request's correlation id", async () => {
      const res = await authedRequest(app)
        .post("/products")
        .send({ name: "Notebook", price: 4500 });

      const correlationId = res.headers["x-correlation-id"];
      expect(correlationId).toEqual(expect.any(String));

      const outboxRow = await OutboxMessageModel.findOne({
        where: { event_name: "ProductCreatedEvent" },
      });
      expect(outboxRow).not.toBeNull();
      expect(outboxRow!.routing_key).toBe("product.created");
      expect(outboxRow!.correlation_id).toBe(correlationId);
      expect(outboxRow!.status).toBe("pending");
      expect(JSON.parse(outboxRow!.payload)).toMatchObject({ id: res.body.id, name: "Notebook" });
    });

    it("should create a product with zero price", async () => {
      const res = await authedRequest(app).post("/products").send({ name: "Freebie", price: 0 });

      expect(res.status).toBe(201);
      expect(res.body.price).toBe(0);
    });

    it("should return 400 when name is missing", async () => {
      const res = await authedRequest(app).post("/products").send({ price: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("should return 400 when price is missing", async () => {
      const res = await authedRequest(app)
        .post("/products")
        .send({ name: "Product Without Price" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("should return 400 when price is negative", async () => {
      const res = await authedRequest(app).post("/products").send({ name: "Invalid", price: -10 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/greater than or equal to zero/i);
    });

    it("should return 400 when price is a string", async () => {
      const res = await authedRequest(app)
        .post("/products")
        .send({ name: "Invalid", price: "abc" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/number/i);
    });
  });

  // ─────────────────────────────────────────────
  // GET /products/:id
  // ─────────────────────────────────────────────

  describe("GET /products/:id", () => {
    it("should return a product by id", async () => {
      const createRes = await authedRequest(app)
        .post("/products")
        .send({ name: "Keyboard", price: 350 });

      const id = createRes.body.id;

      const res = await authedRequest(app).get(`/products/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.name).toBe("Keyboard");
      expect(res.body.price).toBe(350);
    });

    it("should return 404 for a non-existing id", async () => {
      const res = await authedRequest(app).get("/products/invalid-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Product not found");
    });
  });

  // ─────────────────────────────────────────────
  // GET /products
  // ─────────────────────────────────────────────

  describe("GET /products", () => {
    it("should list all products", async () => {
      await authedRequest(app).post("/products").send({ name: "Mouse", price: 80 });
      await authedRequest(app).post("/products").send({ name: "Monitor", price: 1200 });

      const res = await authedRequest(app).get("/products");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(
        expect.arrayContaining(["Mouse", "Monitor"]),
      );
    });

    it("should return an empty array when there are no products", async () => {
      const res = await authedRequest(app).get("/products");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // PUT /products/:id
  // ─────────────────────────────────────────────

  describe("PUT /products/:id", () => {
    it("should update product name", async () => {
      const createRes = await authedRequest(app)
        .post("/products")
        .send({ name: "Old Name", price: 100 });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/products/${id}`).send({ name: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
      expect(res.body.price).toBe(100);
    });

    it("should update product price", async () => {
      const createRes = await authedRequest(app)
        .post("/products")
        .send({ name: "Product", price: 100 });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/products/${id}`).send({ price: 250 });

      expect(res.status).toBe(200);
      expect(res.body.price).toBe(250);
    });

    it("should update name and price simultaneously", async () => {
      const createRes = await authedRequest(app).post("/products").send({ name: "Old", price: 50 });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/products/${id}`).send({ name: "New", price: 75 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New");
      expect(res.body.price).toBe(75);
    });

    it("should return 404 when updating a non-existing product", async () => {
      const res = await authedRequest(app).put("/products/non-existing").send({ name: "Anyone" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Product not found");
    });

    it("should return 400 when setting an empty name", async () => {
      const createRes = await authedRequest(app)
        .post("/products")
        .send({ name: "Product", price: 100 });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/products/${id}`).send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });

    it("should return 400 when setting a negative price", async () => {
      const createRes = await authedRequest(app)
        .post("/products")
        .send({ name: "Product", price: 100 });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/products/${id}`).send({ price: -5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/greater than or equal to zero/i);
    });
  });

  // ─────────────────────────────────────────────
  // DELETE /products/:id
  // ─────────────────────────────────────────────

  describe("DELETE /products/:id", () => {
    it("should delete an existing product and return 204", async () => {
      const createRes = await authedRequest(app)
        .post("/products")
        .send({ name: "To Delete", price: 10 });

      const id = createRes.body.id;

      const deleteRes = await authedRequest(app).delete(`/products/${id}`);
      expect(deleteRes.status).toBe(204);

      const getRes = await authedRequest(app).get(`/products/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 when deleting a non-existing product", async () => {
      const res = await authedRequest(app).delete("/products/non-existing");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Product not found");
    });
  });
});
