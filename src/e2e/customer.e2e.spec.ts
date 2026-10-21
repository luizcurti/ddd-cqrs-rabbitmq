import "reflect-metadata";
import { authedRequest } from "./setup/authenticated-request";
import { Sequelize } from "sequelize-typescript";
import app from "../api/app";
import { setupE2EDatabase, truncateAllTables } from "./setup/database.helper";

describe("Customer E2E — /customers", () => {
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
  // POST /customers
  // ─────────────────────────────────────────────

  describe("POST /customers", () => {
    it("should create a customer with address and return 201", async () => {
      const res = await authedRequest(app)
        .post("/customers")
        .send({
          name: "John Smith",
          address: {
            street: "Maple Avenue",
            number: 100,
            zip: "10001",
            city: "New York",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe("John Smith");
      expect(res.body.active).toBe(false);
      expect(res.body.rewardPoints).toBe(0);
      expect(res.body.address.street).toBe("Maple Avenue");
      expect(res.body.address.number).toBe(100);
      expect(res.body.address.zip).toBe("10001");
      expect(res.body.address.city).toBe("New York");
    });

    it("should return 400 when name is missing", async () => {
      const res = await authedRequest(app)
        .post("/customers")
        .send({
          address: { street: "Main St", number: 1, zip: "10001", city: "New York" },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("should return 400 when address is missing", async () => {
      const res = await authedRequest(app).post("/customers").send({ name: "No Address" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("should return 400 when address number is zero", async () => {
      const res = await authedRequest(app)
        .post("/customers")
        .send({
          name: "Test",
          address: { street: "Main St", number: 0, zip: "10001", city: "New York" },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/greater than zero/i);
    });
  });

  // ─────────────────────────────────────────────
  // GET /customers/:id
  // ─────────────────────────────────────────────

  describe("GET /customers/:id", () => {
    it("should return a customer by id", async () => {
      const createRes = await authedRequest(app)
        .post("/customers")
        .send({
          name: "Jane Doe",
          address: { street: "Broadway", number: 200, zip: "90210", city: "Los Angeles" },
        });

      const id = createRes.body.id;

      const res = await authedRequest(app).get(`/customers/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.name).toBe("Jane Doe");
      expect(res.body.address.city).toBe("Los Angeles");
    });

    it("should return 404 for a non-existing id", async () => {
      const res = await authedRequest(app).get("/customers/non-existing-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Customer not found");
    });
  });

  // ─────────────────────────────────────────────
  // GET /customers
  // ─────────────────────────────────────────────

  describe("GET /customers", () => {
    it("should list all customers", async () => {
      await authedRequest(app)
        .post("/customers")
        .send({
          name: "Alice",
          address: { street: "Oak St", number: 1, zip: "10001", city: "Chicago" },
        });
      await authedRequest(app)
        .post("/customers")
        .send({
          name: "Bob",
          address: { street: "Pine St", number: 2, zip: "20002", city: "Houston" },
        });

      const res = await authedRequest(app).get("/customers");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((c: { name: string }) => c.name)).toEqual(
        expect.arrayContaining(["Alice", "Bob"]),
      );
    });

    it("should return an empty array when there are no customers", async () => {
      const res = await authedRequest(app).get("/customers");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // PUT /customers/:id
  // ─────────────────────────────────────────────

  describe("PUT /customers/:id", () => {
    it("should update customer name", async () => {
      const createRes = await authedRequest(app)
        .post("/customers")
        .send({
          name: "Old Name",
          address: { street: "Elm St", number: 5, zip: "10001", city: "Seattle" },
        });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/customers/${id}`).send({ name: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("should update customer address", async () => {
      const createRes = await authedRequest(app)
        .post("/customers")
        .send({
          name: "Charlie",
          address: { street: "Elm St", number: 5, zip: "10001", city: "Seattle" },
        });

      const id = createRes.body.id;

      const res = await authedRequest(app)
        .put(`/customers/${id}`)
        .send({
          address: { street: "New Street", number: 99, zip: "99999", city: "Denver" },
        });

      expect(res.status).toBe(200);
      expect(res.body.address.street).toBe("New Street");
      expect(res.body.address.city).toBe("Denver");
    });

    it("should return 404 when updating a non-existing customer", async () => {
      const res = await authedRequest(app).put("/customers/non-existing").send({ name: "Anyone" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Customer not found");
    });

    it("should return 400 when setting an empty name", async () => {
      const createRes = await authedRequest(app)
        .post("/customers")
        .send({
          name: "Valid Name",
          address: { street: "Elm St", number: 5, zip: "10001", city: "Seattle" },
        });

      const id = createRes.body.id;

      const res = await authedRequest(app).put(`/customers/${id}`).send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });
  });

  // ─────────────────────────────────────────────
  // DELETE /customers/:id
  // ─────────────────────────────────────────────

  describe("DELETE /customers/:id", () => {
    it("should delete an existing customer and return 204", async () => {
      const createRes = await authedRequest(app)
        .post("/customers")
        .send({
          name: "To Delete",
          address: { street: "Delete Ln", number: 1, zip: "10001", city: "Miami" },
        });

      const id = createRes.body.id;

      const deleteRes = await authedRequest(app).delete(`/customers/${id}`);
      expect(deleteRes.status).toBe(204);

      const getRes = await authedRequest(app).get(`/customers/${id}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 when deleting a non-existing customer", async () => {
      const res = await authedRequest(app).delete("/customers/non-existing");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Customer not found");
    });
  });
});
