import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { connection, demoDatabase } from "./demo-environment.mjs";
import { request } from "./demo-seed.mjs";
async function run() {
  if (
    process.argv[2] !== "--database" ||
    process.argv[3] !== demoDatabase ||
    process.argv[4] !== "--browser"
  )
    throw Error("EXPLICIT_DEMO_TARGET_REQUIRED");
  const db = await connection(),
    access = JSON.parse(await readFile(".local/demo/access.json", "utf8")),
    base = "http://127.0.0.1:3001",
    checks = [],
    exceptions = [];
  let chrome,
    socket,
    evaluate,
    ok = false;
  async function until(fn, label) {
    for (let n = 0; n < 150; n++) {
      try {
        if (await fn()) return;
      } catch {}
      await new Promise(r => setTimeout(r, 150));
    }
    throw Error("TIMEOUT:" + label);
  }
  try {
    assert.equal(
      (await request("/api/health", null, null)).data.demoDatabase,
      demoDatabase
    );
    const port = 19310;
    chrome = spawn(
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=" + port,
        "--user-data-dir=" +
          process.cwd() +
          "/.local/demo/browser-" +
          Date.now(),
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" }
    );
    await until(
      async () =>
        (await fetch("http://127.0.0.1:" + port + "/json/version")).ok,
      "Chrome"
    );
    const page = await (
      await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", {
        method: "PUT",
      })
    ).json();
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      socket.onopen = r;
      socket.onerror = j;
    });
    let seq = 0;
    const pending = new Map();
    socket.onmessage = e => {
      const m = JSON.parse(e.data),
        p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error ? p.reject(Error("CDP_FAILED")) : p.resolve(m.result);
      } else if (m.method === "Runtime.exceptionThrown")
        exceptions.push(m.params.exceptionDetails.text);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    evaluate = async expression => {
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (r.exceptionDetails) throw Error("UI_EVALUATION");
      return r.result.value;
    };
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1365,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    });
    async function select(selector, value) {
      await evaluate(
        "(()=>{const i=document.querySelector(" +
          JSON.stringify(selector) +
          ');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(i,' +
          JSON.stringify(value) +
          ');i.dispatchEvent(new Event("change",{bubbles:true}))})()'
      );
    }
    async function input(selector, value) {
      await evaluate(
        "(()=>{const i=document.querySelector(" +
          JSON.stringify(selector) +
          ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,' +
          JSON.stringify(value) +
          ');i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}))})()'
      );
    }
    async function session(label) {
      await send("Page.navigate", { url: base + "/" });
      await until(() => evaluate('document.readyState==="complete"'), "page");
      await evaluate(
        'fetch("/api/trpc/auth.logout",{method:"POST",headers:{"Content-Type":"application/json","X-Stationos-Request":"1"},body:JSON.stringify({json:null})}).then(()=>true)'
      );
      await send("Page.navigate", { url: base + "/" });
      await until(
        () =>
          evaluate(
            '!!document.querySelector(".local-login-form input[name=email]")'
          ),
        "login"
      );
      const actor = access.actors[label];
      await input("input[name=email]", actor.email);
      await input("input[name=password]", actor.password);
      await evaluate(
        'document.querySelector(".local-login-form").requestSubmit()'
      );
      await until(
        () =>
          evaluate(
            "!!document.querySelector('[aria-label=\"İstasyon filtresi\"]')"
          ),
        "authenticated"
      );
    }

    await session("a-owner");
    await send("Page.navigate", { url: base + "/icmal" });
    await until(
      () =>
        evaluate(
          "!!document.querySelector('select[aria-label] option[value=\"" +
            access.stations[0].id +
            "\"]')"
        ),
      "station"
    );
    await select("select[aria-label]", access.stations[0].id);
    await until(
      () => evaluate('!!document.querySelector("input[name=icmalDay]")'),
      "icmal"
    );
    await input("input[name=icmalDay]", access.anchorDay);
    const [[latest]] = await db.execute(
      "SELECT a.source_sales_minor FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id WHERE a.station_id=? AND a.business_unit='FUEL' AND a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') ORDER BY s.starts_at DESC LIMIT 1",
      [access.stations[0].id]
    );
    const expectedTotal = (
      Number(latest.source_sales_minor) / 100
    ).toLocaleString("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    await until(
      () =>
        evaluate(
          "document.body.innerText.includes(" +
            JSON.stringify(expectedTotal) +
            ")"
        ),
      "current day totals"
    );
    await until(
      () =>
        evaluate(
          '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Excel (.xlsx) indir"&&!b.disabled)'
        ),
      "loaded export"
    );
    const { mkdir, readdir } = await import("node:fs/promises"),
      { resolve } = await import("node:path");
    const dir = resolve(".local/demo/downloads");
    await mkdir(dir, { recursive: true });
    const downloadEvents = [];
    socket.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.method?.startsWith("Browser.download"))
        downloadEvents.push({
          method: m.method,
          state: m.params?.state,
          receivedBytes: m.params?.receivedBytes,
        });
    });
    await send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: dir,
      eventsEnabled: true,
    });
    await evaluate(
      "(()=>{const original=URL.createObjectURL;window.__demoBlobSizes=[];URL.createObjectURL=function(blob){window.__demoBlobSizes.push(blob.size);return original.call(URL,blob)}})()"
    );
    await until(
      () =>
        evaluate(
          '(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Excel (.xlsx) indir");if(!b||b.disabled)return false;b.click();return true})()'
        ),
      "export click"
    );
    await writeFile(
      ".local/demo/download-debug.json",
      JSON.stringify({
        blobSizes: await evaluate("window.__demoBlobSizes"),
        downloadEvents,
      })
    );
    await until(
      async () => (await readdir(dir)).some(f => f.endsWith(".xlsx")),
      "xlsx download"
    );
    const file = (await readdir(dir)).find(f => f.endsWith(".xlsx"));
    assert.equal(
      (await readFile(dir + "/" + file)).subarray(0, 2).toString(),
      "PK"
    );
    await evaluate(
      '[...document.querySelectorAll("button")].find(b=>b.textContent.trim().startsWith("PDF /")).click()'
    );
    let popup;
    await until(async () => {
      popup = (
        await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()
      ).find(
        t => t.type === "page" && t.id !== page.id && t.title.includes("icmali")
      );
      return !!popup;
    }, "print popup");
    const ps = new WebSocket(popup.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ps.onopen = r;
      ps.onerror = j;
    });
    let pseq = 0;
    const waits = new Map();
    ps.onmessage = e => {
      const m = JSON.parse(e.data),
        w = waits.get(m.id);
      if (w) {
        waits.delete(m.id);
        m.error ? w.reject(Error("PDF_CDP")) : w.resolve(m.result);
      }
    };
    const pSend = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++pseq;
        waits.set(id, { resolve, reject });
        ps.send(JSON.stringify({ id, method, params }));
      });
    await until(
      async () =>
        (
          await pSend("Runtime.evaluate", {
            expression:
              'document.body.innerText.includes("DEMO")&&!!document.querySelector("table")',
            returnByValue: true,
          })
        ).result.value,
      "print data"
    );
    const pdf = Buffer.from(
      (
        await pSend("Page.printToPDF", {
          printBackground: true,
          landscape: true,
        })
      ).data,
      "base64"
    );
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    await writeFile(".local/demo/icmal-demo.pdf", pdf);
    ps.close();
    checks.push(
      "Ger?ek DEMO icmalinden taray?c?yla XLSX indirme ve PDF yazd?rma; PK/%PDF bi?imi do?ruland?"
    );
    assert.deepEqual(exceptions, []);
    ok = true;
    console.log(JSON.stringify({ ok, checks }));
  } catch (e) {
    if (evaluate)
      try {
        await writeFile(
          ".local/demo/export-failure.txt",
          await evaluate("document.body.innerText")
        );
      } catch {}
    throw e;
  } finally {
    socket?.close();
    chrome?.kill();
    await db.end();
    await writeFile(
      ".local/demo/export-result.json",
      JSON.stringify({ ok, checks }, null, 2)
    );
  }
}
run().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
