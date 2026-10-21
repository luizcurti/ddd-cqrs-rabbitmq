// Realistic mixed-traffic load test: ~2,000 concurrent "shoppers" for ~1
// minute. Most just browse; a fraction check out. Run with:
//
//   BASE_URL=http://localhost:3000 npm run test:load
//
// Requires the k6 binary (https://k6.io/docs/get-started/installation/) and
// a running stack (docker compose up -d --build).
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const CUSTOMER_COUNT = Number(__ENV.SEED_CUSTOMERS || 50);
const PRODUCT_COUNT = Number(__ENV.SEED_PRODUCTS || 20);
const PEAK_VUS = Number(__ENV.PEAK_VUS || 2000);
// Every route below /health and /metrics requires this (api-key.middleware.ts)
// — without it every request here 401s and setup() can't seed anything.
const API_KEY = __ENV.API_KEY || "local-dev-key";

const ordersPlaced = new Counter("orders_placed");
const ordersFailed = new Counter("orders_failed");

export const options = {
  scenarios: {
    shoppers: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: PEAK_VUS }, // everyone arrives
        { duration: "60s", target: PEAK_VUS }, // 2,000 people browsing/buying at once
        { duration: "20s", target: 0 }, // everyone leaves
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    "http_req_duration{endpoint:browse_products}": ["p(95)<1000"],
    "http_req_duration{endpoint:browse_orders}": ["p(95)<1000"],
    "http_req_duration{endpoint:place_order}": ["p(95)<2000"],
  },
};

function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(list) {
  return list[randomIntBetween(0, list.length - 1)];
}

const JSON_HEADERS = {
  headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
};

// Seeds a fixed pool of customers/products once, before any virtual user
// starts — mirrors a real storefront where the catalog and customer base
// already exist; the load test only exercises the read/write traffic on
// top of it, not N-thousand fresh signups.
export function setup() {
  const customerIds = [];
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const res = http.post(
      `${BASE_URL}/customers`,
      JSON.stringify({
        name: `Load Test Customer ${i}`,
        address: { street: "Main St", number: i + 1, zip: "00000-000", city: "Springfield" },
      }),
      JSON_HEADERS,
    );
    if (res.status === 201) customerIds.push(res.json("id"));
  }

  const productIds = [];
  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const res = http.post(
      `${BASE_URL}/products`,
      JSON.stringify({ name: `Load Test Product ${i}`, price: randomIntBetween(10, 500) }),
      JSON_HEADERS,
    );
    if (res.status === 201) productIds.push(res.json("id"));
  }

  if (customerIds.length === 0 || productIds.length === 0) {
    throw new Error(
      `Setup failed: seeded ${customerIds.length}/${CUSTOMER_COUNT} customers and ` +
        `${productIds.length}/${PRODUCT_COUNT} products — is ${BASE_URL} reachable?`,
    );
  }

  return { customerIds, productIds };
}

export default function (data) {
  const { customerIds, productIds } = data;
  const roll = Math.random();

  if (roll < 0.55) {
    // 55%: browse the catalog
    const res = http.get(`${BASE_URL}/products`, {
      headers: { "X-API-Key": API_KEY },
      tags: { endpoint: "browse_products" },
    });
    check(res, { "browse products: status 200": (r) => r.status === 200 });
  } else if (roll < 0.8) {
    // 25%: check the order read model (CQRS read side)
    const res = http.get(`${BASE_URL}/read-models/orders`, {
      headers: { "X-API-Key": API_KEY },
      tags: { endpoint: "browse_orders" },
    });
    check(res, { "browse read-model orders: status 200": (r) => r.status === 200 });
  } else {
    // 20%: check out
    const items = [];
    const itemCount = randomIntBetween(1, 3);
    for (let i = 0; i < itemCount; i++) {
      items.push({
        name: "Item",
        productId: randomItem(productIds),
        price: randomIntBetween(10, 500),
        quantity: randomIntBetween(1, 3),
      });
    }

    const res = http.post(
      `${BASE_URL}/orders`,
      JSON.stringify({ customerId: randomItem(customerIds), items }),
      {
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        tags: { endpoint: "place_order" },
      },
    );

    const ok = check(res, { "place order: status 201": (r) => r.status === 201 });
    ok ? ordersPlaced.add(1) : ordersFailed.add(1);
  }

  // Think time — a real shopper doesn't hammer the API in a tight loop.
  sleep(randomIntBetween(1, 3));
}
