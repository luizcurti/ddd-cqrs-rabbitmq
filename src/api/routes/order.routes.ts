import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { ForeignKeyConstraintError } from "sequelize";
import Order from "../../domain/checkout/entity/order";
import OrderItem from "../../domain/checkout/entity/order-item";
import OrderService from "../../domain/checkout/service/order.service";
import OrderRepository from "../../infrastructure/order/repository/sequelize/order.repository";
import CustomerRepository from "../../infrastructure/customer/repository/sequelize/customer.repository";
import OrderRepositoryInterface from "../../domain/checkout/repository/order-repository.interface";
import CustomerRepositoryInterface from "../../domain/customer/repository/customer-repository.interface";
import { eventNameToRoutingKey } from "../../infrastructure/messaging/event-routing-key";
import { captureTraceContext } from "../../infrastructure/observability/trace-context";
import idempotency from "../../infrastructure/idempotency/idempotency.middleware";
import DatabaseConfig from "../../infrastructure/database/database-config";

const router = Router();
const repository: OrderRepositoryInterface = new OrderRepository();
const customerRepository: CustomerRepositoryInterface = new CustomerRepository();

interface OrderItemInput {
  id?: string;
  name: string;
  productId: string;
  price: number;
  quantity: number;
}

function validateItemsInput(items: unknown): string | null {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return "items are required";
  }
  for (const item of items) {
    if (!item.name) return "Each item must have a name";
    if (!item.productId) return "Each item must have a productId";
    if (typeof item.price !== "number") return "Each item price must be a number";
    if (typeof item.quantity !== "number") return "Each item quantity must be a number";
  }
  return null;
}

function toOrderItems(items: OrderItemInput[]): OrderItem[] {
  return items.map(
    (item) =>
      new OrderItem(item.id ?? uuid(), item.name, item.price, item.productId, item.quantity),
  );
}

function toClientErrorMessage(error: unknown): string {
  if (error instanceof ForeignKeyConstraintError) {
    return "customerId or productId does not exist";
  }
  return (error as Error).message;
}

function toDTO(order: Order) {
  return {
    id: order.id,
    customerId: order.customerId,
    total: order.total(),
    items: order.items.map((item) => ({
      id: item.id,
      name: item.name,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.price,
    })),
  };
}

// POST /orders
router.post("/", idempotency, async (req: Request, res: Response) => {
  try {
    const { customerId, items } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: "customerId is required" });
    }
    const validationError = validateItemsInput(items);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const customer = await customerRepository.find(customerId);
    const orderItems = toOrderItems(items);
    const order = OrderService.placeOrder(customer, orderItems);
    const rewardPoints = OrderService.rewardPointsFor(order);

    // Order creation (+ outbox row) and the customer's reward-point grant
    // commit as one transaction: either both happen, or neither does. The
    // reward points are applied as an atomic increment (not a read-modify-
    // write of the `customer` loaded above) so two concurrent orders for the
    // same customer can't clobber each other's points.
    await DatabaseConfig.getInstance()
      .getSequelize()
      .transaction(async (transaction) => {
        await repository.create(
          order,
          [
            {
              eventName: "OrderPlacedEvent",
              routingKey: eventNameToRoutingKey("OrderPlacedEvent"),
              correlationId: req.correlationId,
              traceContext: captureTraceContext(),
              payload: {
                id: order.id,
                customerId: order.customerId,
                total: order.total(),
                items: order.items.map((item) => ({
                  productId: item.productId,
                  name: item.name,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                })),
              },
            },
          ],
          transaction,
        );
        await customerRepository.incrementRewardPoints(customer.id, rewardPoints, transaction);
      });

    return res.status(201).json(toDTO(order));
  } catch (error: unknown) {
    return res.status(400).json({ error: toClientErrorMessage(error) });
  }
});

// GET /orders
router.get("/", async (_req: Request, res: Response) => {
  try {
    const orders = await repository.findAll();
    return res.status(200).json(orders.map(toDTO));
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /orders/:id
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const order = await repository.find(req.params.id);
    return res.status(200).json(toDTO(order));
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Order not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

// PUT /orders/:id
router.put("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { items } = req.body;

    const validationError = validateItemsInput(items);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const existing = await repository.find(req.params.id);
    const orderItems = toOrderItems(items);
    const updatedOrder = new Order(existing.id, existing.customerId, orderItems);
    await repository.update(updatedOrder);

    return res.status(200).json(toDTO(updatedOrder));
  } catch (error: unknown) {
    const msg = toClientErrorMessage(error);
    if (msg === "Order not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(400).json({ error: msg });
  }
});

// DELETE /orders/:id
router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await repository.delete(req.params.id);
    return res.status(204).send();
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Order not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

export default router;
