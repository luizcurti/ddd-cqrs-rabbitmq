import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.createTable("customers", {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    street: { type: DataTypes.STRING, allowNull: false },
    number: { type: DataTypes.INTEGER, allowNull: false },
    zipcode: { type: DataTypes.STRING, allowNull: false },
    city: { type: DataTypes.STRING, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false },
    rewardPoints: { type: DataTypes.INTEGER, allowNull: false },
  });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.dropTable("customers");
}
