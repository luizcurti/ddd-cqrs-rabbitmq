import { Request, Response, NextFunction } from "express";
import { trace } from "@opentelemetry/api";
import { v4 as uuid } from "uuid";
import logger from "./logger";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
    log: typeof logger;
  }
}

const CORRELATION_HEADER = "x-correlation-id";

/**
 * Assigns a correlation id to every request (reusing one supplied by an
 * upstream caller when present) and threads it through a child logger so
 * the same id can be picked up later in outbox/consumer logs — grep one id
 * across all three processes' logs to see one order's whole journey. Also
 * stamped onto the active OTel span (when tracing is initialized) so a trace
 * in Jaeger and a correlation id in the logs point at the same request.
 */
export default function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const correlationId = req.header(CORRELATION_HEADER) || uuid();
  req.correlationId = correlationId;
  req.log = logger.child({ correlationId });
  res.setHeader(CORRELATION_HEADER, correlationId);
  trace.getActiveSpan()?.setAttribute("correlation_id", correlationId);

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    req.log.info(
      {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      "request completed",
    );
  });

  next();
}
