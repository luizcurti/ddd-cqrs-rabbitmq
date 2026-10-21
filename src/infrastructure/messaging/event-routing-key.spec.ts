import { eventNameToRoutingKey } from "./event-routing-key";

describe("eventNameToRoutingKey", () => {
  it("converts a PascalCase event class name into a dot-separated routing key", () => {
    expect(eventNameToRoutingKey("OrderPlacedEvent")).toBe("order.placed");
    expect(eventNameToRoutingKey("ProductCreatedEvent")).toBe("product.created");
  });

  it("keeps the name as-is when it does not end with Event", () => {
    expect(eventNameToRoutingKey("SomethingHappened")).toBe("something.happened");
  });
});
