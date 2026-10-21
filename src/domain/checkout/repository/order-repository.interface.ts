import { Transaction } from "sequelize";
import { OutboxMessageInput } from "../../@shared/outbox/outbox-message.interface";
import RepositoryInterface from "../../@shared/repository/repository-interface";
import Order from "../entity/order";

export default interface OrderRepositoryInterface extends RepositoryInterface<Order> {
  /**
   * An externally supplied transaction lets a caller (see order.routes.ts)
   * commit the order/outbox write and a related write on another aggregate
   * (the customer's reward points) as one atomic unit. Without it, a failure
   * between the two calls would leave the order placed but the reward points
   * ungranted.
   */
  create(
    entity: Order,
    outboxMessages?: OutboxMessageInput[],
    transaction?: Transaction,
  ): Promise<void>;
}
