import Order from "../entity/order";
import OrderItem from "../entity/order-item";
import { v4 as uuid } from "uuid";
import Customer from "../../customer/entity/customer";

export default class OrderService {
  static rewardPointsFor(order: Order): number {
    return Math.floor(order.total() / 2);
  }

  static placeOrder(customer: Customer, items: OrderItem[]): Order {
    if (items.length === 0) {
      throw new Error("Order must have at least one item");
    }

    const order = new Order(uuid(), customer.id, items);
    customer.addRewardPoints(OrderService.rewardPointsFor(order));

    return order;
  }

  static total(orders: Order[]): number {
    if (orders.length === 0) {
      return 0;
    }

    return orders.reduce((acc, order) => acc + order.total(), 0);
  }
}
