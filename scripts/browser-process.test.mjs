import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyBrowserDomProgress,
  inspectBrowserEnvironment,
  runBrowserProcess,
} from "./browser-process.mjs";

test("zero-exit child without page requests is an early exit, not DOM failure", async () => {
  const child = await runBrowserProcess(
    process.execPath,
    ["-e", "process.exit(0)"],
    { timeoutMs: 3_000 }
  );
  assert.equal(child.code, 0);
  assert.equal(child.exitCode, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stdoutBytes, 0);
  assert.equal(child.stderrBytes, 0);
  assert.equal(child.closeReason, "normal-exit");
  assert.deepEqual(classifyBrowserDomProgress(child, []), {
    status: "NOT_RUN",
    reason: "BROWSER_EARLY_EXIT",
  });
});

test("native early crash without a page request remains NOT_RUN", () => {
  const child = {
    code: 2147483651,
    error: null,
    timedOut: false,
    timings: { spawnMs: 7 },
  };
  assert.deepEqual(classifyBrowserDomProgress(child, []), {
    status: "NOT_RUN",
    reason: "BROWSER_EARLY_EXIT",
  });
});

test("page load without harness bundle is not an assertion failure", () => {
  const child = {
    code: 0,
    error: null,
    timedOut: false,
    timings: { spawnMs: 1 },
  };
  assert.deepEqual(classifyBrowserDomProgress(child, ["/"]), {
    status: "NOT_RUN",
    reason: "PAGE_OR_HARNESS_NOT_LOADED",
  });
});

test("DOM classification requires page and harness requests", () => {
  const child = {
    code: 0,
    error: null,
    timedOut: false,
    timings: { spawnMs: 1 },
  };
  assert.deepEqual(classifyBrowserDomProgress(child, ["/", "/bundle.js"]), {
    status: "DOM_STARTED",
    reason: null,
  });
});

test("isolated profile preflight reports writable scope and profile locks", () => {
  const root = mkdtempSync(join(tmpdir(), "stationos-browser-probe-"));
  const localRoot = join(root, ".local");
  const profile = join(localRoot, "unique-profile");
  mkdirSync(profile, { recursive: true });
  try {
    const clean = inspectBrowserEnvironment(
      process.execPath,
      profile,
      localRoot
    );
    assert.equal(clean.executable.isFile, true);
    assert.equal(clean.executable.readable, true);
    assert.equal(clean.profile.inLocalRoot, true);
    assert.equal(clean.profile.writable, true);
    assert.deepEqual(clean.profile.lockFilesPresent, []);
    writeFileSync(join(profile, "SingletonLock"), "synthetic lock");
    const locked = inspectBrowserEnvironment(
      process.execPath,
      profile,
      localRoot
    );
    assert.deepEqual(locked.profile.lockFilesPresent, ["SingletonLock"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
