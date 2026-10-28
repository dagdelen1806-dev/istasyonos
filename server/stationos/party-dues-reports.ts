import { createHash } from "node:crypto";
import type { Express } from "express";
import type { Row, Services } from "./market-pos";
import { first, rows, withTransaction } from "./db";
import { requireId, requireEnum, requireString } from "./domain";
import { businessToday, integer, plusDays } from "./market-accounting-domain";
import { fail } from "./types";
import { safeAdd } from "./safety";
import {
  dueAge,
  dueAmounts,
  dueBuckets,
  dueMatches,
  dueRemaining,
} from "./party-dues-domain";
import type { DueDocument, PartyDues } from "../../shared/party-dues";
export function registerPartyDues(app: Express, services: Services) {
  app.get(
    "/api/stationos/market-accounting/reports/party-dues",
    async (req, res) => {
      try {
        const actor = services.actor(req),
          station = requireId(req.query.stationId, "stationId"),
          today = businessToday();
        // This is a live remaining-balance report, not a historical reconstruction.
        if (
          req.query.from !== undefined ||
          req.query.to !== undefined ||
          req.query.asOf !== undefined
        )
          fail(
            "INVALID_DATE",
            "Vade raporu yalnız güncel açık bakiyeleri gösterir."
          );
        const direction = requireEnum(
            req.query.direction ?? "ALL",
            "Cari yönü",
            ["ALL", "AR", "AP"] as const
          ),
          view = requireEnum(req.query.view ?? "ALL", "Vade görünümü", [
            "ALL",
            "OVERDUE",
            "TODAY",
            "NEXT7",
            "NEXT30",
            "NEXT90",
            "UNKNOWN",
          ] as const),
          partyId = req.query.partyId
            ? requireId(req.query.partyId, "Cari")
            : "",
          cursor = req.query.cursor
            ? requireId(req.query.cursor, "cursor")
            : "",
          expected = req.query.snapshot
            ? requireString(req.query.snapshot, "Görüntü", { max: 64 })
            : "";
        if (cursor && !expected)
          fail("INVALID_CURSOR", "Sayfalama görüntü kimliği ister.");
        res.json(
          await withTransaction(async c => {
            const { scope } = await services.requireStation(c, actor, station, [
              "OWNER",
              "MANAGER",
              "ACCOUNTANT",
            ]);
            const book = await first<Row>(
              c,
              "SELECT revision FROM st_market_books WHERE tenant_id=? AND station_id=?",
              [scope.tenantId, station]
            );
            if (!book)
              fail(
                "MARKET_BOOK_REQUIRED",
                "Önce market mali defterini açın.",
                409
              );
            const parties = await rows<Row[]>(
              c,
              "SELECT id,name FROM st_market_parties WHERE tenant_id=? AND station_id=? ORDER BY id LIMIT 5001",
              [scope.tenantId, station]
            );
            if (parties.length > 5000)
              fail(
                "REPORT_LIMIT",
                "Vade raporu en fazla 5.000 cari destekler.",
                409
              );
            const pm = new Map(parties.map(p => [p.id, p]));
            if (partyId && !pm.has(partyId))
              fail("NOT_FOUND", "Cari bu istasyonda bulunamadı.", 404);
            const docs = await rows<Row[]>(
              c,
              "SELECT id,party_id,kind,reference,due_date,total_minor,settled_minor,credited_minor FROM st_market_documents WHERE tenant_id=? AND station_id=? AND settled_minor+credited_minor<>total_minor ORDER BY due_date,id LIMIT 10001",
              [scope.tenantId, station]
            );
            if (docs.length > 10000)
              fail(
                "REPORT_LIMIT",
                "Vade raporu en fazla 10.000 açık belge destekler.",
                409
              );
            const all: DueDocument[] = docs.map(d => {
              const p = pm.get(d.party_id);
              if (!p)
                fail("REPORT_INCONSISTENT", "Belge carisi kapsamda yok.", 409);
              if (
                ![
                  "CREDIT_SALE",
                  "OPENING_AR",
                  "PURCHASE",
                  "OPENING_AP",
                ].includes(d.kind)
              )
                fail("REPORT_INCONSISTENT", "Cari belge türü geçersiz.", 409);
              const remainingMinor = dueRemaining(
                d.total_minor,
                d.settled_minor,
                d.credited_minor
              );
              return {
                id: d.id,
                partyId: d.party_id,
                partyName: p.name,
                kind: d.kind,
                reference: d.reference,
                direction: ["CREDIT_SALE", "OPENING_AR"].includes(d.kind)
                  ? "AR"
                  : "AP",
                dueDate: d.due_date,
                ...dueAge(today, d.due_date),
                totalMinor: integer(d.total_minor),
                settledMinor: integer(d.settled_minor),
                creditedMinor: integer(d.credited_minor),
                remainingMinor,
              };
            });
            // Validate against posted journal, not just the cached balance. No AR/AP netting.
            const ledger = await rows<Row[]>(
              c,
              "SELECT l.party_id,l.account_code,SUM(l.debit_minor-l.credit_minor) amount FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.tenant_id=? AND e.station_id=? AND l.account_code IN ('RECEIVABLE','PAYABLE') GROUP BY l.party_id,l.account_code LIMIT 10001",
              [scope.tenantId, station]
            );
            if (ledger.length > 10000)
              fail("REPORT_LIMIT", "Cari defter sınırı aşıldı.", 409);
            const balances = new Map<string, number>();
            for (const l of ledger) {
              if (!pm.has(l.party_id))
                fail(
                  "REPORT_INCONSISTENT",
                  "Mali cari hesabı kapsamda yok.",
                  409
                );
              balances.set(
                l.party_id +
                  ":" +
                  (l.account_code === "RECEIVABLE" ? "AR" : "AP"),
                integer(l.amount) * (l.account_code === "PAYABLE" ? -1 : 1)
              );
            }
            const documentBalances = new Map<string, number>();
            for (const d of all) {
              const key = d.partyId + ":" + d.direction;
              documentBalances.set(
                key,
                safeAdd(documentBalances.get(key) ?? 0, d.remainingMinor)
              );
            }
            for (const key of new Set([
              ...balances.keys(),
              ...documentBalances.keys(),
            ]))
              if ((balances.get(key) ?? 0) !== (documentBalances.get(key) ?? 0))
                fail(
                  "REPORT_INCONSISTENT",
                  "Açık belgeler ile cari defter uyuşmuyor; hareketleri kontrol edin.",
                  409
                );
            const snapshot = createHash("sha256")
              .update(JSON.stringify([today, book.revision, parties, all]))
              .digest("hex");
            if (expected && expected !== snapshot)
              fail(
                "REPORT_CHANGED",
                "Cari kayıtları değişti; raporu yenileyin.",
                409
              );
            const selected = all.filter(
              d =>
                (!partyId || d.partyId === partyId) &&
                (direction === "ALL" || d.direction === direction)
            );
            const matching = selected.filter(d => dueMatches(d, view));
            const index = cursor
              ? matching.findIndex(d => d.id === cursor)
              : -1;
            if (cursor && index < 0)
              fail("INVALID_CURSOR", "İmleç bu vade filtresinde bulunamadı.");
            const page = matching.slice(index + 1, index + 51);
            return {
              today,
              generatedAt: new Date().toISOString(),
              snapshot,
              partyId,
              direction,
              view,
              parties: parties.map(p => ({
                id: String(p.id),
                name: String(p.name),
              })),
              totals: dueAmounts(selected),
              overdue: dueAmounts(
                selected.filter(d => dueMatches(d, "OVERDUE"))
              ),
              todayDue: dueAmounts(
                selected.filter(d => dueMatches(d, "TODAY"))
              ),
              unknown: dueAmounts(
                selected.filter(d => dueMatches(d, "UNKNOWN"))
              ),
              aging: dueBuckets.map(bucket => ({
                bucket,
                amounts: dueAmounts(selected.filter(d => d.bucket === bucket)),
              })),
              calendar: Array.from({ length: 91 }, (_, i) => {
                const date = plusDays(today, i);
                return {
                  date,
                  amounts: dueAmounts(selected.filter(d => d.dueDate === date)),
                };
              }),
              matched: matching.length,
              rows: page,
              nextCursor:
                index + 1 + page.length < matching.length
                  ? page.at(-1)!.id
                  : null,
            } satisfies PartyDues;
          })
        );
      } catch (e) {
        services.error(res, e);
      }
    }
  );
}
