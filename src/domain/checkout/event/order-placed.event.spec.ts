import OrderPlacedEvent from "./order-placed.event";

describe("OrderPlacedEvent", () => {
  it("captures the event data and the moment it occurred", () => {
    const eventData = {
      id: "order-1",
      customerId: "customer-1",
      total: 100,
      items: [] as string[],
    };

    const event = new OrderPlacedEvent(eventData);

    expect(event.eventData).toBe(eventData);
    expect(event.dateTimeOccurred).toBeInstanceOf(Date);
  });
});
