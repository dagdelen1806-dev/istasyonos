import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("manual mode serves loopback synthetic page without launching a browser", async t => {
  const child = spawn(
    process.execPath,
    ["scripts/staffing-browser-test.mjs", "--manual"],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] }
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));

  const deadline = Date.now() + 15_000;
  let match;
  while (!match && Date.now() < deadline && child.exitCode === null) {
    match = stdout.match(/MANUAL_SERVER_URL=(http:\/\/127\.0\.0\.1:\d+\/)/);
    if (!match) await delay(50);
  }
  assert.ok(
    match,
    `manual server did not publish loopback URL; stderr=${stderr}`
  );
  assert.match(stdout, /BROWSER_MANUAL_SYNTHETIC_ONLY/);
  assert.match(stdout, /MANUAL_SERVER_READY host=127\.0\.0\.1 port=\d+ url=/);
  assert.doesNotMatch(stdout, /BROWSER_SMOKE_PASS|BROWSER_DOM_PASS/);

  const baseUrl = match[1];
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.equal(child.exitCode, null, "HTTP GET must not terminate the server");
  const html = await page.text();
  assert.match(html, /rel="stylesheet" href="\/styles\.css"/);
  assert.match(
    html,
    /onload="document\.documentElement\.dataset\.stylesheetLoaded='true'/
  );
  assert.match(
    html,
    /onerror="document\.documentElement\.dataset\.stylesheetLoaded='false'/
  );
  assert.match(html, /stylesheet-load-error/);
  assert.match(html, /Sentetik inceleme CSS'i yüklenemedi/);
  const shutdownAction = html.match(/action="(\/__shutdown\?token=[^"]+)"/);
  assert.ok(
    shutdownAction,
    "manual page should expose an explicit shutdown action"
  );
  assert.ok(html.includes("YALNIZ SENTETİK TEST"));
  assert.ok(html.includes("/__clear-local-state"));

  const bundle = await fetch(new URL("bundle.js", baseUrl));
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get("content-type") ?? "", /javascript/);

  const styles = await fetch(new URL("styles.css", baseUrl));
  assert.equal(styles.status, 200);
  assert.match(styles.headers.get("content-type") ?? "", /^text\/css/);
  const css = await styles.text();
  assert.ok(Buffer.byteLength(css) > 1000);
  assert.ok(css.includes(".pompaci-mobile"));
  assert.ok(css.includes(".panel-heading"));
  assert.ok(css.includes(":focus-visible"));
  assert.ok(css.includes("max-width:560px"));
  assert.ok(css.includes("max-width:360px"));
  assert.match(
    html,
    /name="viewport" content="width=device-width, initial-scale=1"/
  );

  const cleanup = await fetch(new URL("__clear-local-state", baseUrl));
  assert.equal(cleanup.status, 200);
  assert.equal(cleanup.headers.get("clear-site-data"), '"storage"');
  assert.match(await cleanup.text(), /isolated localhost test origin/);
  assert.equal(
    child.exitCode,
    null,
    "storage cleanup must not stop the server"
  );
  assert.equal((await fetch(baseUrl)).status, 200);

  const deniedShutdown = await fetch(
    new URL("__shutdown?token=wrong", baseUrl),
    {
      method: "POST",
    }
  );
  assert.equal(deniedShutdown.status, 403);
  assert.equal(
    child.exitCode,
    null,
    "invalid shutdown token must not stop the server"
  );

  const shutdown = await fetch(new URL(shutdownAction[1].slice(1), baseUrl), {
    method: "POST",
  });
  assert.equal(shutdown.status, 202);
  const exitTimeout = setTimeout(() => child.kill(), 3_000);
  let code;
  try {
    [code] = await once(child, "exit");
  } finally {
    clearTimeout(exitTimeout);
  }
  assert.equal(code, 0, stderr);
  assert.match(stdout, /BROWSER_MANUAL_SESSION_CLOSED/);
  assert.match(stdout, /MANUAL_SERVER_CLOSED/);
  assert.doesNotMatch(stdout, /BROWSER_DOM_PASS/);
});
