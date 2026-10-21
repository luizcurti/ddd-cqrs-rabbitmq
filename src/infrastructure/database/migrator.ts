import { Sequelize } from "sequelize";
import { SequelizeStorage, Umzug } from "umzug";
import * as createCustomers from "./migrations/0001-create-customers";
import * as createProducts from "./migrations/0002-create-products";
import * as createOrders from "./migrations/0003-create-orders";
import * as createOrderItems from "./migrations/0004-create-order-items";
import * as createOrderSummaries from "./migrations/0005-create-order-summaries";
import * as createOutboxMessages from "./migrations/0006-create-outbox-messages";
import * as createIdempotencyKeys from "./migrations/0007-create-idempotency-keys";
import * as addOutboxClaimedAt from "./migrations/0008-add-outbox-claimed-at";

// Imported directly rather than discovered via a glob: a glob would need to
// match `*.ts` under ts-node and `*.js` under the compiled dist/ build, and
// picking the right pattern for each runtime is exactly the kind of thing
// that's easy to get wrong once and not notice until a deploy runs the app
// build. Explicit imports work identically either way.
const migrations = [
  { name: "0001-create-customers", ...createCustomers },
  { name: "0002-create-products", ...createProducts },
  { name: "0003-create-orders", ...createOrders },
  { name: "0004-create-order-items", ...createOrderItems },
  { name: "0005-create-order-summaries", ...createOrderSummaries },
  { name: "0006-create-outbox-messages", ...createOutboxMessages },
  { name: "0007-create-idempotency-keys", ...createIdempotencyKeys },
  { name: "0008-add-outbox-claimed-at", ...addOutboxClaimedAt },
];

export function createMigrator(sequelize: Sequelize) {
  return new Umzug({
    migrations,
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: undefined,
  });
}

export type Migrator = ReturnType<typeof createMigrator>;
