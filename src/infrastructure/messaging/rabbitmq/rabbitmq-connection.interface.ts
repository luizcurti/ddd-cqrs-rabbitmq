import { Channel } from "amqplib";

export default interface RabbitMqConnectionInterface {
  getChannel(): Promise<Channel>;
  close(): Promise<void>;
  /** Current known connection state — never opens a new connection itself,
   * so it's safe (and fast) to call from a readiness probe. */
  isConnected(): boolean;
}
