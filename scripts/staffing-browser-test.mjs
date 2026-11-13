import { build } from "esbuild";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildStaffingStylesheet } from "./staffing-styles.mjs";
import {
  classifyBrowserDomProgress,
  inspectBrowserEnvironment,
  resolveBrowser,
  runBrowserProcess,
} from "./browser-process.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localRoot = resolve(root, ".local");
const manualMode = process.argv.includes("--manual");

const phaseTimes = {};
const phaseStarted = performance.now();
const bundleStarted = performance.now();
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["scripts/staffing-browser-harness.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "@shared": join(root, "shared"), "@": join(root, "client/src") },
});
phaseTimes.harnessBundleMs = Math.round(performance.now() - bundleStarted);
const stylesheetStarted = performance.now();
const stylesheet = await buildStaffingStylesheet(root);
phaseTimes.stylesheetMs = Math.round(performance.now() - stylesheetStarted);
if (process.argv.includes("--build-only")) {
  process.stdout.write(
    `STAFFING_HARNESS_BUILD_PASS: bundle=${phaseTimes.harnessBundleMs}ms stylesheet=${phaseTimes.stylesheetMs}ms cssBytes=${Buffer.byteLength(stylesheet)}; browser was not started.\n`
  );
  process.exit(0);
}

const { candidates, executable } = manualMode
  ? { candidates: [], executable: null }
  : resolveBrowser();
if (!manualMode && !executable) {
  process.stderr.write(
    `BROWSER_NOT_RUN: Chrome/Edge executable not found; checked ${candidates.length} configured locations.\n`
  );
  process.exit(2);
}

let smokePassed = false;
if (!manualMode) {
  const smokeProfileDir = join(localRoot, `browser-smoke-${randomUUID()}`);
  try {
    const { mkdirSync, rmSync } = await import("node:fs");
    mkdirSync(smokeProfileDir, { recursive: true });
    const smokeEnvironment = inspectBrowserEnvironment(
      executable,
      smokeProfileDir,
      localRoot
    );
    process.stdout.write(
      `BROWSER_SMOKE_ENVIRONMENT=${JSON.stringify(smokeEnvironment)}\n`
    );
    const smokeEnvironmentReady =
      smokeEnvironment.executable.isFile &&
      smokeEnvironment.executable.readable &&
      smokeEnvironment.profile.inLocalRoot &&
      smokeEnvironment.profile.writable &&
      smokeEnvironment.profile.lockFilesPresent.length === 0 &&
      smokeEnvironment.temp.isDirectory &&
      smokeEnvironment.temp.readable &&
      smokeEnvironment.temp.writable;
    if (!smokeEnvironmentReady) {
      process.stderr.write(
        "BROWSER_NOT_RUN: smoke preflight failed; Chrome/Edge was not launched and DOM assertions were not run.\n"
      );
    } else {
      const smokeArgs = [
        "--headless=new",
        "--window-size=390,844",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-extensions",
        "--disable-sync",
        "--no-first-run",
        `--user-data-dir=${smokeProfileDir}`,
        "--dump-dom",
        "about:blank",
      ];
      process.stdout.write(`BROWSER_SMOKE_ARGS=${JSON.stringify(smokeArgs)}\n`);
      const smokeResult = await runBrowserProcess(executable, smokeArgs, {
        timeoutMs: 20_000,
      });
      const smokeHasDom = /<html[\s>]/i.test(smokeResult.stdout);
      process.stdout.write(
        `BROWSER_SMOKE_PROCESS=${JSON.stringify({ exitCode: smokeResult.code, signal: smokeResult.signal, closeReason: smokeResult.closeReason, spawnErrorCode: smokeResult.spawnErrorCode, spawnErrorName: smokeResult.spawnErrorName, stdoutBytes: smokeResult.stdoutBytes, stderrBytes: smokeResult.stderrBytes, timings: smokeResult.timings })}\n`
      );
      smokePassed =
        !smokeResult.error &&
        !smokeResult.timedOut &&
        smokeResult.code === 0 &&
        smokeHasDom;
      if (!smokePassed) {
        const earlyExit =
          !smokeResult.error &&
          !smokeResult.timedOut &&
          smokeResult.stdoutBytes === 0 &&
          smokeResult.stderrBytes === 0;
        const reason = earlyExit
          ? "BROWSER_EARLY_EXIT"
          : smokeResult.timedOut
            ? "ETIMEDOUT"
            : (smokeResult.error?.code ?? `exit=${smokeResult.code}`);
        process.stderr.write(
          `BROWSER_NOT_RUN: smoke did not return about:blank DOM; reason=${reason}; exitCode=${smokeResult.code}; signal=${smokeResult.signal ?? "none"}; closeReason=${smokeResult.closeReason}; stdoutBytes=${smokeResult.stdoutBytes}; stderrBytes=${smokeResult.stderrBytes}; DOM assertions were not run.\n`
        );
      } else {
        process.stdout.write(
          "BROWSER_SMOKE_PASS: isolated about:blank DOM received.\n"
        );
      }
    }
  } catch (error) {
    process.stderr.write(
      `BROWSER_NOT_RUN: smoke stage failed; error=${error instanceof Error ? error.name : "unknown"}; code=${error?.code ?? "none"}. DOM assertions were not run.\n`
    );
  } finally {
    if (resolve(smokeProfileDir).startsWith(`${localRoot}\\`)) {
      const { rmSync } = await import("node:fs");
      rmSync(smokeProfileDir, { recursive: true, force: true });
    }
  }
  if (!smokePassed) process.exit(2);
} else {
  process.stdout.write(
    "BROWSER_MANUAL_SYNTHETIC_ONLY: Chrome smoke skipped; no app API/DB or external service is available.\n"
  );
}

const requests = [];
const manualShutdownToken = randomUUID();
let stopManualServer = () => {};
const server = createServer((request, response) => {
  requests.push({
    path: request.url,
    atMs: Math.round(performance.now() - phaseStarted),
  });
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/__shutdown") {
    if (
      !manualMode ||
      requestUrl.searchParams.get("token") !== manualShutdownToken
    ) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(202, {
      "content-type": "text/plain; charset=utf-8",
      connection: "close",
    });
    response.end("Manual synthetic server is shutting down.");
    setTimeout(() => stopManualServer("explicit-close"), 50).unref();
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  if (request.url === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>İstasyonOS sentetik ÖSSE akış incelemesi</title><link id="synthetic-styles" rel="stylesheet" href="/styles.css" onload="document.documentElement.dataset.stylesheetLoaded='true'" onerror="document.documentElement.dataset.stylesheetLoaded='false'"></head><body>${manualMode ? `<aside style="position:sticky;top:0;background:#fff3cd;color:#222;padding:12px;border:2px solid #856404;z-index:9999;font:16px sans-serif"><strong>YALNIZ SENTETİK TEST</strong> — Gerçek uygulamaya/API/DB bağlanmaz; gerçek davet veya kayıt yapmayın.<br><a href="/__clear-local-state">Bu test origininin yerel depolamasını temizle</a><form method="post" action="/__shutdown?token=${manualShutdownToken}" style="display:inline;margin-left:12px"><button type="submit">Sentetik sunucuyu kapat</button></form><span> Temizleme sunucuyu kapatmaz. Sunucuyu Ctrl+C ile de durdurabilirsiniz.</span></aside>` : ""}<div id="stylesheet-load-error" role="alert" hidden style="position:sticky;top:0;background:#8b0000;color:white;padding:12px;z-index:10000">HATA: Sentetik inceleme CSS'i yüklenemedi; biçimlendirme doğrulanmadı.</div><div id="mobile"></div><div id="mobile-shifts"></div><div id="mobile-shifts-gated"></div><div id="mobile-submit"></div><div id="manager"></div><div id="manager-gated"></div><div id="reconciliation"></div><div id="legacy-reconciliation"></div><div id="invalid-row-reconciliation"></div><div id="legacy-daily-reconciliation"></div><div id="mismatch"></div><div id="api-error"></div><div id="tenant-mismatch"></div><div id="station-mismatch"></div><div id="date-mismatch"></div><div id="shift-mismatch"></div><div id="person-mismatch"></div><pre id="browser-diagnostics"></pre><script>if(document.documentElement.dataset.stylesheetLoaded==='false'){document.getElementById('stylesheet-load-error').hidden=false}</script><script src="/bundle.js"></script></body></html>`
    );
    return;
  }
  if (request.url === "/__clear-local-state") {
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "clear-site-data": '"storage"',
    });
    response.end(
      "This isolated localhost test origin requested storage cleanup. You may close this tab and return to the terminal."
    );
    return;
  }
  if (request.url === "/bundle.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(bundle.outputFiles[0].text);
    return;
  }
  if (request.url === "/styles.css") {
    response.writeHead(200, {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(stylesheet);
    return;
  }
  if (request.url?.startsWith("/api/stationos/pos-slip-drafts?")) {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end('{"drafts":[]}');
    return;
  }
  response.writeHead(404).end();
});

let profileDir;
try {
  const listenStarted = performance.now();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  phaseTimes.fixtureServerBindMs = Math.round(
    performance.now() - listenStarted
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local fixture server failed to bind.");

  if (manualMode) {
    const url = `http://127.0.0.1:${address.port}/`;
    let finishManual;
    let manualStopping = false;
    const manualStopped = new Promise(resolveStop => {
      finishManual = resolveStop;
    });
    stopManualServer = reason => {
      if (manualStopping) return;
      manualStopping = true;
      process.stdout.write(`MANUAL_SERVER_STOPPING reason=${reason}\n`);
      server.close(() => {
        process.stdout.write(
          "BROWSER_MANUAL_SESSION_CLOSED: visual review only; automated DOM assertions were NOT_RUN.\nMANUAL_SERVER_CLOSED\n"
        );
        finishManual();
      });
      server.closeAllConnections();
    };
    process.once("SIGINT", () => stopManualServer("SIGINT"));
    process.stdout.write(`MANUAL_SERVER_URL=${url}\n`);
    process.stdout.write(`MANUAL_SERVER_PORT=${address.port}\n`);
    process.stdout.write(
      `MANUAL_SERVER_READY host=127.0.0.1 port=${address.port} url=${url}\n`
    );
    process.stdout.write(
      "BROWSER_MANUAL_INSTRUCTIONS=Open the URL in your normal browser. Storage cleanup is separate from server shutdown. Stop with Ctrl+C or the explicit shutdown button in the page. No browser process is launched.\n"
    );
    await manualStopped;
  } else {
    profileDir = join(localRoot, `staffing-browser-${randomUUID()}`);
    const { mkdirSync, rmSync } = await import("node:fs");
    mkdirSync(profileDir, { recursive: true });
    const browserEnvironment = inspectBrowserEnvironment(
      executable,
      profileDir,
      localRoot
    );
    process.stdout.write(
      `BROWSER_DOM_ENVIRONMENT=${JSON.stringify(browserEnvironment)}\n`
    );
    if (
      !browserEnvironment.executable.isFile ||
      !browserEnvironment.executable.readable ||
      !browserEnvironment.profile.inLocalRoot ||
      !browserEnvironment.profile.writable ||
      browserEnvironment.profile.lockFilesPresent.length > 0 ||
      !browserEnvironment.temp.isDirectory ||
      !browserEnvironment.temp.readable ||
      !browserEnvironment.temp.writable
    ) {
      throw Object.assign(new Error("Browser environment preflight failed"), {
        code: "BROWSER_ENV_PREFLIGHT_FAILED",
      });
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
      "--virtual-time-budget=6000",
      "--dump-dom",
      `http://127.0.0.1:${address.port}/`,
    ];
    process.stdout.write(`BROWSER_EXECUTABLE=${executable}\n`);
    process.stdout.write(`BROWSER_LAUNCH_ARGS=${JSON.stringify(args)}\n`);
    process.stdout.write(
      `BROWSER_PHASE harness_bundle=${phaseTimes.harnessBundleMs}ms fixture_server_bind=${phaseTimes.fixtureServerBindMs}ms\n`
    );

    const result = await runBrowserProcess(executable, args, {
      timeoutMs: 25_000,
    });
    phaseTimes.browserProcess = result.timings;
    const requestStages = requests.map(({ path, atMs }) => ({
      stage:
        path === "/"
          ? "page-load"
          : path === "/bundle.js"
            ? "harness-fetch"
            : path === "/styles.css"
              ? "stationos-stylesheet"
              : "fixture-fetch",
      atMs,
    }));
    process.stdout.write(
      `BROWSER_PHASE requests=${JSON.stringify(requestStages)} process=${JSON.stringify({ exitCode: result.code, signal: result.signal, closeReason: result.closeReason, spawnErrorCode: result.spawnErrorCode, spawnErrorName: result.spawnErrorName, stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes, timings: result.timings })}\n`
    );
    if (result.outputLimitExceeded) {
      process.stderr.write(
        "BROWSER_NOT_RUN: bounded browser output limit exceeded.\n"
      );
      process.exitCode = 2;
    } else {
      const output = result.stdout;
      const progress = classifyBrowserDomProgress(
        result,
        requests.map(item => item.path)
      );
      const readDiagnostics = () => {
        const encoded = output.match(/data-test-diagnostics="([^\"]*)"/)?.[1];
        if (!encoded) return null;
        try {
          return JSON.parse(decodeURIComponent(encoded));
        } catch {
          return { diagnosticDecode: "failed" };
        }
      };
      const diagnostics = readDiagnostics();
      if (progress.status === "NOT_RUN") {
        process.stderr.write(
          `BROWSER_NOT_RUN: ${progress.reason}; exitCode=${result.code}; signal=${result.signal ?? "none"}; closeReason=${result.closeReason}; spawnErrorCode=${result.spawnErrorCode ?? "none"}; spawnErrorName=${result.spawnErrorName ?? "none"}; stdoutBytes=${result.stdoutBytes}; stderrBytes=${result.stderrBytes}; requests=${JSON.stringify(requestStages)}; DOM assertions did not complete.\n`
        );
        process.exitCode = 2;
      } else {
        const failedChecks = [
          "test",
          "staffing-gate",
          "mobile-entry",
          "mobile-submit",
          "legacy-draft",
          "invalid-row",
          "daily-source-fallback",
          "reconciliation",
          "financial-review",
          "mobile-sales-gate",
          "scope-mismatch",
          "api-error",
          "accessibility",
          "mobile-layout",
        ].some(name => output.includes(`data-${name}-result="FAIL"`));
        const expectedPassMarkers = [
          "data-test-result",
          "data-staffing-gate-result",
          "data-mobile-entry-result",
          "data-mobile-submit-result",
          "data-legacy-draft-result",
          "data-invalid-row-result",
          "data-daily-source-fallback-result",
          "data-reconciliation-result",
          "data-financial-review-result",
          "data-mobile-sales-gate-result",
          "data-scope-mismatch-result",
          "data-api-error-result",
          "data-accessibility-result",
          "data-mobile-layout-result",
        ];
        const missingPassMarker = expectedPassMarkers.find(
          marker => !output.includes(`${marker}="PASS"`)
        );
        const incompleteDomMarker = expectedPassMarkers.find(
          marker => !new RegExp(`${marker}="(?:PASS|FAIL)"`).test(output)
        );
        const browserErrors = Array.isArray(diagnostics?.browserErrors)
          ? diagnostics.browserErrors
          : [];
        const stylesheetRequested = requests.some(
          item => item.path === "/styles.css"
        );
        const stylesheetApplied = output.includes(
          'data-stylesheet-loaded="true"'
        );
        if (!stylesheetRequested || !stylesheetApplied) {
          process.stderr.write(
            `BROWSER_FAIL: synthetic DOM loaded without verified StationOS stylesheet; css_request=${stylesheetRequested}; css_applied=${stylesheetApplied}.\n`
          );
          process.exitCode = 1;
        } else if (browserErrors.length > 0) {
          process.stderr.write(
            `BROWSER_FAIL: browser page/console errors; incomplete_dom_marker=${incompleteDomMarker ?? "none"}; browser_error_count=${browserErrors.length}.\n${JSON.stringify(diagnostics ?? { diagnostics: "unavailable" }, null, 2)}\n`
          );
          process.exitCode = 1;
        } else if (incompleteDomMarker) {
          process.stderr.write(
            `BROWSER_NOT_RUN: DOM_RESULT_INCOMPLETE; missing_result_marker=${incompleteDomMarker}; requests=${JSON.stringify(requestStages)}; stdoutBytes=${result.stdoutBytes}; stderrBytes=${result.stderrBytes}.\n`
          );
          process.exitCode = 2;
        } else if (failedChecks || missingPassMarker) {
          process.stderr.write(
            `BROWSER_FAIL: synthetic DOM assertions failed; missing_pass_marker=${missingPassMarker ?? "none"}; browser_error_count=0.\n${JSON.stringify(diagnostics ?? { diagnostics: "unavailable" }, null, 2)}\n`
          );
          process.exitCode = 1;
        } else {
          process.stdout.write(
            `BROWSER_DOM_PASS: synthetic React DOM assertions completed; result_transfer_ms=${result.timings.firstStdoutMs ?? "unknown"}; no backend or database endpoint was available.\n`
          );
        }
      }
    }
  }
} catch (error) {
  process.stderr.write(
    `BROWSER_NOT_RUN: runner stage failed (${error instanceof Error ? error.name : "unknown"}); code=${error?.code ?? "none"}.\n`
  );
  process.exitCode = 2;
} finally {
  await new Promise(resolveClose => server.close(() => resolveClose()));
  if (profileDir && resolve(profileDir).startsWith(`${localRoot}\\`)) {
    const { rmSync } = await import("node:fs");
    rmSync(profileDir, { recursive: true, force: true });
  }
}
