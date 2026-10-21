import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.createTable("products", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    // Matches the schema sync() has always produced: sequelize-typescript
    // infers TS `number` as INTEGER (not FLOAT) with no explicit @Column type.
    price: { type: DataTypes.INTEGER, allowNull: false },
  });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.dropTable("products");
}
