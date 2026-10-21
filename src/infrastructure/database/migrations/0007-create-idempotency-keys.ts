import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.createTable("idempotency_keys", {
    id: { type: DataTypes.STRING, primaryKey: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "processing" },
    response_status: { type: DataTypes.INTEGER, allowNull: true },
    response_body: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.dropTable("idempotency_keys");
}
