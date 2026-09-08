import { context, propagation } from "@opentelemetry/api";

/**
 * The outbox table is a persistence boundary amqplib's auto-instrumentation
 * can't see through: the HTTP request that writes an outbox row and the
 * later poll cycle that publishes it are two unrelated OTel contexts. To get
 * one trace spanning the whole request -> outbox -> RabbitMQ -> consumer
 * journey (not just the RabbitMQ hop), the trace context has to be
 * serialized alongside the outbox row and re-injected right before publish.
 */
export function captureTraceContext(): string {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return JSON.stringify(carrier);
}

export function withExtractedContext<T>(serialized: string | null | undefined, fn: () => T): T {
  if (!serialized) {
    return fn();
  }

  try {
    const carrier = JSON.parse(serialized);
    const extracted = propagation.extract(context.active(), carrier);
    return context.with(extracted, fn);
  } catch {
    return fn();
  }
}
