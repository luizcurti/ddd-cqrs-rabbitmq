import Product from "../../../../domain/product/entity/product";
import ProductRepositoryInterface from "../../../../domain/product/repository/product-repository.interface";
import { OutboxMessageInput } from "../../../../domain/@shared/outbox/outbox-message.interface";
import { appendOutboxMessages } from "../../../outbox/outbox-writer";
import ProductModel from "./product.model";

export default class ProductRepository implements ProductRepositoryInterface {
  async create(entity: Product, outboxMessages: OutboxMessageInput[] = []): Promise<void> {
    await ProductModel.sequelize!.transaction(async (t) => {
      await ProductModel.create(
        {
          id: entity.id,
          name: entity.name,
          price: entity.price,
        },
        { transaction: t },
      );

      await appendOutboxMessages(outboxMessages, t);
    });
  }

  async update(entity: Product): Promise<void> {
    const [rowsUpdated] = await ProductModel.update(
      {
        name: entity.name,
        price: entity.price,
      },
      {
        where: {
          id: entity.id,
        },
      },
    );
    if (rowsUpdated === 0) {
      throw new Error("Product not found");
    }
  }

  async find(id: string): Promise<Product> {
    const productModel = await ProductModel.findOne({ where: { id } });
    if (!productModel) {
      throw new Error("Product not found");
    }
    return new Product(productModel.id, productModel.name, productModel.price);
  }

  async findAll(): Promise<Product[]> {
    const productModels = await ProductModel.findAll();
    return productModels.map(
      (productModel) => new Product(productModel.id, productModel.name, productModel.price),
    );
  }

  async delete(id: string): Promise<void> {
    const rows = await ProductModel.destroy({ where: { id } });
    if (rows === 0) {
      throw new Error("Product not found");
    }
  }
}
