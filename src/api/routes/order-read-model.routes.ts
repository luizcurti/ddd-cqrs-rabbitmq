import { Router, Request, Response } from "express";
import OrderReadModelRepository from "../../infrastructure/order-read-model/sequelize/order-read-model.repository";
import OrderReadModelRepositoryInterface from "../../domain/checkout/read-model/order-summary.interface";

const router = Router();
const repository: OrderReadModelRepositoryInterface = new OrderReadModelRepository();

// GET /read-models/orders
router.get("/", async (_req: Request, res: Response) => {
  try {
    const summaries = await repository.findAll();
    return res.status(200).json(summaries);
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /read-models/orders/:id
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const summary = await repository.find(req.params.id);
    return res.status(200).json(summary);
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Order summary not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

export default router;
