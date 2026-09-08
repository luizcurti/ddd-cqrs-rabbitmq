export interface OrderSummary {
  id: string;
  customerId: string;
  total: number;
  itemsCount: number;
  placedAt: Date;
}

export default interface OrderReadModelRepositoryInterface {
  upsert(summary: OrderSummary): Promise<void>;
  find(id: string): Promise<OrderSummary>;
  findAll(): Promise<OrderSummary[]>;
}
