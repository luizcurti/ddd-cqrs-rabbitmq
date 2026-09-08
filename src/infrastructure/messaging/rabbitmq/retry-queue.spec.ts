import { Channel } from "amqplib";
import { setupRetryQueue } from "./retry-queue";

describe("setupRetryQueue", () => {
  it("declares a fanout exchange and a TTL queue that dead-letters back to the target", async () => {
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as Channel;

    await setupRetryQueue(channel, {
      retryExchange: "events.retry",
      retryQueue: "order-placed.retry",
      targetExchange: "events",
      targetRoutingKey: "order.placed",
      delayMs: 5000,
    });

    expect(channel.assertExchange).toHaveBeenCalledWith("events.retry", "fanout", {
      durable: true,
    });
    expect(channel.assertQueue).toHaveBeenCalledWith("order-placed.retry", {
      durable: true,
      arguments: {
        "x-message-ttl": 5000,
        "x-dead-letter-exchange": "events",
        "x-dead-letter-routing-key": "order.placed",
      },
    });
    expect(channel.bindQueue).toHaveBeenCalledWith("order-placed.retry", "events.retry", "");
  });
});
