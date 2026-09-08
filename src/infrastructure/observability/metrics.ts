import client from "prom-client";

export const register = new client.Registry();

// collectDefaultMetrics() enables a Node perf_hooks event-loop-delay monitor
// that never tears itself down — harmless for a long-running process, but it
// leaves an open handle behind Jest workers, so it's skipped under test.
if (process.env.NODE_ENV !== "test") {
  client.collectDefaultMetrics({ register });
}

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const outboxMessagesRelayedTotal = new client.Counter({
  name: "outbox_messages_relayed_total",
  help: "Total outbox messages successfully published to RabbitMQ",
  registers: [register],
});

export const outboxMessagesFailedTotal = new client.Counter({
  name: "outbox_messages_failed_total",
  help: "Total outbox relay publish attempts that failed and will retry",
  registers: [register],
});

export const outboxPendingGauge = new client.Gauge({
  name: "outbox_pending_messages",
  help: "Number of outbox rows currently pending relay to RabbitMQ",
  registers: [register],
});

export const outboxMessagesReclaimedTotal = new client.Counter({
  name: "outbox_messages_reclaimed_total",
  help: "Total outbox rows recovered from a stale 'sending' claim left behind by a crashed relay process",
  registers: [register],
});

export const consumerMessagesProcessedTotal = new client.Counter({
  name: "order_placed_consumer_messages_processed_total",
  help: "Total OrderPlaced messages successfully projected into the read model",
  registers: [register],
});

export const consumerMessagesFailedTotal = new client.Counter({
  name: "order_placed_consumer_messages_failed_total",
  help: "Total OrderPlaced messages that exhausted retries and were dead-lettered",
  registers: [register],
});

export const consumerMessagesRetriedTotal = new client.Counter({
  name: "order_placed_consumer_messages_retried_total",
  help: "Total OrderPlaced messages sent back for a delayed retry after a processing failure",
  registers: [register],
});

export const consumerProcessingDuration = new client.Histogram({
  name: "order_placed_consumer_processing_duration_seconds",
  help: "Time spent processing one OrderPlaced message, from parse to ack/nack",
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const dlqDepthGauge = new client.Gauge({
  name: "order_placed_dlq_depth",
  help: "Number of messages currently sitting in the OrderPlaced dead-letter queue",
  registers: [register],
});
