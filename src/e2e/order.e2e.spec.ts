import "reflect-metadata";
import { authedRequest } from "./setup/authenticated-request";
import { Sequelize } from "sequelize-typescript";
import app from "../api/app";
import { setupE2EDatabase, truncateAllTables } from "./setup/database.helper";
import OutboxMessageModel from "../infrastructure/outbox/outbox-message.model";

describe("Order E2E — /orders", () => {
  let sequelize: Sequelize;
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    sequelize = await setupE2EDatabase();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await truncateAllTables();

    // Create base customer and product for order tests
    const customerRes = await authedRequest(app)
      .post("/customers")
      .send({
        name: "Test Customer",
        address: { street: "Test Street", number: 1, zip: "00000-000", city: "Springfield" },
      });
    customerId = customerRes.body.id;

    const productRes = await authedRequest(app)
      .post("/products")
      .send({ name: "Test Product", price: 100 });
    productId = productRes.body.id;
  });

  // ─────────────────────────────────────────────
  // POST /orders
  // ─────────────────────────────────────────────

  describe("POST /orders", () => {
    it("should create an order and return 201", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item 1", productId, price: 100, quantity: 2 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.customerId).toBe(customerId);
      expect(res.body.total).toBe(200); // 100 * 2
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe("Item 1");
      expect(res.body.items[0].unitPrice).toBe(100);
      expect(res.body.items[0].quantity).toBe(2);
      expect(res.body.items[0].total).toBe(200);
    });

    it("writes an OrderPlaced outbox row tagged with the request's correlation id", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item 1", productId, price: 100, quantity: 2 }],
        });

      const correlationId = res.headers["x-correlation-id"];
      expect(correlationId).toEqual(expect.any(String));

      const outboxRow = await OutboxMessageModel.findOne({
        where: { event_name: "OrderPlacedEvent" },
      });
      expect(outboxRow).not.toBeNull();
      expect(outboxRow!.routing_key).toBe("order.placed");
      expect(outboxRow!.correlation_id).toBe(correlationId);
      expect(outboxRow!.status).toBe("pending");
      expect(JSON.parse(outboxRow!.payload)).toMatchObject({ id: res.body.id, total: 200 });
    });

    it("should grant reward points to the customer when an order is placed", async () => {
      const before = await authedRequest(app).get(`/customers/${customerId}`);
      expect(before.body.rewardPoints).toBe(0);

      await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item 1", productId, price: 100, quantity: 2 }],
        });

      const after = await authedRequest(app).get(`/customers/${customerId}`);
      expect(after.body.rewardPoints).toBe(100); // floor(total / 2) = floor(200 / 2)
    });

    it("grants reward points from concurrent orders for the same customer without losing any", async () => {
      // Each request reads the customer, adds its own reward points in
      // memory, then persists — a plain read-modify-write update would let
      // concurrent requests overwrite one another's points. This must
      // resolve to the atomic increment used by every order, not a lost update.
      const concurrentOrders = 10;
      const pricePerOrder = 100; // reward points per order = floor(100 / 2) = 50

      await Promise.all(
        Array.from({ length: concurrentOrders }, () =>
          authedRequest(app)
            .post("/orders")
            .send({
              customerId,
              items: [{ name: "Item 1", productId, price: pricePerOrder, quantity: 1 }],
            }),
        ),
      );

      const after = await authedRequest(app).get(`/customers/${customerId}`);
      expect(after.body.rewardPoints).toBe(concurrentOrders * (pricePerOrder / 2));
    });

    it("should create an order with multiple items", async () => {
      const product2Res = await authedRequest(app)
        .post("/products")
        .send({ name: "Product 2", price: 50 });
      const productId2 = product2Res.body.id;

      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [
            { name: "Item A", productId, price: 100, quantity: 1 },
            { name: "Item B", productId: productId2, price: 50, quantity: 3 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.total).toBe(250); // 100*1 + 50*3
      expect(res.body.items).toHaveLength(2);
    });

    it("returns the exact same order for a retried request carrying the same Idempotency-Key", async () => {
      const body = { customerId, items: [{ name: "Item 1", productId, price: 100, quantity: 2 }] };

      const first = await authedRequest(app)
        .post("/orders")
        .set("Idempotency-Key", "retry-test-key")
        .send(body);
      const second = await authedRequest(app)
        .post("/orders")
        .set("Idempotency-Key", "retry-test-key")
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body); // same order id, not a second one

      const allOrders = await authedRequest(app).get("/orders");
      expect(allOrders.body).toHaveLength(1); // the retry did not create a duplicate
    });

    it("creates two separate orders for the same body when no Idempotency-Key is sent", async () => {
      const body = { customerId, items: [{ name: "Item 1", productId, price: 100, quantity: 2 }] };

      await authedRequest(app).post("/orders").send(body);
      await authedRequest(app).post("/orders").send(body);

      const allOrders = await authedRequest(app).get("/orders");
      expect(allOrders.body).toHaveLength(2); // no key sent, so no idempotency guarantee
    });

    it("should return 400 when customerId is missing", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          items: [{ name: "Item", productId, price: 100, quantity: 1 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("should return 400 when customerId does not exist", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId: "non-existing-customer",
          items: [{ name: "Item", productId, price: 100, quantity: 1 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Customer not found");
    });

    it("should return 400 when items is empty", async () => {
      const res = await authedRequest(app).post("/orders").send({ customerId, items: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("should return 400 when quantity is zero", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item", productId, price: 100, quantity: 0 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/greater than zero/i);
    });

    it("should return 400 when item price is negative", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item", productId, price: -1, quantity: 1 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/greater than or equal to zero/i);
    });

    it("should return 400 when item price is a string", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item", productId, price: "abc", quantity: 1 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/number/i);
    });

    it("should return 400 when item name is missing", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ productId, price: 100, quantity: 1 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it("should return 400 when item productId is missing", async () => {
      const res = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item", price: 100, quantity: 1 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/productId/i);
    });
  });

  // ─────────────────────────────────────────────
  // GET /orders/:id
  // ─────────────────────────────────────────────

  describe("GET /orders/:id", () => {
    it("should return an order by id", async () => {
      const createRes = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item X", productId, price: 200, quantity: 1 }],
        });

      const id = createRes.body.id;

      const res = await authedRequest(app).get(`/orders/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.customerId).toBe(customerId);
      expect(res.body.total).toBe(200);
      expect(res.body.items[0].name).toBe("Item X");
    });

    it("should return 404 for a non-existing id", async () => {
      const res = await authedRequest(app).get("/orders/non-existing-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Order not found");
    });
  });

  // ─────────────────────────────────────────────
  // GET /orders
  // ─────────────────────────────────────────────

  describe("GET /orders", () => {
    it("should list all orders", async () => {
      await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item 1", productId, price: 50, quantity: 1 }],
        });
      await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item 2", productId, price: 75, quantity: 2 }],
        });

      const res = await authedRequest(app).get("/orders");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((o: { customerId: string }) => o.customerId)).toEqual([
        customerId,
        customerId,
      ]);
    });

    it("should return an empty array when there are no orders", async () => {
      const res = await authedRequest(app).get("/orders");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // PUT /orders/:id
  // ─────────────────────────────────────────────

  describe("PUT /orders/:id", () => {
    it("should update order items", async () => {
      const createRes = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Original Item", productId, price: 100, quantity: 1 }],
        });

      const id = createRes.body.id;

      const res = await authedRequest(app)
        .put(`/orders/${id}`)
        .send({
          items: [{ name: "Updated Item", productId, price: 150, quantity: 3 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(450); // 150 * 3
      expect(res.body.items[0].name).toBe("Updated Item");
      expect(res.body.items[0].quantity).toBe(3);
    });

    it("should update an order with multiple new items", async () => {
      const createRes = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Single Item", productId, price: 50, quantity: 1 }],
        });

      const id = createRes.body.id;

      const product2Res = await authedRequest(app)
        .post("/products")
        .send({ name: "Extra Product", price: 30 });
      const productId2 = product2Res.body.id;

      const res = await authedRequest(app)
        .put(`/orders/${id}`)
        .send({
          items: [
            { name: "Item 1", productId, price: 50, quantity: 2 },
            { name: "Item 2", productId: productId2, price: 30, quantity: 1 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(130); // 50*2 + 30*1
      expect(res.body.items).toHaveLength(2);
    });

    it("should return 404 when updating a non-existing order", async () => {
      const res = await authedRequest(app)
        .put("/orders/non-existing")
        .send({
          items: [{ name: "Item", productId, price: 10, quantity: 1 }],
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Order not found");
    });

    it("should return 400 when updating with empty items", async () => {
      const createRes = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item", productId, price: 100, quantity: 1 }],
        });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/orders/${id}`).send({ items: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // DELETE /orders/:id
  // ─────────────────────────────────────────────

  describe("DELETE /orders/:id", () => {
    it("should delete an existing order and return 204", async () => {
      const createRes = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [{ name: "Item", productId, price: 10, quantity: 1 }],
        });

      const id = createRes.body.id;

      const deleteRes = await authedRequest(app).delete(`/orders/${id}`);
      expect(deleteRes.status).toBe(204);

      const getRes = await authedRequest(app).get(`/orders/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 when deleting a non-existing order", async () => {
      const res = await authedRequest(app).delete("/orders/non-existing");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Order not found");
    });

    it("should delete an order and its associated items", async () => {
      const createRes = await authedRequest(app)
        .post("/orders")
        .send({
          customerId,
          items: [
            { name: "Item A", productId, price: 10, quantity: 1 },
            { name: "Item B", productId, price: 20, quantity: 2 },
          ],
        });

      const id = createRes.body.id;

      await authedRequest(app).delete(`/orders/${id}`);

      const allOrders = await authedRequest(app).get("/orders");
      expect(allOrders.body).toHaveLength(0);
    });
  });
});
