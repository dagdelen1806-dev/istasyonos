import { spawn } from "node:child_process";

const production = process.argv[2] === "production";
const child = spawn(process.execPath, production ? ["dist/index.js"] : ["--watch", "--import", "tsx", "server/_core/index.ts"], {
  stdio: "inherit", env: { ...process.env, NODE_ENV: production ? "production" : "development" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", error => { console.error(error.message); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 1; });
