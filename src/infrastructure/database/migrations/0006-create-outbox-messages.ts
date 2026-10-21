import { DataTypes, QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.createTable("outbox_messages", {
    id: { type: DataTypes.STRING, primaryKey: true },
    event_name: { type: DataTypes.STRING, allowNull: false },
    routing_key: { type: DataTypes.STRING, allowNull: false },
    payload: { type: DataTypes.TEXT, allowNull: false },
    correlation_id: { type: DataTypes.STRING, allowNull: true },
    trace_context: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    sent_at: { type: DataTypes.DATE, allowNull: true },
  });
}

export async function down({ context: qi }: { context: QueryInterface }): Promise<void> {
  await qi.dropTable("outbox_messages");
}
