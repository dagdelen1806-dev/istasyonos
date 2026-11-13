import { config, assertDemoUrl } from "./demo-environment.mjs";
const cfg = await config();
assertDemoUrl(cfg.databaseUrl);
if (cfg.port !== 3001) throw Error("DEMO_PORT_REJECTED");
Object.assign(process.env, {
  DATABASE_URL: cfg.databaseUrl,
  STATIONOS_DEMO_ONLY: "istasyonos_demo",
  SESSION_SECRET: cfg.sessionSecret,
  AUTH_PROVIDER: "local",
  COOKIE_SECURE: "false",
  BIND_HOST: "127.0.0.1",
  PORT: String(cfg.port),
  NODE_ENV: "production",
  GEMINI_API_KEY: "",
  OPENAI_API_KEY: "",
});
await import("../.local/demo/runtime/index.js");
