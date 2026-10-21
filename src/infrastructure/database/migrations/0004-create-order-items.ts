import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.createTable("order_items", {
    id: { type: DataTypes.STRING, primaryKey: true },
    product_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: { model: "products", key: "id" },
      onDelete: "NO ACTION",
      onUpdate: "CASCADE",
    },
    order_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.INTEGER, allowNull: false },
  });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.dropTable("order_items");
}
