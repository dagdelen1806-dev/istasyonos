import { spawn } from "node:child_process";

// Startup never applies schema. The server verifies migration readiness read-only.
async function run(args) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const forward = () => child.kill(signal);
    process.once(signal, forward);
    child.once("exit", () => process.removeListener(signal, forward));
  }
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`Command failed (${signal ?? code})`))
    );
  });
}
await run(["dist/index.js"]);
