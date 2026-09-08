import Product from "../entity/product";
import ProductService from "./product.service";

describe("Product service unit tests", () => {
  it("should change the prices of all products", () => {
    const product1 = new Product("product1", "Product 1", 10);
    const product2 = new Product("product2", "Product 2", 20);
    const products = [product1, product2];

    ProductService.increasePrice(products, 100);

    expect(product1.price).toBe(20);
    expect(product2.price).toBe(40);
  });

  it("should increase prices by percentage correctly", () => {
    const product1 = new Product("product1", "Product 1", 100);
    const product2 = new Product("product2", "Product 2", 50);
    const products = [product1, product2];

    ProductService.increasePrice(products, 50); // 50% increase

    expect(product1.price).toBe(150); // 100 + 50%
    expect(product2.price).toBe(75); // 50 + 50%
  });

  it("should handle zero percentage increase", () => {
    const product1 = new Product("product1", "Product 1", 100);
    const products = [product1];

    ProductService.increasePrice(products, 0);

    expect(product1.price).toBe(100); // No change
  });

  it("should throw error for negative percentage", () => {
    const product1 = new Product("product1", "Product 1", 100);
    const products = [product1];

    expect(() => {
      ProductService.increasePrice(products, -10);
    }).toThrow("Percentage must be greater than or equal to zero");
  });

  it("should handle empty product array", () => {
    const products: Product[] = [];

    expect(() => {
      ProductService.increasePrice(products, 50);
    }).not.toThrow();
  });
});
