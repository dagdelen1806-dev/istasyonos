import type { PoolConnection } from "mysql2/promise";
import type { Row } from "./market-pos";
import type { StationRole } from "./types";
import { first } from "./db";
import { requireId } from "./domain";
import { integer } from "./market-accounting-domain";
import { fail } from "./types";
export async function productPrice(
  c: PoolConnection,
  station: string,
  product: Row,
  listId: unknown,
  role: StationRole,
  locked = false
) {
  if (listId === undefined || listId === null || listId === "")
    return {
      price: integer(product.sale_price_minor),
      listId: null,
      listName: null,
    };
  const id = requireId(listId, "Fiyat listesi");
  const row = await first<Row>(
    c,
    "SELECT l.name,l.active,l.staff_enabled,p.unit_price_minor FROM st_market_price_lists l LEFT JOIN st_market_prices p ON p.list_id=l.id AND p.product_id=? WHERE l.id=? AND l.station_id=?" +
      (locked ? " FOR UPDATE" : ""),
    [product.id, id, station]
  );
  if (!row || !row.active)
    fail("PRICE_LIST_INACTIVE", "Fiyat listesi bulunamadı veya kapalı.", 409);
  if (role === "MARKET_STAFF" && !row.staff_enabled)
    fail(
      "PRICE_LIST_FORBIDDEN",
      "Bu fiyat listesi kasiyer kullanımına kapalı.",
      403
    );
  if (row.unit_price_minor === null)
    fail(
      "PRODUCT_PRICE_MISSING",
      "Bu ürünün seçili listede fiyatı tanımlı değil.",
      409
    );
  return {
    price: integer(row.unit_price_minor),
    listId: id,
    listName: String(row.name),
  };
}
