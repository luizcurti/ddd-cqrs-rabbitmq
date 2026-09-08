import { Request, Response, NextFunction } from "express";
import { httpRequestDuration } from "./metrics";

/**
 * Records one httpRequestDuration observation per request, labeled by the
 * matched route pattern (e.g. "/orders/:id", not the literal URL — otherwise
 * every distinct id would create its own time series).
 */
export default function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const endTimer = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;
    endTimer({ method: req.method, route, status_code: String(res.statusCode) });
  });

  next();
}
