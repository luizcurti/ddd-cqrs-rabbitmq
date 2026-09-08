import { context, propagation } from "@opentelemetry/api";
import { captureTraceContext, withExtractedContext } from "./trace-context";

describe("captureTraceContext", () => {
  it("serializes whatever the active context injects (empty when there is no active span)", () => {
    const serialized = captureTraceContext();

    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(JSON.parse(serialized)).toEqual({});
  });
});

describe("withExtractedContext", () => {
  it("runs the callback in the plain active context when nothing was captured", () => {
    const fn = jest.fn().mockReturnValue("result");

    const result = withExtractedContext(null, fn);

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("extracts the carrier and runs the callback inside that context", () => {
    const injectSpy = jest.spyOn(propagation, "inject");
    const serialized = captureTraceContext();
    injectSpy.mockRestore();

    const extractSpy = jest.spyOn(propagation, "extract");
    const withSpy = jest.spyOn(context, "with");
    const fn = jest.fn().mockReturnValue(42);

    const result = withExtractedContext(serialized, fn);

    expect(result).toBe(42);
    expect(extractSpy).toHaveBeenCalledWith(context.active(), JSON.parse(serialized));
    expect(withSpy).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);

    extractSpy.mockRestore();
    withSpy.mockRestore();
  });

  it("falls back to running the callback plainly when the serialized context is malformed", () => {
    const fn = jest.fn().mockReturnValue("ok");

    const result = withExtractedContext("not valid json", fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
