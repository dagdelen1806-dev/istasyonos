import "dotenv/config";
import { registerLocalAuth } from "../local-auth";
import { ENV } from "./env";
import { assertMigrationReady } from "../migrations/readiness";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStationRoutes } from "../stationos";
import { readStationosRuntimeTestProfile } from "../stationos/runtime-db-profile";

async function startServer() {
  const runtimeTestProfile = readStationosRuntimeTestProfile(process.env);
  if (
    runtimeTestProfile &&
    (process.env.STATIONOS_DEMO_ONLY || ENV.authProvider !== "local")
  )
    throw new Error("STATIONOS_TEST_DB_TARGET_REJECTED");
  if (
    !runtimeTestProfile &&
    process.env.STATIONOS_DEMO_ONLY &&
    (process.env.STATIONOS_DEMO_ONLY !== "istasyonos_demo" ||
      new URL(process.env.DATABASE_URL ?? "").pathname !== "/istasyonos_demo")
  )
    throw new Error("DEMO_DATABASE_TARGET_REJECTED");
  if (ENV.authProvider === "local" && ENV.cookieSecret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  await assertMigrationReady();
  const app = express();
  const server = createServer(app);
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/auth", express.json({ limit: "8kb" }));
  // Existing application payload limits
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      ...(process.env.STATIONOS_DEMO_ONLY === "istasyonos_demo"
        ? { demoDatabase: "istasyonos_demo" }
        : {}),
    })
  );
  app.get("/api/platform/config.js", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(publicPlatformScript());
  });
  if (ENV.authProvider === "manus") registerOAuthRoutes(app);
  else registerLocalAuth(app);
  registerStationRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  const bindHost =
    process.env.BIND_HOST ||
    (process.env.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, bindHost, () =>
    console.log(`Server listening on ${bindHost}:${port}`)
  );
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
