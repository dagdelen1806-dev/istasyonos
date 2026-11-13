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
    await until(
      () => evaluate('!!document.querySelector(".demo-dashboard-metrics")'),
      "dashboard"
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".demo-dashboard-metrics").closest("section").querySelectorAll("tbody tr").length'
      ),
      60
    );
    await input("input[name=dashboardMonth]", "2026-10");
    await until(
      () =>
        evaluate(
          'document.querySelector("input[name=dashboardFrom]").value==="2026-10-01"&&document.querySelector(".demo-dashboard-metrics")?.closest("section").querySelectorAll("tbody tr").length===31'
        ),
      "monthly data"
    );
    await writeFile(
      ".local/demo/dashboard-desktop.png",
      Buffer.from(
        (await send("Page.captureScreenshot", { format: "png" })).data,
        "base64"
      )
    );
    checks.push(
      "Gerçek formdan giriş; 60 günlük yönetim paneli ve Ekim 31 günlük tarih filtresi"
    );
    for (const path of [
      "/vardiyalar",
      "/sayaclar",
      "/icmal",
      "/tanklar",
      "/tank-dogrulama",
      "/gunluk-rapor",
      "/tanker-belge",
      "/slipler",
      "/muhasebe",
      "/market",
      "/satinalma",
      "/cari",
      "/finans",
      "/kurulum",
      "/entegrasyon",
      "/personel",
      "/denetim",
      "/asistan",
      "/profil",
    ]) {
      await send("Page.navigate", { url: base + path });
      await until(
        () =>
          evaluate(
            '!!document.querySelector(\'[aria-label="İstasyon filtresi"] option[value="' +
              access.stations[0].id +
              "\"]')"
          ),
        "station " + path
      );
      await select('[aria-label="İstasyon filtresi"]', access.stations[0].id);
      await new Promise(r => setTimeout(r, 400));
      assert.equal(
        await evaluate(
          'document.body.innerText.includes("Bir şeyler ters gitti")'
        ),
        false
      );
      assert.equal(
        await evaluate(
          'document.body.innerText.includes("Veritabanı verileri alınamadı")'
        ),
        false
      );
      if (path === "/tank-dogrulama")
        await until(
          () => evaluate('document.body.innerText.includes("LPG")'),
          "photo data"
        );
      if (path === "/gunluk-rapor")
        await until(
          () =>
            evaluate(
              'document.querySelector("select[name=dailyPackage]")?.options.length>1'
            ),
          "daily data"
        );
      if (path === "/tanker-belge")
        await until(
          () => evaluate('document.body.innerText.includes("VERIFIED_DRAFT")'),
          "OCR persisted"
        );
      if (path === "/cari") {
        const prior = JSON.parse(
          await readFile(".local/demo/browser-write.json", "utf8").catch(
            () => "null"
          )
        );
        if (!prior) {
          const [[before]] = await db.execute(
            "SELECT SUM(balance_minor) AS amount FROM st_debtors WHERE station_id=?",
            [access.stations[0].id]
          );
          await evaluate(
            '([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Tahsilat"&&!b.disabled)).click()'
          );
          await until(
            () =>
              evaluate(
                '!!document.querySelector("[role=dialog] input[name=amount]")'
              ),
            "collection form"
          );
          await input("[role=dialog] input[name=amount]", "1,00");
          await input(
            "[role=dialog] input[name=reference]",
            "DEMO-BROWSER-PERSISTENCE"
          );
          await evaluate(
            'document.querySelector("[role=dialog] form").requestSubmit()'
          );
          await until(async () => {
            const [[after]] = await db.execute(
              "SELECT SUM(balance_minor) AS amount FROM st_debtors WHERE station_id=?",
              [access.stations[0].id]
            );
            return Number(after.amount) === Number(before.amount) - 100;
          }, "real collection write");
          await writeFile(
            ".local/demo/browser-write.json",
            JSON.stringify({
              beforeMinor: Number(before.amount),
              afterMinor: Number(before.amount) - 100,
              amountMinor: 100,
              reference: "DEMO-BROWSER-PERSISTENCE",
            })
          );
        }
        await send("Page.reload", { ignoreCache: true });
        await until(
          () =>
            evaluate(
              "!!document.querySelector('[aria-label=\"İstasyon filtresi\"]')"
            ),
          "reloaded"
        );
        const [[payment]] = await db.query(
          "SELECT COUNT(*) AS n FROM st_payments WHERE reference='DEMO-BROWSER-PERSISTENCE' AND kind='AR_COLLECTION'"
        );
        assert.equal(Number(payment.n), 1);
      }
    }
    checks.push(
      "19 modül ekranı gerçek DEMO kayıtlarıyla açıldı; cari formundan 1 TL tahsilat MySQL’e yazıldı, yenilemede korundu"
    );
    await send("Page.navigate", { url: base + "/" });
    await until(
      () => evaluate('!!document.querySelector(".demo-dashboard-metrics")'),
      "dashboard mobile"
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    assert.equal(
      await evaluate("document.documentElement.scrollWidth<=innerWidth"),
      true
    );
    await writeFile(
      ".local/demo/dashboard-mobile.png",
      Buffer.from(
        (await send("Page.captureScreenshot", { format: "png" })).data,
        "base64"
      )
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1365,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await session("b-owner");
    await until(
      () => evaluate('!!document.querySelector(".demo-dashboard-metrics")'),
      "company B"
    );
    assert.equal(
      await evaluate(
        'document.querySelector(\'[aria-label="İstasyon filtresi"] option[value="' +
          access.stations[0].id +
          "\"]')===null"
      ),
      true
    );
    await session("0-fuel");
    await new Promise(r => setTimeout(r, 350));
    assert.equal(
      await evaluate('!!document.querySelector(".demo-dashboard-metrics")'),
      false
    );
    assert.equal(
      await evaluate(
        'document.querySelector(\'[aria-label="İstasyon filtresi"] option[value="' +
          access.stations[2].id +
          "\"]')===null"
      ),
      true
    );
    checks.push(
      "İkinci şirket ve pompacı girişlerinde tenant/rol ayrımı; mobil taşma denetimi"
    );
    assert.deepEqual(exceptions, []);
    ok = true;
    console.log(JSON.stringify({ ok, checks }));
  } catch (e) {
    if (evaluate)
      try {
        await writeFile(
          ".local/demo/browser-failure.txt",
          await evaluate("document.body.innerText")
        );
      } catch {}
    throw e;
  } finally {
    socket?.close();
    chrome?.kill();
    await db.end();
    await writeFile(
      ".local/demo/browser-result.json",
      JSON.stringify({ ok, checks }, null, 2)
    );
  }
}
run().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
