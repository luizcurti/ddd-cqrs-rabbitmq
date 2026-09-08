/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

export default {
  transform: {
    "^.+\.(t|j)sx?$": ["@swc/jest"],
  },

  clearMocks: true,

  coverageProvider: "v8",

  // Exclude E2E tests — they require a live PostgreSQL and use jest.e2e.config.ts
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/src/e2e/"],

  // Collect coverage from TypeScript source files
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.interface.ts",
    "!src/e2e/**",
    "!src/api/**",          // API layer is covered by E2E tests (jest.e2e.config.ts)
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  
  // Paths excluded from coverage collection
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    ".spec.ts$",
    ".interface.ts$",
    "database-config.ts$",
    "rabbitmq-connection.ts$",
    "src/consumer.ts$",
    "src/outbox-relay.ts$",
    "src/dlq-replay.ts$",
    "src/migrate.ts$",
    "infrastructure/logging/logger.ts$",
    "infrastructure/observability/metrics-server.ts$",
    "infrastructure/observability/tracing.ts$",
  ],
};
