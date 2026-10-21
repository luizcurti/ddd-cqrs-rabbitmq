import { Transaction } from "sequelize";
import Order from "../../../../domain/checkout/entity/order";
import OrderItem from "../../../../domain/checkout/entity/order-item";
import OrderRepositoryInterface from "../../../../domain/checkout/repository/order-repository.interface";
import { OutboxMessageInput } from "../../../../domain/@shared/outbox/outbox-message.interface";
import { appendOutboxMessages } from "../../../outbox/outbox-writer";
import OrderItemModel from "./order-item.model";
import OrderModel from "./order.model";

export default class OrderRepository implements OrderRepositoryInterface {
  async create(
    entity: Order,
    outboxMessages: OutboxMessageInput[] = [],
    transaction?: Transaction,
  ): Promise<void> {
    const run = async (t: Transaction): Promise<void> => {
      await OrderModel.create(
        {
          id: entity.id,
          customer_id: entity.customerId,
          total: entity.total(),
          items: entity.items.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.unitPrice,
            product_id: item.productId,
            quantity: item.quantity,
          })),
        },
        {
          include: [{ model: OrderItemModel }],
          transaction: t,
        },
      );

      await appendOutboxMessages(outboxMessages, t);
    };

    if (transaction) {
      await run(transaction);
    } else {
      await OrderModel.sequelize!.transaction(run);
    }
  }

  async update(entity: Order): Promise<void> {
    await OrderModel.sequelize!.transaction(async (t) => {
      const [rowsUpdated] = await OrderModel.update(
        { total: entity.total() },
        { where: { id: entity.id }, transaction: t },
      );
      if (rowsUpdated === 0) {
        throw new Error("Order not found");
      }
      await OrderItemModel.destroy({ where: { order_id: entity.id }, transaction: t });
      await OrderItemModel.bulkCreate(
        entity.items.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.unitPrice,
          product_id: item.productId,
          quantity: item.quantity,
          order_id: entity.id,
        })),
        { transaction: t },
      );
    });
  }

  async find(id: string): Promise<Order> {
    const orderModel = await OrderModel.findOne({
      where: { id },
      include: [{ model: OrderItemModel }],
    });
    if (!orderModel) {
      throw new Error("Order not found");
    }
    const items = orderModel.items.map(
      (item) => new OrderItem(item.id, item.name, item.price, item.product_id, item.quantity),
    );
    return new Order(orderModel.id, orderModel.customer_id, items);
  }

  async findAll(): Promise<Order[]> {
    const orderModels = await OrderModel.findAll({
      include: [{ model: OrderItemModel }],
    });
    return orderModels.map((orderModel) => {
      const items = orderModel.items.map(
        (item) => new OrderItem(item.id, item.name, item.price, item.product_id, item.quantity),
      );
      return new Order(orderModel.id, orderModel.customer_id, items);
    });
  }

  async delete(id: string): Promise<void> {
    await OrderModel.sequelize!.transaction(async (t) => {
      await OrderItemModel.destroy({ where: { order_id: id }, transaction: t });
      const rows = await OrderModel.destroy({ where: { id }, transaction: t });
      if (rows === 0) {
        throw new Error("Order not found");
      }
    });
  }
}
