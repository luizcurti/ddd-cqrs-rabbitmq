import OrderItem from "./order-item";

describe("OrderItem unit tests", () => {
  it("should create a valid order item", () => {
    const orderItem = new OrderItem("1", "Product 1", 100, "p1", 2);

    expect(orderItem.id).toBe("1");
    expect(orderItem.name).toBe("Product 1");
    expect(orderItem.productId).toBe("p1");
    expect(orderItem.quantity).toBe(2);
    expect(orderItem.unitPrice).toBe(100);
    expect(orderItem.price).toBe(200); // quantity * unitPrice
  });

  it("should throw error when id is empty", () => {
    expect(() => {
      new OrderItem("", "Product 1", 100, "p1", 2);
    }).toThrow("OrderItem id is required");
  });

  it("should throw error when name is empty", () => {
    expect(() => {
      new OrderItem("1", "", 100, "p1", 2);
    }).toThrow("OrderItem name is required");
  });

  it("should throw error when productId is empty", () => {
    expect(() => {
      new OrderItem("1", "Product 1", 100, "", 2);
    }).toThrow("OrderItem productId is required");
  });

  it("should throw error when price is negative", () => {
    expect(() => {
      new OrderItem("1", "Product 1", -1, "p1", 2);
    }).toThrow("OrderItem price must be greater than or equal to zero");
  });

  it("should throw error when quantity is zero or negative", () => {
    expect(() => {
      new OrderItem("1", "Product 1", 100, "p1", 0);
    }).toThrow("OrderItem quantity must be greater than zero");

    expect(() => {
      new OrderItem("1", "Product 1", 100, "p1", -1);
    }).toThrow("OrderItem quantity must be greater than zero");
  });

  it("should allow zero price", () => {
    const orderItem = new OrderItem("1", "Free Product", 0, "p1", 2);

    expect(orderItem.unitPrice).toBe(0);
    expect(orderItem.price).toBe(0);
  });
});
