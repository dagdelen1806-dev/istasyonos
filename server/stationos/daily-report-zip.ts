import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fail } from "./types";

export const DAILY_ZIP_LIMIT = 20 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024,
  TOTAL_LIMIT = 25 * 1024 * 1024;
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const invalid = () =>
  fail(
    "DAILY_ZIP_INVALID",
    "ZIP geçersiz veya desteklenmiyor. Yalnız JPEG/PNG içeren, şifresiz ZIP kullanın."
  );
export function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function readDailyZip(base64: unknown) {
  if (
    typeof base64 !== "string" ||
    !base64.length ||
    base64.length > Math.ceil(DAILY_ZIP_LIMIT / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    invalid();
  const bytes = Buffer.from(base64 as string, "base64");
  if (
    bytes.length > DAILY_ZIP_LIMIT ||
    bytes.length < 22 ||
    bytes.toString("base64") !== base64
  )
    invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) invalid();
  const e = end,
    count = bytes.readUInt16LE(e + 10),
    centralSize = bytes.readUInt32LE(e + 12),
    centralOffset = bytes.readUInt32LE(e + 16);
  if (
    bytes.readUInt16LE(e + 4) ||
    bytes.readUInt16LE(e + 6) ||
    count !== bytes.readUInt16LE(e + 8) ||
    !count ||
    count > 24 ||
    centralOffset + centralSize !== e
  )
    invalid();
  let at = centralOffset,
    total = 0;
  const names = new Set<string>(),
    hashes = new Set<string>(),
    ranges: { start: number; end: number }[] = [];
  const pages: { name: string; sha256: string; mime: string; bytes: Buffer }[] =
    [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > e || bytes.readUInt32LE(at) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(at + 8),
      method = bytes.readUInt16LE(at + 10),
      crc = bytes.readUInt32LE(at + 16),
      compressed = bytes.readUInt32LE(at + 20),
      size = bytes.readUInt32LE(at + 24),
      nameSize = bytes.readUInt16LE(at + 28),
      extraSize = bytes.readUInt16LE(at + 30),
      commentSize = bytes.readUInt16LE(at + 32),
      offset = bytes.readUInt32LE(at + 42),
      attrs = bytes.readUInt32LE(at + 38);
    if (
      at + 46 + nameSize + extraSize + commentSize > e ||
      !nameSize ||
      nameSize > 512 ||
      flags & ~0x808 ||
      ![0, 8].includes(method) ||
      bytes.readUInt16LE(at + 34) ||
      ((attrs >>> 16) & 0xf000) === 0xa000
    )
      invalid();
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameSize);
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true })
        .decode(nameBytes)
        .normalize("NFC");
    } catch {
      invalid();
    }
    if (
      !name! ||
      name!.length > 190 ||
      /[\\:\x00-\x1f]/.test(name!) ||
      name!.startsWith("/") ||
      name!.split("/").some(p => p === ".." || p === ".")
    )
      invalid();
    const key = name!.toLocaleLowerCase("en-US");
    if (names.has(key)) invalid();
    names.add(key);
    at += 46 + nameSize + extraSize + commentSize;
    if (
      offset + 30 > centralOffset ||
      bytes.readUInt32LE(offset) !== 0x04034b50
    )
      invalid();
    const localNameSize = bytes.readUInt16LE(offset + 26),
      localExtraSize = bytes.readUInt16LE(offset + 28),
      dataStart = offset + 30 + localNameSize + localExtraSize,
      dataEnd = dataStart + compressed;
    if (
      bytes.readUInt16LE(offset + 6) !== flags ||
      bytes.readUInt16LE(offset + 8) !== method ||
      localNameSize !== nameSize ||
      !bytes
        .subarray(offset + 30, offset + 30 + localNameSize)
        .equals(nameBytes) ||
      dataEnd > centralOffset ||
      ranges.some(r => offset < r.end && dataEnd > r.start)
    )
      invalid();
    ranges.push({ start: offset, end: dataEnd });
    if (
      !(flags & 8) &&
      (bytes.readUInt32LE(offset + 14) !== crc ||
        bytes.readUInt32LE(offset + 18) !== compressed ||
        bytes.readUInt32LE(offset + 22) !== size)
    )
      invalid();
    if (name!.endsWith("/")) {
      if (size !== 0 || compressed !== 0) invalid();
      continue;
    }
    if (
      !/\.(jpe?g|png)$/i.test(name!) ||
      size < 4 ||
      size > IMAGE_LIMIT ||
      compressed === 0 ||
      size > Math.max(1024, compressed * 200)
    )
      invalid();
    total += size;
    if (total > TOTAL_LIMIT || pages.length >= 12)
      fail(
        "DAILY_ZIP_LIMIT",
        "En fazla 12 fotoğraf, fotoğraf başına 5 MB ve toplam 25 MB kullanılabilir."
      );
    let image: Buffer;
    try {
      image =
        method === 0
          ? Buffer.from(bytes.subarray(dataStart, dataEnd))
          : inflateRawSync(bytes.subarray(dataStart, dataEnd), {
              maxOutputLength: IMAGE_LIMIT,
            });
    } catch {
      invalid();
    }
    if (image!.length !== size || crc32(image!) !== crc) invalid();
    const jpeg =
      image!.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
      image!.subarray(-2).equals(Buffer.from([255, 217]));
    const png =
      image!.length >= 24 &&
      image!
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      image!
        .subarray(-12)
        .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
    if ((!/\.jpe?g$/i.test(name!) || !jpeg) && (!/\.png$/i.test(name!) || !png))
      invalid();
    const sha256 = digest(image!);
    if (hashes.has(sha256))
      fail(
        "DAILY_DUPLICATE_PAGE",
        "Aynı fotoğraf ZIP içinde birden fazla kez bulunuyor."
      );
    hashes.add(sha256);
    pages.push({
      name: name!,
      sha256,
      mime: jpeg ? "image/jpeg" : "image/png",
      bytes: image!,
    });
  }
  if (at !== e || !pages.length) invalid();
  return {
    sourceSha256: digest(bytes),
    sourceSetSha256: digest(Buffer.from([...hashes].sort().join("\n"))),
    pages,
  };
}
