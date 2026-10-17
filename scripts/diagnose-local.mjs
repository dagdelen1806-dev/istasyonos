import "dotenv/config";
import { readdir } from "node:fs/promises";
import mysql from "mysql2/promise";

// Read-only: no migrations, registration, session changes or business writes.
// Never print connection strings, credentials, response bodies or SQL errors.
let failed = false;
function report(label, detail, ok = true) {
  console.log(`${ok ? "OK" : "HATA"} ${label}: ${detail}`);
  if (!ok) failed = true;
}
function errorCode(error) {
  return typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : "BAGLANTI_VEYA_YANIT_HATASI";
}
async function get(base, path) {
  const response = await fetch(new URL(path, base), {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  return { response, text: await response.text() };
}

console.log("IstasyonOS salt okunur yerel tani — 2026-10-17");
console.log(`Node: ${process.version}`);
const port = Number(process.env.PORT || "3000");
if (Number.isInteger(port) && port >= 1 && port <= 65535) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const { response, text } = await get(base, "/api/health");
    let health;
    try { health = JSON.parse(text); } catch { /* Invalid JSON is reported below. */ }
    report("Sunucu", `HTTP ${response.status}; port ${port}`, response.ok && health?.status === "ok");
  } catch {
    report("Sunucu", `port ${port} uzerinde saglik yaniti alinamadi; pnpm dev terminalini kontrol edin`, false);
  }
  try {
    const { response, text } = await get(base, "/");
    const isHtml = response.ok && response.headers.get("content-type")?.includes("text/html");
    report("Ana sayfa", `HTTP ${response.status}`, !!isHtml);
    const modulePath = text.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i)?.[1];
    if (isHtml && modulePath?.startsWith("/") && !modulePath.startsWith("//")) {
      const module = await get(base, modulePath);
      report("Arayuz JavaScript", `HTTP ${module.response.status}`, module.response.ok && /(?:javascript|ecmascript)/i.test(module.response.headers.get("content-type") ?? ""));
    } else if (isHtml) {
      report("Arayuz JavaScript", "ana modul etiketi bulunamadi", false);
    }
  } catch {
    report("Ana sayfa / JavaScript", "yanit alinamadi; Vite/derleme terminalini kontrol edin", false);
  }
  try {
    const { response } = await get(base, "/api/stationos/state");
    report("Oturum korumasi", `HTTP ${response.status}; giris yapmadan 401 beklenir`, response.status === 401);
  } catch {
    report("Oturum korumasi", "yanit alinamadi", false);
  }
  if ((process.env.AUTH_PROVIDER || "local") === "local" && process.env.COOKIE_SECURE !== "false") {
    console.log("BILGI: Guvenli cookie acik. Yerel HTTP girisi icin COOKIE_SECURE=false gerekir; uretim HTTPS ayarini degistirmeyin.");
  }
} else {
  report("Sunucu portu", "PORT gecersiz", false);
}

if (!process.env.DATABASE_URL) {
  report("Veritabani", "DATABASE_URL tanimli degil; .env dosyasini yerelde kontrol edin", false);
} else {
  let connection;
  try {
    connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, connectTimeout: 5000 });
    await connection.query({ sql: "SELECT 1 AS ok", timeout: 5000 });
    report("Veritabani", "SELECT 1 basarili");
    const [users] = await connection.query({ sql: "SELECT COUNT(*) AS present FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='users'", timeout: 5000 });
    report("Kullanici semasi", users[0].present ? "users mevcut" : "users eksik; pnpm db:migrate gerekli", !!users[0].present);
    const expected = (await readdir(new URL("../server/stationos/migrations/", import.meta.url)))
      .filter(file => /^\d+_[a-z0-9_-]+\.sql$/i.test(file)).map(file => file.replace(/\.sql$/i, "")).sort();
    const [applied] = await connection.query({ sql: "SELECT version FROM st_schema_migrations", timeout: 5000 });
    const appliedSet = new Set(applied.map(row => row.version));
    const pending = expected.filter(version => !appliedSet.has(version));
    report("Operasyon semasi", pending.length ? `bekleyen: ${pending.join(", ")}` : `${expected.length} goc mevcut`, pending.length === 0);
    if (pending.length) console.log("BILGI: Once veritabani yedegi alin. Ardindan pnpm tsx server/stationos/migrate.ts komutunu calistirin.");
  } catch (error) {
    report("Veritabani / sema", errorCode(error), false);
  } finally {
    if (connection) {
      try { await connection.end(); }
      catch (error) { report("Veritabani baglanti kapanisi", errorCode(error), false); }
    }
  }
}
console.log("Bu kontrol tarayici oturumunu ve oturumlu is akislarini dogrulamaz. .env veya parola paylasmayin.");
process.exitCode = failed ? 1 : 0;
