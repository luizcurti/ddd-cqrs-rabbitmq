import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
  tableName: "outbox_messages",
  timestamps: false,
})
export default class OutboxMessageModel extends Model {
  @PrimaryKey
  @Column
  declare id: string;

  @Column({ allowNull: false })
  declare event_name: string;

  @Column({ allowNull: false })
  declare routing_key: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare payload: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare correlation_id: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare trace_context: string | null;

  @Column({ allowNull: false, defaultValue: "pending" })
  declare status: string;

  @Column({ allowNull: false, defaultValue: 0 })
  declare attempts: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare last_error: string | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare created_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare sent_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare claimed_at: Date | null;
}
