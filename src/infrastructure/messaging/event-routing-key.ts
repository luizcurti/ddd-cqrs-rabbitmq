const EVENT_SUFFIX = "Event";

/**
 * Derives a topic-exchange routing key from a domain event class name,
 * e.g. "OrderPlacedEvent" -> "order.placed", "ProductCreatedEvent" -> "product.created".
 */
export function eventNameToRoutingKey(eventName: string): string {
  const withoutSuffix = eventName.endsWith(EVENT_SUFFIX)
    ? eventName.slice(0, -EVENT_SUFFIX.length)
    : eventName;

  return withoutSuffix.replace(/([a-z0-9])([A-Z])/g, "$1.$2").toLowerCase();
}
