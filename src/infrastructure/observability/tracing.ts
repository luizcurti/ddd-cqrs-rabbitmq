/**
 * Initializes OpenTelemetry tracing. This file must be the FIRST import in
 * every process entrypoint (server.ts, consumer.ts, outbox-relay.ts) —
 * before express/amqplib/pg are required anywhere — because instrumentation
 * works by monkey-patching those modules the first time Node requires them.
 * Import it any later and the patches silently never attach.
 */
import dotenv from "dotenv";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { AmqplibInstrumentation } from "@opentelemetry/instrumentation-amqplib";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";

// This file loads before the entrypoint's own dotenv.config() call runs
// (that's the whole point), so it can't rely on that call having happened —
// it loads .env itself before reading OTEL_* below.
dotenv.config();

const serviceName = process.env.OTEL_SERVICE_NAME || "ddd-cqrs-rabbitmq";
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "http://localhost:4318/v1/traces";

const sdk = new NodeSDK({
  resource: defaultResource().merge(resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName })),
  traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    // Propagates trace context through RabbitMQ message headers on publish
    // and extracts it again on consume, so one trace spans the app, the
    // outbox relay, and the consumer even though they only ever talk to
    // each other through the broker.
    new AmqplibInstrumentation(),
    new PgInstrumentation(),
  ],
});

sdk.start();

/**
 * Called by each entrypoint's own shutdown sequence (server.ts, consumer.ts,
 * outbox-relay.ts) — not registered as its own SIGTERM/SIGINT handler here.
 * This module has no visibility into the HTTP server, RabbitMQ connection,
 * or DB pool those entrypoints own, so it can't safely call process.exit()
 * itself: doing so would race an entrypoint's own graceful drain and could
 * kill the process mid-shutdown, before in-flight work finishes.
 */
export async function shutdownTracing(): Promise<void> {
  await sdk.shutdown();
}
