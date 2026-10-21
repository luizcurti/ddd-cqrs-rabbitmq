#!/usr/bin/env bash
# Runs the Postman collection (happy + sad paths) against a live server backed by
# a real PostgreSQL instance. Used locally (npm run test:collection) and in CI.
set -euo pipefail

export NODE_ENV="${NODE_ENV:-development}"
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-ddd_project}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-postgres}"
export PORT="${PORT:-3000}"
export API_KEY="${API_KEY:-local-dev-key}"

BASE_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Starting API server on ${BASE_URL}..."
npx ts-node src/api/server.ts &
SERVER_PID=$!

echo "Waiting for the server to become healthy..."
for attempt in $(seq 1 30); do
  if curl -sf "${BASE_URL}/health" > /dev/null 2>&1; then
    echo "Server is healthy after ${attempt} attempt(s)."
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Server did not become healthy in time." >&2
    exit 1
  fi
  sleep 1
done

echo "Running Postman collection with Newman..."
npx --yes newman@6.2.2 run ddd-cqrs-rabbitmq.postman_collection.json \
  --env-var "baseUrl=${BASE_URL}" \
  --env-var "apiKey=${API_KEY}"
