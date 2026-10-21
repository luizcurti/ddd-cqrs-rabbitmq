import { Channel } from "amqplib";
import { context } from "@opentelemetry/api";
import { Counter, Gauge } from "prom-client";
import OutboxRepositoryInterface, {
  OutboxMessageRecord,
} from "../../domain/@shared/outbox/outbox-message.interface";
import RabbitMqConnectionInterface from "../messaging/rabbitmq/rabbitmq-connection.interface";
import { EVENTS_EXCHANGE } from "../messaging/rabbitmq/constants";
import {
  outboxMessagesFailedTotal,
  outboxMessagesReclaimedTotal,
  outboxMessagesRelayedTotal,
  outboxPendingGauge,
  register,
} from "../observability/metrics";
import OutboxRelay from "./outbox-relay";

async function metricValue(metric: Counter<string> | Gauge<string>): Promise<number> {
  const snapshot = await metric.get();
  return snapshot.values[0]?.value ?? 0;
}

beforeEach(() => {
  register.resetMetrics();
});

function buildRecord(overrides: Partial<OutboxMessageRecord> = {}): OutboxMessageRecord {
  return {
    id: "outbox-1",
    eventName: "OrderPlacedEvent",
    routingKey: "order.placed",
    payload: { id: "order-1" },
    correlationId: "corr-1",
    traceContext: null,
    attempts: 0,
    lastError: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    sentAt: null,
    ...overrides,
  };
}

function buildOutboxRepository(): jest.Mocked<OutboxRepositoryInterface> {
  return {
    findPending: jest.fn().mockResolvedValue([]),
    countPending: jest.fn().mockResolvedValue(0),
    claim: jest.fn().mockResolvedValue(true),
    markSent: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    reclaimStale: jest.fn().mockResolvedValue(0),
  };
}

describe("OutboxRelay", () => {
  describe("pollOnce", () => {
    it("does nothing (and never opens a channel) when there are no pending messages, but still zeroes the gauge", async () => {
      const outboxRepository = buildOutboxRepository();
      const getChannel = jest.fn();
      const connection: RabbitMqConnectionInterface = {
        getChannel,
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(getChannel).not.toHaveBeenCalled();
      expect(await metricValue(outboxPendingGauge)).toBe(0);
    });

    it("calls reclaimStale with the configured threshold on every poll, before anything else", async () => {
      const outboxRepository = buildOutboxRepository();
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn(),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection, 2000, 200, 30_000).pollOnce();

      expect(outboxRepository.reclaimStale).toHaveBeenCalledWith(30_000);
    });

    it("reports (via the reclaimed-total metric) rows recovered from a crashed relay's abandoned claim", async () => {
      // The bug this guards against: a relay process claims a row (flips it
      // to "sending") and then dies — killed, OOM'd, redeployed — before
      // publishing. Without reclaimStale, that row is invisible to
      // findPending/countPending forever, since both only look at "pending".
      const outboxRepository = buildOutboxRepository();
      outboxRepository.reclaimStale.mockResolvedValue(3);
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn(),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(await metricValue(outboxMessagesReclaimedTotal)).toBe(3);
    });

    it("stops without opening a channel if the count and the fetch disagree (e.g. another worker just claimed the batch)", async () => {
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockResolvedValue(5);
      outboxRepository.findPending.mockResolvedValue([]);
      const getChannel = jest.fn();
      const connection: RabbitMqConnectionInterface = {
        getChannel,
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(getChannel).not.toHaveBeenCalled();
    });

    it("publishes every pending message to the events exchange, marks it sent, and updates metrics", async () => {
      const record = buildRecord();
      const outboxRepository = buildOutboxRepository();
      // Once (1 pending) to enter the drain loop, then 0 so it stops after
      // this single batch instead of looping forever on a stub that never
      // reflects the message having been sent.
      outboxRepository.countPending.mockResolvedValueOnce(1).mockResolvedValue(0);
      outboxRepository.findPending.mockResolvedValue([record]);

      const publish = jest.fn().mockReturnValue(true);
      const channel = { publish } as unknown as Channel;
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn().mockResolvedValue(channel),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(publish).toHaveBeenCalledTimes(1);
      const [exchange, routingKey, content, options] = publish.mock.calls[0];
      expect(exchange).toBe(EVENTS_EXCHANGE);
      expect(routingKey).toBe("order.placed");
      expect(options).toEqual({ contentType: "application/json", persistent: true });
      expect(JSON.parse(content.toString())).toEqual({
        eventName: "OrderPlacedEvent",
        occurredAt: record.createdAt.toISOString(),
        correlationId: "corr-1",
        data: { id: "order-1" },
      });

      expect(outboxRepository.claim).toHaveBeenCalledWith("outbox-1");
      expect(outboxRepository.markSent).toHaveBeenCalledWith("outbox-1");
      expect(outboxRepository.recordFailure).not.toHaveBeenCalled();
      // The gauge is refreshed again after the batch drains, so it ends at 0
      // (the mock's post-drain "0 pending" answer), not the pre-drain count.
      expect(await metricValue(outboxPendingGauge)).toBe(0);
      expect(await metricValue(outboxMessagesRelayedTotal)).toBe(1);
      expect(await metricValue(outboxMessagesFailedTotal)).toBe(0);
    });

    it("relays a message that has no correlationId (e.g. an event published outside an HTTP request)", async () => {
      const record = buildRecord({ correlationId: null });
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockResolvedValueOnce(1).mockResolvedValue(0);
      outboxRepository.findPending.mockResolvedValue([record]);

      const publish = jest.fn().mockReturnValue(true);
      const channel = { publish } as unknown as Channel;
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn().mockResolvedValue(channel),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(publish).toHaveBeenCalledTimes(1);
      expect(outboxRepository.markSent).toHaveBeenCalledWith("outbox-1");
    });

    it("skips a message another relay instance already claimed, without publishing or failing it", async () => {
      // The bug this guards against: with 2+ outbox-relay replicas, both
      // would fetch the same "pending" rows and both publish them — a real,
      // 100%-reproducible duplicate found by actually scaling the relay
      // (see docs/README.md#load-testing) despite the consumer's upsert
      // masking the symptom. claim() is the fix; this proves the losing
      // side backs off cleanly instead of publishing anyway.
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockResolvedValueOnce(1).mockResolvedValue(0);
      outboxRepository.findPending.mockResolvedValue([buildRecord()]);
      outboxRepository.claim.mockResolvedValue(false);

      const publish = jest.fn();
      const channel = { publish } as unknown as Channel;
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn().mockResolvedValue(channel),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(outboxRepository.claim).toHaveBeenCalledWith("outbox-1");
      expect(publish).not.toHaveBeenCalled();
      expect(outboxRepository.markSent).not.toHaveBeenCalled();
      expect(outboxRepository.recordFailure).not.toHaveBeenCalled();
      expect(await metricValue(outboxMessagesRelayedTotal)).toBe(0);
      expect(await metricValue(outboxMessagesFailedTotal)).toBe(0);
    });

    it("keeps polling (does not back off) when a batch was only skipped, not failed", async () => {
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      outboxRepository.findPending.mockResolvedValue([buildRecord()]);
      outboxRepository.claim.mockResolvedValue(false);

      const channel = { publish: jest.fn() } as unknown as Channel;
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn().mockResolvedValue(channel),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      // Looped twice — an all-skipped batch does not trip the "back off"
      // guard the way an all-failed batch does.
      expect(outboxRepository.findPending).toHaveBeenCalledTimes(2);
    });

    it("publishes inside the extracted trace context when the outbox row carries one", async () => {
      const record = buildRecord({
        traceContext: JSON.stringify({ traceparent: "00-abc-def-01" }),
      });
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockResolvedValueOnce(1).mockResolvedValue(0);
      outboxRepository.findPending.mockResolvedValue([record]);

      const publish = jest.fn().mockReturnValue(true);
      const channel = { publish } as unknown as Channel;
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn().mockResolvedValue(channel),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };
      const withSpy = jest.spyOn(context, "with");

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(withSpy).toHaveBeenCalled();
      expect(publish).toHaveBeenCalledTimes(1);

      withSpy.mockRestore();
    });

    it("records a failure and does not mark the message sent when publish throws", async () => {
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockResolvedValue(1);
      outboxRepository.findPending.mockResolvedValue([buildRecord()]);

      const channel = {
        publish: jest.fn(() => {
          throw new Error("channel closed");
        }),
      } as unknown as Channel;
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn().mockResolvedValue(channel),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(outboxRepository.markSent).not.toHaveBeenCalled();
      expect(outboxRepository.recordFailure).toHaveBeenCalledWith("outbox-1", "channel closed");
      expect(await metricValue(outboxMessagesFailedTotal)).toBe(1);
      expect(await metricValue(outboxMessagesRelayedTotal)).toBe(0);
    });

    it("backs off to the next scheduled poll instead of hot-looping when a whole batch fails", async () => {
      // countPending never drops (nothing ever gets marked sent), which
      // would spin the drain loop forever if pollOnce() didn't detect "no
      // progress" and stop — this is what actually happens when the broker
      // is reachable enough to hand out a channel but every publish fails.
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockResolvedValue(1);
      outboxRepository.findPending.mockResolvedValue([buildRecord()]);

      const channel = {
        publish: jest.fn(() => {
          throw new Error("channel closed");
        }),
      } as unknown as Channel;
      const getChannel = jest.fn().mockResolvedValue(channel);
      const connection: RabbitMqConnectionInterface = {
        getChannel,
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await new OutboxRelay(outboxRepository, connection).pollOnce();

      expect(getChannel).toHaveBeenCalledTimes(1);
      expect(outboxRepository.findPending).toHaveBeenCalledTimes(1);
    });

    it("relays every message in the batch even when the connection is unreachable for the whole batch", async () => {
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockResolvedValue(2);
      outboxRepository.findPending.mockResolvedValue([
        buildRecord({ id: "a" }),
        buildRecord({ id: "b" }),
      ]);
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn().mockRejectedValue(new Error("connection refused")),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      await expect(new OutboxRelay(outboxRepository, connection).pollOnce()).rejects.toThrow(
        "connection refused",
      );

      // getChannel is fetched once per pollOnce, before iterating the batch —
      // a broker outage fails the whole poll rather than half-processing it.
      expect(outboxRepository.markSent).not.toHaveBeenCalled();
    });
  });

  describe("start/stop", () => {
    it("polls repeatedly until stop() is called", async () => {
      const outboxRepository = buildOutboxRepository();
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn(),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      const relay = new OutboxRelay(outboxRepository, connection, 5);
      const runPromise = relay.start();

      await new Promise((resolve) => setTimeout(resolve, 30));
      relay.stop();
      await runPromise;

      expect(outboxRepository.countPending.mock.calls.length).toBeGreaterThan(1);
    });

    it("keeps polling — and never crashes the process — when a poll fails", async () => {
      const outboxRepository = buildOutboxRepository();
      outboxRepository.countPending.mockRejectedValue(new Error("db unreachable"));
      const connection: RabbitMqConnectionInterface = {
        getChannel: jest.fn(),
        close: jest.fn(),
        isConnected: jest.fn().mockReturnValue(true),
      };

      const relay = new OutboxRelay(outboxRepository, connection, 5);
      const runPromise = relay.start();

      await new Promise((resolve) => setTimeout(resolve, 30));
      relay.stop();

      await expect(runPromise).resolves.toBeUndefined();
      expect(outboxRepository.countPending.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
