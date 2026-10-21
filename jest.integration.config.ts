/*
 * Integration tests: repository implementations exercised against a real
 * Sequelize engine (SQLite in-memory) — persistence + mapping, not mocked.
 */
export default {
  displayName: "integration",

  transform: {
    "^.+\.(t|j)sx?$": ["@swc/jest"],
  },

  clearMocks: true,

  coverageProvider: "v8",

  testMatch: ["**/*.repository.spec.ts"],
};
