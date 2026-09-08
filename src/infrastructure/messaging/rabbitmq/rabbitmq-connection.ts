import { Channel, ChannelModel, connect } from "amqplib";
import RabbitMqConnectionInterface from "./rabbitmq-connection.interface";
import { EVENTS_EXCHANGE, RABBITMQ_URL } from "./constants";

export default class RabbitMqConnection implements RabbitMqConnectionInterface {
  private static instance: RabbitMqConnection;
  private connectionModel: ChannelModel | null = null;
  private channel: Channel | null = null;
  private connecting: Promise<Channel> | null = null;

  public static getInstance(): RabbitMqConnection {
    if (!RabbitMqConnection.instance) {
      RabbitMqConnection.instance = new RabbitMqConnection();
    }
    return RabbitMqConnection.instance;
  }

  public async getChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }
    if (!this.connecting) {
      // A failed attempt must not be cached, or every future call would keep
      // returning the same rejected promise even after the broker recovers.
      this.connecting = this.connect().catch((error) => {
        this.connecting = null;
        throw error;
      });
    }
    return this.connecting;
  }

  private async connect(): Promise<Channel> {
    const connectionModel = await connect(RABBITMQ_URL);

    try {
      const channel = await connectionModel.createChannel();
      await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });

      // A disconnect (broker restart, network blip) must drop the cached
      // channel/connection so the next getChannel() call reconnects instead
      // of handing out a channel that is already dead.
      connectionModel.on("close", () => this.reset());
      connectionModel.on("error", () => this.reset());
      channel.on("close", () => this.reset());
      channel.on("error", () => this.reset());

      this.connectionModel = connectionModel;
      this.channel = channel;
      return channel;
    } catch (error) {
      try {
        await connectionModel.close();
      } catch {
        // ignore — we're already propagating the original connect failure
      }
      throw error;
    }
  }

  private reset(): void {
    this.channel = null;
    this.connectionModel = null;
    this.connecting = null;
  }

  public isConnected(): boolean {
    return this.channel !== null;
  }

  public async close(): Promise<void> {
    const channel = this.channel;
    const connectionModel = this.connectionModel;
    this.reset();
    await channel?.close();
    await connectionModel?.close();
  }
}
