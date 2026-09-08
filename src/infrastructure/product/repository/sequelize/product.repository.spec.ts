import { Sequelize } from "sequelize-typescript";
import Product from "../../../../domain/product/entity/product";
import OutboxMessageModel from "../../../outbox/outbox-message.model";
import { OutboxMessageInput } from "../../../../domain/@shared/outbox/outbox-message.interface";
import ProductModel from "./product.model";
import ProductRepository from "./product.repository";

describe("Product repository test", () => {
  let sequileze: Sequelize;

  beforeEach(async () => {
    sequileze = new Sequelize({
      dialect: "sqlite",
      storage: ":memory:",
      logging: false,
      sync: { force: true },
    });
    sequileze.addModels([ProductModel, OutboxMessageModel]);
    await sequileze.sync();
  });

  afterEach(async () => {
    await sequileze.close();
  });

  it("should create a product", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("1", "Product 1", 100);

    await productRepository.create(product);

    const productModel = await ProductModel.findOne({ where: { id: "1" } });

    expect(productModel.toJSON()).toStrictEqual({
      id: "1",
      name: "Product 1",
      price: 100,
    });
  });

  it("writes an outbox row atomically with the product (transactional outbox)", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("1", "Product 1", 100);

    await productRepository.create(product, [
      {
        eventName: "ProductCreatedEvent",
        routingKey: "product.created",
        correlationId: "corr-2",
        payload: { id: product.id, name: product.name, price: product.price },
      },
    ]);

    const outboxRows = await OutboxMessageModel.findAll({
      where: { event_name: "ProductCreatedEvent" },
    });
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].routing_key).toBe("product.created");
    expect(outboxRows[0].correlation_id).toBe("corr-2");
    expect(outboxRows[0].status).toBe("pending");
  });

  it("rolls back the product write when the outbox insert fails, proving they commit as one unit", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("2", "Product 2", 50);
    const invalidOutboxMessage = {
      eventName: null,
      routingKey: "product.created",
      payload: {},
    } as unknown as OutboxMessageInput;

    await expect(productRepository.create(product, [invalidOutboxMessage])).rejects.toThrow();

    const persistedProduct = await ProductModel.findOne({ where: { id: "2" } });
    expect(persistedProduct).toBeNull();

    const outboxRows = await OutboxMessageModel.findAll();
    expect(outboxRows).toHaveLength(0);
  });

  it("should update a product", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("1", "Product 1", 100);

    await productRepository.create(product);

    const productModel = await ProductModel.findOne({ where: { id: "1" } });

    expect(productModel.toJSON()).toStrictEqual({
      id: "1",
      name: "Product 1",
      price: 100,
    });

    product.changeName("Product 2");
    product.changePrice(200);

    await productRepository.update(product);

    const productModel2 = await ProductModel.findOne({ where: { id: "1" } });

    expect(productModel2.toJSON()).toStrictEqual({
      id: "1",
      name: "Product 2",
      price: 200,
    });
  });

  it("should find a product", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("1", "Product 1", 100);

    await productRepository.create(product);

    const productModel = await ProductModel.findOne({ where: { id: "1" } });

    const foundProduct = await productRepository.find("1");

    expect(productModel.toJSON()).toStrictEqual({
      id: foundProduct.id,
      name: foundProduct.name,
      price: foundProduct.price,
    });
  });

  it("should throw an error when product is not found", async () => {
    const productRepository = new ProductRepository();

    await expect(productRepository.find("non-existent")).rejects.toThrow("Product not found");
  });

  it("should find all products", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("1", "Product 1", 100);
    await productRepository.create(product);

    const product2 = new Product("2", "Product 2", 200);
    await productRepository.create(product2);

    const foundProducts = await productRepository.findAll();
    const products = [product, product2];

    expect(products).toEqual(foundProducts);
  });

  it("should throw when updating a non-existent product", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("non-existent", "Product 1", 100);

    await expect(productRepository.update(product)).rejects.toThrow("Product not found");
  });

  it("should delete a product", async () => {
    const productRepository = new ProductRepository();
    const product = new Product("1", "Product 1", 100);
    await productRepository.create(product);

    await productRepository.delete("1");

    await expect(productRepository.find("1")).rejects.toThrow("Product not found");
  });

  it("should throw when deleting non-existent product", async () => {
    const productRepository = new ProductRepository();

    await expect(productRepository.delete("non-existent")).rejects.toThrow("Product not found");
  });
});
