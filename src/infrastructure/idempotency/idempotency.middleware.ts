import { Request, Response, NextFunction } from "express";
import { UniqueConstraintError } from "sequelize";
import IdempotencyKeyModel from "./idempotency-key.model";
import logger from "../logging/logger";

const IDEMPOTENCY_HEADER = "idempotency-key";

// How long a claim can sit "processing" before we assume the request that
// made it crashed (killed process, OOM) rather than just being slow — every
// normal code path below resolves the claim to "completed" or deletes it, so
// "processing" past this age with no live requester means it's orphaned and
// otherwise blocks every future retry with that key forever.
const STALE_PROCESSING_MS = 60_000;

async function reclaimIfStale(id: string, existing: IdempotencyKeyModel): Promise<boolean> {
  if (Date.now() - existing.created_at.getTime() <= STALE_PROCESSING_MS) {
    return false;
  }
  // Conditional delete, same atomic-claim pattern as the insert below — if
  // two requests race to reclaim the same stale key, only one deletes a row.
  const deleted = await IdempotencyKeyModel.destroy({ where: { id, status: "processing" } });
  return deleted > 0;
}

/**
 * Makes a mutating endpoint safe to retry: a client that resends the same
 * request (network blip, timeout, a double-tapped button) with the same
 * Idempotency-Key gets back the exact response the first attempt produced,
 * instead of creating a second order.
 *
 * The key is "claimed" with an INSERT before any business logic runs, so two
 * near-simultaneous requests with the same key can't both slip through — the
 * loser's INSERT hits the table's unique primary key and gets a 409 instead.
 * No key header at all means the caller didn't ask for this guarantee, so the
 * request just proceeds normally.
 */
export default async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawKey = req.header(IDEMPOTENCY_HEADER);
  if (!rawKey) {
    next();
    return;
  }

  const id = `${req.method} ${req.baseUrl}${req.path}:${rawKey}`;

  // At most one retry: the first pass either claims the key outright or
  // finds a stale claim and reclaims it, in which case this second pass
  // makes the actual claim. A collision on the second pass is a live
  // in-flight request (or another reclaimer that won the race) — that's a
  // genuine 409, not something worth looping over again.
  let claimed = false;
  for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
    try {
      await IdempotencyKeyModel.create({ id, status: "processing" });
      claimed = true;
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) {
        next(error);
        return;
      }

      const existing = await IdempotencyKeyModel.findByPk(id);
      if (existing?.status === "completed") {
        res.status(existing.response_status).json(JSON.parse(existing.response_body));
        return;
      }

      const reclaimed = existing?.status === "processing" && (await reclaimIfStale(id, existing));
      if (!reclaimed || attempt === 1) {
        res
          .status(409)
          .json({ error: "A request with this Idempotency-Key is already being processed" });
        return;
      }
      // reclaimed on attempt 0 — loop around once more to actually claim it.
    }
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
    const persist = isSuccess
      ? IdempotencyKeyModel.update(
          {
            status: "completed",
            response_status: res.statusCode,
            response_body: JSON.stringify(body),
          },
          { where: { id } },
        )
      : // Don't cache an error response — deleting the claim lets the
        // client fix the request and retry with the same key.
        IdempotencyKeyModel.destroy({ where: { id } });

    persist.catch((err) => logger.error({ err, id }, "failed to persist idempotency record"));
    return originalJson(body);
  };

  next();
}
