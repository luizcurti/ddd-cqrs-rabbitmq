#!/usr/bin/env bash
# End-to-end check of a deployed stack, run by the CI deploy job after every
# deploy (and runnable by hand against any environment):
#   1. readiness (PostgreSQL) and API-key auth;
#   2. the Postman collection CI runs locally (customers, products, orders —
#      happy and sad paths);
#   3. the CQRS read side: an order placed through the API must show up in
#      GET /read-models/orders/:id, which only happens once the outbox relay
#      has published OrderPlaced to RabbitMQ and the consumer has projected it.
#
# Usage: API_URL=https://xxxx.cloudfront.net API_KEY=... scripts/smoke-test.sh
set -euo pipefail

: "${API_URL:?set API_URL, e.g. https://xxxx.cloudfront.net}"
: "${API_KEY:?set API_KEY (the X-API-Key value)}"

fail() {
  echo "::error title=Smoke test::$*"
  echo "FAIL: $*" >&2
  exit 1
}

api() {
  curl -sS -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' "$@"
}

echo "== readiness"
for _ in $(seq 1 30); do
  curl -sf "$API_URL/health/ready" > /dev/null && break
  sleep 5
done
curl -sf "$API_URL/health/ready" || fail "/health/ready did not report PostgreSQL ok"
echo

echo "== auth"
status=$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL/customers")
[ "$status" = "401" ] || fail "GET /customers without X-API-Key returned $status, expected 401"

echo "== Postman collection"
npx --yes newman@6.2.2 run ddd-cqrs-rabbitmq.postman_collection.json \
  --env-var "baseUrl=$API_URL" \
  --env-var "apiKey=$API_KEY" \
  --reporters cli

echo "== order -> outbox relay -> RabbitMQ -> consumer -> read model"
customer=$(api -X POST "$API_URL/customers" \
  -d '{"name":"Smoke Test","address":{"street":"Main St","number":1,"zip":"E15 1AA","city":"London"}}' | jq -r '.id')
[ -n "$customer" ] && [ "$customer" != "null" ] || fail "could not create a customer"
product=$(api -X POST "$API_URL/products" -d '{"name":"Smoke Widget","price":50}' | jq -r '.id')
[ -n "$product" ] && [ "$product" != "null" ] || fail "could not create a product"
order=$(api -X POST "$API_URL/orders" \
  -d "{\"customerId\":\"$customer\",\"items\":[{\"name\":\"Smoke Widget\",\"productId\":\"$product\",\"price\":50,\"quantity\":3}]}")
echo "$order"
order_id=$(jq -r '.id // empty' <<<"$order")
[ -n "$order_id" ] || fail "POST /orders returned no id"

summary=""
for _ in $(seq 1 30); do
  summary=$(api "$API_URL/read-models/orders/$order_id")
  [ "$(jq -r '.id // empty' <<<"$summary" 2>/dev/null)" = "$order_id" ] && break
  sleep 2
done
echo "$summary"
[ "$(jq -r '.id // empty' <<<"$summary")" = "$order_id" ] ||
  fail "order $order_id never reached the read model (outbox relay -> RabbitMQ -> consumer)"

echo "All smoke tests passed."
