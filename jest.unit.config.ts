/*
 * Pure domain/application unit tests — no I/O, no database.
 * Repository tests (real Sequelize + SQLite) live in jest.integration.config.ts,
 * and full-stack HTTP tests (real PostgreSQL) live in jest.e2e.config.ts.
 */
export default {
  displayName: "unit",

  transform: {
    "^.+\.(t|j)sx?$": ["@swc/jest"],
  },

  clearMocks: true,

  coverageProvider: "v8",

  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/e2e/",
    "\\.repository\\.spec\\.ts$",
  ],
};
