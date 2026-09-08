# DDD, CQRS & RabbitMQ

![Tests](https://img.shields.io/badge/tests-169%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D24.x-339933?logo=node.js&logoColor=white)

Domain events, not just folders named "domain": a real `EventDispatcher` fires and is unit-tested on every `ProductCreatedEvent` — a DDD implementation built around tactical patterns rather than a relabeled layered architecture, using Node.js, TypeScript, and Sequelize.

![System overview](docs/img/system-overview.png)

## 📋 Overview

This project demonstrates a clean architecture following DDD patterns with:
- **Domain Layer**: Core business logic and entities
- **Infrastructure Layer**: Database persistence with Sequelize ORM
- **REST API Layer**: Express HTTP server exposing full CRUD endpoints
- **Four-layer test suite**: unit, integration, E2E and a Postman/Newman collection — see the Testing section below
- **Code Quality**: ESLint + Prettier with TypeScript support, `tsc --noEmit` enforced in CI
- **Domain Events**: `EventDispatcher` / `ProductCreatedEvent` — dispatched from `POST /products` and unit-tested (see Architecture Patterns below)
- **Messaging & CQRS**: domain events are written to a transactional outbox and relayed to a RabbitMQ topic exchange as integration events; a failed consumer delivery gets a few delayed retries before landing on a dead-letter queue (see Architecture Patterns below); a standalone consumer projects `OrderPlaced` into a `order_summaries` read model, exposed via `GET /read-models/orders`
- **Idempotent writes**: `POST /orders` and `POST /products` honor an `Idempotency-Key` header — a retried request with the same key replays the original response instead of creating a duplicate
- **Database migrations**: Umzug-managed, Postgres-advisory-lock-coordinated migrations replace `sequelize.sync()` — safe to run from multiple starting replicas at once
- **API security**: API-key auth (`X-API-Key`) on every route except `/health*` and `/metrics`, CORS, Helmet security headers, a request body size limit, and per-IP rate limiting
- **Structured logging**: Pino, with a correlation id generated per HTTP request and threaded through the outbox row → RabbitMQ message → consumer log, so one order can be traced across all three processes
- **Metrics & distributed tracing**: Prometheus metrics (`GET /metrics` on every process) with a starter Grafana dashboard, and OpenTelemetry traces exported to Jaeger with **persistent storage** (Badger, survives a container restart) — one trace spans the HTTP request, the outbox relay's publish, and the consumer, because the trace context is captured at write time and re-injected before the async publish (see Architecture Patterns below)
- **Containerized**: multi-stage `Dockerfile` and `docker-compose.yml` run the API server, the read-model consumer, the outbox relay (both horizontally scalable, coordinated via a claim/lock so scaling never double-processes a row), PostgreSQL, RabbitMQ, and the Jaeger/Prometheus/Grafana observability stack

📊 **Diagrams**: architecture, domain model, order sequence, testing strategy, CI pipeline and deployment diagrams (plus the system overview above) live in [`docs/`](docs/README.md).

## 🚀 Getting Started

### Quick Start (Testing Only)

1. **Clone this repository:**
```bash
git clone https://github.com/luizcurti/ddd-cqrs-rabbitmq.git
cd ddd-cqrs-rabbitmq
```

2. **Install dependencies:**
```bash
npm install
```

3. **Run tests:**
```bash
npm test
```

### Development with Database

1. **Setup environment (optional):**
```bash
cp .env.example .env
```

2. **Start PostgreSQL database (optional):**
```bash
npm run docker:up
```

3. **Install dependencies and run tests:**
```bash
npm install
npm test  # Tests always use SQLite in memory
```

4. **Optional: Access PgAdmin at http://localhost:8080**
   - Email: `admin@ddd-cqrs-rabbitmq.com`
   - Password: `admin`

### Available Commands

```bash
npm run typecheck        # tsc --noEmit
npm run lint              # ESLint (flat config)
npm run lint:fix          # ESLint with autofix
npm run format             # Prettier — write formatting
npm run format:check       # Prettier — check formatting (used in CI)
npm test                  # Unit + integration tests (SQLite in-memory, no Docker needed)
npm run test:unit          # Unit tests only — pure domain logic, no I/O
npm run test:integration   # Integration tests only — repositories against real Sequelize (SQLite)
npm run test:coverage      # Unit + integration tests with coverage report (90% threshold)
npm run test:e2e           # E2E tests against real PostgreSQL (starts Docker automatically)
npm run test:collection    # Postman collection via Newman against a live server + real PostgreSQL (starts Docker automatically)
npm run build               # Compile src/ to dist/ (swc, CommonJS, spec/e2e files excluded)
npm run dev                 # Start the API server in watch mode
npm run start                # Start the compiled API server (node dist/api/server.js)
npm run consumer            # Start the OrderPlaced read-model consumer (ts-node)
npm run start:consumer       # Start the compiled consumer (node dist/consumer.js)
npm run outbox-relay        # Start the outbox relay (ts-node)
npm run start:outbox-relay   # Start the compiled outbox relay (node dist/outbox-relay.js)
npm run dlq:replay:order-placed # Drain the OrderPlaced dead-letter queue back onto the main exchange
npm run migrate             # Apply pending database migrations (Postgres-advisory-lock coordinated)
npm run migrate:undo         # Roll back the most recently applied migration
npm run migrate:status       # List applied/pending migrations
npm run docker:up          # Start PostgreSQL + RabbitMQ
npm run docker:up:full      # Start the full stack: postgres, rabbitmq, app, consumer, outbox-relay, jaeger, prometheus, grafana, pgadmin
npm run docker:down        # Stop all containers
npm run docker:build        # Build the production Docker image (ddd-cqrs-rabbitmq:local)
npm run db:reset           # Reset database
```

## 🗄️ Database Setup

This project supports multiple database configurations:

- **Unit & Integration Tests**: SQLite in-memory (automatic, no setup required)
- **E2E Tests**: PostgreSQL via Docker (**required** for `npm run test:e2e`)
- **Collection Tests**: PostgreSQL via Docker + a live server instance (**required** for `npm run test:collection`)
- **Development / Production**: PostgreSQL (configurable via environment variables)

### Quick Database Setup

```bash
# Start PostgreSQL (required for E2E/collection tests and local development)
npm run docker:up

# Stop PostgreSQL
npm run docker:down
```

**Note**: Unit and integration tests always use SQLite in-memory, so Docker is **not** required for `npm test`. `test:e2e` and `test:collection` start PostgreSQL themselves (`docker compose up -d postgres`) if it isn't already running.

## 🐳 Docker

The `Dockerfile` is a multi-stage build: dependencies are installed and `src/` is compiled with swc in a `builder` stage, then only `dist/` and production dependencies are copied into a slim, non-root `node:24-alpine` runtime image with a `/health`-based `HEALTHCHECK`.

```bash
# Build the image only
npm run docker:build

# Build and run the full stack (API server + consumer + outbox relay + PostgreSQL + RabbitMQ + observability + PgAdmin)
docker compose up -d --build

# API:        http://localhost:3000/health          (send X-API-Key: local-dev-key on every other route)
# RabbitMQ UI: http://localhost:15672 (guest/guest)
# Jaeger UI:   http://localhost:16686
# Prometheus:  http://localhost:9090
# Grafana:     http://localhost:3001 (admin/admin) — dashboard auto-provisioned
# PgAdmin:     http://localhost:8080
docker compose down
```

`docker-compose.yml` defines eleven services on one bridge network: `app` (the API server, built from the `Dockerfile` — horizontally scalable, see below), `nginx` (load balances across however many `app` replicas are running), `consumer` (the OrderPlaced read-model projector, same image as `app`, different entrypoint) and `outbox-relay` (polls the outbox table and publishes pending rows to RabbitMQ, same image again) — both horizontally scalable and coordinated via an atomic claim so scaling never double-publishes or double-consumes a row (see [outbox relay scaling](#observability-metrics--distributed-tracing)) — `postgres` (tuned — see [Load testing](docs/README.md#load-testing), and bootstrapped via versioned migrations rather than `sequelize.sync()`, see below) and `rabbitmq` (both with healthchecks that the others wait on), `jaeger-volume-init` (a one-shot `chown` so the non-root Jaeger image can write to its trace volume) plus `jaeger`/`prometheus`/`grafana` for observability, and `pgadmin`. See the [deployment diagram](docs/README.md#deployment).

**Per-service health checks.** `consumer` and `outbox-relay` run the same image as `app`, which bakes in a `HEALTHCHECK` that curls `localhost:3000/health` — meaningful for `app`, but neither `consumer` nor `outbox-relay` is an HTTP server on port 3000 (each only runs a tiny metrics server on `9091`/`9092`). `docker-compose.yml` overrides `healthcheck:` per-service so `consumer`/`outbox-relay` are checked against their own metrics port instead, so `docker compose ps` reports an accurate `healthy`/`unhealthy` status for each process.

`app` runs as one or more replicas behind `nginx` — a single Node process is one event loop, so this (not database tuning) is what actually helps under high concurrency:

```bash
# 4 app replicas behind nginx, full observability stack
npm run docker:up:scaled
```

## 📌 Prerequisites

* **Node.js** (version >= 24.x)
* **TypeScript** (version >= 5.9.x)
* **npm** or **yarn**
* **Docker & Docker Compose** (required for E2E/collection tests, running the containerized app, and local development database)

## 📁 Project Structure

```
docs/                                 # Diagrams — see docs/README.md
├── mmd/                              # Mermaid diagram source (.mmd)
└── img/                              # Rendered diagrams (.png)
scripts/
└── test-collection.sh                # Starts the API server, waits for /health, runs Newman
src/
├── api/                             # REST API Layer (Express)
│   ├── app.ts                       # Express app setup
│   ├── server.ts                    # HTTP server bootstrap
│   └── routes/                      # Route handlers
│       ├── customer.routes.ts
│       ├── product.routes.ts
│       ├── order.routes.ts
│       └── order-read-model.routes.ts # GET /read-models/orders — CQRS read side
├── consumer.ts                      # OrderPlaced read-model consumer bootstrap (separate process)
├── outbox-relay.ts                  # Outbox relay bootstrap (separate process)
├── dlq-replay.ts                    # One-shot CLI: drains the OrderPlaced DLQ back onto the main exchange
├── migrate.ts                       # One-shot CLI: apply/roll back/status database migrations
├── domain/                          # Domain Layer (Business Logic)
│   ├── @shared/                     # Shared domain components
│   │   ├── event/                   # Event system
│   │   ├── outbox/                  # OutboxMessageInput/Record + OutboxRepositoryInterface
│   │   └── repository/              # Repository interfaces
│   ├── customer/                    # Customer domain
│   │   ├── entity/                  # Customer entity
│   │   ├── factory/                 # Customer factory
│   │   ├── repository/              # Customer repository interface
│   │   └── value-object/            # Address value object
│   ├── product/                     # Product domain
│   │   ├── entity/                  # Product entity
│   │   ├── event/                   # Product events and handlers
│   │   ├── repository/              # Product repository interface
│   │   └── service/                 # Product services
│   └── checkout/                    # Order domain
│       ├── entity/                  # Order and OrderItem entities
│       ├── event/                   # OrderPlacedEvent
│       ├── factory/                 # Order factory
│       ├── read-model/              # OrderReadModelRepositoryInterface (CQRS read side port)
│       ├── repository/              # Order repository interface
│       └── service/                 # Order services (OrderService — reward points)
├── infrastructure/                  # Infrastructure Layer
│   ├── customer/                    # Customer persistence — includes customer.repository.spec.ts (integration)
│   ├── product/                     # Product persistence — includes product.repository.spec.ts (integration)
│   ├── order/                       # Order persistence — includes order.repository.spec.ts (integration)
│   ├── order-read-model/            # Order summary read model (Sequelize) — includes repository.spec.ts (integration)
│   ├── outbox/                      # OutboxMessageModel, writer (in-transaction), repository (claim/relay), the relay itself
│   ├── messaging/                   # RabbitMQ connection, routing-key mapping, consumers, retry queue, dead-letter setup, DLQ replay
│   ├── idempotency/                 # IdempotencyKeyModel + the Idempotency-Key middleware
│   ├── security/                    # API-key auth middleware
│   ├── database/                    # Sequelize bootstrap + Umzug migrations (migrator.ts, migrations/000N-*.ts)
│   ├── logging/                     # Pino logger + the http-logger middleware (correlation id)
│   └── observability/               # Prometheus metrics, /metrics server, OTel tracing bootstrap, trace-context bridge
└── e2e/                             # E2E Tests (real PostgreSQL)
    ├── setup/
    │   ├── global-setup.ts          # Jest global setup (waits for PostgreSQL)
    │   ├── database.helper.ts       # DB helpers for E2E tests
    │   └── authenticated-request.ts # Supertest wrapper that stamps the test API key on every request
    ├── customer.e2e.spec.ts
    ├── product.e2e.spec.ts
    ├── order.e2e.spec.ts
    ├── order-read-model.e2e.spec.ts # GET /read-models/orders — read-model repository seeded directly (consumer runs as a separate process)
    ├── health.e2e.spec.ts           # GET /health/ready against a real Postgres connection
    └── auth.e2e.spec.ts             # API key auth, CORS, and rate-limit headers

jest.unit.config.ts                   # Unit layer (excludes *.repository.spec.ts and e2e/)
jest.integration.config.ts            # Integration layer (*.repository.spec.ts only)
jest.config.ts                        # Combined unit + integration, used by `npm test` / `test:coverage`
jest.e2e.config.ts                    # E2E layer
ddd-cqrs-rabbitmq.postman_collection.json   # Collection layer (run via Newman)
docker/
├── prometheus/prometheus.yml         # Scrape config for app/consumer/outbox-relay
└── grafana/provisioning/             # Auto-provisioned Prometheus datasource + starter dashboard
```

## 🧪 Testing

Four independent layers, each catching different classes of bugs. See [`docs/README.md`](docs/README.md#testing-strategy) for the diagram.

| Layer | Command | Backing store | What it covers |
|---|---|---|---|
| Unit | `npm run test:unit` | none | Domain entities, value objects, factories, services, event dispatcher — happy and sad paths, no I/O |
| Integration | `npm run test:integration` | SQLite in-memory | Repository implementations against a real Sequelize engine — persistence + mapping, not mocked |
| E2E | `npm run test:e2e` | Real PostgreSQL (Docker) | Full HTTP stack (Express → Sequelize → PostgreSQL) via Supertest — every route, every 2xx/4xx |
| Collection | `npm run test:collection` | Real PostgreSQL (Docker) | The Postman collection run with Newman against a live server — black-box contract check |

- **Test Framework**: Jest with SWC compiler; Postman collection run with [Newman](https://github.com/postmanlabs/newman) (invoked via `npx`, not installed as a dependency, to avoid its legacy transitive-dependency footprint)
- `npm test` / `npm run test:coverage` run unit + integration together (no Docker needed) and gate on 90% coverage

### Coverage

169 unit + integration tests (30 suites), gated at 90% in CI — actual numbers run well above that:

| Metric | Coverage |
|---|---|
| Statements | 100% |
| Branches | 100% |
| Functions | 100% |
| Lines | 100% |

`database-config.ts`, `rabbitmq-connection.ts`, and the standalone process entrypoints (`consumer.ts`, `outbox-relay.ts`, `dlq-replay.ts`, `migrate.ts`) are excluded from this report entirely (`jest.config.ts` → `coveragePathIgnorePatterns`) — they're thin wiring around real external I/O (Postgres, RabbitMQ), exercised by the E2E/Postman layers and the load test against a live stack instead. Every file inside the reported set is 100% — including the branches that only show up with real infrastructure attached, closed with tests that fake the infrastructure rather than skip the branch:

- `metrics.ts` — `collectDefaultMetrics()` is skipped under `NODE_ENV=test` (the real call opens a Node perf-hooks handle that never closes, which would hang Jest workers). Covered by mocking `prom-client`'s `collectDefaultMetrics` and re-importing the module under both `NODE_ENV=test` and a non-test value via `jest.isolateModules` — asserts the call is skipped/made without ever opening the real handle.
- `outbox-relay.ts` — the `message.correlationId ?? undefined` fallback in `relay()`'s logger context. Covered by relaying a message with `correlationId: null` and asserting it still publishes and gets marked sent.
- `http-logger.middleware.ts` — `trace.getActiveSpan()?.setAttribute(...)`. Covered by mocking `trace.getActiveSpan()` to return a fake span and asserting `setAttribute("correlation_id", ...)` is called, alongside a dedicated test for the "no active span" path.

Regenerate locally with `npm run test:coverage`.

### Running E2E Tests

E2E tests exercise the full HTTP stack (Express → Sequelize → PostgreSQL) using Supertest.

```bash
# 1. Start the database
npm run docker:up

# 2. Run E2E tests
npm run test:e2e
```

The global setup waits for PostgreSQL to be ready before running any test suite.

### Running the Postman Collection

`npm run test:collection` starts PostgreSQL, boots the API server, waits for `/health`, runs every request in [`ddd-cqrs-rabbitmq.postman_collection.json`](ddd-cqrs-rabbitmq.postman_collection.json) via Newman (happy and sad paths for every endpoint, including reward points after an order), then stops the server. It's idempotent — safe to run repeatedly without resetting the database.

```bash
npm run test:collection
```

## 🌐 REST API

Start the server with `npm run dev` (or `npm start`). Base URL: `http://localhost:3000`.

Every route except `/health`, `/health/ready`, and `/metrics` requires an `X-API-Key` header (see [Auth](#auth-cors--rate-limiting) below) — the examples below omit it for brevity.

`POST /orders` and `POST /products` additionally accept an `Idempotency-Key` header: a retry with the same key returns the original response instead of creating a duplicate (see [Idempotent writes](#domain-events-messaging-and-reliability) below).

### Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/customers` | Create a customer |
| `GET` | `/customers` | List all customers |
| `GET` | `/customers/:id` | Get a customer by ID |
| `PUT` | `/customers/:id` | Update name and/or address |
| `DELETE` | `/customers/:id` | Delete a customer |

**POST /customers body:**
```json
{
  "name": "John Smith",
  "address": { "street": "Main St", "number": 42, "zip": "10001", "city": "New York" }
}
```

### Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/products` | Create a product |
| `GET` | `/products` | List all products |
| `GET` | `/products/:id` | Get a product by ID |
| `PUT` | `/products/:id` | Update name and/or price |
| `DELETE` | `/products/:id` | Delete a product |

**POST /products body:**
```json
{ "name": "Laptop", "price": 1200 }
```

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/orders` | Create an order |
| `GET` | `/orders` | List all orders |
| `GET` | `/orders/:id` | Get an order by ID |
| `PUT` | `/orders/:id` | Replace order items |
| `DELETE` | `/orders/:id` | Delete an order |

**POST /orders body:**
```json
{
  "customerId": "<uuid>",
  "items": [
    { "name": "Item 1", "productId": "<uuid>", "price": 100, "quantity": 2 }
  ]
}
```

### Read Models (CQRS)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/read-models/orders` | List all order summaries projected from `OrderPlaced` events |
| `GET` | `/read-models/orders/:id` | Get a single order summary by order ID |

Populated asynchronously: `POST /orders` writes an `OrderPlaced` row to the outbox in the same transaction as the order, the `outbox-relay` process publishes it to RabbitMQ, and the separate `consumer` process (`npm run consumer`) projects it into this read model — so a row may take a moment to appear after the order is created. See [Domain Events, Messaging and Reliability](#domain-events-messaging-and-reliability) below.

### Health Checks

```
GET /health        →  { "status": "ok" }                       # liveness — always 200 once the process is up
GET /health/ready   →  { "status": "ok", "checks": { "database": "ok" } }   # readiness — 503 if Postgres isn't reachable
```

`/health` is a liveness probe: it never touches a dependency, so it can't falsely report the process as dead just because Postgres is briefly unreachable. `/health/ready` is a readiness probe: it runs `SELECT 1` against the database and returns 503 if that fails — deliberately **not** checking RabbitMQ, since the outbox pattern means a broker outage shouldn't take `app` out of the load-balancer pool (orders still get written and queued for the relay).

## 🔧 Code Quality

- **Type checking**: `npm run typecheck` (`tsc --noEmit`), enforced in CI
- **Linting**: ESLint 10 (flat config) with TypeScript support
- **Formatting**: Prettier, enforced in CI via `npm run format:check`
- **Type Safety**: Strict TypeScript configuration
- **Code Standards**: Consistent formatting and naming conventions

## 📦 Key Dependencies

### Core Technologies
- **TypeScript**: 5.9.x - Type-safe JavaScript development
- **Node.js**: >= 24.x - JavaScript runtime
- **Express**: 5.x - HTTP server and routing
- **Jest**: 30.x - Testing framework
- **Sequelize**: 6.37.x - ORM for database operations
- **ESLint**: 10.x - Code quality and linting
- **Prettier**: 3.x - Code formatting

### Database Support
- **PostgreSQL**: 17.x - Production database (via Docker)
- **SQLite3**: 6.x - In-memory testing database
- **pg**: 8.23.x - PostgreSQL driver for Node.js

### Messaging & Observability
- **amqplib**: 2.x - RabbitMQ client (topic exchange publish + queue consume)
- **RabbitMQ**: 3.13.x - Message broker for domain → integration event delivery (via Docker)
- **pino**: 10.x - Structured JSON logging; `pino-pretty` renders it human-readable when `NODE_ENV=development` (kept as a runtime dependency, not dev-only, since the containers run with `NODE_ENV=development` too)
- **prom-client**: 15.x - Prometheus metrics (`GET /metrics` on every process)
- **@opentelemetry/sdk-node** + **instrumentation-{http,express,amqplib,pg}**: 0.222.x - Auto-instrumented distributed tracing, exported via OTLP to Jaeger
- **Jaeger / Prometheus / Grafana**: tracing UI, metrics store, and dashboards (via Docker)

### Development Tools
- **@swc/core**: 1.16.x - Fast TypeScript/JavaScript compiler
- **Supertest**: 7.x - E2E HTTP assertions (dev dependency, test code only)
- **Docker & Docker Compose**: Containerized runtime for the API server, consumer, PostgreSQL and RabbitMQ
- **dotenv**: 17.x - Loads `.env` into `process.env` on server bootstrap

## 🏗 Architecture Patterns

### Domain-Driven Design (DDD)
- **Entities**: Customer, Product, Order, OrderItem
- **Value Objects**: Address
- **Aggregates**: Clear boundaries and consistency
- **Factories**: Object creation patterns (`CustomerFactory`, `OrderFactory`)
- **Services**: `OrderService.placeOrder` — creates the order and grants the customer reward points, called from `POST /orders` (see the [order sequence diagram](docs/README.md#order-creation-sequence))

**Concurrency-safe reward points.** `CustomerRepository.incrementRewardPoints()` issues an atomic `SET reward_points = reward_points + ?` (via Sequelize's `increment()`) rather than a read-modify-write, so concurrent `POST /orders` requests for the same customer compose correctly regardless of ordering. `OrderRepository.create()` accepts the caller's transaction, so the order/outbox write and the reward-points increment commit as one unit — a failure between them can't place an order that never grants its points. Covered by a concurrent-request test in `order.e2e.spec.ts` and a same-key-race test in `customer.repository.spec.ts`.

### Repository Pattern
- Clean separation between domain and infrastructure
- Interface-based design for testability
- Sequelize ORM for database persistence
- Every `find()` reports "not found" only when the row is actually missing — `CustomerRepository`, `OrderRepository`, and `ProductRepository` all check for `null` rather than treating any thrown error as "not found," so a real infrastructure failure (e.g. a dropped DB connection mid-query) surfaces as one instead of being reported as a missing entity.

### Domain Events, Messaging and Reliability

**In-process domain events.** `EventDispatcher` / `ProductCreatedEvent` / `SendEmailWhenProductIsCreatedHandler` implement the in-process publish/subscribe pattern and are fully unit-tested. This stays fire-and-forget on purpose — sending an email is not something that needs the atomicity guarantees below.

**Transactional outbox → RabbitMQ.** Publishing an integration event directly from the route handler has an unfixable hole: if RabbitMQ is unreachable at that exact moment, the event is gone even though the order was saved. So `OrderRepository.create()` and `ProductRepository.create()` take an optional list of outbox messages and write them to an `outbox_messages` table **inside the same database transaction** as the aggregate — either both commit or neither does (see the rollback tests in `order.repository.spec.ts` / `product.repository.spec.ts`, which force the outbox insert to fail and assert the order/product was rolled back too). A separate `outbox-relay` process (`src/outbox-relay.ts`, `OutboxRelay` in `src/infrastructure/outbox/`) polls that table every `OUTBOX_POLL_INTERVAL_MS` (default 2s), publishes pending rows to the `ddd_project.events` **topic exchange** (routing key derived from the event class name via `eventNameToRoutingKey` — `OrderPlacedEvent` → `order.placed`, `ProductCreatedEvent` → `product.created`), and marks them `sent`. A publish failure just increments `attempts`/`last_error` and leaves the row `pending` for the next poll — it never crashes the relay process.

**Delayed retry before dead-lettering.** A message the consumer can't process isn't dead-lettered on the first failure — `OrderPlacedConsumer` tracks attempts via an `x-death` header count and republishes the message onto a dedicated retry queue (`setupRetryQueue` in `src/infrastructure/messaging/rabbitmq/retry-queue.ts`) with a per-message TTL; when that TTL expires, the retry queue's own dead-letter-exchange config bounces the message back onto the main exchange for another attempt. After `maxAttempts` (default 3, configurable via the consumer's constructor) it's `nack`'d without requeue and falls through to the dead-letter queue below — this absorbs transient failures (a momentary DB hiccup, a brief downstream timeout) without needing an operator to intervene, while still guaranteeing a poison message eventually lands somewhere visible instead of retrying forever.

**Dead-letter queue.** `OrderPlacedConsumer`'s queue is asserted with `x-dead-letter-exchange` pointing at a dedicated `ddd_project.events.dlx` fanout exchange bound to `order-summary.order-placed.dlq` (`setupDeadLetterQueue` in `src/infrastructure/messaging/rabbitmq/dead-letter.ts`). A message that exhausts its retries lands in that DLQ instead of vanishing. `npm run dlq:replay:order-placed` drains it and republishes every message onto the main exchange — for an operator to run once whatever caused the failures is fixed. It republishes on a `ConfirmChannel` and only acks the original DLQ message once the broker confirms the republish landed — a plain channel's `publish()` only writes to the local socket buffer, so a connection drop right after it (exactly the kind of broker instability that makes an operator reach for this tool in the first place) could otherwise ack a message off the DLQ that never actually made it back onto the main exchange, losing it for good.

**Idempotent writes.** `POST /orders` and `POST /products` accept an `Idempotency-Key` header (`src/infrastructure/idempotency/idempotency.middleware.ts`). The middleware tries to atomically claim the key by inserting a row keyed on `<method> <path>:<key>` — a route-scoped id, so the same raw key sent to two different endpoints doesn't collide; a unique-constraint violation means either another request with the same key is still in flight (`409`) or one already completed, in which case the original response is replayed verbatim from the stored `response_status`/`response_body` instead of re-running the handler. A wrapped `res.json` persists the response as `completed` on a 2xx and deletes the claim on anything else, so a client that got a `4xx`/`5xx` can safely retry with the same key. Modeled on Stripe's idempotency-key pattern.

A claim left `processing` past 60s is treated as orphaned — the request that made it presumably crashed (killed process, OOM) before ever resolving it, since every normal code path above always resolves to `completed` or deletes the row. Without this, that key would 409 every future retry forever, which is the opposite of what an idempotency key is supposed to guarantee. Reclaiming is itself a conditional delete (`WHERE id = ? AND status = 'processing'`), so two requests racing to reclaim the same stale key can't both win.

**Database migrations.** Schema changes are managed with [Umzug](https://github.com/sequelize/umzug) (`src/infrastructure/database/migrations/0001..0008-*.ts`, run via `createMigrator()` in `migrator.ts`) rather than `sequelize.sync()`, giving the database a real, versioned change history. Because `app`/`consumer`/`outbox-relay` all start from the same image and could race to migrate the same database, `database-config.ts` wraps the migration run in a Postgres advisory lock (`pg_advisory_lock`/`pg_advisory_unlock`), so only one starting replica applies pending migrations while the others see an empty pending list.

**Connection resilience.** `RabbitMqConnection` recovers on its own after a broker restart (a dropped connection/channel is discarded via `close`/`error` listeners so the next publish or consume reconnects instead of hanging); `OrderPlacedConsumer` resubscribes with a retry loop if its channel dies; `OutboxRelay`'s poll loop catches its own errors so a broker outage is logged and retried, never a crash. An order placed while RabbitMQ is down is **not lost**: it sits `pending` in the outbox and gets relayed once the broker comes back, which is the point of the outbox pattern over a direct publish.

**Graceful shutdown.** All three processes (`server.ts`, `consumer.ts`, `outbox-relay.ts`) handle `SIGTERM`/`SIGINT` end to end: `app` stops accepting new connections and lets in-flight requests finish (`server.close()`, with a 10s force-exit fallback) before closing the database; `outbox-relay` flips a stop flag the poll loop checks between iterations, so an already-in-progress batch finishes instead of being cut off mid-publish; `consumer` stops its DLQ-depth poller and closes the RabbitMQ connection (an in-flight, unacked message is simply redelivered later — the same at-least-once guarantee it already relies on for a broker restart). Every step is individually fault-tolerant: each cleanup step (including flushing pending OpenTelemetry trace spans, which can fail if the OTLP collector is unreachable) runs inside its own try/catch, so one failing step can't turn a clean shutdown into a crash with a non-zero exit code. All three processes exit with code `0` on `SIGTERM`, with or without Jaeger reachable.

**Structured logging.** `httpLogger` (`src/infrastructure/logging/`) assigns a correlation id to every request (reusing an incoming `x-correlation-id` header if present) and returns it in the response header. That id rides along in the outbox row, the RabbitMQ message payload, and the consumer's logs — so `grep`-ing one correlation id across the `app`, `outbox-relay`, and `consumer` logs shows one order's entire journey. Pino renders JSON normally and pretty-printed color output when `NODE_ENV=development` (including inside the containers, which run that way by default).

### Auth, CORS & Rate Limiting

`src/infrastructure/security/api-key.middleware.ts` gates every route below `/health`, `/health/ready`, and `/metrics` behind an `X-API-Key` header, checked against `API_KEY` in the environment (comma-separated for multiple valid keys; a `local-dev-key` fallback keeps `npm run dev` working without any setup — set a real value before exposing this anywhere else, since an unset `API_KEY` does *not* fail closed). The comparison is constant-time (`crypto.timingSafeEqual` over a SHA-256 hash of both sides, so mismatched lengths can't throw and can't be distinguished by timing either) rather than a plain string `===`/`includes()` — closing a timing side-channel that could otherwise let an attacker recover a valid key one byte at a time from response latency. `cors()` runs *before* the auth check — a browser's CORS preflight (`OPTIONS`) is sent without credentials, so authenticating first would fail every cross-origin preflight before the browser ever got to send the real request — with the allowed origin(s) configurable via `CORS_ORIGIN` (defaults to `*`). `helmet()` sets standard security headers, `express.json({ limit: "100kb" })` caps request body size so a single client can't tie up the event loop parsing an arbitrarily large payload, and `express-rate-limit` throttles each IP to `RATE_LIMIT_MAX` requests (default 300) per `RATE_LIMIT_WINDOW_MS` (default 60s), returning standard `RateLimit-*` headers.

`app.set("trust proxy", 1)` tells Express to honor exactly one hop of `X-Forwarded-For` (the `nginx` in front of it — see the Docker section above), which is what makes the rate limiter's per-IP bucketing see the real client instead of `nginx`'s own container IP. `1`, not `true` — `true` would trust every hop, including an `X-Forwarded-For` value a client forged for itself. Without it, every request behind `nginx` shares `nginx`'s own container IP, so the per-IP limit becomes one shared budget for every client combined.

### CQRS: Order Read Model
- The `consumer` process (`src/consumer.ts`, run via `npm run consumer` / the `consumer` Docker service) binds a queue to the `order.placed` routing key and projects each `OrderPlaced` integration event into an `order_summaries` table (`OrderReadModelRepositoryInterface`) — a basic write-model/read-model split: orders are written through `POST /orders` → `OrderRepository` (normalized, transactional), and read back in denormalized form via `GET /read-models/orders` → `OrderReadModelRepository`, updated asynchronously by the consumer
- Message handling is idempotent (`upsert` keyed by order ID) and acknowledges only after the read model is updated; processing failures `nack` the message without requeue, routing them to the dead-letter queue above instead of dropping them

### Observability: Metrics & Distributed Tracing

**Metrics.** `src/infrastructure/observability/metrics.ts` defines every custom metric on one shared `prom-client` registry: an `http_request_duration_seconds` histogram (labeled by method/route/status — `app` only), `outbox_pending_messages` and `outbox_messages_{relayed,failed}_total` (`outbox-relay` only), and `order_placed_consumer_messages_{processed,failed}_total` + `order_placed_dlq_depth` (`consumer` only, the latter refreshed on a background poll of RabbitMQ's queue depth via `checkQueue` — see `dlq-metrics.ts`). `app` exposes `GET /metrics` directly on its Express app; `consumer`/`outbox-relay` run a tiny standalone HTTP server for it (`metrics-server.ts`) since they aren't otherwise HTTP servers. A `prometheus` container scrapes all three, and a `grafana` container has that Prometheus pre-wired as a datasource with a starter dashboard auto-provisioned from `docker/grafana/provisioning/` — open http://localhost:3001 (admin/admin) and it's already populated, no manual setup.

**Distributed tracing.** `src/infrastructure/observability/tracing.ts` boots an OpenTelemetry `NodeSDK` with HTTP, Express, amqplib, and pg auto-instrumentation, exporting to Jaeger over OTLP. It's imported as the literal first line of `server.ts`/`consumer.ts`/`outbox-relay.ts` — instrumentation works by patching those libraries the first time Node `require`s them, so importing tracing any later means the patches silently never attach. The outbox is a persistence boundary amqplib's instrumentation can't see through — the HTTP request that writes an outbox row and the later poll cycle that publishes it are two unrelated OTel contexts. `trace-context.ts` bridges that gap by serializing the active trace context (`captureTraceContext()`) into the outbox row alongside `correlationId`, then re-injecting it (`withExtractedContext()`) around `OutboxRelay`'s `channel.publish()` call — so amqplib's instrumentation stamps the *original* request's trace id onto the RabbitMQ message instead of starting a new, disconnected one. The result: a single Jaeger trace spans `POST /orders` in `app`, the `publish` span in `outbox-relay` (fired on the next poll), and the `process`/DB spans in `consumer` — one trace, three processes, across a database table and a message broker.

Jaeger's all-in-one image defaults to storing traces in memory, which loses every trace on restart and grows unbounded under sustained load. `docker-compose.yml` sets `SPAN_STORAGE_TYPE=badger` with a persistent volume instead, trading a bit of disk I/O for traces that survive a container restart — appropriate for a single-node deployment, where standing up Elasticsearch/Cassandra just for trace storage would be overkill. (The Badger volume needs to be owned by uid 10001, which the Jaeger image runs as but a freshly-created Docker volume isn't — see `jaeger-volume-init` in the Docker section above.)

**Coordinated outbox relay scaling.** Running multiple `outbox-relay` replicas (`docker compose up -d --scale outbox-relay=N`) needs coordination so two replicas never fetch and publish the same pending row. `OutboxRepository.claim(id)` is an atomic conditional update (`UPDATE ... SET status='sending' WHERE id=? AND status='pending'`) that only one replica's query can win; `OutboxRelay.relay()` calls it before publishing and treats "not claimed" as "another replica has this one" rather than an error.

A row claimed by a replica that then crashes — killed, OOM'd, redeployed — before calling `markSent()`/`recordFailure()` would otherwise sit `sending` forever, invisible to `findPending`/`countPending` (both only look at `pending`). `OutboxRepository.reclaimStale(staleMs)` closes that gap: every poll, before anything else, it puts back to `pending` any row that's been `sending` for longer than `OUTBOX_STALE_CLAIM_MS` (default 60s — generous, since a real publish is milliseconds, not minutes) and increments `outbox_messages_reclaimed_total`. The same class of reclaim logic protects the idempotency-key claim above (see [Idempotent writes](#domain-events-messaging-and-reliability)).

See [Auth, CORS & Rate Limiting](#auth-cors--rate-limiting) above for why `app.set("trust proxy", 1)` matters to the per-IP rate limiter once requests are flowing through `nginx`.

- `httpLogger` also stamps `correlation_id` onto the active span, so a trace in Jaeger and a correlation id in the Pino logs point at the same request either way you start investigating.

## ⚙️ CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push/PR to `main`, split across two jobs:

1. **`test`** (against a real `postgres:17-alpine` service container, `API_KEY=local-dev-key`): install → `npm audit` (advisory, non-blocking) → format check → lint → typecheck → unit → integration → coverage (+ Codecov upload) → E2E → Postman collection → build.
2. **`docker`** (runs after `test` passes): builds the Docker image, brings up `postgres`, `rabbitmq`, `app`, `nginx`, `consumer`, `outbox-relay` and `pgadmin` via `docker compose`, polls `/health`, then runs the Postman collection against the containerized app before tearing the stack down. `app` runs unscaled here (nginx still fronts it, exercising the load-balanced path trivially); `jaeger`/`prometheus`/`grafana` are deliberately excluded — they add ~800MB of image pulls and nothing this job checks exercises them; all of it is still part of `npm run docker:up:full` / `docker:up:scaled` for local development.

See the [CI pipeline diagram](docs/README.md#ci-pipeline) for the full flow.

`npm audit` currently reports 0 vulnerabilities. `sequelize@6.37.8` bundles its own `uuid@8.3.2` (which has a moderate advisory) as a transitive dependency; since `sequelize` only calls `uuid`'s stable, unchanged `v1()`/`v4()` functions, `package.json` uses `overrides` to force that nested copy up to this project's own `uuid@11.x`, eliminating the vulnerable version from the tree without waiting on an unstable Sequelize major. The audit step stays `continue-on-error` in CI as a safety net for future advisories, not because of a known unresolved one.

## 🎯 Features

- ✅ Complete customer management with addresses
- ✅ Product catalog with pricing
- ✅ Order processing with items and total calculations
- ✅ Reward points granted to the customer on order creation (`OrderService.placeOrder`)
- ✅ Domain events published as integration events via a transactional outbox → RabbitMQ topic exchange (`ProductCreatedEvent`, `OrderPlacedEvent`) — no event is lost to a broker outage
- ✅ Delayed retry (TTL + dead-letter-exchange bounce-back) before a message lands on the dead-letter queue, plus a one-shot replay command (`npm run dlq:replay:order-placed`)
- ✅ Idempotency-Key support on `POST /orders` and `POST /products` — a retried request replays the original response instead of creating a duplicate
- ✅ Versioned, advisory-lock-coordinated database migrations (Umzug) replace `sequelize.sync()`
- ✅ API-key auth, CORS, Helmet security headers, request body size limit, and per-IP rate limiting
- ✅ Honest `/health` (liveness) vs `/health/ready` (readiness — checks Postgres, deliberately not RabbitMQ) split
- ✅ `outbox-relay` and `consumer` both horizontally scale safely — an atomic claim stops two relay replicas from double-publishing the same row
- ✅ Structured (Pino) logging with a correlation id traceable across the API, outbox relay, and consumer processes
- ✅ Prometheus metrics on every process, with a starter Grafana dashboard auto-provisioned
- ✅ OpenTelemetry distributed tracing to Jaeger, with persistent (Badger) trace storage — one trace spans the HTTP request, the async outbox relay publish, and the consumer
- ✅ Basic CQRS: a standalone consumer projects `OrderPlaced` into an `order_summaries` read model, exposed via `GET /read-models/orders`
- ✅ `app` horizontally scales behind `nginx` (`docker compose up --scale app=N`) — a single Node process is one event loop, so this is what raises throughput under concurrent load, not database tuning (see [Load testing](docs/README.md#load-testing))
- ✅ Full REST API (Express) with CRUD endpoints
- ✅ Four-layer test suite (unit, integration, E2E, Postman/Newman collection) — happy and sad paths
- ✅ Type-safe database operations
- ✅ Clean architecture following SOLID principles
