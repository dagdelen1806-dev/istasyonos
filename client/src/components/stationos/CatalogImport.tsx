import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, RefreshCw, FileDown } from "lucide-react";
import { money } from "@shared/station";
import {
  parseCatalog,
  pilotCatalogVat,
  type CatalogMode,
  catalogHeaders,
  type CatalogPreview,
  type CatalogHistory,
} from "@shared/catalog-import";
import { previewCatalog, loadCatalogHistory } from "@/lib/station-api";
import { marketCsv } from "./MarketStatement";
export function CatalogImport({
  stationId,
  csrfToken,
  locked,
  canWrite,
  isDemo,
  closedToday,
  action,
}: {
  stationId: string;
  csrfToken: string | undefined;
  locked: boolean;
  canWrite: boolean;
  isDemo: boolean;
  closedToday: boolean;
  action: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [text, setText] = useState(""),
    [label, setLabel] = useState("Stok listesi"),
    [preview, setPreview] = useState<CatalogPreview | null>(null),
    [history, setHistory] = useState<CatalogHistory[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [accepted, setAccepted] = useState(false),
    [netAccepted, setNetAccepted] = useState(false),
    [mode, setMode] = useState<CatalogMode>("CATALOG_ONLY"),
    [vatByGroup, setVatByGroup] = useState<Record<string, number>>({
      ...pilotCatalogVat,
    });
  const opening = mode === "DEMO_OPENING_ABS";
  const settings = { mode, vatByGroup: opening ? vatByGroup : {} };
  const groups = useMemo(() => {
    try {
      return [...new Set(parseCatalog(text).map(r => r.category))].sort();
    } catch {
      return [];
    }
  }, [text]);
  const seq = useRef(0);
  const update = (value: string) => {
    seq.current++;
    setText(value);
    setPreview(null);
    setAccepted(false);
    setNetAccepted(false);
    setError("");
    setNotice("");
  };
  async function historyLoad() {
    setHistory(await loadCatalogHistory(stationId));
  }
  useEffect(() => {
    void historyLoad().catch(e => setError(e.message));
    return () => {
      seq.current++;
    };
  }, [stationId]);
  async function inspect() {
    const id = ++seq.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      parseCatalog(text);
      const result = await previewCatalog(stationId, text, csrfToken, settings);
      if (id === seq.current) {
        setPreview(result);
        setAccepted(false);
      }
    } catch (e) {
      if (id === seq.current) {
        setPreview(null);
        setError((e as Error).message);
      }
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }
  return (
    <section className="ma-panel">
      <div className="ma-panel-head">
        <div>
          <h2>Ürün listesinden kart aktarımı</h2>
          <p>
            Ürün kartlarını önizleyin; DEMO başlangıç stoğu ve grup KDV
            oranlarını seçerek aktarın.
          </p>
        </div>
        <button
          className="btn"
          disabled={locked || busy}
          onClick={() => void historyLoad().catch(e => setError(e.message))}
        >
          <RefreshCw size={16} />
          Aktarım geçmişini yenile
        </button>
      </div>
      <div className="notice warning">
        {opening
          ? "DEMO başlangıç stoğu: eksi miktarlar artıya çevrilir. Alış Fiyatı 1 KDV hariç net maliyet, Satış Fiyatı 1 mevcut etiket fiyatı olarak alınır. Kaynak iskonto uygulanmaz; cari borç ve indirilecek KDV oluşmaz."
          : "Yalnız kart aktarımı: yeni stok ve maliyet 0, KDV ve lot/SKT tanımsız başlar."}{" "}
        Mevcut barkodlu ürünün fiyatı, stoğu ve geçmişi korunur. Kaynak
        miktarlar değiştirilmeden denetim kaydında saklanır.
      </div>
      <fieldset disabled={locked || busy}>
        <label>
          Aktarım yöntemi
          <select
            aria-label="Aktarım yöntemi"
            value={mode}
            onChange={e => {
              setMode(e.target.value as CatalogMode);
              update(text);
            }}
          >
            <option value="CATALOG_ONLY">
              Yalnız yeni ürün kartları · stok sıfır
            </option>
            <option value="DEMO_OPENING_ABS" disabled={!isDemo}>
              DEMO başlangıç stoğu · eksi adetleri artıya çevir
            </option>
          </select>
        </label>
        {!isDemo && (
          <p className="ma-hint">
            Artı örnek stok seçeneği DEMO firmalarda kullanılabilir.
          </p>
        )}
        {opening && groups.length > 0 && (
          <div className="ma-table-wrap">
            <table>
              <caption>Grup KDV oranları · yeni kartlara uygulanır</caption>
              <thead>
                <tr>
                  <th>Ürün grubu</th>
                  <th>Alış ve satış KDV</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => (
                  <tr key={group}>
                    <td>{group || "Grupsuz"}</td>
                    <td>
                      <select
                        aria-label={`KDV ${group || "Grupsuz"}`}
                        value={
                          Object.hasOwn(vatByGroup, group)
                            ? vatByGroup[group]
                            : ""
                        }
                        onChange={e => {
                          const next = { ...vatByGroup };
                          if (e.target.value)
                            next[group] = Number(e.target.value);
                          else delete next[group];
                          setVatByGroup(next);
                          update(text);
                        }}
                      >
                        <option value="">Oran seçin</option>
                        <option value="100">%1</option>
                        <option value="1000">%10</option>
                        <option value="2000">%20</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ma-hint">
              Gıda %1, içecek %10, kişisel bakım ve araç bakımı %20 bu pilotta
              verdiğiniz başlangıç seçimleridir. Ürün grubunun mevzuata
              uygunluğunu ayrıca doğrulayın; ürün kartında oran
              değiştirilebilir.
            </p>
          </div>
        )}
        <label>
          Liste adı
          <input
            aria-label="Aktarım liste adı"
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={100}
          />
        </label>
        <label className="mi-catalog-file">
          <FileUp size={16} />
          Stok metin dosyası
          <input
            aria-label="Stok metin dosyası"
            type="file"
            accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values"
            onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                if (f.size > 2100000)
                  throw Error("Dosya 2 MB sınırını aşıyor.");
                const bytes = new Uint8Array(await f.arrayBuffer()),
                  encoding =
                    bytes[0] === 255 && bytes[1] === 254
                      ? "utf-16le"
                      : bytes[0] === 254 && bytes[1] === 255
                        ? "utf-16be"
                        : "utf-8";
                const value = new TextDecoder(encoding, { fatal: true }).decode(
                  bytes
                );
                update(value);
                setLabel(f.name.slice(0, 100));
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          />
        </label>
        <label>
          Başlık dahil stok listesini yapıştır
          <textarea
            aria-label="Stok listesi metni"
            rows={8}
            maxLength={1000000}
            value={text}
            onChange={e => update(e.target.value)}
            placeholder={catalogHeaders.join("\t")}
          />
        </label>
        <p className="ma-hint">
          Sekmeyle ayrılmış 9 sütun; en fazla 5.000 ADET ürün. UTF-8 veya
          Unicode metin kullanılabilir. Barkodlar metin olarak alınır; baştaki
          sıfırlar korunur. Satış Fiyatı 1 aynen satış fiyatına kopyalanır; KDV
          tahmin edilmez. DEMO stok aktarımında alış fiyatının net olduğunu
          teyit etmeniz gerekir; iskonto uygulanmaz.
        </p>
        <button
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => void inspect()}
        >
          Listeyi kontrol et
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="ma-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {busy && <p role="status">Liste kontrol ediliyor…</p>}
      {preview && (
        <>
          <div className="ma-wallet-grid">
            <div>
              <span>Kaynak ürün</span>
              <strong>{preview.rows.length}</strong>
            </div>
            <div>
              <span>Yeni / mevcut</span>
              <strong>
                {preview.added} / {preview.skipped}
              </strong>
            </div>
            <div>
              <span>Eksi stoklu satır</span>
              <strong>{preview.negativeRows}</strong>
            </div>
            <div>
              <span>Kaynak miktar toplamı · işlenmez</span>
              <strong>{preview.sourceTotalQty}</strong>
            </div>
          </div>
          {opening && (
            <div className="notice">
              <b>Yeni başlangıç stoğu: {preview.plannedQty} adet</b> · Net stok
              değeri: {money(preview.plannedInventoryMinor)}. Satış/kâr, cari
              borç veya vergi alacağı oluşturmaz.
            </div>
          )}
          {opening && preview.missingVatGroups.length > 0 && (
            <p role="alert" className="ma-error">
              KDV oranı seçilmeyen gruplar:{" "}
              {preview.missingVatGroups.map(g => g || "Grupsuz").join(", ")}
            </p>
          )}
          {opening && (closedToday || preview.closedToday) && (
            <p role="alert" className="ma-error">
              Bugünün market gün sonu kapalı; başlangıç stoğu eklenemez.
            </p>
          )}
          {preview.alreadyImported && (
            <p className="notice">
              Bu listenin aynı içeriği daha önce aktarıldı; yeniden ürün
              oluşturulmaz.
            </p>
          )}
          {preview.conflicts > 0 && (
            <p className="ma-error">
              {preview.conflicts} stok kodu başka barkodla çakışıyor. Listeyi
              düzeltip yeniden kontrol edin.
            </p>
          )}
          {preview.capacityExceeded && (
            <p className="ma-error">5.000 ürün kartı sınırı aşılacak.</p>
          )}
          <div className="ma-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stok kodu / ürün</th>
                  <th>Barkod / grup</th>
                  <th>Kaynak stok</th>
                  <th>Satış fiyatı</th>
                  <th>
                    {opening
                      ? "KDV hariç birim maliyet / KDV"
                      : "Kaynak alış · KDV türü belirsiz"}
                  </th>
                  <th>Sonuç</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map(r => (
                  <tr key={r.line}>
                    <td>
                      <b>{r.code}</b>
                      <small>{r.name}</small>
                    </td>
                    <td>
                      {r.barcode}
                      <small>{r.category}</small>
                    </td>
                    <td className={r.sourceQuantity < 0 ? "ma-error" : ""}>
                      {r.sourceQuantity}
                    </td>
                    <td>{money(r.salePriceMinor)}</td>
                    <td>
                      {money(r.sourcePurchaseMinor)}
                      {opening && (
                        <small>
                          {r.vatBps === null
                            ? "KDV seçilmedi"
                            : `%${r.vatBps / 100}`}
                        </small>
                      )}
                    </td>
                    <td>
                      {r.status === "NEW"
                        ? `Yeni kart · stok ${r.plannedQty}`
                        : r.status === "EXISTS"
                          ? "Mevcut · değiştirilmez"
                          : "Kod çakışması"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ma-hint">
            İlk 100 satır gösterilir; aktarım ve önizleme CSV'si tüm satırları
            içerir.
          </p>
          <button
            className="btn"
            onClick={() =>
              marketCsv("urun-aktarim-onizleme.csv", [
                [
                  "Stok kodu",
                  "Ad",
                  "Barkod",
                  "Grup",
                  "Kaynak stok",
                  "Yeni kart stoğu",
                  "Satış TL",
                  "Kaynak alış TL",
                  "Kaynak iskonto %",
                  "KDV %",
                  "Planlanan net stok TL",
                  "Durum",
                ],
                ...preview.rows.map(r => [
                  r.code,
                  r.name,
                  r.barcode,
                  r.category,
                  r.sourceQuantity,
                  r.status === "NEW" ? r.plannedQty : "Değişmez",
                  r.salePriceMinor / 100,
                  r.sourcePurchaseMinor / 100,
                  r.discountBps / 100,
                  r.vatBps === null ? "" : r.vatBps / 100,
                  r.status === "NEW" ? r.plannedValueMinor / 100 : "Değişmez",
                  r.status,
                ]),
              ])
            }
          >
            <FileDown size={16} />
            Önizlemeyi CSV indir
          </button>
          {opening && (
            <label className="ma-check">
              <input
                type="checkbox"
                aria-label="Alış fiyatları KDV hariç net maliyettir"
                checked={netAccepted}
                disabled={locked || busy || !canWrite}
                onChange={e => setNetAccepted(e.target.checked)}
              />
              Alış Fiyatı 1 KDV hariç net maliyettir; kaynak iskonto
              uygulanmayacak.
            </label>
          )}
          <label className="ma-check">
            <input
              aria-label={
                opening
                  ? "DEMO artı başlangıç stoğunu teyit et"
                  : "Yalnız kart aktarımını teyit et"
              }
              type="checkbox"
              checked={accepted}
              disabled={locked || busy || !canWrite}
              onChange={e => setAccepted(e.target.checked)}
            />
            {opening
              ? "Yalnız yeni kartlara artı DEMO başlangıç stoğu ve net maliyet eklenecek; seçtiğim KDV oranları kullanılacak."
              : "Yalnız yeni kartlar açılacak; kaynak miktar, alış maliyeti, iskonto ve bakiyeler işlenmeyecek."}
          </label>
          <button
            className="btn primary"
            disabled={
              locked ||
              busy ||
              !canWrite ||
              !accepted ||
              !label.trim() ||
              (opening &&
                (!netAccepted ||
                  !isDemo ||
                  closedToday ||
                  preview.closedToday ||
                  preview.missingVatGroups.length > 0)) ||
              preview.alreadyImported ||
              !!preview.conflicts ||
              preview.capacityExceeded ||
              !preview.added
            }
            onClick={async () => {
              if (
                await action("/market-accounting/inventory/catalog-import", {
                  text,
                  label,
                  expectedHash: preview.hash,
                  settings: preview.settings,
                  catalogOnlyAccepted: !opening,
                  demoOpeningAccepted: opening && accepted,
                  netCostsAccepted: opening && netAccepted,
                })
              ) {
                setNotice(
                  `${preview.added} ürün kartı eklendi; ${preview.skipped} mevcut ürün korundu. ${opening ? `${preview.plannedQty} adet DEMO başlangıç stoğu, ${money(preview.plannedInventoryMinor)} net stok değeri.` : "Stok ve mali defter değişmedi."}`
                );
                setPreview({ ...preview, alreadyImported: true });
                setAccepted(false);
                await historyLoad().catch(e => setError(e.message));
              }
            }}
          >
            {opening
              ? "DEMO kart ve başlangıç stoğunu aktar"
              : "Yeni ürün kartlarını aktar"}
          </button>
        </>
      )}
      <h3>Son 20 liste aktarımı</h3>
      <div className="ma-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Liste / tarih UTC</th>
              <th>Eklenen / korunan</th>
              <th>Kaynak eksi satır / toplam</th>
              <th>Kullanıcı</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>
                  {h.label}
                  <small>{h.createdAt}</small>
                  <small>
                    {h.mode === "DEMO_OPENING_ABS"
                      ? `${h.openingQty} adet DEMO · ${money(h.inventoryMinor)} net stok`
                      : "Yalnız kart"}
                  </small>
                </td>
                <td>
                  {h.added} / {h.skipped}
                </td>
                <td>
                  {h.negativeRows} / {h.sourceTotalQty}
                </td>
                <td>{h.actorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ma-hint">
        Eksi stok fizikî stok değildir; doğru miktar sayım veya belgeli mal
        kabul ile belirlenir. Artıya çevirme yalnız örnek DEMO başlangıcıdır.
        Kaynak listede lot/SKT yoktur; gerekiyorsa Lot ve SKT ekranında ayrıca
        açın. Liste işletmeye ait fiyat bilgileri içerir; herkese açık kaynak
        paketine eklenmez.
      </p>
    </section>
  );
}
