import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";

// Read-only verification; no environment loading, DB access, or dependency imports.
const root = resolve(process.argv[2] ?? process.cwd());
try {
  const manifest = JSON.parse(
    await readFile(join(root, "release.manifest.json"), "utf8")
  );
  if (
    manifest.format !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  )
    throw new Error("Geçersiz sürüm manifesti.");
  const seen = new Set();
  for (const file of manifest.files) {
    if (
      typeof file.path !== "string" ||
      isAbsolute(file.path) ||
      file.path.includes("\\") ||
      file.path
        .split("/")
        .some(part => !part || part === "." || part === "..") ||
      file.path === "release.manifest.json" ||
      seen.has(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("Geçersiz veya tekrarlanan dosya kaydı.");
    seen.add(file.path);
    let current = root;
    for (const part of file.path.split("/")) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Sembolik bağlantı kabul edilmez: ${file.path}`);
    }
    const bytes = await readFile(current);
    if (
      bytes.length !== file.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new Error(`Dosya bütünlüğü uyuşmuyor: ${file.path}`);
  }
  console.log(`Sürüm bütünlüğü doğrulandı: ${seen.size} dosya.`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Sürüm bütünlüğü doğrulanamadı."
  );
  process.exitCode = 1;
}
