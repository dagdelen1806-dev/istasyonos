import { execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  openSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

export function browserCandidates(env = process.env) {
  return [
    env.CHROME_BIN,
    join(
      env.PROGRAMFILES ?? "C:\\Program Files",
      "Google/Chrome/Application/chrome.exe"
    ),
    join(
      env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
      "Microsoft/Edge/Application/msedge.exe"
    ),
  ].filter(Boolean);
}

export function resolveBrowser(env = process.env) {
  const candidates = browserCandidates(env);
  return {
    candidates,
    executable: candidates.find(candidate => existsSync(candidate)) ?? null,
  };
}

export function inspectBrowserEnvironment(executable, profileDir, localRoot) {
  const executableInfo = {
    exists: false,
    isFile: false,
    readable: false,
    sizeBytes: null,
    errorCode: null,
  };
  try {
    executableInfo.exists = existsSync(executable);
    const executableStat = executableInfo.exists ? statSync(executable) : null;
    executableInfo.isFile = executableStat?.isFile() ?? false;
    executableInfo.sizeBytes = executableStat?.size ?? null;
    if (executableInfo.isFile) {
      accessSync(executable, fsConstants.R_OK);
      executableInfo.readable = true;
    }
  } catch (error) {
    executableInfo.errorCode = error?.code ?? error?.name ?? "unknown";
    // Keep diagnostics limited to booleans; do not emit machine-specific errors.
  }

  const profileRelative = relative(resolve(localRoot), resolve(profileDir));
  const profileInLocalRoot =
    !!profileRelative &&
    !isAbsolute(profileRelative) &&
    profileRelative !== ".." &&
    !profileRelative.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`
    );
  const profileInfo = {
    inLocalRoot: profileInLocalRoot,
    exists: false,
    isDirectory: false,
    writable: false,
    lockFilesPresent: [],
    errorCode: null,
  };
  let profileProbePath;
  try {
    profileInfo.exists = existsSync(profileDir);
    profileInfo.isDirectory =
      profileInfo.exists && statSync(profileDir).isDirectory();
    if (profileInfo.isDirectory) {
      profileProbePath = join(profileDir, `.codex-write-probe-${process.pid}`);
      const descriptor = openSync(profileProbePath, "wx");
      closeSync(descriptor);
      unlinkSync(profileProbePath);
      profileProbePath = undefined;
      profileInfo.writable = true;
      profileInfo.lockFilesPresent = [
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "DevToolsActivePort",
      ].filter(name => existsSync(join(profileDir, name)));
    }
  } catch (error) {
    profileInfo.errorCode = error?.code ?? error?.name ?? "unknown";
    if (profileProbePath && existsSync(profileProbePath)) {
      try {
        unlinkSync(profileProbePath);
      } catch {
        // The enclosing runner removes only this newly created profile.
      }
    }
    // A failed isolated-profile probe prevents browser launch below.
  }

  const tempInfo = {
    exists: false,
    isDirectory: false,
    readable: false,
    writable: false,
    errorCode: null,
  };
  try {
    const temp = tmpdir();
    tempInfo.exists = existsSync(temp);
    tempInfo.isDirectory = tempInfo.exists && statSync(temp).isDirectory();
    if (tempInfo.isDirectory) {
      accessSync(temp, fsConstants.R_OK);
      tempInfo.readable = true;
      accessSync(temp, fsConstants.W_OK);
      tempInfo.writable = true;
    }
  } catch (error) {
    tempInfo.errorCode = error?.code ?? error?.name ?? "unknown";
    // Keep output free of temp paths and permission error text.
  }

  return { executable: executableInfo, profile: profileInfo, temp: tempInfo };
}

export function classifyBrowserDomProgress(result, requestPaths) {
  if (result.error) return { status: "NOT_RUN", reason: "SPAWN_ERROR" };
  if (result.timedOut) return { status: "NOT_RUN", reason: "PROCESS_TIMEOUT" };
  if (result.timings?.spawnMs === null || result.timings?.spawnMs === undefined)
    return { status: "NOT_RUN", reason: "BROWSER_STARTUP" };
  if (!requestPaths.includes("/"))
    return { status: "NOT_RUN", reason: "BROWSER_EARLY_EXIT" };
  if (!requestPaths.includes("/bundle.js"))
    return { status: "NOT_RUN", reason: "PAGE_OR_HARNESS_NOT_LOADED" };
  if (result.code !== 0)
    return { status: "NOT_RUN", reason: "BROWSER_EXIT_BEFORE_DOM_RESULT" };
  return { status: "DOM_STARTED", reason: null };
}

function terminateOwnedProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 3000,
        stdio: "ignore",
      });
    } catch {
      // Only fall back to the exact child process started by this runner.
    }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill();
}

export function runBrowserProcess(executable, args, options = {}) {
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;

  return new Promise(resolve => {
    let child;
    let timer;
    let fallbackTimer;
    let settled = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnMs = null;
    let firstStdoutMs = null;
    let firstStderrMs = null;
    let outputBytes = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdout = "";
    let stderr = "";
    let error = null;
    let observedExitCode = null;
    let observedExitSignal = null;

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      resolve({
        ...result,
        exitCode: result.code ?? observedExitCode,
        signal: result.signal ?? observedExitSignal,
        stdout,
        stderr,
        error,
        timedOut,
        outputLimitExceeded,
        stdoutBytes,
        stderrBytes,
        closeReason:
          result.closeReason ??
          (error ? "spawn-error" : timedOut ? "timeout" : "unknown"),
        spawnErrorCode: error?.code ?? null,
        spawnErrorName: error?.name ?? null,
        timings: {
          spawnMs,
          firstStdoutMs,
          firstStderrMs,
          totalMs: Math.round(performance.now() - startedAt),
        },
      });
    };

    try {
      child = spawn(executable, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      error = cause;
      finish({
        code: null,
        signal: null,
        phase: "spawn",
        closeReason: "spawn-error",
      });
      return;
    }

    child.once("spawn", () => {
      spawnMs = Math.round(performance.now() - startedAt);
    });
    child.once("exit", (code, signal) => {
      observedExitCode = code;
      observedExitSignal = signal;
    });
    child.once("error", cause => {
      error = cause;
      finish({
        code: null,
        signal: null,
        phase: "spawn",
        closeReason: "spawn-error",
      });
    });

    const append = (kind, chunk) => {
      outputBytes += chunk.length;
      if (kind === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        outputLimitExceeded = true;
        terminateOwnedProcessTree(child);
        return;
      }
      if (kind === "stdout") {
        firstStdoutMs ??= Math.round(performance.now() - startedAt);
        stdout += chunk.toString("utf8");
        options.onStdout?.(chunk);
      } else {
        firstStderrMs ??= Math.round(performance.now() - startedAt);
        stderr += chunk.toString("utf8");
        options.onStderr?.(chunk);
      }
    };

    child.stdout.on("data", chunk => append("stdout", chunk));
    child.stderr.on("data", chunk => append("stderr", chunk));
    child.once("close", (code, signal) => {
      finish({
        code,
        signal,
        phase: timedOut ? "timeout" : "close",
        closeReason: timedOut
          ? "timeout"
          : signal
            ? "signaled"
            : code === 0
              ? "normal-exit"
              : "nonzero-exit",
      });
    });

    timer = setTimeout(() => {
      timedOut = true;
      terminateOwnedProcessTree(child);
      fallbackTimer = setTimeout(() => {
        finish({
          code: child.exitCode,
          signal: child.signalCode,
          phase: "timeout-kill-fallback",
        });
      }, 4000);
      fallbackTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();
  });
}
