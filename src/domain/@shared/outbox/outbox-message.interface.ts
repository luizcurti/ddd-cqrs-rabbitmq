export interface OutboxMessageInput {
  eventName: string;
  routingKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  correlationId?: string;
  /** Serialized OTel trace context (see infrastructure/observability/trace-context.ts). */
  traceContext?: string;
}

export interface OutboxMessageRecord {
  id: string;
  eventName: string;
  routingKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  correlationId: string | null;
  traceContext: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export default interface OutboxRepositoryInterface {
  findPending(limit: number): Promise<OutboxMessageRecord[]>;
  countPending(): Promise<number>;
  /** Atomically flips pending -> sending. Returns false if another relay
   * instance already claimed this row — the caller must not publish it. */
  claim(id: string): Promise<boolean>;
  markSent(id: string): Promise<void>;
  recordFailure(id: string, error: string): Promise<void>;
  /** Puts a "sending" row back to "pending" if it's been claimed for longer
   * than staleMs without being resolved — recovers rows orphaned by a relay
   * process that crashed between claim() and markSent()/recordFailure().
   * Returns how many rows were reclaimed. */
  reclaimStale(staleMs: number): Promise<number>;
}
