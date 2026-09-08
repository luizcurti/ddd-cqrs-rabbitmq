import { Channel } from "amqplib";
import { dlqDepthGauge, register } from "./metrics";
import { startDlqDepthPolling } from "./dlq-metrics";

async function gaugeValue(): Promise<number> {
  const snapshot = await dlqDepthGauge.get();
  return snapshot.values[0]?.value ?? 0;
}

describe("startDlqDepthPolling", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("sets the gauge immediately and again on every interval", async () => {
    jest.useFakeTimers();
    try {
      const checkQueue = jest
        .fn()
        .mockResolvedValueOnce({ messageCount: 3, queue: "q", consumerCount: 0 })
        .mockResolvedValueOnce({ messageCount: 5, queue: "q", consumerCount: 0 });
      const channel = { checkQueue } as unknown as Channel;

      const stop = startDlqDepthPolling(channel, "order-summary.order-placed.dlq", 10);
      await Promise.resolve();
      await Promise.resolve();

      expect(await gaugeValue()).toBe(3);

      await jest.advanceTimersByTimeAsync(10);

      expect(checkQueue).toHaveBeenCalledTimes(2);
      expect(checkQueue).toHaveBeenCalledWith("order-summary.order-placed.dlq");
      expect(await gaugeValue()).toBe(5);

      stop();
      await jest.advanceTimersByTimeAsync(50);
      expect(checkQueue).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not throw when the queue check fails, and keeps the previous value", async () => {
    jest.useFakeTimers();
    try {
      const checkQueue = jest.fn().mockRejectedValue(new Error("channel closed"));
      const channel = { checkQueue } as unknown as Channel;

      const stop = startDlqDepthPolling(channel, "order-summary.order-placed.dlq", 10);
      await Promise.resolve();
      await Promise.resolve();

      expect(await gaugeValue()).toBe(0);
      stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
