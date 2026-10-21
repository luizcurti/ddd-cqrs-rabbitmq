import OrderReadModelRepositoryInterface, {
  OrderSummary,
} from "../../../domain/checkout/read-model/order-summary.interface";
import OrderSummaryModel from "./order-summary.model";

function toOrderSummary(model: OrderSummaryModel): OrderSummary {
  return {
    id: model.id,
    customerId: model.customer_id,
    total: model.total,
    itemsCount: model.items_count,
    placedAt: model.placed_at,
  };
}

export default class OrderReadModelRepository implements OrderReadModelRepositoryInterface {
  async upsert(summary: OrderSummary): Promise<void> {
    await OrderSummaryModel.upsert({
      id: summary.id,
      customer_id: summary.customerId,
      total: summary.total,
      items_count: summary.itemsCount,
      placed_at: summary.placedAt,
    });
  }

  async find(id: string): Promise<OrderSummary> {
    const model = await OrderSummaryModel.findOne({ where: { id } });
    if (!model) {
      throw new Error("Order summary not found");
    }
    return toOrderSummary(model);
  }

  async findAll(): Promise<OrderSummary[]> {
    const models = await OrderSummaryModel.findAll();
    return models.map(toOrderSummary);
  }
}
