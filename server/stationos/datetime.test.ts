import { describe, expect, it } from "vitest";
import { fmtDate } from "../../client/src/components/stationos/Common";
import { safeCalendarDate, safeDate } from "./domain";
import {
  calendarDate,
  formatDbUtc,
  formatTurkeyInstant,
  parseDbUtc,
  parseInstant,
  turkeyDateTimeInput,
  turkeyInputToIso,
  turkeyToday,
} from "../../shared/datetime";

describe("UTC ve Türkiye tarih sözleşmesi", () => {
  it("gerçek UI biçimleyicisinde vade gününü ve İstanbul saatini korur", () => {
    expect(fmtDate("2026-10-29", false)).toContain("29");
    expect(fmtDate("2026-10-28T21:00:00.000Z")).toContain("29");
    expect(fmtDate("2026-10-28T21:00:00.000Z")).toContain("00:00");
    expect(fmtDate("invalid")).toBe("—");
  });
  it("DB tarihlerini işletim sistemi saat diliminden bağımsız UTC okur", () => {
    expect(parseDbUtc("2026-10-28 12:34:56.123").toISOString()).toBe(
      "2026-10-28T12:34:56.123Z"
    );
    expect(parseDbUtc("2026-10-28 12:34:56").toISOString()).toBe(
      "2026-10-28T12:34:56.000Z"
    );
    expect(formatDbUtc(parseInstant("2026-10-28T15:34:56.123+03:00"))).toBe(
      "2026-10-28 12:34:56.123"
    );
  });
  it.each([
    "2026-02-29T12:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-10-28T24:00:00Z",
    "2026-10-28T12:00:00",
    "2026-10-28",
    "2026-10-28T12:00:00+24:00",
    "1000-01-01T00:00:00+03:00",
    "9999-12-31T23:59:59-01:00",
  ])("geçersiz/belirsiz girdiyi reddeder: %s", value => {
    expect(() => parseInstant(value)).toThrow();
  });
  it("artık gün ve yıl sınırını korur", () => {
    expect(parseDbUtc("2024-02-29 23:59:59.999").toISOString()).toBe(
      "2024-02-29T23:59:59.999Z"
    );
    expect(turkeyToday(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01");
    expect(calendarDate("2024-02-29")).toBe("2024-02-29");
    expect(() => calendarDate("2026-02-29")).toThrow();
  });
  it.each([
    undefined,
    null,
    123,
    "",
    "2026-10-28",
    "2026-10-28T15:30:00",
    "2026-02-29T15:30:00Z",
    "2026-10-28T15:30:00+0300",
  ])("API yardımcısı hatalı/belirsiz değere Türkçe 400 verir: %s", value => {
    try {
      safeDate(value, "startsAt");
      throw new Error("Expected validation error");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_INPUT", status: 400 });
      expect((error as Error).message).toContain("Z veya ±HH:MM");
    }
  });
  it.each([
    "2026-10-28T12:30:00Z",
    "2026-10-28T15:30:00+03:00",
    "2026-10-28T07:30:00-05:00",
  ])("API açık saat farkını aynı UTC anına çevirir: %s", value => {
    expect(safeDate(value, "transactionAt").toISOString()).toBe(
      "2026-10-28T12:30:00.000Z"
    );
  });
  it("RFC biçimindeki kesirleri mevcut milisaniye hassasiyetinde saklar", () => {
    expect(
      safeDate("2026-10-28T12:30:00.123456Z", "transactionAt").toISOString()
    ).toBe("2026-10-28T12:30:00.123Z");
    expect(() => parseInstant("2026-10-28T12:30:00+03:60")).toThrow();
    expect(() => parseInstant("2026-10-28T12:30:00+15:00")).not.toThrow();
  });
  it("takvim tarihleri yalnız YYYY-MM-DD kalır; tarih-saat dönüşümü uygulanmaz", () => {
    expect(safeCalendarDate("2026-10-28", "dueDate")).toBe("2026-10-28");
    for (const value of ["2026-02-29", "2026-10-28T00:00:00Z", null]) {
      expect(() => safeCalendarDate(value, "dueDate")).toThrow();
    }
  });
  it("Türkiye gece yarısı sınırını doğru gösterir", () => {
    expect(turkeyDateTimeInput(new Date("2026-10-28T20:59:59Z"))).toBe(
      "2026-10-28T23:59"
    );
    expect(turkeyDateTimeInput(new Date("2026-10-28T21:00:00Z"))).toBe(
      "2026-10-29T00:00"
    );
    expect(formatTurkeyInstant("2026-10-28T21:00:00Z")).toContain("00:00");
  });
  it("güncel yaz/kış döneminde +03; tarihsel kışta +02 kullanır", () => {
    expect(turkeyInputToIso("2026-01-15T12:00")).toBe(
      "2026-01-15T09:00:00.000Z"
    );
    expect(turkeyInputToIso("2026-07-15T12:00")).toBe(
      "2026-07-15T09:00:00.000Z"
    );
    expect(turkeyInputToIso("2015-01-15T12:00")).toBe(
      "2015-01-15T10:00:00.000Z"
    );
    expect(turkeyInputToIso("2015-07-15T12:00")).toBe(
      "2015-07-15T09:00:00.000Z"
    );
  });
  it("tarihsel DST boşluk ve çift saatini sessizce seçmez", () => {
    expect(() => turkeyInputToIso("2015-03-29T03:30")).toThrow();
    expect(() => turkeyInputToIso("2015-11-08T03:30")).toThrow();
  });
  it("süre bitişi ve gün sınırlarında UTC karşılaştırır", () => {
    const expires = parseDbUtc("2026-10-28 21:00:00.000").getTime();
    expect(
      expires > parseInstant("2026-10-28T23:59:59.999+03:00").getTime()
    ).toBe(true);
    expect(expires <= parseInstant("2026-10-29T00:00:00+03:00").getTime()).toBe(
      true
    );
  });
});
