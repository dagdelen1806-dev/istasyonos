import { beforeEach, describe, it, expect, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import { crc32, readDailyZip } from "./daily-report-zip";
const image = Buffer.from([255, 216, 255, 219, 1, 255, 217]);
export function testZip(
  files: {
    name: string;
    bytes?: Buffer;
    flags?: number;
    method?: number;
    attrs?: number;
    size?: number;
    crc?: number;
  }[]
) {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name),
      data = f.bytes ?? image,
      method = f.method ?? 0,
      compressed = method === 8 ? deflateRawSync(data) : data,
      crc = f.crc ?? crc32(data),
      size = f.size ?? data.length;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(f.flags ?? 0x800, 6);
    l.writeUInt16LE(method, 8);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(compressed.length, 18);
    l.writeUInt32LE(size, 22);
    l.writeUInt16LE(name.length, 26);
    locals.push(l, name, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(f.flags ?? 0x800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(f.attrs ?? 0, 38);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += l.length + name.length + compressed.length;
  }
  const central = Buffer.concat(centrals),
    e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50);
  e.writeUInt16LE(files.length, 8);
  e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(central.length, 12);
  e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, e]);
}
const m = vi.hoisted(() => ({
  demo: true,
  station: true,
  doc: null as any,
  duplicate: null as any,
  last: null as any,
  writes: [] as string[],
  source: [] as any[],
}));
vi.mock("./db", () => ({
  first: vi.fn(async (_: unknown, sql: string) => {
    if (sql.includes("FROM st_tenants")) return { is_demo: m.demo ? 1 : 0 };
    if (sql.includes("FROM st_stations")) return m.station ? { id: "s" } : null;
    if (sql.includes("(source_sha256=")) return m.duplicate;
    if (sql.includes("SELECT revision")) return m.last;
    if (sql.includes("FROM st_daily_report_packages")) return m.doc;
    throw Error(sql);
  }),
  rows: vi.fn(async () => m.source),
  execute: vi.fn(async (_: unknown, sql: string) => {
    m.writes.push(sql);
  }),
}));
import {
  importDailyReport,
  reviewDailyReport,
  validateDailyReview,
} from "./daily-report";
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  c = {} as any,
  scope = { tenantId: "t", stationId: "s" };
const review = {
  expectedRevision: 0,
  decision: "REVIEWED_DRAFT",
  shiftReference: "DEMO-DAILY-01",
  reportDay: "2026-11-05",
  note: "DEMO kaynak kontrolü",
  evidence: "DEMO belge",
  sourceConfirmed: true,
  pages: [{ pageId: id, kind: "SALES" }],
};
beforeEach(() => {
  m.demo = true;
  m.station = true;
  m.doc = { id };
  m.duplicate = null;
  m.last = null;
  m.writes = [];
  m.source = [{ id }];
});
describe("daily ZIP boundaries", () => {
  it("accepts stored and deflated JPEG and preserves hashes", () => {
    const a = readDailyZip(
        testZip([{ name: "photo.jpeg" }]).toString("base64")
      ),
      b = readDailyZip(
        testZip([{ name: "renamed.jpg", method: 8 }]).toString("base64")
      );
    expect(a.pages[0].bytes).toEqual(image);
    expect(a.sourceSha256).not.toBe(b.sourceSha256);
    expect(a.sourceSetSha256).toBe(b.sourceSetSha256);
  });
  it("accepts valid PNG signature and Unicode path", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
      "base64"
    );
    expect(
      readDailyZip(
        testZip([{ name: "örnek/resim.png", bytes: png }]).toString("base64")
      ).pages[0].mime
    ).toBe("image/png");
  });
  it.each([
    "../photo.jpg",
    "C:/photo.jpg",
    "/photo.jpg",
    "a\\photo.jpg",
    "a/../photo.jpg",
    "file.exe",
    "file.svg",
    "bad\n.jpg",
  ])("rejects unsafe name %s", name =>
    expect(() => readDailyZip(testZip([{ name }]).toString("base64"))).toThrow()
  );
  it.each([
    { flags: 1 },
    { method: 99 },
    { attrs: 0xa0000000 },
    { crc: 1 },
    { size: 6000000 },
    { bytes: Buffer.from("not an image") },
  ])("rejects unsafe or corrupt content %o", extra =>
    expect(() =>
      readDailyZip(testZip([{ name: "a.jpg", ...extra }]).toString("base64"))
    ).toThrow()
  );
  it("rejects repeated image bytes under another name", () =>
    expect(() =>
      readDailyZip(
        testZip([{ name: "a.jpg" }, { name: "b.jpg" }]).toString("base64")
      )
    ).toThrow());
  it("rejects case-insensitive duplicate names", () =>
    expect(() =>
      readDailyZip(
        testZip([
          { name: "a.jpg" },
          { name: "A.jpg", bytes: Buffer.from([255, 216, 255, 1, 255, 217]) },
        ]).toString("base64")
      )
    ).toThrow());
  it("rejects over 12 photos", () =>
    expect(() =>
      readDailyZip(
        testZip(
          Array.from({ length: 13 }, (_, i) => ({
            name: i + ".jpg",
            bytes: Buffer.from([255, 216, 255, i, 255, 217]),
          }))
        ).toString("base64")
      )
    ).toThrow());
  it("rejects compression bomb before accepting output", () =>
    expect(() =>
      readDailyZip(
        testZip([
          { name: "a.jpg", method: 8, bytes: Buffer.alloc(100000) },
        ]).toString("base64")
      )
    ).toThrow());
  it.each([
    "",
    "a",
    "%%%",
    "abcd===",
    "data:application/zip;base64,AAAA",
    null,
    1,
  ])("rejects invalid base64 %s", b => expect(() => readDailyZip(b)).toThrow());
  it("rejects truncation and trailing data", () => {
    const b = testZip([{ name: "a.jpg" }]);
    expect(() => readDailyZip(b.subarray(0, -1).toString("base64"))).toThrow();
    expect(() =>
      readDailyZip(Buffer.concat([b, Buffer.from("x")]).toString("base64"))
    ).toThrow();
  });
  it("rejects local/central filename mismatch", () => {
    const b = testZip([{ name: "a.jpg" }]);
    b[30] = 98;
    expect(() => readDailyZip(b.toString("base64"))).toThrow();
  });
  it("rejects multidisk and ZIP64 declarations", () => {
    const b = testZip([{ name: "a.jpg" }]);
    b.writeUInt16LE(1, b.length - 18);
    expect(() => readDailyZip(b.toString("base64"))).toThrow();
    const x = testZip([{ name: "a.jpg" }]);
    x.writeUInt32LE(0xffffffff, x.length - 6);
    expect(() => readDailyZip(x.toString("base64"))).toThrow();
  });
});
describe("daily draft validation and scope", () => {
  it("requires confirmation and complete classification", () => {
    expect(() =>
      validateDailyReview({ ...review, sourceConfirmed: false }, [{ id }])
    ).toThrow();
    expect(() =>
      validateDailyReview(
        { ...review, pages: [{ pageId: id, kind: "UNKNOWN" }] },
        [{ id }]
      )
    ).toThrow();
  });
  it("preserves pending unknown classification", () =>
    expect(
      validateDailyReview(
        {
          ...review,
          decision: "PENDING",
          pages: [{ pageId: id, kind: "UNKNOWN" }],
        },
        [{ id }]
      ).decision
    ).toBe("PENDING"));
  it("rejects foreign and duplicate pages", () => {
    expect(() =>
      validateDailyReview(
        { ...review, pages: [{ pageId: other, kind: "SALES" }] },
        [{ id }]
      )
    ).toThrow();
    expect(() =>
      validateDailyReview(
        {
          ...review,
          pages: [
            { pageId: id, kind: "SALES" },
            { pageId: id, kind: "METERS" },
          ],
        },
        [{ id }, { id: other }]
      )
    ).toThrow();
  });
  it.each(["2026-02-30", "2026-13-01", "05.11.2026"])(
    "rejects invalid report day %s",
    reportDay =>
      expect(() =>
        validateDailyReview({ ...review, reportDay }, [{ id }])
      ).toThrow()
  );
  it("rejects non-DEMO before archive writes", async () => {
    m.demo = false;
    await expect(
      importDailyReport(c, scope, 7, {
        sourceName: "a.zip",
        zipBase64: testZip([{ name: "a.jpg" }]).toString("base64"),
      })
    ).rejects.toMatchObject({ code: "DEMO_REQUIRED" });
    expect(m.writes).toHaveLength(0);
  });
  it("rejects station outside tenant", async () => {
    m.station = false;
    await expect(importDailyReport(c, scope, 7, {})).rejects.toMatchObject({
      code: "STATION_FORBIDDEN",
    });
  });
  it("imports only immutable package and page rows", async () => {
    const r = await importDailyReport(c, scope, 7, {
      sourceName: "a.zip",
      zipBase64: testZip([{ name: "a.jpg" }]).toString("base64"),
    });
    expect(r.stockApplied).toBe(false);
    expect(m.writes).toHaveLength(2);
    expect(m.writes.join(" ")).not.toMatch(
      /UPDATE|st_tank_|st_payments|st_accounts/
    );
  });
  it("resolves repackaged source without second write", async () => {
    m.duplicate = { id };
    const result = await importDailyReport(c, scope, 7, {
      sourceName: "a.zip",
      zipBase64: testZip([{ name: "a.jpg" }]).toString("base64"),
    });
    expect(result).toMatchObject({
      id,
      alreadyImported: true,
      stockApplied: false,
    });
    expect(m.writes).toHaveLength(0);
  });
  it("does not reveal foreign package", async () => {
    m.doc = null;
    await expect(
      reviewDailyReport(c, scope, 7, { ...review, packageId: id })
    ).rejects.toMatchObject({ code: "DAILY_NOT_FOUND" });
  });
  it("rejects concurrent stale draft review", async () => {
    m.last = { revision: 1 };
    await expect(
      reviewDailyReport(c, scope, 7, { ...review, packageId: id })
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(m.writes).toHaveLength(0);
  });
  it("appends review without financial or stock effects", async () => {
    const r = await reviewDailyReport(c, scope, 7, {
      ...review,
      packageId: id,
    });
    expect(r.financialApplied).toBe(false);
    expect(r.stockApplied).toBe(false);
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0]).toContain("INSERT INTO st_daily_report_reviews");
  });
});
