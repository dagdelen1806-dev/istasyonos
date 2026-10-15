import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

export function getSessionCookieOptions(_req: Request): CookieOptions {
  if (ENV.authProvider === "manus") return { httpOnly: true, path: "/", sameSite: "none", secure: true };
  // HTTP cookies are permitted only when explicitly enabled for local development.
  return { httpOnly: true, path: "/", sameSite: "lax", secure: process.env.COOKIE_SECURE !== "false" };
}
