import type { Request } from "express";
import { dbErrorCode } from "./domain";

// Log the registered route, never the raw URL/query, SQL, bound values or body.
// In particular, duplicate-key messages can contain customer/document data.
export function stationErrorLog(
  error: unknown,
  req?: Pick<Request, "method" | "route">
): string {
  const rawCode = dbErrorCode(error);
  const code = rawCode && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode)
    ? rawCode
    : "internal_error";
  const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(req?.method ?? "")
    ? req!.method
    : "UNKNOWN";
  const rawRoute = req?.route?.path;
  const route = typeof rawRoute === "string" && /^\/api\/stationos(?:\/[a-z-]+)*$/.test(rawRoute)
    ? rawRoute
    : "/api/stationos";
  return `[StationOS] ${code} method=${method} route=${route}`;
}
