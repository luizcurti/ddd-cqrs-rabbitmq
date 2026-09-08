import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import Product from "../../domain/product/entity/product";
import ProductRepository from "../../infrastructure/product/repository/sequelize/product.repository";
import ProductRepositoryInterface from "../../domain/product/repository/product-repository.interface";
import EventDispatcher from "../../domain/@shared/event/event-dispatcher";
import ProductCreatedEvent from "../../domain/product/event/product-created.event";
import SendEmailWhenProductIsCreatedHandler from "../../domain/product/event/handler/send-email-when-product-is-created.handler";
import { eventNameToRoutingKey } from "../../infrastructure/messaging/event-routing-key";
import { captureTraceContext } from "../../infrastructure/observability/trace-context";
import idempotency from "../../infrastructure/idempotency/idempotency.middleware";

const router = Router();
const repository: ProductRepositoryInterface = new ProductRepository();

const eventDispatcher = new EventDispatcher();
eventDispatcher.register("ProductCreatedEvent", new SendEmailWhenProductIsCreatedHandler());

function toDTO(product: Product) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
  };
}

// POST /products
router.post("/", idempotency, async (req: Request, res: Response) => {
  try {
    const { name, price } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (price === undefined || price === null) {
      return res.status(400).json({ error: "Price is required" });
    }
    if (typeof price !== "number") {
      return res.status(400).json({ error: "Price must be a number" });
    }

    const product = new Product(uuid(), name, price);
    await repository.create(product, [
      {
        eventName: "ProductCreatedEvent",
        routingKey: eventNameToRoutingKey("ProductCreatedEvent"),
        correlationId: req.correlationId,
        traceContext: captureTraceContext(),
        payload: { id: product.id, name: product.name, price: product.price },
      },
    ]);
    eventDispatcher.notify(
      new ProductCreatedEvent({ id: product.id, name: product.name, price: product.price }),
    );

    return res.status(201).json(toDTO(product));
  } catch (error: unknown) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

// GET /products
router.get("/", async (_req: Request, res: Response) => {
  try {
    const products = await repository.findAll();
    return res.status(200).json(products.map(toDTO));
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /products/:id
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const product = await repository.find(req.params.id);
    return res.status(200).json(toDTO(product));
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Product not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

// PUT /products/:id
router.put("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { name, price } = req.body;
    const product = await repository.find(req.params.id);

    if (name !== undefined) {
      product.changeName(name);
    }
    if (price !== undefined) {
      product.changePrice(price);
    }

    await repository.update(product);
    return res.status(200).json(toDTO(product));
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Product not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(400).json({ error: msg });
  }
});

// DELETE /products/:id
router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await repository.delete(req.params.id);
    return res.status(204).send();
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Product not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

export default router;
