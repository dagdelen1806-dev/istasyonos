/** Instants cross the API with an explicit offset; calendar dates stay dates. */
export const TURKEY_TIME_ZONE = "Europe/Istanbul";

function validWallTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
  if (!match || Number(match[1]) < 1000) return false;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${value.split(".")[0]}Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
  );
}

export function parseInstant(value: string): Date {
  const match = /^(.*)(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validWallTime(match[1]))
    throw new Error("Saat dilimi içeren geçerli ISO tarih gerekli.");
  if (match[2] !== "Z") {
    const [hours, minutes] = match[2].slice(1).split(":").map(Number);
    if (hours > 23 || minutes > 59)
      throw new Error("Geçersiz saat dilimi farkı.");
  }
  // JavaScript and the existing DATETIME(3) schema preserve milliseconds.
  const wall = match[1].replace(
    /\.(\d+)$/,
    (_, fraction: string) => `.${fraction.slice(0, 3).padEnd(3, "0")}`
  );
  const date = new Date(`${wall}${match[2]}`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1000 ||
    date.getUTCFullYear() > 9999
  )
    throw new Error("Geçersiz veya veritabanı aralığı dışında tarih.");
  return date;
}

/** MySQL DATETIME values in this application represent UTC, not host time. */
export function parseDbUtc(value: string): Date {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error("Geçersiz UTC veritabanı tarihi.");
  const fraction = match[3] ? `.${match[3].slice(0, 3)}` : "";
  return parseInstant(`${match[1]}T${match[2]}${fraction}Z`);
}

export function formatDbUtc(date: Date): string {
  return parseInstant(date.toISOString())
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
}

export function calendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !validWallTime(`${value}T00:00:00`))
    throw new Error("Geçerli takvim tarihi gerekli.");
  return value;
}

export function turkeyDateTimeInput(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TURKEY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function turkeyToday(date = new Date()): string {
  return turkeyDateTimeInput(date).slice(0, 10);
}

/** Reject historical DST gaps/folds rather than silently choosing an instant. */
export function turkeyInputToIso(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !validWallTime(`${value}:00`)
  )
    throw new Error("Geçerli Türkiye tarih ve saati gerekli.");
  const wall = parseInstant(`${value}:00Z`).getTime();
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = new Date(wall + hours * 3600000);
    offsets.add(
      parseInstant(`${turkeyDateTimeInput(probe)}:00Z`).getTime() -
        probe.getTime()
    );
  }
  const matches = [...offsets]
    .map(offset => new Date(wall - offset))
    .filter(date => turkeyDateTimeInput(date) === value);
  if (matches.length !== 1)
    throw new Error(
      "Yaz/kış saati geçişinde belirsiz veya mevcut olmayan saat. Farklı bir saat seçin."
    );
  return matches[0].toISOString();
}

export function formatTurkeyInstant(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: TURKEY_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(parseInstant(value));
}
