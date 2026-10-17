import { describe, expect, it } from "vitest";
import { stationErrorLog } from "./error-log";

describe("StationOS error diagnostics", () => {
  it("identifies the failing route without logging duplicate values or request data", () => {
    const error = {
      code: "ER_DUP_ENTRY",
      sql: "INSERT INTO st_products VALUES ('secret-barcode')",
      sqlMessage: "Duplicate entry 'secret-barcode' for key 'barcode'",
    };
    const request = {
      method: "POST",
      route: { path: "/api/stationos/product" },
      originalUrl: "/api/stationos/product?token=secret-token",
      body: { email: "private@example.invalid" },
      headers: { cookie: "secret-cookie" },
    };
    expect(stationErrorLog(error, request)).toBe(
      "[StationOS] ER_DUP_ENTRY method=POST route=/api/stationos/product"
    );
  });

  it("does not allow untrusted codes, URLs or newlines into the log", () => {
    expect(stationErrorLog(
      { code: "ER_DUP_ENTRY\nsecret" },
      { method: "GET\nsecret", route: { path: "/api/stationos/state?secret=yes" } }
    )).toBe("[StationOS] internal_error method=UNKNOWN route=/api/stationos");
    expect(stationErrorLog(new Error("private details"))).toBe(
      "[StationOS] internal_error method=UNKNOWN route=/api/stationos"
    );
  });
});
