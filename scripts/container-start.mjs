import { spawn } from "node:child_process";

// The desktop Compose stack owns its own database volume. No schema generation
// or destructive resets; only the existing versioned migrations are applied.
async function run(args) {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const forward = () => child.kill(signal);
    process.once(signal, forward);
    child.once("exit", () => process.removeListener(signal, forward));
  }
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Command failed (${signal ?? code})`)));
  });
}
await run(["node_modules/drizzle-kit/bin.cjs", "migrate"]);
await run(["--import", "tsx", "server/stationos/migrate.ts"]);
await run(["dist/index.js"]);
