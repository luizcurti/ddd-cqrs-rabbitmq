import { Sequelize } from "sequelize-typescript";
import Order from "../../../../domain/checkout/entity/order";
import OrderItem from "../../../../domain/checkout/entity/order-item";
import Customer from "../../../../domain/customer/entity/customer";
import Address from "../../../../domain/customer/value-object/address";
import Product from "../../../../domain/product/entity/product";
import CustomerModel from "../../../customer/repository/sequelize/customer.model";
import CustomerRepository from "../../../customer/repository/sequelize/customer.repository";
import ProductModel from "../../../product/repository/sequelize/product.model";
import ProductRepository from "../../../product/repository/sequelize/product.repository";
import OutboxMessageModel from "../../../outbox/outbox-message.model";
import { OutboxMessageInput } from "../../../../domain/@shared/outbox/outbox-message.interface";
import OrderItemModel from "./order-item.model";
import OrderModel from "./order.model";
import OrderRepository from "./order.repository";

describe("Order repository test", () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
      sync: { force: true },
    });

    await sequelize.addModels([
      CustomerModel,
      OrderModel,
      OrderItemModel,
      ProductModel,
      OutboxMessageModel,
    ]);
    await sequelize.sync();
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function createCustomerAndProduct() {
    const customerRepository = new CustomerRepository();
    const customer = new Customer("123", "Customer 1");
    const address = new Address("Street 1", 1, "Zipcode 1", "City 1");
    customer.changeAddress(address);
    await customerRepository.create(customer);

    const productRepository = new ProductRepository();
    const product = new Product("123", "Product 1", 10);
    await productRepository.create(product);

    return { customer, product };
  }

  it("should create a new order", async () => {
    const { product } = await createCustomerAndProduct();

    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("123", "123", [orderItem]);

    const orderRepository = new OrderRepository();
    await orderRepository.create(order);

    const orderModel = await OrderModel.findOne({
      where: { id: order.id },
      include: ["items"],
    });

    expect(orderModel.toJSON()).toStrictEqual({
      id: "123",
      customer_id: "123",
      total: order.total(),
      items: [
        {
          id: orderItem.id,
          name: orderItem.name,
          price: orderItem.unitPrice,
          quantity: orderItem.quantity,
          order_id: "123",
          product_id: "123",
        },
      ],
    });
  });

  it("writes an outbox row atomically with the order (transactional outbox)", async () => {
    const { product } = await createCustomerAndProduct();
    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("123", "123", [orderItem]);

    const orderRepository = new OrderRepository();
    await orderRepository.create(order, [
      {
        eventName: "OrderPlacedEvent",
        routingKey: "order.placed",
        correlationId: "corr-1",
        payload: { id: order.id, total: order.total() },
      },
    ]);

    const outboxRows = await OutboxMessageModel.findAll({
      where: { event_name: "OrderPlacedEvent" },
    });
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].routing_key).toBe("order.placed");
    expect(outboxRows[0].correlation_id).toBe("corr-1");
    expect(outboxRows[0].status).toBe("pending");
    expect(outboxRows[0].attempts).toBe(0);
    expect(JSON.parse(outboxRows[0].payload)).toEqual({ id: "123", total: order.total() });
  });

  it("rolls back the order write when the outbox insert fails, proving they commit as one unit", async () => {
    const { product } = await createCustomerAndProduct();
    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("999", "123", [orderItem]);

    const orderRepository = new OrderRepository();
    // eventName: null violates the outbox table's NOT NULL constraint, so the
    // whole transaction — order, items, AND the outbox row — must roll back.
    const invalidOutboxMessage = {
      eventName: null,
      routingKey: "order.placed",
      payload: {},
    } as unknown as OutboxMessageInput;

    await expect(orderRepository.create(order, [invalidOutboxMessage])).rejects.toThrow();

    const persistedOrder = await OrderModel.findOne({ where: { id: "999" } });
    expect(persistedOrder).toBeNull();

    const outboxRows = await OutboxMessageModel.findAll();
    expect(outboxRows).toHaveLength(0);
  });

  it("commits alongside a caller-supplied transaction (e.g. a customer reward-points update)", async () => {
    const { customer, product } = await createCustomerAndProduct();
    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("123", customer.id, [orderItem]);

    const orderRepository = new OrderRepository();
    const customerRepository = new CustomerRepository();

    await sequelize.transaction(async (t) => {
      await orderRepository.create(order, [], t);
      await customerRepository.incrementRewardPoints(customer.id, 10, t);
    });

    const persistedOrder = await OrderModel.findOne({ where: { id: "123" } });
    expect(persistedOrder).not.toBeNull();
    const updatedCustomer = await customerRepository.find(customer.id);
    expect(updatedCustomer.rewardPoints).toBe(10);
  });

  it("rolls back a caller-supplied transaction's other writes when the order write fails", async () => {
    const { customer, product } = await createCustomerAndProduct();
    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("bad-order", customer.id, [orderItem]);
    // eventName: null violates the outbox table's NOT NULL constraint —
    // enough to fail the order's own transaction participation without
    // needing a second, unrelated failure mode.
    const invalidOutboxMessage = {
      eventName: null,
      routingKey: "order.placed",
      payload: {},
    } as unknown as OutboxMessageInput;

    const orderRepository = new OrderRepository();
    const customerRepository = new CustomerRepository();

    await expect(
      sequelize.transaction(async (t) => {
        await customerRepository.incrementRewardPoints(customer.id, 10, t);
        await orderRepository.create(order, [invalidOutboxMessage], t);
      }),
    ).rejects.toThrow();

    const persistedOrder = await OrderModel.findOne({ where: { id: "bad-order" } });
    expect(persistedOrder).toBeNull();
    const updatedCustomer = await customerRepository.find(customer.id);
    expect(updatedCustomer.rewardPoints).toBe(0);
  });

  it("should find an order", async () => {
    const { product } = await createCustomerAndProduct();

    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("123", "123", [orderItem]);

    const orderRepository = new OrderRepository();
    await orderRepository.create(order);

    const foundOrder = await orderRepository.find("123");

    expect(foundOrder.id).toBe("123");
    expect(foundOrder.customerId).toBe("123");
    expect(foundOrder.items).toHaveLength(1);
    expect(foundOrder.total()).toBe(order.total());
  });

  it("should throw when finding non-existent order", async () => {
    const orderRepository = new OrderRepository();
    await expect(orderRepository.find("non-existent")).rejects.toThrow("Order not found");
  });

  it("should find all orders", async () => {
    const { product } = await createCustomerAndProduct();

    const orderItem1 = new OrderItem("1", product.name, product.price, product.id, 1);
    const orderItem2 = new OrderItem("2", product.name, product.price, product.id, 2);
    const order1 = new Order("o1", "123", [orderItem1]);
    const order2 = new Order("o2", "123", [orderItem2]);

    const orderRepository = new OrderRepository();
    await orderRepository.create(order1);
    await orderRepository.create(order2);

    const orders = await orderRepository.findAll();

    expect(orders).toHaveLength(2);
    expect(orders[0].id).toBe("o1");
    expect(orders[1].id).toBe("o2");
    expect(orders[0].total()).toBe(order1.total());
    expect(orders[1].total()).toBe(order2.total());
  });

  it("should update an order", async () => {
    const { product } = await createCustomerAndProduct();

    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("123", "123", [orderItem]);

    const orderRepository = new OrderRepository();
    await orderRepository.create(order);

    const updatedItem = new OrderItem("1", product.name, product.price, product.id, 5);
    const updatedOrder = new Order("123", "123", [updatedItem]);
    await orderRepository.update(updatedOrder);

    const orderModel = await OrderModel.findOne({
      where: { id: "123" },
      include: ["items"],
    });

    expect(orderModel.total).toBe(updatedOrder.total());
    expect(orderModel.items[0].quantity).toBe(5);
  });

  it("should delete an order", async () => {
    const { product } = await createCustomerAndProduct();

    const orderItem = new OrderItem("1", product.name, product.price, product.id, 2);
    const order = new Order("123", "123", [orderItem]);

    const orderRepository = new OrderRepository();
    await orderRepository.create(order);

    await orderRepository.delete("123");

    await expect(orderRepository.find("123")).rejects.toThrow("Order not found");
  });

  it("should throw when deleting non-existent order", async () => {
    const orderRepository = new OrderRepository();
    await expect(orderRepository.delete("non-existent")).rejects.toThrow("Order not found");
  });

  it("should throw when updating a non-existent order", async () => {
    const { product } = await createCustomerAndProduct();
    const orderItem = new OrderItem("1", product.name, product.price, product.id, 1);
    const order = new Order("non-existent", "123", [orderItem]);

    const orderRepository = new OrderRepository();
    await expect(orderRepository.update(order)).rejects.toThrow("Order not found");
  });
});
