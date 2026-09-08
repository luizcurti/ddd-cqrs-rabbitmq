import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import Customer from "../../domain/customer/entity/customer";
import Address from "../../domain/customer/value-object/address";
import CustomerRepository from "../../infrastructure/customer/repository/sequelize/customer.repository";
import CustomerRepositoryInterface from "../../domain/customer/repository/customer-repository.interface";

const router = Router();
const repository: CustomerRepositoryInterface = new CustomerRepository();

function toDTO(customer: Customer) {
  return {
    id: customer.id,
    name: customer.name,
    active: customer.isActive(),
    rewardPoints: customer.rewardPoints,
    address: customer.address
      ? {
          street: customer.address.street,
          number: customer.address.number,
          zip: customer.address.zip,
          city: customer.address.city,
        }
      : null,
  };
}

// POST /customers
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, address } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    const customer = new Customer(uuid(), name);
    customer.changeAddress(new Address(address.street, address.number, address.zip, address.city));

    await repository.create(customer);

    return res.status(201).json(toDTO(customer));
  } catch (error: unknown) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

// GET /customers
router.get("/", async (_req: Request, res: Response) => {
  try {
    const customers = await repository.findAll();
    return res.status(200).json(customers.map(toDTO));
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /customers/:id
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const customer = await repository.find(req.params.id);
    return res.status(200).json(toDTO(customer));
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Customer not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

// PUT /customers/:id
router.put("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { name, address } = req.body;
    const customer = await repository.find(req.params.id);

    if (name !== undefined) {
      customer.changeName(name);
    }
    if (address) {
      customer.changeAddress(
        new Address(address.street, address.number, address.zip, address.city),
      );
    }

    await repository.update(customer);
    return res.status(200).json(toDTO(customer));
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Customer not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(400).json({ error: msg });
  }
});

// DELETE /customers/:id
router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    await repository.delete(req.params.id);
    return res.status(204).send();
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (msg === "Customer not found") {
      return res.status(404).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

export default router;
