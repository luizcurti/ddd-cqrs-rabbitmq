import { Transaction } from "sequelize";
import RepositoryInterface from "../../@shared/repository/repository-interface";
import Customer from "../entity/customer";

export default interface CustomerRepositoryInterface extends RepositoryInterface<Customer> {
  /**
   * Grants reward points via an atomic `SET reward_points = reward_points + ?`
   * rather than a read-modify-write, so concurrent orders for the same
   * customer can't lose one another's points (see order.routes.ts).
   */
  incrementRewardPoints(id: string, points: number, transaction?: Transaction): Promise<void>;
}
