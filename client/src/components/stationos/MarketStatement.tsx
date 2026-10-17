import { useEffect, useState } from "react";
import type {
  MarketParty,
  MarketStatementPage,
} from "@shared/market-accounting";
import { money } from "@shared/station";
import { loadMarketStatement } from "@/lib/station-api";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function marketCsv(
  filename: string,
  rows: (string | number | null)[][]
) {
  const cell = (v: string | number | null) => {
    let s = String(v ?? "");
    if (typeof v !== "number" && /^[=+@\-\t\r]/.test(s.trimStart()))
      s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const blob = new Blob(
      ["\uFEFF" + rows.map(r => r.map(cell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" }
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const marketKindLabels: Record<string, string> = {
  OPENING: "Açılış",
  PARTY_OPENING: "Cari açılışı",
  POS_SALE: "Kasa satışı",
  PURCHASE: "Mal kabul",
  COLLECTION: "Tahsilat",
  PAYMENT: "Tedarikçi ödemesi",
  EXPENSE: "Gider",
  TRANSFER: "Hesap transferi",
  CAPITAL: "Kaynak girişi",
  BANK_SETTLEMENT: "Kart → banka",
  STOCK_ADJUST: "Stok sayımı",
  REGISTER_OPEN: "Kasa açılışı",
  REGISTER_CLOSE: "Kasa devri",
  DAY_VARIANCE: "Gün sonu farkı",
  REVERSAL: "Ters kayıt",
};
export function MarketStatement({
  stationId,
  party,
  today,
  startedOn,
  close,
}: {
  stationId: string;
  party: MarketParty;
  today: string;
  startedOn: string | null;
  close: () => void;
}) {
  const [from, setFrom] = useState(startedOn ?? today),
    [to, setTo] = useState(today),
    [cursors, setCursors] = useState([0]),
    [data, setData] = useState<MarketStatementPage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const cursor = cursors.at(-1) ?? 0;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    void loadMarketStatement(stationId, party.id, from, to, cursor)
      .then(d => {
        if (active) setData(d);
      })
      .catch(e => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [stationId, party.id, from, to, cursor]);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent className="ma-dialog ma-statement">
        <DialogTitle>{party.name} · cari ekstre</DialogTitle>
        <DialogDescription>
          Tarih aralığında müşteri alacağı ve tedarikçi borcu ayrı izlenir.
        </DialogDescription>
        <div className="ma-statement-filters">
          <label>
            Başlangıç
            <input
              type="date"
              value={from}
              onChange={e => {
                setFrom(e.target.value);
                setCursors([0]);
              }}
            />
          </label>
          <label>
            Bitiş
            <input
              type="date"
              value={to}
              onChange={e => {
                setTo(e.target.value);
                setCursors([0]);
              }}
            />
          </label>
          <button
            className="btn"
            disabled={!data || busy}
            onClick={() => {
              if (data)
                marketCsv(`market-ekstre-${from}-${to}.csv`, [
                  [
                    "Tarih",
                    "İşlem",
                    "Referans",
                    "Açıklama",
                    "Alacak değişimi TL",
                    "Borç değişimi TL",
                    "Müşteri alacağı TL",
                    "Tedarikçi borcu TL",
                  ],
                  ...data.rows.map(r => [
                    r.date,
                    marketKindLabels[r.kind] ?? r.kind,
                    r.reference,
                    r.description,
                    r.receivableDeltaMinor / 100,
                    r.payableDeltaMinor / 100,
                    r.receivableBalanceMinor / 100,
                    r.payableBalanceMinor / 100,
                  ]),
                ]);
            }}
          >
            Bu sayfayı CSV indir
          </button>
        </div>
        {error && (
          <p role="alert" className="ma-error">
            {error}
          </p>
        )}
        {busy && <p>Ekstre yükleniyor…</p>}
        {data && !busy && (
          <>
            <div className="ma-opening-summary">
              <span>
                Dönem sonu müşteri alacağı
                <strong>{money(data.closingReceivableMinor)}</strong>
              </span>
              <span>
                Dönem sonu tedarikçi borcu
                <strong>{money(data.closingPayableMinor)}</strong>
              </span>
            </div>
            <div className="ma-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tarih / İşlem</th>
                    <th>Açıklama</th>
                    <th>Alacak değişimi</th>
                    <th>Borç değişimi</th>
                    <th>Müşteri alacağı</th>
                    <th>Tedarikçi borcu</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={4}>Sayfa başı bakiye</td>
                    <td>{money(data.openingReceivableMinor)}</td>
                    <td>{money(data.openingPayableMinor)}</td>
                  </tr>
                  {data.rows.map(r => (
                    <tr key={r.id}>
                      <td>
                        {r.date}
                        <small>
                          {marketKindLabels[r.kind] ?? r.kind} · #{r.number}
                        </small>
                      </td>
                      <td>
                        {r.description}
                        <small>{r.reference}</small>
                      </td>
                      <td>{money(r.receivableDeltaMinor)}</td>
                      <td>{money(r.payableDeltaMinor)}</td>
                      <td>{money(r.receivableBalanceMinor)}</td>
                      <td>{money(r.payableBalanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ma-pagination">
              <button
                className="btn"
                disabled={cursors.length < 2}
                onClick={() => setCursors(c => c.slice(0, -1))}
              >
                Önceki sayfa
              </button>
              <span>{cursors.length}. sayfa · en fazla 100 hareket</span>
              <button
                className="btn"
                disabled={data.nextCursor === null}
                onClick={() => setCursors(c => [...c, data.nextCursor!])}
              >
                Sonraki sayfa
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
