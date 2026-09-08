import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import customerRouter from "./routes/customer.routes";
import productRouter from "./routes/product.routes";
import orderRouter from "./routes/order.routes";
import orderReadModelRouter from "./routes/order-read-model.routes";
import httpLogger from "../infrastructure/logging/http-logger.middleware";
import httpMetrics from "../infrastructure/observability/http-metrics.middleware";
import { register } from "../infrastructure/observability/metrics";
import DatabaseConfig from "../infrastructure/database/database-config";
import apiKeyAuth from "../infrastructure/security/api-key.middleware";

const app = express();

// Trust exactly one hop: nginx is the only proxy between a client and this
// process (see docker-compose.yml / docker/nginx/nginx.conf). Without this,
// Express ignores X-Forwarded-For and treats every request's `req.ip` as
// nginx's own container IP — which silently turns the per-IP rate limiter
// below into one shared bucket for all clients combined, and would let one
// noisy client 429 everyone else. `1` (not `true`) matters: `true` trusts
// every hop, including one a client could forge in its own X-Forwarded-For.
app.set("trust proxy", 1);

// Must run before apiKeyAuth below: a browser's CORS preflight (OPTIONS) is
// sent without credentials, so if auth ran first every cross-origin request
// would fail the preflight before the browser ever got to send the real one.
const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin === "*" ? "*" : corsOrigin.split(",").map((o) => o.trim()) }));

app.use(helmet());
// Unbounded JSON bodies were accepted before this — a single client could
// send an arbitrarily large payload and tie up the event loop parsing it.
app.use(express.json({ limit: "100kb" }));
app.use(httpLogger);
app.use(httpMetrics);

// Liveness: is the process up at all? Never touches a dependency, so it can't
// be dragged down by one — this is what the Docker HEALTHCHECK and
// docker-compose's depends_on condition poll.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness: can this instance actually serve traffic right now? Only checks
// Postgres — the one dependency a request on this process touches synchronously.
// RabbitMQ is deliberately not checked here: thanks to the transactional
// outbox, this process never talks to the broker directly, so a RabbitMQ
// outage doesn't stop it from accepting orders and would make this check lie.
app.get("/health/ready", async (_req, res) => {
  try {
    await DatabaseConfig.getInstance().getSequelize().authenticate();
    res.status(200).json({ status: "ok", checks: { database: "ok" } });
  } catch (error) {
    res.status(503).json({
      status: "unavailable",
      checks: { database: "error" },
      error: (error as Error).message,
    });
  }
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Everything below is rate-limited and requires an API key — /health,
// /health/ready and /metrics stay open above this line since infra probes
// and Prometheus scraping shouldn't be throttled or need credentials.
app.use(
  rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"),
    limit: parseInt(process.env.RATE_LIMIT_MAX || "300"),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  }),
);
app.use(apiKeyAuth);

app.use("/customers", customerRouter);
app.use("/products", productRouter);
app.use("/orders", orderRouter);
app.use("/read-models/orders", orderReadModelRouter);

export default app;
