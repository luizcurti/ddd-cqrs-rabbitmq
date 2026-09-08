import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
  tableName: "idempotency_keys",
  timestamps: false,
})
export default class IdempotencyKeyModel extends Model {
  // Composite identity as a single string: "<METHOD> <path>:<raw key>" — scopes
  // the same client-supplied key to one endpoint, so it can't collide across routes.
  @PrimaryKey
  @Column
  declare id: string;

  @Column({ allowNull: false, defaultValue: "processing" })
  declare status: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare response_status: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare response_body: string | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare created_at: Date;
}
