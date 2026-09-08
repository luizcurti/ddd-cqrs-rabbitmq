import Customer from "../../customer/entity/customer";
import Order from "../entity/order";
import OrderItem from "../entity/order-item";
import OrderService from "./order.service";
describe("Order service unit tests", () => {
  it("should place an order", () => {
    const customer = new Customer("c1", "Customer 1");
    const item1 = new OrderItem("i1", "Item 1", 10, "p1", 1);

    const order = OrderService.placeOrder(customer, [item1]);

    expect(customer.rewardPoints).toBe(5);
    expect(order.total()).toBe(10);
  });

  it("should get total of all orders", () => {
    const item1 = new OrderItem("i1", "Item 1", 100, "p1", 1);
    const item2 = new OrderItem("i2", "Item 2", 200, "p2", 2);

    const order = new Order("o1", "c1", [item1]);
    const order2 = new Order("o2", "c1", [item2]);

    const total = OrderService.total([order, order2]);

    expect(total).toBe(500);
  });

  it("should throw error when order has no items", () => {
    const customer = new Customer("c1", "Customer 1");

    expect(() => {
      OrderService.placeOrder(customer, []);
    }).toThrow("Order must have at least one item");
  });

  it("should return zero for empty order list", () => {
    const total = OrderService.total([]);

    expect(total).toBe(0);
  });

  it("should calculate correct reward points with decimal values", () => {
    const customer = new Customer("c1", "Customer 1");
    const item1 = new OrderItem("i1", "Item 1", 15, "p1", 1); // total = 15, reward = 7 (floor)

    const order = OrderService.placeOrder(customer, [item1]);

    expect(customer.rewardPoints).toBe(7); // Math.floor(15 / 2)
    expect(order.total()).toBe(15);
  });
});
