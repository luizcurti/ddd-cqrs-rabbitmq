import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.addColumn("outbox_messages", "claimed_at", { type: DataTypes.DATE, allowNull: true });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.removeColumn("outbox_messages", "claimed_at");
}
