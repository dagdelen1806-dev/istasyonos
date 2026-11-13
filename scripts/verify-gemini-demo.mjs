// Run from normal PowerShell. Only synthetic DEMO image input; no DB access.
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { build } from "esbuild";
const env = parse(await readFile(new URL("../.env", import.meta.url)));
process.env.GEMINI_API_KEY = env.GEMINI_API_KEY || "";
process.env.GEMINI_OCR_MODEL = env.GEMINI_OCR_MODEL || "";
await build({
  entryPoints: ["server/stationos/gemini-ocr.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "esm",
  outfile: ".local/tanker-document/tools/gemini-verify.js",
});
const { extractGeminiDocument } = await import(
  "../.local/tanker-document/tools/gemini-verify.js"
);
// This repository-owned synthetic test image contains no customer data.
try {
  const bytes = await readFile("scripts/fixtures/demo-tanker.png");
  const result = await extractGeminiDocument(
    [{ mime: "image/png", bytes }],
    "TANKER"
  );
  console.log(
    JSON.stringify({
      ok: true,
      model: result.model,
      demoOnly: true,
      productRows: Array.isArray(result.raw.lines)
        ? result.raw.lines.length
        : 0,
      databaseAccess: false,
    })
  );
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      code: error?.code || "GEMINI_DEMO_FAILED",
      message: String(error?.code || "").startsWith("GEMINI_")
        ? error.message
        : "DEMO doğrulaması tamamlanamadı; özel hata ayrıntıları gizlendi.",
    })
  );
  process.exitCode = 1;
}
