import { parseMoney } from "./station";
export type CatalogMode = "CATALOG_ONLY" | "DEMO_OPENING_ABS";
export type CatalogSettings = {
  mode: CatalogMode;
  vatByGroup: Record<string, number>;
};
// This pilot's user-confirmed choices, not a statutory product classification.
export const pilotCatalogVat: Record<string, number> = {
  GIDA: 100,
  İÇECEK: 1000,
  "KİŞİSEL BAKIM": 2000,
  "ARAÇ BAKIMI": 2000,
};
export function catalogSettings(value: unknown): CatalogSettings {
  if (value === undefined) return { mode: "CATALOG_ONLY", vatByGroup: {} };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Aktarım ayarları geçersiz.");
  const v = value as Record<string, unknown>;
  if (v.mode !== "CATALOG_ONLY" && v.mode !== "DEMO_OPENING_ABS")
    throw Error("Aktarım yöntemi geçersiz.");
  const map = v.vatByGroup ?? {};
  if (
    !map ||
    typeof map !== "object" ||
    Array.isArray(map) ||
    Object.keys(map).length > 5000
  )
    throw Error("Grup KDV listesi geçersiz.");
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  for (const [group, rate] of entries) {
    if (
      group.length > 100 ||
      typeof rate !== "number" ||
      ![100, 1000, 2000].includes(rate)
    )
      throw Error("Grup KDV oranı %1, %10 veya %20 olmalı.");
  }
  return { mode: v.mode, vatByGroup: Object.fromEntries(entries) };
}
export function catalogOpening(row: CatalogRow, settings: CatalogSettings) {
  const vatBps = Object.hasOwn(settings.vatByGroup, row.category)
    ? settings.vatByGroup[row.category]
    : null;
  const opening = settings.mode === "DEMO_OPENING_ABS";
  const quantity = opening ? Math.abs(row.sourceQuantity) : 0;
  if (quantity > 1000000000)
    throw Error(
      `Satır ${row.line}: Başlangıç stoğu en fazla 1 milyar adet olabilir.`
    );
  const value = BigInt(quantity) * BigInt(row.sourcePurchaseMinor);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error(
      `Satır ${row.line}: Stok değeri güvenli kuruş sınırını aşıyor.`
    );
  return { plannedQty: quantity, plannedValueMinor: Number(value), vatBps };
}
export type CatalogRow = {
  line: number;
  code: string;
  name: string;
  barcode: string;
  category: string;
  unit: "adet";
  sourceQuantity: number;
  salePriceMinor: number;
  sourcePurchaseMinor: number;
  discountBps: number;
};
export type CatalogPreview = {
  hash: string;
  settings: CatalogSettings;
  priorMode: CatalogMode | null;
  missingVatGroups: string[];
  plannedQty: number;
  plannedInventoryMinor: number;
  isDemo: boolean;
  closedToday: boolean;
  sourceHash: string;
  alreadyImported: boolean;
  added: number;
  skipped: number;
  conflicts: number;
  negativeRows: number;
  sourceTotalQty: number;
  capacityExceeded: boolean;
  rows: (CatalogRow & {
    status: "NEW" | "EXISTS" | "CONFLICT";
    existingId: string | null;
    plannedQty: number;
    plannedValueMinor: number;
    vatBps: number | null;
  })[];
};
export type CatalogHistory = {
  id: string;
  label: string;
  added: number;
  skipped: number;
  rows: number;
  negativeRows: number;
  sourceTotalQty: number;
  createdAt: string;
  actorName: string;
  mode: CatalogMode;
  inventoryMinor: number;
  openingQty: number;
};
export const catalogHeaders = [
  "Stok Kodu",
  "Stok Adı",
  "Barkodu",
  "Grubu",
  "Kalan Miktar",
  "Birimi",
  "Satış Fiyatı 1",
  "Alış Fiyatı 1",
  "İskonto 1 %",
];
function table(text: string) {
  const records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const push = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === '"' && !cell && !closed) {
      quoted = true;
      continue;
    }
    if (ch === "\t") {
      push();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      push();
      records.push(row);
      row = [];
      continue;
    }
    if (closed && ch.trim())
      throw Error("Kapanan tırnaktan sonra geçersiz karakter var.");
    cell += ch;
  }
  if (quoted) throw Error("Kapanmayan tırnak var.");
  if (cell || row.length) {
    push();
    records.push(row);
  }
  return records.filter(r => r.some(c => c.trim()));
}
export function parseCatalog(text: string): CatalogRow[] {
  if (typeof text !== "string" || text.length > 1000000)
    throw Error("Liste en fazla 1 milyon karakter olmalı.");
  const records = table(text.replace(/^\uFEFF/, ""));
  if (records.length < 2)
    throw Error("Başlık ve en az bir ürün satırı gerekir.");
  if (
    records[0].length !== catalogHeaders.length ||
    records[0].some((v, i) => v.trim() !== catalogHeaders[i])
  )
    throw Error(
      "Sütun başlıkları örnek stok listesiyle aynı sırada ve sekmeyle ayrılmış olmalı."
    );
  if (records.length > 5001)
    throw Error("Bir aktarım en fazla 5.000 ürün içerir.");
  const seen = new Set<string>(),
    codes = new Set<string>();
  return records.slice(1).map((cells, i) => {
    const line = i + 2;
    try {
      if (cells.length !== 9) throw Error("9 sütun bekleniyor.");
      const [code, name, barcode, category, qty, unit, sale, cost, discount] =
        cells.map(c => c.trim());
      if (
        !code ||
        code.length > 100 ||
        !name ||
        name.length > 190 ||
        category.length > 100
      )
        throw Error("Stok kodu/adı/grubu geçersiz veya çok uzun.");
      if (!/^\d{4,32}$/.test(barcode))
        throw Error(
          "Barkod 4–32 rakamdan oluşmalı; baştaki sıfırları koruyun."
        );
      if (seen.has(barcode) || codes.has(code.toLocaleUpperCase("tr-TR")))
        throw Error("Liste içinde tekrarlanan barkod veya stok kodu var.");
      seen.add(barcode);
      codes.add(code.toLocaleUpperCase("tr-TR"));
      if (unit.toLocaleUpperCase("tr-TR") !== "ADET")
        throw Error("Bu aktarım yalnız ADET temel birimini destekler.");
      if (!/^-?\d+$/.test(qty) || !Number.isSafeInteger(Number(qty)))
        throw Error("Kaynak miktar tam sayı olmalı.");
      const salePriceMinor = parseMoney(sale),
        sourcePurchaseMinor = parseMoney(cost),
        discountBps = parseMoney(discount);
      if (discountBps > 10000) throw Error("İskonto %0–100 arası olmalı.");
      return {
        line,
        code,
        name,
        barcode,
        category,
        unit: "adet",
        sourceQuantity: Number(qty),
        salePriceMinor,
        sourcePurchaseMinor,
        discountBps,
      };
    } catch (e) {
      throw Error(`Satır ${line}: ${(e as Error).message}`);
    }
  });
}
