import { ConfirmChannel, GetMessage } from "amqplib";
import { EVENTS_EXCHANGE } from "../rabbitmq/constants";
import { ORDER_PLACED_DLQ, ORDER_PLACED_ROUTING_KEY } from "../consumers/order-placed.consumer";
import { replayOrderPlacedDlq } from "./order-placed-dlq-replay";

function fakeMessage(content: string): GetMessage {
  return { content: Buffer.from(content) } as unknown as GetMessage;
}

// Confirms the broker accepted every publish before the caller's ack()
// removes the original off the DLQ — a real ConfirmChannel invokes this
// callback asynchronously once the broker's ack comes back.
function confirmingPublish(): jest.Mock {
  return jest.fn((_exchange, _routingKey, _content, _options, callback) => {
    callback(null);
    return true;
  });
}

describe("replayOrderPlacedDlq", () => {
  it("drains every message in the DLQ, republishing and acking each one only after the broker confirms", async () => {
    const messages = [fakeMessage("first"), fakeMessage("second")];
    const get = jest
      .fn()
      .mockResolvedValueOnce(messages[0])
      .mockResolvedValueOnce(messages[1])
      .mockResolvedValueOnce(false);
    const channel = {
      get,
      publish: confirmingPublish(),
      ack: jest.fn(),
    } as unknown as ConfirmChannel;

    const result = await replayOrderPlacedDlq(channel);

    expect(result).toEqual({ replayed: 2 });
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledWith(ORDER_PLACED_DLQ, { noAck: false });

    expect(channel.publish).toHaveBeenNthCalledWith(
      1,
      EVENTS_EXCHANGE,
      ORDER_PLACED_ROUTING_KEY,
      messages[0].content,
      { contentType: "application/json", persistent: true },
      expect.any(Function),
    );
    expect(channel.publish).toHaveBeenNthCalledWith(
      2,
      EVENTS_EXCHANGE,
      ORDER_PLACED_ROUTING_KEY,
      messages[1].content,
      { contentType: "application/json", persistent: true },
      expect.any(Function),
    );
    expect(channel.ack).toHaveBeenCalledWith(messages[0]);
    expect(channel.ack).toHaveBeenCalledWith(messages[1]);
  });

  it("returns zero when the dead-letter queue is already empty", async () => {
    const channel = {
      get: jest.fn().mockResolvedValue(false),
      publish: confirmingPublish(),
      ack: jest.fn(),
    } as unknown as ConfirmChannel;

    const result = await replayOrderPlacedDlq(channel);

    expect(result).toEqual({ replayed: 0 });
    expect(channel.publish).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it("does not ack the original message when the broker rejects the republish", async () => {
    const messages = [fakeMessage("first")];
    const get = jest.fn().mockResolvedValueOnce(messages[0]).mockResolvedValueOnce(false);
    const channel = {
      get,
      publish: jest.fn((_exchange, _routingKey, _content, _options, callback) => {
        callback(new Error("channel closed"));
        return true;
      }),
      ack: jest.fn(),
    } as unknown as ConfirmChannel;

    await expect(replayOrderPlacedDlq(channel)).rejects.toThrow("channel closed");
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
