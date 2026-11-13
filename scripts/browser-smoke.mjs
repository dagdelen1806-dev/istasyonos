import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  inspectBrowserEnvironment,
  resolveBrowser,
  runBrowserProcess,
} from "./browser-process.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localRoot = resolve(root, ".local");
const { candidates, executable } = resolveBrowser();
const profileDir = join(localRoot, `browser-smoke-${randomUUID()}`);

if (!executable) {
  process.stderr.write(
    `BROWSER_SMOKE_NOT_RUN: executable not found; checked ${candidates.length} configured locations.\n`
  );
  process.exit(2);
}

const args = [
  "--headless=new",
  "--window-size=390,844",
  "--disable-gpu",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-sync",
  "--no-first-run",
  `--user-data-dir=${profileDir}`,
  "--dump-dom",
  "about:blank",
];
try {
  mkdirSync(profileDir, { recursive: true });
} catch (error) {
  process.stderr.write(
    `BROWSER_SMOKE_NOT_RUN: profile creation failed; code=${error?.code ?? "unknown"}.\n`
  );
  process.exit(2);
}
const environment = inspectBrowserEnvironment(
  executable,
  profileDir,
  localRoot
);
process.stdout.write(`BROWSER_SMOKE_EXECUTABLE=${executable}\n`);
process.stdout.write(`BROWSER_SMOKE_ARGS=${JSON.stringify(args)}\n`);
process.stdout.write(
  `BROWSER_SMOKE_ENVIRONMENT=${JSON.stringify(environment)}\n`
);
if (
  !environment.executable.isFile ||
  !environment.executable.readable ||
  !environment.profile.inLocalRoot ||
  !environment.profile.writable ||
  environment.profile.lockFilesPresent.length > 0 ||
  !environment.temp.isDirectory ||
  !environment.temp.readable ||
  !environment.temp.writable
) {
  process.stderr.write(
    "BROWSER_SMOKE_NOT_RUN: isolated executable/profile/temp preflight failed; Chrome was not launched.\n"
  );
  process.exitCode = 2;
  rmSync(profileDir, { recursive: true, force: true });
  process.exit();
}
const result = await runBrowserProcess(executable, args, { timeoutMs: 20_000 });
process.stdout.write(
  `BROWSER_SMOKE_PROCESS=${JSON.stringify({ exitCode: result.code, signal: result.signal, closeReason: result.closeReason, spawnErrorCode: result.spawnErrorCode, spawnErrorName: result.spawnErrorName, stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes, timings: result.timings })}\n`
);

try {
  if (result.timedOut || result.error || result.code !== 0) {
    const reason = result.timedOut
      ? "ETIMEDOUT during browser startup/page load/result transfer"
      : (result.error?.code ?? `exit=${result.code}`);
    const stage =
      result.timings.spawnMs === null ? "browser-startup" : "about-blank-load";
    const safeStderr = result.stderr
      .split(/\r?\n/)
      .filter(line => /\b(?:ERROR|FATAL|GPU|crash|failed)\b/i.test(line))
      .slice(0, 4)
      .map(line =>
        line
          .replaceAll(profileDir, "[isolated-profile]")
          .replaceAll(root, "[project]")
          .replace(/https?:\/\/\S+/gi, "[url]")
          .slice(0, 200)
      );
    const earlyExit =
      !result.error &&
      !result.timedOut &&
      result.stdoutBytes === 0 &&
      result.stderrBytes === 0;
    const status =
      result.timedOut || result.error || earlyExit
        ? "BROWSER_SMOKE_NOT_RUN"
        : "BROWSER_SMOKE_FAIL";
    const reasonCode = earlyExit ? "BROWSER_EARLY_EXIT" : reason;
    process.stderr.write(
      `${status}: ${reasonCode}; exitCode=${result.code}; signal=${result.signal ?? "none"}; closeReason=${result.closeReason}; stdoutBytes=${result.stdoutBytes}; stderrBytes=${result.stderrBytes}; stage=${stage}; stderr=${JSON.stringify(safeStderr)}.\n`
    );
    process.exitCode = result.timedOut || result.error || earlyExit ? 2 : 1;
  } else if (!/<html[\s>]/i.test(result.stdout)) {
    process.stderr.write(
      `BROWSER_SMOKE_NOT_RUN: BROWSER_EARLY_EXIT; exitCode=${result.code}; signal=${result.signal ?? "none"}; closeReason=${result.closeReason}; stdoutBytes=${result.stdoutBytes}; stderrBytes=${result.stderrBytes}; about:blank DOM was not returned.\n`
    );
    process.exitCode = 2;
  } else {
    process.stdout.write(
      "BROWSER_SMOKE_PASS: isolated about:blank DOM received.\n"
    );
  }
} finally {
  if (resolve(profileDir).startsWith(`${localRoot}\\`))
    rmSync(profileDir, { recursive: true, force: true });
}
