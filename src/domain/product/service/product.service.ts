import Product from "../entity/product";

export default class ProductService {
  static increasePrice(products: Product[], percentage: number): Product[] {
    if (percentage < 0) {
      throw new Error("Percentage must be greater than or equal to zero");
    }

    products.forEach((product) => {
      const newPrice = product.price * (1 + percentage / 100);
      product.changePrice(newPrice);
    });
    return products;
  }
}
