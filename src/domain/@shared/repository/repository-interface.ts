import { OutboxMessageInput } from "../outbox/outbox-message.interface";

export default interface RepositoryInterface<T> {
  create(entity: T, outboxMessages?: OutboxMessageInput[]): Promise<void>;
  update(entity: T): Promise<void>;
  find(id: string): Promise<T>;
  findAll(): Promise<T[]>;
  delete(id: string): Promise<void>;
}
