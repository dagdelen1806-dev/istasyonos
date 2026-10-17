import type { Express } from "express";
import type { Services, Row } from "./market-pos";
import { withTransaction, first, rows } from "./db";
import { requireId, requireInteger } from "./domain";
import { fail } from "./types";
import { safeAdd } from "./safety";
import {
  businessToday,
  calendarDate,
  integer,
} from "./market-accounting-domain";
import type { MarketStatementPage } from "../../shared/market-accounting";
export function registerMarketStatement(app: Express, services: Services) {
  app.get("/api/stationos/market-accounting/statement", async (req, res) => {
    try {
      const actor = services.actor(req),
        station = requireId(req.query.stationId, "stationId"),
        partyId = requireId(req.query.partyId, "partyId"),
        from = calendarDate(req.query.from ?? "2000-01-01"),
        to = calendarDate(req.query.to ?? businessToday()),
        cursor = requireInteger(Number(req.query.cursor ?? 0), "cursor", {
          allowZero: true,
        });
      if (from > to)
        fail("INVALID_DATE", "Başlangıç tarihi bitişten sonra olamaz.");
      const result = await withTransaction(async c => {
        const { scope } = await services.requireStation(c, actor, station, [
          "OWNER",
          "MANAGER",
          "ACCOUNTANT",
        ]);
        const party = await first<Row>(
          c,
          "SELECT id,name FROM st_market_parties WHERE id=? AND tenant_id=? AND station_id=?",
          [partyId, scope.tenantId, station]
        );
        if (!party) fail("NOT_FOUND", "Cari bulunamadı.", 404);
        const sum = async (where: string, params: unknown[]) => {
          const r = await rows<Row[]>(
            c,
            `SELECT l.account_code,SUM(l.debit_minor-l.credit_minor) AS n FROM st_market_lines l JOIN st_market_entries e ON e.id=l.entry_id WHERE e.station_id=? AND e.tenant_id=? AND l.party_id=? AND ${where} GROUP BY l.account_code`,
            [station, scope.tenantId, partyId, ...params]
          );
          const v = Object.fromEntries(
            r.map(x => [x.account_code, integer(x.n)])
          );
          return { ar: v.RECEIVABLE ?? 0, ap: -(v.PAYABLE ?? 0) };
        };
        const opening = await sum(
            "(e.business_date<? OR (e.business_date BETWEEN ? AND ? AND e.seq<=?))",
            [from, from, to, cursor]
          ),
          closing = await sum("e.business_date<=?", [to]);
        const es = await rows<Row[]>(
          c,
          "SELECT e.* FROM st_market_entries e WHERE e.station_id=? AND e.tenant_id=? AND e.business_date BETWEEN ? AND ? AND e.seq>? AND EXISTS(SELECT 1 FROM st_market_lines l WHERE l.entry_id=e.id AND l.party_id=?) ORDER BY e.seq LIMIT 101",
          [station, scope.tenantId, from, to, cursor, partyId]
        );
        const selected = es.slice(0, 100),
          ls = selected.length
            ? await rows<Row[]>(
                c,
                `SELECT entry_id,account_code,SUM(debit_minor-credit_minor) AS n FROM st_market_lines WHERE party_id=? AND entry_id IN (${selected.map(() => "?").join(",")}) GROUP BY entry_id,account_code`,
                [partyId, ...selected.map(e => e.id)]
              )
            : [];
        let ar = opening.ar,
          ap = opening.ap;
        const movements = selected.map(e => {
          const r = ls.filter(l => l.entry_id === e.id),
            d = Object.fromEntries(r.map(x => [x.account_code, integer(x.n)])),
            a = d.RECEIVABLE ?? 0,
            p = -(d.PAYABLE ?? 0);
          ar = safeAdd(ar, a);
          ap = safeAdd(ap, p);
          return {
            id: e.id,
            number: integer(e.seq),
            date: e.business_date,
            kind: e.kind,
            description: e.description,
            reference: e.reference,
            receivableDeltaMinor: a,
            payableDeltaMinor: p,
            receivableBalanceMinor: ar,
            payableBalanceMinor: ap,
          };
        });
        return {
          party: { id: party.id, name: party.name },
          from,
          to,
          openingReceivableMinor: opening.ar,
          openingPayableMinor: opening.ap,
          closingReceivableMinor: closing.ar,
          closingPayableMinor: closing.ap,
          nextCursor: es.length > 100 ? integer(selected.at(-1)!.seq) : null,
          rows: movements,
        } satisfies MarketStatementPage;
      });
      res.json(result);
    } catch (e) {
      services.error(res, e);
    }
  });
}
