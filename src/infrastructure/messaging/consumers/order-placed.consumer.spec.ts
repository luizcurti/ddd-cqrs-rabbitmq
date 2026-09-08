import { Channel, ConsumeMessage } from "amqplib";
import OrderReadModelRepositoryInterface from "../../../domain/checkout/read-model/order-summary.interface";
import { EVENTS_EXCHANGE } from "../rabbitmq/constants";
import RabbitMqConnectionInterface from "../rabbitmq/rabbitmq-connection.interface";
import {
  consumerMessagesFailedTotal,
  consumerMessagesProcessedTotal,
  consumerMessagesRetriedTotal,
  register,
} from "../../observability/metrics";
import OrderPlacedConsumer, {
  ORDER_PLACED_DLQ,
  ORDER_PLACED_DLX,
  ORDER_PLACED_QUEUE,
  ORDER_PLACED_RETRY_EXCHANGE,
  ORDER_PLACED_RETRY_QUEUE,
  ORDER_PLACED_ROUTING_KEY,
} from "./order-placed.consumer";

async function counterValue(metric: { get(): Promise<{ values: { value: number }[] }> }) {
  const snapshot = await metric.get();
  return snapshot.values[0]?.value ?? 0;
}

beforeEach(() => {
  register.resetMetrics();
});

function toMessage(payload: unknown, headers?: Record<string, unknown>): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    properties: { headers },
  } as unknown as ConsumeMessage;
}

function buildChannel() {
  return {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    checkQueue: jest
      .fn()
      .mockResolvedValue({ queue: ORDER_PLACED_DLQ, messageCount: 0, consumerCount: 0 }),
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn(),
    on: jest.fn(),
  } as unknown as Channel;
}

function emit(channel: Channel, event: string): void {
  const handler = (channel.on as jest.Mock).mock.calls.find(([name]) => name === event)?.[1];
  handler();
}

function buildRepository(): jest.Mocked<OrderReadModelRepositoryInterface> {
  return {
    upsert: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(),
    findAll: jest.fn(),
  };
}

describe("OrderPlacedConsumer", () => {
  it("binds its queue to the events exchange, with failures routed through a delayed retry queue", async () => {
    const channel = buildChannel();
    const connection: RabbitMqConnectionInterface = {
      getChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    };

    await new OrderPlacedConsumer(buildRepository(), connection).start();

    // terminal dead-letter queue (reached only after exhausting retries)
    expect(channel.assertExchange).toHaveBeenCalledWith(ORDER_PLACED_DLX, "fanout", {
      durable: true,
    });
    expect(channel.assertQueue).toHaveBeenCalledWith(ORDER_PLACED_DLQ, { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith(ORDER_PLACED_DLQ, ORDER_PLACED_DLX, "");

    // delayed retry queue
    expect(channel.assertExchange).toHaveBeenCalledWith(ORDER_PLACED_RETRY_EXCHANGE, "fanout", {
      durable: true,
    });
    expect(channel.assertQueue).toHaveBeenCalledWith(ORDER_PLACED_RETRY_QUEUE, {
      durable: true,
      arguments: {
        "x-message-ttl": 5000,
        "x-dead-letter-exchange": EVENTS_EXCHANGE,
        "x-dead-letter-routing-key": ORDER_PLACED_ROUTING_KEY,
      },
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      ORDER_PLACED_RETRY_QUEUE,
      ORDER_PLACED_RETRY_EXCHANGE,
      "",
    );

    // main queue dead-letters into the retry queue, not straight to the DLQ
    expect(channel.assertQueue).toHaveBeenCalledWith(ORDER_PLACED_QUEUE, {
      durable: true,
      arguments: { "x-dead-letter-exchange": ORDER_PLACED_RETRY_EXCHANGE },
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      ORDER_PLACED_QUEUE,
      EVENTS_EXCHANGE,
      ORDER_PLACED_ROUTING_KEY,
    );
    expect(channel.consume).toHaveBeenCalledWith(ORDER_PLACED_QUEUE, expect.any(Function));
    expect(channel.checkQueue).toHaveBeenCalledWith(ORDER_PLACED_DLQ);
  });

  it("wires each raw amqplib message into handleMessage", async () => {
    const channel = buildChannel();
    const connection: RabbitMqConnectionInterface = {
      getChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    };
    const consumer = new OrderPlacedConsumer(buildRepository(), connection);
    const handleMessage = jest.spyOn(consumer, "handleMessage").mockResolvedValue(undefined);

    await consumer.start();

    const onMessage = (channel.consume as jest.Mock).mock.calls[0][1];
    const msg = toMessage({ eventName: "OrderPlacedEvent", occurredAt: "x", data: {} });
    onMessage(msg);

    expect(handleMessage).toHaveBeenCalledWith(channel, msg);
  });

  it("projects an OrderPlaced integration event into the read model and acks the message", async () => {
    const channel = buildChannel();
    const repository = buildRepository();
    const consumer = new OrderPlacedConsumer(repository, {
      getChannel: jest.fn(),
      close: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    });

    const msg = toMessage({
      eventName: "OrderPlacedEvent",
      occurredAt: "2026-01-01T00:00:00.000Z",
      data: {
        id: "order-1",
        customerId: "customer-1",
        total: 30,
        items: [{ productId: "p1", name: "Product 1", quantity: 2, unitPrice: 15 }],
      },
    });

    await consumer.handleMessage(channel, msg);

    expect(repository.upsert).toHaveBeenCalledWith({
      id: "order-1",
      customerId: "customer-1",
      total: 30,
      itemsCount: 1,
      placedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(await counterValue(consumerMessagesProcessedTotal)).toBe(1);
    expect(await counterValue(consumerMessagesFailedTotal)).toBe(0);
  });

  it("retries via the delayed retry queue on the first failure, instead of giving up immediately", async () => {
    const channel = buildChannel();
    const repository = buildRepository();
    repository.upsert.mockRejectedValue(new Error("db down"));
    const consumer = new OrderPlacedConsumer(repository, {
      getChannel: jest.fn(),
      close: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    });

    // No x-death header yet — this is the message's first trip through the queue.
    const msg = toMessage({
      eventName: "OrderPlacedEvent",
      occurredAt: "2026-01-01T00:00:00.000Z",
      data: { id: "order-1", customerId: "customer-1", total: 30, items: [] },
    });

    await consumer.handleMessage(channel, msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.sendToQueue).not.toHaveBeenCalled();
    expect(await counterValue(consumerMessagesRetriedTotal)).toBe(1);
    expect(await counterValue(consumerMessagesFailedTotal)).toBe(0);
  });

  it("routes straight to the dead-letter queue once retries are exhausted, without nacking back into the retry loop", async () => {
    const channel = buildChannel();
    const repository = buildRepository();
    repository.upsert.mockRejectedValue(new Error("db still down"));
    // default maxAttempts is 3: this is the 3rd attempt (2 prior rejections recorded)
    const consumer = new OrderPlacedConsumer(repository, {
      getChannel: jest.fn(),
      close: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    });

    const msg = toMessage(
      {
        eventName: "OrderPlacedEvent",
        occurredAt: "2026-01-01T00:00:00.000Z",
        data: { id: "order-1", customerId: "customer-1", total: 30, items: [] },
      },
      { "x-death": [{ queue: ORDER_PLACED_QUEUE, reason: "rejected", count: 2 }] },
    );

    await consumer.handleMessage(channel, msg);

    expect(channel.nack).not.toHaveBeenCalled();
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      ORDER_PLACED_DLQ,
      msg.content,
      expect.objectContaining({ persistent: true }),
    );
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(await counterValue(consumerMessagesFailedTotal)).toBe(1);
    expect(await counterValue(consumerMessagesRetriedTotal)).toBe(0);
  });

  it("ignores a null message (consumer cancellation notice)", async () => {
    const channel = buildChannel();
    const repository = buildRepository();
    const consumer = new OrderPlacedConsumer(repository, {
      getChannel: jest.fn(),
      close: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    });

    await consumer.handleMessage(channel, null);

    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it("resubscribes when the channel closes, retrying until the broker is reachable again", async () => {
    jest.useFakeTimers();
    try {
      const channel = buildChannel();
      const secondChannel = buildChannel();
      const getChannel = jest
        .fn()
        .mockResolvedValueOnce(channel)
        .mockRejectedValueOnce(new Error("connection refused"))
        .mockResolvedValueOnce(secondChannel);
      const connection: RabbitMqConnectionInterface = {
        getChannel,
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      const consumer = new OrderPlacedConsumer(buildRepository(), connection, 10);
      await consumer.start();

      emit(channel, "close");

      await jest.advanceTimersByTimeAsync(10); // 1st retry: getChannel rejects
      await jest.advanceTimersByTimeAsync(10); // 2nd retry: getChannel resolves

      expect(getChannel).toHaveBeenCalledTimes(3);
      expect(secondChannel.assertQueue).toHaveBeenCalledWith(ORDER_PLACED_QUEUE, {
        durable: true,
        arguments: { "x-dead-letter-exchange": ORDER_PLACED_RETRY_EXCHANGE },
      });
      expect(secondChannel.consume).toHaveBeenCalledWith(ORDER_PLACED_QUEUE, expect.any(Function));
    } finally {
      jest.useRealTimers();
    }
  });

  it("stop() prevents a resubscribe triggered by the connection it just closed", async () => {
    jest.useFakeTimers();
    try {
      const channel = buildChannel();
      const getChannel = jest.fn().mockResolvedValue(channel);
      const connection: RabbitMqConnectionInterface = {
        getChannel,
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      const consumer = new OrderPlacedConsumer(buildRepository(), connection, 10);
      await consumer.start();

      consumer.stop();
      // Closing the connection during shutdown fires the same "close" event
      // a broker-side disconnect would — must not be treated as one to
      // recover from.
      emit(channel, "close");
      await jest.advanceTimersByTimeAsync(10);

      expect(getChannel).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not schedule a second resubscribe while one is already pending", async () => {
    jest.useFakeTimers();
    try {
      const channel = buildChannel();
      const getChannel = jest.fn().mockResolvedValue(channel);
      const connection: RabbitMqConnectionInterface = {
        getChannel,
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      const consumer = new OrderPlacedConsumer(buildRepository(), connection, 10);
      await consumer.start();

      emit(channel, "close");
      emit(channel, "error"); // fires before the pending retry runs — must not double-schedule

      await jest.advanceTimersByTimeAsync(10);

      expect(getChannel).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
