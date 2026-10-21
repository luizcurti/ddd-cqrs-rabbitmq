import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
  tableName: "order_summaries",
  timestamps: false,
})
export default class OrderSummaryModel extends Model {
  @PrimaryKey
  @Column
  declare id: string;

  @Column({ allowNull: false })
  declare customer_id: string;

  @Column({ allowNull: false })
  declare total: number;

  @Column({ allowNull: false })
  declare items_count: number;

  @Column({ type: DataType.DATE, allowNull: false })
  declare placed_at: Date;
}
