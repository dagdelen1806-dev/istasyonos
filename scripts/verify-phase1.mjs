import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
// Allowlist OS essentials; do not inherit secrets, DATABASE_URL or NODE_OPTIONS.
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|COMSPEC|APPDATA|LOCALAPPDATA|USERPROFILE|HOME)$/i.test(
      key
    )
  )
    env[key] = value;
}
Object.assign(env, {
  NODE_ENV: "test",
  DATABASE_URL: "",
  AUTH_PROVIDER: "local",
  SESSION_SECRET: "phase1-isolated-test-secret-not-for-deployment",
});
function run(args, extra = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...env, ...extra },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const mode = process.argv[2] ?? "test";
if (mode === "test") {
  run([
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--incremental",
    "false",
  ]);
  run([
    "node_modules/typescript/bin/tsc",
    "--project",
    "tsconfig.phase1.json",
    "--noEmit",
  ]);
  run([
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.phase1.config.ts",
    "--no-cache",
  ]);
  for (const TZ of ["UTC", "Europe/Istanbul", "America/New_York"]) {
    console.log(`UTC/date regression TZ=${TZ}`);
    run(
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "server/stationos/datetime.test.ts",
        "server/stationos/invitation-flow.test.ts",
        "--config",
        "vitest.phase1.config.ts",
        "--no-cache",
      ],
      { TZ }
    );
  }
} else if (mode === "build") {
  // Inline envDir overrides the application's Vite config: .env is never read.
  const outDir = path.join(root, ".local/phase1-build/public");
  run(
    [
      "--input-type=module",
      "-e",
      `import { build } from 'vite'; await build({envDir:false,build:{outDir:${JSON.stringify(outDir)},emptyOutDir:false}});`,
    ],
    { NODE_ENV: "production" }
  );
  run([
    "node_modules/esbuild/bin/esbuild",
    "server/_core/index.ts",
    "--platform=node",
    "--packages=external",
    "--bundle",
    "--format=esm",
    `--outdir=${path.join(root, ".local/phase1-build")}`,
  ]);
} else {
  throw new Error("Usage: node scripts/verify-phase1.mjs [test|build]");
}
