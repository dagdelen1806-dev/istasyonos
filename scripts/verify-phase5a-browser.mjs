import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { demoDatabase } from "./demo-environment.mjs";
if (
  process.argv[2] !== "--database" ||
  process.argv[3] !== demoDatabase ||
  process.argv[4] !== "--browser"
)
  throw Error("EXPLICIT_DEMO_TARGET_REQUIRED");
const base = "http://127.0.0.1:3001",
  access = JSON.parse(await readFile(".local/demo/access.json", "utf8")),
  checks = [],
  exceptions = [];
assert.equal(
  (await (await fetch(base + "/api/health")).json()).demoDatabase,
  demoDatabase
);
let chrome,
  socket,
  evaluate,
  passed = false;
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw Error("TIMEOUT:" + label);
}
try {
  const port = 19315;
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
        "/.local/demo/phase5a-browser-" +
        Date.now(),
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" }
  );
  await until(
    async () => (await fetch("http://127.0.0.1:" + port + "/json/version")).ok,
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
  socket.onclose = () => {
    for (const p of pending.values()) p.reject(Error("CDP_CLOSED"));
    pending.clear();
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("CDP_TIMEOUT:" + method));
      }, 10000);
      pending.set(id, {
        resolve: r => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: e => {
          clearTimeout(timer);
          reject(e);
        },
      });
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
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1365,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  async function input(selector, value, select = false) {
    await evaluate(
      `(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${select ? "HTMLSelectElement" : "HTMLInputElement"}.prototype,"value").set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));})()`
    );
  }
  async function session(key) {
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
    await input("input[name=email]", access.actors[key].email);
    await input("input[name=password]", access.actors[key].password);
    await evaluate(
      'document.querySelector(".local-login-form").requestSubmit()'
    );
    await until(
      () =>
        evaluate(
          `!!document.querySelector('select[aria-label="İstasyon filtresi"]')`
        ),
      "authenticated"
    );
  }
  await session("a-owner");
  await until(
    () => evaluate('!!document.querySelector("[data-finding=SALES]")'),
    "dashboard assistant"
  );
  assert.equal(
    await evaluate(
      'document.querySelector("[data-testid=smart-assistant]").innerText.includes("6.046.643")'
    ),
    true
  );
  assert.equal(
    await evaluate(
      'document.querySelector("[data-testid=assistant-provider]").innerText.includes("Gemini bağlantısı kapalı")'
    ),
    true
  );
  assert.equal(
    await evaluate(
      'document.querySelector("[data-testid=smart-assistant] button").disabled'
    ),
    true
  );
  await evaluate(
    'document.querySelector("[data-finding=SALES] details").open=true'
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll("[data-finding=SALES] tbody tr").length'
    ),
    10
  );
  assert.equal(
    await evaluate(
      'document.querySelector("[data-finding=SALES]").innerText.includes("10/240")'
    ),
    true
  );
  await writeFile(
    ".local/demo/phase5a-desktop.png",
    Buffer.from(
      (
        await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
        })
      ).data,
      "base64"
    )
  );
  checks.push(
    "Yönetim panelinde canlı MySQL raporu, yerel mod, kapalı Gemini düğmesi ve 10/240 kaynak kanıtı"
  );
  await input('input[aria-label="Asistan başlangıç"]', "2026-10-01");
  await input('input[aria-label="Asistan bitiş"]', "2026-10-31");
  await until(
    () =>
      evaluate(
        'document.querySelector("[data-finding=SALES]")?.innerText.includes("124 kayıt")'
      ),
    "date filter"
  );
  await input(
    'select[aria-label="İstasyon filtresi"]',
    access.stations[0].id,
    true
  );
  await until(
    () =>
      evaluate(
        'document.querySelector("[data-finding=SALES]")?.innerText.includes("62 kayıt")'
      ),
    "station filter"
  );
  const companyValue = await evaluate(
    `document.querySelector('select[aria-label="Asistan şirket"] option[value]:not([value=""])').value`
  );
  await input('select[aria-label="Asistan şirket"]', companyValue, true);
  await until(
    () =>
      evaluate(
        'document.querySelector("[data-finding=SALES]")?.innerText.includes("62 kayıt")'
      ),
    "company filter"
  );
  await send("Page.navigate", { url: base + "/asistan" });
  await until(
    () => evaluate('!!document.querySelector("[data-finding=SALES]")'),
    "assistant route"
  );
  assert.equal(
    await evaluate('document.body.innerText.includes("Akıllı Asistan")'),
    true
  );
  checks.push(
    "Ekim tarih aralığı 124 hesap; istasyon ve şirket filtresi 62 hesap; /asistan ekranı"
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate(
    `document.querySelector('[aria-label="Menüyü kapat"]')?.click()`
  );
  await new Promise(r => setTimeout(r, 400));
  await evaluate(
    'document.querySelectorAll("[data-testid=smart-assistant] details").forEach(d=>d.open=true)'
  );
  await writeFile(".local/demo/phase5a-layout.json",JSON.stringify(await evaluate(`['.main-shell','.workspace-main','[data-testid=smart-assistant]','[data-testid=smart-assistant] select'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {s,width:r.width,left:r.left,right:r.right,scroll:e.scrollWidth,inner:window.innerWidth};})`),null,2));
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"),
    true
  );
  await writeFile(
    ".local/demo/phase5a-mobile.png",
    Buffer.from(
      (await send("Page.captureScreenshot", { format: "png" })).data,
      "base64"
    )
  );
  checks.push(
    "390px mobil görünüm: kaynak tablosu dahil yatay sayfa taşması yok"
  );
  await session("b-owner");
  await until(
    () => evaluate('!!document.querySelector("[data-finding=SALES]")'),
    "second tenant"
  );
  assert.equal(
    await evaluate(
      'document.querySelector("[data-testid=smart-assistant]").innerText.includes("3.023.321")'
    ),
    true
  );
  assert.equal(
    await evaluate(
      'document.querySelector("[data-testid=smart-assistant]").innerText.includes("Kuzey")'
    ),
    false
  );
  await session("0-fuel");
  await new Promise(r => setTimeout(r, 300));
  assert.equal(
    await evaluate('!!document.querySelector("[data-testid=smart-assistant]")'),
    false
  );
  assert.deepEqual(exceptions, []);
  checks.push(
    "İkinci şirket ayrı verileri görüyor; pompacı mali asistanı göremiyor; JavaScript hatası yok"
  );
  passed = true;
  console.log(JSON.stringify({ passed, checks }, null, 2));
} catch (e) {
  if (evaluate)
    try {
      await writeFile(
        ".local/demo/phase5a-browser-failure.txt",
        await evaluate("document.body.innerText")
      );
    } catch {}
  throw e;
} finally {
  socket?.close();
  chrome?.kill();
  await writeFile(
    ".local/demo/phase5a-browser.json",
    JSON.stringify({ passed, checks }, null, 2)
  );
}
