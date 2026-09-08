import { Transaction } from "sequelize";
import Customer from "../../../../domain/customer/entity/customer";
import Address from "../../../../domain/customer/value-object/address";
import CustomerRepositoryInterface from "../../../../domain/customer/repository/customer-repository.interface";
import CustomerModel from "./customer.model";

export default class CustomerRepository implements CustomerRepositoryInterface {
  async incrementRewardPoints(
    id: string,
    points: number,
    transaction?: Transaction,
  ): Promise<void> {
    // A `SET reward_points = reward_points + ?` update, not a read-modify-write
    // — the caller already read the customer moments earlier just to place the
    // order, so a plain update() here would silently overwrite whatever
    // reward points a concurrent order for the same customer just granted.
    await CustomerModel.increment({ rewardPoints: points }, { where: { id }, transaction });
  }

  async create(entity: Customer): Promise<void> {
    if (!entity.address) {
      throw new Error("Customer address is required for persistence");
    }

    await CustomerModel.create({
      id: entity.id,
      name: entity.name,
      street: entity.address.street,
      number: entity.address.number,
      zipcode: entity.address.zip,
      city: entity.address.city,
      active: entity.isActive(),
      rewardPoints: entity.rewardPoints,
    });
  }

  async update(entity: Customer): Promise<void> {
    if (!entity.address) {
      throw new Error("Customer address is required for persistence");
    }

    const [rowsUpdated] = await CustomerModel.update(
      {
        name: entity.name,
        street: entity.address.street,
        number: entity.address.number,
        zipcode: entity.address.zip,
        city: entity.address.city,
        active: entity.isActive(),
        rewardPoints: entity.rewardPoints,
      },
      {
        where: {
          id: entity.id,
        },
      },
    );
    if (rowsUpdated === 0) {
      throw new Error("Customer not found");
    }
  }

  async find(id: string): Promise<Customer> {
    const customerModel = await CustomerModel.findOne({ where: { id } });
    if (!customerModel) {
      throw new Error("Customer not found");
    }

    const customer = new Customer(id, customerModel.name);
    customer.addRewardPoints(customerModel.rewardPoints);
    const address = new Address(
      customerModel.street,
      customerModel.number,
      customerModel.zipcode,
      customerModel.city,
    );
    customer.changeAddress(address);
    if (customerModel.active) {
      customer.activate();
    }
    return customer;
  }

  async findAll(): Promise<Customer[]> {
    const customerModels = await CustomerModel.findAll();

    const customers = customerModels.map((model) => {
      const customer = new Customer(model.id, model.name);
      customer.addRewardPoints(model.rewardPoints);
      const address = new Address(model.street, model.number, model.zipcode, model.city);
      customer.changeAddress(address);
      if (model.active) {
        customer.activate();
      }
      return customer;
    });

    return customers;
  }

  async delete(id: string): Promise<void> {
    const rows = await CustomerModel.destroy({ where: { id } });
    if (rows === 0) {
      throw new Error("Customer not found");
    }
  }
}
