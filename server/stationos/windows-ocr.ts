import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { fail } from "./types";
export const OCR_ENGINE_VERSION = "windows-media-ocr-tr-layout-v3";
const messages: Record<string, string> = {
  OCR_PLATFORM_UNAVAILABLE: "Yerel OCR için Windows OCR desteği gerekli.",
  OCR_LANGUAGE_UNAVAILABLE: "Windows Türkçe OCR dil desteği bulunamadı.",
  OCR_IMAGE_TOO_LARGE:
    "Görüntü OCR sınırını aşıyor (16 milyon piksel / en fazla 10000 piksel kenar).",
  OCR_DECODE_FAILED: "Kaynak görüntü OCR için çözümlenemedi.",
  OCR_RECOGNITION_FAILED: "Windows OCR görüntüyü okuyamadı.",
  OCR_INPUT_REJECTED: "OCR kaynak dosyası güvenli sınırlar içinde değil.",
  OCR_TIMEOUT: "Yerel OCR süre sınırını aştı.",
  OCR_NATIVE_FAILED: "Yerel OCR işlemi tamamlanamadı.",
};
let active = false;
async function helper(args: string[]): Promise<any> {
  if (process.platform !== "win32")
    fail("OCR_PLATFORM_UNAVAILABLE", messages.OCR_PLATFORM_UNAVAILABLE, 503);
  const exe = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe"
  );
  return new Promise((resolvePromise, reject) => {
    execFile(
      exe,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        resolve("scripts/windows-ocr.ps1"),
        ...args,
      ],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout) => {
        let output: any;
        try {
          output = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
        } catch {}
        if (error || !output?.ok) {
          const code =
            output?.code && messages[output.code]
              ? output.code
              : (error as any)?.killed
                ? "OCR_TIMEOUT"
                : "OCR_NATIVE_FAILED";
          try {
            fail(code, messages[code], 503);
          } catch (e) {
            reject(e);
          }
          return;
        }
        resolvePromise(output);
      }
    );
  });
}
let capability: Promise<{
  available: boolean;
  language?: string;
  message?: string;
}> | null = null;
export function ocrCapability() {
  return (capability ??= helper(["-Probe"])
    .then(v => ({ available: true, language: String(v.language) }))
    .catch(e => ({
      available: false,
      message: messages[e.code] ?? messages.OCR_NATIVE_FAILED,
    })));
}
export async function recognizeImage(bytes: Buffer) {
  if (active)
    fail(
      "OCR_BUSY",
      "Başka bir yerel okuma sürüyor; tamamlanınca tekrar deneyin.",
      429
    );
  if (bytes.length < 4 || bytes.length > 5 * 1024 * 1024)
    fail("OCR_INPUT_REJECTED", messages.OCR_INPUT_REJECTED);
  active = true;
  let directory: string | undefined;
  try {
    const root = resolve(".local/ocr-work");
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, "job-"));
    const file = join(directory, "source.image");
    await writeFile(file, bytes, { flag: "wx" });
    return await helper(["-ImagePath", file]);
  } finally {
    // mkdtemp owns this exact directory; never derive cleanup paths from a request.
    try {
      if (directory) {
        const target = resolve(directory),
          root = resolve(".local/ocr-work") + sep;
        if (!target.startsWith(root)) throw Error("OCR_CLEANUP_SCOPE_REJECTED");
        await rm(target, { recursive: true, force: true });
      }
    } finally {
      active = false;
    }
  }
}
