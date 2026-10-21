import { Channel } from "amqplib";
import { setupDeadLetterQueue } from "./dead-letter";

describe("setupDeadLetterQueue", () => {
  it("declares the dead-letter exchange, the DLQ, and binds them together", async () => {
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as Channel;

    await setupDeadLetterQueue(channel, {
      dlxExchange: "events.dlx",
      dlqQueue: "order-placed.dlq",
    });

    expect(channel.assertExchange).toHaveBeenCalledWith("events.dlx", "fanout", {
      durable: true,
    });
    expect(channel.assertQueue).toHaveBeenCalledWith("order-placed.dlq", { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith("order-placed.dlq", "events.dlx", "");
  });
});
