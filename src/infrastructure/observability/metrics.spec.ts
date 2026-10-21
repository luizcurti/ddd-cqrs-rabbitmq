describe("metrics module bootstrap", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.dontMock("prom-client");
    jest.resetModules();
  });

  // collectDefaultMetrics() is mocked in both cases below, not just spied on —
  // the real one opens a perf_hooks handle that never closes, which is exactly
  // why the module skips it under NODE_ENV=test in the first place. Letting
  // the real thing run here would leave that handle open behind this test.
  function mockCollectDefaultMetrics(): jest.Mock {
    const collectDefaultMetrics = jest.fn();
    jest.doMock("prom-client", () => ({
      ...jest.requireActual("prom-client"),
      collectDefaultMetrics,
    }));
    return collectDefaultMetrics;
  }

  it("does not call collectDefaultMetrics under NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const collectDefaultMetrics = mockCollectDefaultMetrics();

    jest.isolateModules(() => {
      require("./metrics");
    });

    expect(collectDefaultMetrics).not.toHaveBeenCalled();
  });

  it("calls collectDefaultMetrics against its own registry outside of NODE_ENV=test", () => {
    process.env.NODE_ENV = "production";
    const collectDefaultMetrics = mockCollectDefaultMetrics();

    let registerExport: unknown;
    jest.isolateModules(() => {
      registerExport = require("./metrics").register;
    });

    expect(collectDefaultMetrics).toHaveBeenCalledWith({ register: registerExport });
  });
});
