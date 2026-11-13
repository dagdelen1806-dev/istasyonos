import { useEffect, useState, type FormEvent } from "react";
import type { AppState } from "@shared/station";
import {
  tankerCompleteness,
  tankerDeliveryDifferences,
  type TankerOverview,
  type TankerValues,
} from "@shared/tanker-document";
import { litres, parseLitres } from "@shared/fuel";
import { formatTurkeyInstant } from "@shared/datetime";
import { zipSourceBytes } from "@/lib/icmal-export";
import { Panel, Field, Notice } from "./Common";
type Props = {
  state: AppState;
  stationId: string;
  busy: boolean;
  onAction: (path: string, body: Record<string, unknown>) => Promise<boolean>;
};
const mlInput = (n: number | null) =>
  n === null ? "" : String(n / 1000).replace(".", ",");
export function TankerDocumentPanel({
  state,
  stationId,
  busy,
  onAction,
}: Props) {
  const [data, setData] = useState<TankerOverview | null>(null),
    [packageId, setPackageId] = useState(""),
    [pageId, setPageId] = useState(""),
    [values, setValues] = useState<TankerValues | null>(null),
    [readId, setReadId] = useState(""),
    [formReadId, setFormReadId] = useState(""),
    [preferredProvider, setPreferredProvider] = useState<
      "LOCAL" | "OPENAI" | "GEMINI" | null
    >(null),
    [revision, setRevision] = useState(0),
    [version, setVersion] = useState(0),
    [formVersion, setFormVersion] = useState(0),
    [dirty, setDirty] = useState(false),
    [loading, setLoading] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [externalConfirmed, setExternalConfirmed] = useState(false),
    [completeExisting, setCompleteExisting] = useState(false),
    [lineKey, setLineKey] = useState(""),
    [basis, setBasis] = useState(""),
    [tankId, setTankId] = useState("");
  const [received, setReceived] = useState("");
  const [documentType, setDocumentType] = useState<
    "TANKER" | "TANK" | "INVOICE"
  >("TANKER");
  const station = stationId || state.stations[0]?.id || "",
    allowed = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(
      state.member?.role ?? ""
    ),
    disabled = busy || loading || working || !state.tenant?.isDemo;
  useEffect(() => {
    let active = true;
    if (!station || !allowed || !state.tenant?.isDemo) return;
    setLoading(true);
    fetch(
      "/api/stationos/tanker-documents?" +
        new URLSearchParams({
          stationId: station,
          ...(packageId ? { packageId } : {}),
        }),
      { credentials: "include", cache: "no-store" }
    )
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error?.message || "Tanker evrakı okunamadı.");
        if (active) {
          setData(d);
          if (!dirty) {
            setValues(
              d.latest?.values ?? {
                documentNo: null,
                issuer: null,
                documentDate: null,
                supplierId: null,
                pages: d.pages.map((p: any) => ({
                  pageId: p.id,
                  number: null,
                  total: null,
                })),
                lines: [],
              }
            );
            setRevision(d.latest?.revision ?? 0);
            setFormReadId(d.latest?.readId ?? "");
            setFormVersion(v => v + 1);
          }
        }
      })
      .catch(e => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [station, allowed, state, packageId, version, dirty]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget,
      files = Array.from(
        (form.elements.namedItem("tankerFiles") as HTMLInputElement).files ?? []
      );
    if (!files.length) return;
    if (
      files.length > 12 ||
      files.some(
        f => f.size > 5 * 1024 * 1024 || !/\.(jpe?g|png)$/i.test(f.name)
      ) ||
      files.reduce((s, f) => s + f.size, 0) > 19 * 1024 * 1024
    ) {
      setError(
        "En fazla 12 JPEG/PNG, fotoğraf başına 5 MB ve toplam 19 MB yükleyin."
      );
      return;
    }
    setWorking(true);
    try {
      const additions = await Promise.all(
        files.map(async f => ({
          name: f.name,
          data: new Uint8Array(await f.arrayBuffer()),
        }))
      );
      const existing: { name: string; data: Uint8Array }[] = [];
      if (completeExisting) {
        if (
          !data?.document ||
          dirty ||
          data.receipts.some(r => ["PENDING", "APPROVED"].includes(r.status))
        )
          throw Error(
            "Önce mevcut taslağı kaydedin. Bağlı bekleyen/onaylı kabul bulunan belge tamamlanamaz."
          );
        for (const [index, page] of data.pages.entries()) {
          const response = await fetch(
            "/api/stationos/tanker-document/image?" +
              new URLSearchParams({
                stationId: station,
                packageId: data.document.id,
                pageId: page.id,
              }),
            { credentials: "include", cache: "no-store" }
          );
          if (!response.ok) throw Error("Mevcut kaynak sayfası alınamadı.");
          const bytes = await response.arrayBuffer();
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
          )
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
          if (digest !== page.sha256)
            throw Error("Kaynak sayfası değişti; güncel evrakı yükleyin.");
          const extension = response.headers
            .get("content-type")
            ?.includes("png")
            ? "png"
            : "jpeg";
          existing.push({
            name: `kaynak-${index + 1}.${extension}`,
            data: new Uint8Array(bytes),
          });
        }
      }
      const sources = [
        ...existing,
        ...additions.map((f, i) => ({ ...f, name: `ek-${i + 1}-` + f.name })),
      ];
      if (
        sources.length > 12 ||
        sources.reduce((sum, f) => sum + f.data.byteLength, 0) >
          19 * 1024 * 1024
      )
        throw Error(
          "Tamamlanmış belge toplam en fazla 12 sayfa ve 19 MB olabilir."
        );
      const zipped = zipSourceBytes(sources),
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(Error("Dosya okunamadı."));
          reader.readAsDataURL(new Blob([zipped as BlobPart]));
        });
      if (
        await onAction("/tanker-document/import", {
          stationId: station,
          sourceName: files[0].name.slice(0, 145) + " tanker.zip",
          zipBase64: base64,
        })
      ) {
        setPackageId("");
        setCompleteExisting(false);
        setReadId("");
        setFormReadId("");
        setPreferredProvider(null);
        setExternalConfirmed(false);
        setDirty(false);
        setVersion(v => v + 1);
        form.reset();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function readDocument(provider: "LOCAL" | "OPENAI" | "GEMINI") {
    if (!data?.document) return;
    setError("");
    setWorking(true);
    try {
      if (
        await onAction("/tanker-document/read", {
          stationId: station,
          packageId: data.document.id,
          expectedSourceHash: data.sourceHash,
          provider,
          externalConfirmed,
          documentType,
        })
      ) {
        setDirty(true);
        setReadId("");
        setPreferredProvider(provider);
        setVersion(v => v + 1);
        try {
          const response = await fetch(
            "/api/stationos/tanker-documents?" +
              new URLSearchParams({
                stationId: station,
                packageId: data.document.id,
              }),
            { credentials: "include", cache: "no-store" }
          );
          if (!response.ok) throw Error("Okuma sonucu alınamadı.");
          const fresh: TankerOverview = await response.json();
          const matching = fresh.reads.filter(
            r =>
              (r.proposal.values.documentFields?.kind ?? "TANKER") ===
              documentType
          );
          const next =
            matching.find(r => r.provider === provider) ??
            matching.find(r => r.provider === "LOCAL");
          if (next) {
            setValues(structuredClone(next.proposal.values));
            setReadId(next.id);
            setFormReadId(next.id);
            setDirty(true);
            setFormVersion(v => v + 1);
            if (provider === "GEMINI" && next.provider === "LOCAL")
              setError(
                "Gemini okuması tamamlanamadı; yerel OCR sonucuna geçildi. Alanları fotoğrafla kontrol edin."
              );
          }
        } catch {
          setError(
            "Okuma kaydedildi; sonucu kaydedilmiş okumalardan forma alın."
          );
        }
      }
    } finally {
      setWorking(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data?.document || !values) return;
    setError("");
    const f = new FormData(e.currentTarget),
      text = (name: string) => String(f.get(name) ?? "").trim() || null,
      num = (name: string) => (text(name) === null ? null : Number(text(name))),
      volume = (name: string) =>
        text(name) === null ? null : parseLitres(text(name)!);
    try {
      const payload: TankerValues = {
        ...(values.documentFields
          ? {
              documentFields: {
                kind: values.documentFields.kind,
                fields: values.documentFields.fields.map((field, index) => ({
                  ...field,
                  value: text("documentField-" + index),
                })),
              },
            }
          : {}),
        documentNo: text("documentNo"),
        issuer: text("issuer"),
        documentDate: text("documentDate"),
        supplierId: text("supplierId"),
        pages: values.pages.map(p => ({
          pageId: p.pageId,
          number: num("pageNumber-" + p.pageId),
          total: num("pageTotal-" + p.pageId),
        })),
        lines: values.lines.map(l => ({
          key: l.key,
          label: text("label-" + l.key) ?? "",
          productCode: text("code-" + l.key),
          fuelId: text("fuel-" + l.key),
          netMl: volume("net-" + l.key),
          dispatchMl: volume("dispatch-" + l.key),
        })),
      };
      if (
        await onAction("/tanker-document/review", {
          stationId: station,
          packageId: data.document.id,
          expectedSourceHash: data.sourceHash,
          expectedRevision: revision,
          readId: formReadId || null,
          decision: f.get("tankerDecision"),
          sourceConfirmed: f.get("tankerConfirmed") === "on",
          values: payload,
          note: f.get("tankerNote"),
          evidence: f.get("tankerEvidence"),
        })
      ) {
        setDirty(false);
        setVersion(v => v + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function receipt(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data?.latest || data.latest.decision !== "VERIFIED_DRAFT") return;
    setError("");
    const line = data.latest.values.lines.find(l => l.key === lineKey),
      tank = data.tanks.find(t => t.tankId === tankId),
      f = new FormData(e.currentTarget);
    if (!line || !tank || !["NET", "DISPATCH"].includes(basis)) return;
    try {
      if (
        await onAction("/tank/request", {
          stationId: station,
          tankId,
          expectedRevision: tank.revision,
          kind: "DELIVERY",
          supplierId: data.latest.values.supplierId,
          reference: data.latest.values.documentNo,
          documentMl: basis === "NET" ? line.netMl : line.dispatchMl,
          measuredMl: parseLitres(String(f.get("received"))),
          tankerDocument: {
            reviewId: data.latest.id,
            lineKey: line.key,
            basis,
          },
          note: f.get("receiptNote"),
          evidence: f.get("receiptEvidence"),
        })
      ) {
        setVersion(v => v + 1);
        setBasis("");
        setTankId("");
        setReceived("");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!allowed)
    return (
      <Notice warning>
        Tanker evrakı için yönetim veya muhasebe yetkisi gerekir.
      </Notice>
    );
  if (!state.tenant?.isDemo)
    return (
      <Notice warning>
        Tanker belge aktarımı yalnız DEMO/test alanında açık.
      </Notice>
    );
  const page = data?.pages.find(p => p.id === pageId) ?? data?.pages[0],
    read =
      data?.reads.find(r => r.id === readId) ??
      data?.reads.find(r => r.provider === preferredProvider) ??
      data?.reads[0],
    sourceLocked = data?.receipts.some(r =>
      ["PENDING", "APPROVED"].includes(r.status)
    ),
    conflict = dirty && revision !== (data?.latest?.revision ?? 0),
    selectedLine = data?.latest?.values.lines.find(l => l.key === lineKey),
    activeReceipt = data?.receipts.some(
      r => r.lineKey === lineKey && ["PENDING", "APPROVED"].includes(r.status)
    );
  let deliveryPreview: ReturnType<typeof tankerDeliveryDifferences> | null =
    null;
  let deliveryError = "";
  if (selectedLine && received.trim()) {
    try {
      deliveryPreview = tankerDeliveryDifferences(
        selectedLine,
        parseLitres(received),
        basis
      );
    } catch (e) {
      deliveryError = (e as Error).message;
    }
  }
  return (
    <div className="tanker-document-panel">
      <Notice>
        Evrak okuması öneridir. Net hacim, sevk miktarı ve istasyonda ölçülen
        litre ayrı tutulur. Stok artışı mevcut bağımsız onaydan sonra
        gerçekleşir.
      </Notice>
      {error && <Notice warning>{error}</Notice>}
      <Panel title="OCR belge kaynağını ekle">
        <form className="business-form form-grid two" onSubmit={upload}>
          <Field label="Bütün belge sayfaları (JPEG/PNG)">
            <input
              type="file"
              name="tankerFiles"
              accept=".jpg,.jpeg,.png"
              multiple
              required
              disabled={disabled}
            />
          </Field>
          <label>
            <input
              type="checkbox"
              name="completeExisting"
              checked={completeExisting}
              disabled={
                disabled ||
                dirty ||
                !data?.document ||
                data.receipts.some(r =>
                  ["PENDING", "APPROVED"].includes(r.status)
                )
              }
              onChange={e => setCompleteExisting(e.target.checked)}
            />{" "}
            Seçili evrağın eksik sayfalarını tamamla
          </label>
          {completeExisting && (
            <Notice>
              Seçili evrağın mevcut sayfaları ile yeni fotoğraflar birleştirilip
              yeni kaynak taslağı oluşturulur. Eski evrak ve inceleme geçmişi
              korunur. Yeni taslak yeniden okunmalı, tüm sayfalar ve değerler
              kullanıcı tarafından tekrar doğrulanmalıdır.
            </Notice>
          )}
          <button className="btn primary" disabled={disabled}>
            Tanker kaynaklarını kaydet
          </button>
        </form>
      </Panel>
      <Panel title="Belge okuma ve kullanıcı kontrolü">
        <div className="business-form">
          <Field label="Tanker evrakı">
            <select
              name="tankerPackage"
              disabled={disabled}
              value={data?.document?.id ?? ""}
              onChange={e => {
                setPackageId(e.target.value);
                setError("");
                setDirty(false);
                setPageId("");
                setLineKey("");
                setBasis("");
                setTankId("");
                setReceived("");
                setReadId("");
                setFormReadId("");
                setPreferredProvider(null);
                setExternalConfirmed(false);
                setCompleteExisting(false);
                setData(null);
              }}
            >
              <option value="">Belge seçin</option>
              {data?.packages.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.pageCount} sayfa
                </option>
              ))}
            </select>
          </Field>
          {data?.document && values && (
            <>
              <div className="daily-numeric-workspace">
                <aside>
                  <Field label="Kaynak belge sayfası">
                    <select
                      name="tankerPage"
                      value={page?.id ?? ""}
                      onChange={e => setPageId(e.target.value)}
                    >
                      {data.pages.map((p, i) => (
                        <option key={p.id} value={p.id}>
                          {i + 1}. {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {page && (
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={
                        "/api/stationos/tanker-document/image?" +
                        new URLSearchParams({
                          stationId: station,
                          packageId: data.document.id,
                          pageId: page.id,
                        })
                      }
                    >
                      <img
                        alt="Tanker evrakı kaynak görüntüsü"
                        src={
                          "/api/stationos/tanker-document/image?" +
                          new URLSearchParams({
                            stationId: station,
                            packageId: data.document.id,
                            pageId: page.id,
                          })
                        }
                      />
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={disabled}
                    onClick={() => void readDocument("LOCAL")}
                  >
                    Evrakı yerelde oku
                  </button>
                  <Field label="OCR belge türü">
                    <select
                      name="ocrDocumentType"
                      value={documentType}
                      onChange={e =>
                        setDocumentType(e.target.value as typeof documentType)
                      }
                      disabled={disabled}
                    >
                      <option value="TANKER">Tanker irsaliyesi</option>
                      <option value="TANK">Tank fotoğrafı</option>
                      <option value="INVOICE">Fatura</option>
                    </select>
                  </Field>
                  <p>
                    {data.externalDisabled ? (
                      "DEMO OCR: yerel Windows OCR"
                    ) : (
                      <>
                        Gelişmiş görüntü modeli:{" "}
                        {data.gemini?.available
                          ? data.gemini.model
                          : data.openai.model}
                      </>
                    )}
                  </p>
                  {data.externalDisabled && (
                    <Notice>
                      Bu ayrı DEMO ortamında haricî OCR kapalıdır. Yerel Windows
                      OCR çalışır; canlı Gemini bağlantısı ayrı DEMO bağlantı
                      kontrolüyle sınanır.
                    </Notice>
                  )}
                  {!data.externalDisabled &&
                    !data.openai.available &&
                    !data.gemini?.available && (
                      <Notice warning>
                        Sunucu API anahtarı bekleniyor. GEMINI_API_KEY veya
                        OPENAI_API_KEY yapılandırılmalı; yerel okuma ve elle
                        giriş açık.
                      </Notice>
                    )}
                  <label>
                    <input
                      name="openaiConfirmed"
                      disabled={data.externalDisabled}
                      type="checkbox"
                      checked={externalConfirmed}
                      onChange={e => setExternalConfirmed(e.target.checked)}
                    />{" "}
                    Gelişmiş okuma için belge görüntülerinin{" "}
                    {data.gemini?.available ? "Google Gemini'ye" : "OpenAI'a"}
                    gönderileceğini biliyorum.
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={
                      disabled ||
                      (!data.openai.available && !data.gemini?.available) ||
                      !externalConfirmed ||
                      (documentType !== "TANKER" && !data.gemini?.available)
                    }
                    onClick={() =>
                      void readDocument(
                        data.gemini?.available ? "GEMINI" : "OPENAI"
                      )
                    }
                  >
                    Gelişmiş modelle belgeyi oku
                  </button>
                  <Field label="Kaydedilmiş okuma">
                    <select
                      name="tankerRead"
                      value={read?.id ?? ""}
                      onChange={e => setReadId(e.target.value)}
                    >
                      <option value="">Henüz okuma yok</option>
                      {data.reads.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.provider === "GEMINI"
                            ? "Gemini"
                            : r.provider === "OPENAI"
                              ? "OpenAI"
                              : "Yerel"}{" "}
                          · {r.model}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {read && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={disabled}
                        onClick={() => {
                          setValues(structuredClone(read.proposal.values));
                          setReadId(read.id);
                          setFormReadId(read.id);
                          setDirty(true);
                          setFormVersion(v => v + 1);
                        }}
                      >
                        Okuma önerisini forma al
                      </button>
                      <p>
                        Bu işlem kaydedilmemiş form alanlarını öneriyle
                        değiştirir; kayıt ayrıca yapılır.
                      </p>
                      {read.proposal.warnings.map(w => (
                        <Notice key={w} warning>
                          {w}
                        </Notice>
                      ))}
                    </>
                  )}
                </aside>
                <div>
                  {conflict && (
                    <Notice warning>
                      Başka bir inceleme kaydedildi. Yerel form korunuyor;
                      güncel taslağı yükleyin.
                    </Notice>
                  )}
                  <form
                    className="form-grid two"
                    onSubmit={save}
                    onChange={() => setDirty(true)}
                    key={data.document.id + ":" + formVersion}
                  >
                    {values.documentFields && (
                      <fieldset style={{ minWidth: 0, gridColumn: "1 / -1" }}>
                        <legend>
                          {values.documentFields.kind === "TANK"
                            ? "Tank fotoğrafından okunan alanlar"
                            : "Faturadan okunan alanlar"}
                        </legend>
                        <Notice>
                          OCR önerileri otomatik dolduruldu. Her alanı kaynakla
                          kontrol edin. Bu kayıt yalnız belge taslağıdır; onaylı
                          tank stoku veya mali defter değişmez.
                        </Notice>
                        {values.documentFields.fields.map((field, index) => (
                          <Field
                            key={index}
                            label={
                              field.label +
                              (field.unit ? " (" + field.unit + ")" : "")
                            }
                          >
                            <input
                              name={"documentField-" + index}
                              defaultValue={field.value ?? ""}
                              maxLength={190}
                            />
                          </Field>
                        ))}
                        <button
                          type="button"
                          className="btn"
                          disabled={
                            disabled ||
                            values.documentFields.fields.length >= 100
                          }
                          onClick={() => {
                            const label = window.prompt(
                              "Kaynakta bulunan alan adı:"
                            );
                            if (label?.trim()) {
                              setValues(v =>
                                v?.documentFields
                                  ? {
                                      ...v,
                                      documentFields: {
                                        ...v.documentFields,
                                        fields: [
                                          ...v.documentFields.fields,
                                          {
                                            label: label.trim().slice(0, 190),
                                            value: null,
                                            unit: null,
                                          },
                                        ],
                                      },
                                    }
                                  : v
                              );
                              setDirty(true);
                            }
                          }}
                        >
                          Elle belge alanı ekle
                        </button>
                      </fieldset>
                    )}
                    <Field label="İrsaliye / belge numarası">
                      <input
                        name="documentNo"
                        maxLength={190}
                        defaultValue={values.documentNo ?? ""}
                      />
                    </Field>
                    <Field label="Belge tarihi">
                      <input
                        name="documentDate"
                        type="date"
                        defaultValue={values.documentDate ?? ""}
                      />
                    </Field>
                    <Field label="Evrakta düzenleyen firma">
                      <input
                        name="issuer"
                        maxLength={190}
                        defaultValue={values.issuer ?? ""}
                      />
                    </Field>
                    <Field label="Mevcut tedarikçi eşleştirmesi">
                      <select
                        name="supplierId"
                        defaultValue={values.supplierId ?? ""}
                      >
                        <option value="">Eşleştirilmedi</option>
                        {data.suppliers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {values.pages.map((p, i) => (
                      <div key={p.pageId}>
                        <Field label={i + 1 + ". görüntüdeki sayfa numarası"}>
                          <input
                            name={"pageNumber-" + p.pageId}
                            type="number"
                            min={1}
                            max={12}
                            defaultValue={p.number ?? ""}
                          />
                        </Field>
                        <Field label="Evrakta yazılı toplam sayfa">
                          <input
                            name={"pageTotal-" + p.pageId}
                            type="number"
                            min={1}
                            max={12}
                            defaultValue={p.total ?? ""}
                          />
                        </Field>
                      </div>
                    ))}
                    {values.lines.map(l => (
                      <fieldset
                        key={l.key}
                        style={{ minWidth: 0, gridColumn: "1 / -1" }}
                      >
                        <legend>{l.key} · Ürün ve ayrı hacimler</legend>
                        <div className="form-grid two">
                          <Field label="Ürün adı">
                            <input
                              name={"label-" + l.key}
                              required
                              maxLength={190}
                              defaultValue={l.label}
                            />
                          </Field>
                          <Field label="Belgedeki ürün kodu">
                            <input
                              name={"code-" + l.key}
                              maxLength={64}
                              defaultValue={l.productCode ?? ""}
                            />
                          </Field>
                          <Field label="Mevcut yakıt türü">
                            <select
                              name={"fuel-" + l.key}
                              defaultValue={l.fuelId ?? ""}
                            >
                              <option value="">Eşleştirilmedi</option>
                              {data.fuels.map(f => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Net hacim (L)">
                            <input
                              name={"net-" + l.key}
                              inputMode="decimal"
                              defaultValue={mlInput(l.netMl)}
                            />
                          </Field>
                          <Field label="Sevk miktarı (L)">
                            <input
                              name={"dispatch-" + l.key}
                              inputMode="decimal"
                              defaultValue={mlInput(l.dispatchMl)}
                            />
                          </Field>
                        </div>
                        <button
                          type="button"
                          className="btn"
                          disabled={disabled || sourceLocked}
                          onClick={() => {
                            setValues(v =>
                              v
                                ? {
                                    ...v,
                                    lines: v.lines.filter(
                                      row => row.key !== l.key
                                    ),
                                  }
                                : v
                            );
                            setDirty(true);
                          }}
                        >
                          Bu ürün satırını taslaktan çıkar
                        </button>
                      </fieldset>
                    ))}
                    <button
                      type="button"
                      className="btn"
                      disabled={disabled || values.lines.length >= 20}
                      onClick={() => {
                        const next =
                          Math.max(
                            0,
                            ...values.lines.map(
                              l => Number(l.key.replace("LINE-", "")) || 0
                            )
                          ) + 1;
                        setValues(v =>
                          v
                            ? {
                                ...v,
                                lines: [
                                  ...v.lines,
                                  {
                                    key: "LINE-" + next,
                                    label: "",
                                    productCode: null,
                                    fuelId: null,
                                    netMl: null,
                                    dispatchMl: null,
                                  },
                                ],
                              }
                            : v
                        );
                        setDirty(true);
                      }}
                    >
                      Ürün satırı ekle
                    </button>
                    <Field label="Evrak inceleme kararı">
                      <select name="tankerDecision" defaultValue="PENDING">
                        <option value="PENDING">Doğrulama bekliyor</option>
                        <option value="VERIFIED_DRAFT">
                          Evrak kaynağı doğrulandı (stok onayı değildir)
                        </option>
                        <option value="REJECTED">Reddedildi</option>
                      </select>
                    </Field>
                    <Field label="İnceleme açıklaması">
                      <textarea
                        name="tankerNote"
                        required
                        maxLength={1000}
                        defaultValue={data.latest?.note ?? ""}
                      />
                    </Field>
                    <Field label="İnceleme kanıtı">
                      <input
                        name="tankerEvidence"
                        required
                        maxLength={500}
                        defaultValue={data.latest?.evidence ?? ""}
                      />
                    </Field>
                    <label>
                      <input name="tankerConfirmed" type="checkbox" /> Bütün
                      sayfaları, ürünleri ve ayrı net/sevk hacimlerini kaynakla
                      kontrol ettim.
                    </label>
                    <button
                      className="btn primary"
                      disabled={disabled || !!conflict || sourceLocked}
                    >
                      Evrak taslağını kaydet
                    </button>
                    {sourceLocked && (
                      <Notice warning>
                        Bu evrağa bağlı bekleyen veya onaylı tanker kabulü var.
                        Kaynak taslağı değiştirilemez; bekleyen kabul önce
                        mevcut inceleme akışından sonuçlandırılmalıdır.
                      </Notice>
                    )}
                  </form>
                </div>
              </div>
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => {
                  setDirty(false);
                  setVersion(v => v + 1);
                }}
              >
                Güncel evrakı yükle (yerel düzenlemeyi bırak)
              </button>
              {tankerCompleteness(values).map(w => (
                <Notice key={w} warning>
                  {w}
                </Notice>
              ))}
              <p>
                Kaydedilmiş karar: {data.latest?.decision ?? "Henüz yok"} · Rev{" "}
                {data.latest?.revision ?? 0}. Ölçülen teslim litresi evraktan
                otomatik alınmaz.
              </p>
              {data.latest?.decision === "VERIFIED_DRAFT" &&
                !data.latest.values.documentFields && (
                  <Panel title="Mevcut tanker kabulüne onay talebi">
                    <form
                      className="business-form form-grid two"
                      onSubmit={receipt}
                      key={"receipt-" + version}
                    >
                      <Field label="Doğrulanmış ürün satırı">
                        <select
                          name="receiptLine"
                          required
                          value={lineKey}
                          onChange={e => {
                            setLineKey(e.target.value);
                            setTankId("");
                            setBasis("");
                            setReceived("");
                          }}
                        >
                          <option value="">Ürün seçin</option>
                          {data.latest.values.lines.map(l => (
                            <option key={l.key} value={l.key}>
                              {l.label} / {l.productCode}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Belge litresi esası">
                        <select
                          name="receiptBasis"
                          required
                          value={basis}
                          onChange={e => setBasis(e.target.value)}
                        >
                          <option value="">Esası açıkça seçin</option>
                          <option value="NET">Net hacim</option>
                          <option value="DISPATCH">Sevk miktarı</option>
                        </select>
                      </Field>
                      <p>
                        Net:{" "}
                        {selectedLine?.netMl == null
                          ? "Bilinmiyor"
                          : litres(selectedLine.netMl) + " L"}{" "}
                        · Sevk:{" "}
                        {selectedLine?.dispatchMl == null
                          ? "Bilinmiyor"
                          : litres(selectedLine.dispatchMl) + " L"}
                      </p>
                      <Field label="Aynı yakıt türündeki hedef tank">
                        <select
                          name="receiptTank"
                          required
                          value={tankId}
                          onChange={e => setTankId(e.target.value)}
                        >
                          <option value="">Tank seçin</option>
                          {data.tanks
                            .filter(t => t.fuelId === selectedLine?.fuelId)
                            .map(t => (
                              <option key={t.tankId} value={t.tankId}>
                                {t.number} / {t.fuel}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="İstasyonda ölçülen teslim litresi (L)">
                        <input
                          name="received"
                          required
                          inputMode="decimal"
                          value={received}
                          onChange={e => setReceived(e.target.value)}
                        />
                      </Field>
                      {deliveryError && (
                        <Notice warning>{deliveryError}</Notice>
                      )}
                      {deliveryPreview && (
                        <div
                          aria-live="polite"
                          className="tanker-delivery-preview"
                        >
                          <p>
                            Fark = fiziksel ölçüm − belge litresi. Eksi: eksik
                            teslim; artı: fazla teslim.
                          </p>
                          <p>
                            Net hacme göre fark:{" "}
                            {deliveryPreview.netDifferenceMl === null
                              ? "Bilinmiyor"
                              : litres(deliveryPreview.netDifferenceMl) + " L"}
                          </p>
                          <p>
                            Sevk miktarına göre fark:{" "}
                            {deliveryPreview.dispatchDifferenceMl === null
                              ? "Bilinmiyor"
                              : litres(deliveryPreview.dispatchDifferenceMl) +
                                " L"}
                          </p>
                          <p>
                            Seçilen esasa göre fark:{" "}
                            {deliveryPreview.selectedDifferenceMl === null
                              ? "Önce belge litresi esasını seçin"
                              : litres(deliveryPreview.selectedDifferenceMl) +
                                " L"}
                          </p>
                          <p>
                            Bu karşılaştırma ön izlemedir; tolerans uygunluğu
                            veya stok onayı değildir.
                          </p>
                        </div>
                      )}
                      <Field label="Kabul açıklaması / fark nedeni">
                        <input name="receiptNote" required maxLength={1000} />
                      </Field>
                      <Field label="Teslim ölçüm kanıtı">
                        <input
                          name="receiptEvidence"
                          required
                          maxLength={500}
                        />
                      </Field>
                      <button
                        className="btn primary"
                        disabled={
                          disabled ||
                          dirty ||
                          !!activeReceipt ||
                          !deliveryPreview ||
                          !!deliveryError ||
                          deliveryPreview.selectedDifferenceMl === null
                        }
                      >
                        Bağımsız onaya gönder (stok değişmez)
                      </button>
                    </form>
                    <p>
                      Bu aşamada ürün satırı tek tanka bütün olarak kabul
                      edilir. Bölünmüş/kısmi teslim otomatik oluşturulmaz. Onay
                      Tank ve yakıt stoku ekranındaki mevcut bağımsız akıştadır.
                    </p>
                  </Panel>
                )}
              {!!data.receipts.length && (
                <Panel title="Belgeye bağlı tanker kabul geçmişi">
                  <Notice>
                    Fark = fiziksel ölçüm − seçilen belge litresi. Bekleyen ve
                    reddedilen talepler stok girişi değildir. Bağımsız onay Tank
                    ve yakıt stoku ekranından yapılır.
                  </Notice>
                  {data.receipts.map(r => (
                    <details
                      key={r.requestId}
                      className="tanker-receipt-history"
                      open={r.status === "PENDING"}
                    >
                      <summary>
                        {r.productLabel} ·{" "}
                        {r.status === "PENDING"
                          ? "Bağımsız onay bekliyor"
                          : r.status === "APPROVED"
                            ? "Onaylandı"
                            : r.status === "REJECTED"
                              ? "Reddedildi"
                              : r.status}
                      </summary>
                      <p>
                        Belge: {r.documentNo ?? "Bilinmiyor"} · Kaynak
                        revizyonu: {r.sourceRevision} · Ürün kodu:{" "}
                        {r.productCode ?? "Bilinmiyor"}
                      </p>
                      <p>
                        Tank:{" "}
                        {data.tanks.find(t => t.tankId === r.tankId)?.number ??
                          "Tank kartı bulunamadı"}{" "}
                        · Esas:{" "}
                        {r.basis === "NET"
                          ? "Net hacim"
                          : r.basis === "DISPATCH"
                            ? "Sevk miktarı"
                            : "Doğrulama gerekli"}
                      </p>
                      <p>
                        Kaynak net:{" "}
                        {r.netMl === null
                          ? "Bilinmiyor"
                          : litres(r.netMl) + " L"}{" "}
                        · Kaynak sevk:{" "}
                        {r.dispatchMl === null
                          ? "Bilinmiyor"
                          : litres(r.dispatchMl) + " L"}
                      </p>
                      <p>
                        Seçilen belge litresi:{" "}
                        {r.documentMl === null
                          ? "Bilinmiyor"
                          : litres(r.documentMl) + " L"}{" "}
                        · Fiziksel ölçüm:{" "}
                        {r.measuredMl === null
                          ? "Bilinmiyor"
                          : litres(r.measuredMl) + " L"}
                      </p>
                      <p>
                        Kaydedilmiş teslim farkı:{" "}
                        {r.differenceMl === null
                          ? "Bilinmiyor"
                          : litres(r.differenceMl) + " L"}
                      </p>
                      <p>
                        Talep eden: {r.creatorName ?? "Bilinmiyor"} ·{" "}
                        {formatTurkeyInstant(r.createdAt)}
                      </p>
                      <p>
                        Açıklama: {r.note} · Kanıt: {r.evidence}
                      </p>
                      <p>
                        İnceleyen: {r.reviewerName ?? "Henüz yok"} · İnceleme
                        açıklaması: {r.reviewNote ?? "Henüz yok"} · İnceleme
                        kanıtı: {r.reviewEvidence ?? "Henüz yok"}
                      </p>
                    </details>
                  ))}
                </Panel>
              )}
              {data.history.map(h => (
                <details key={h.id}>
                  <summary>
                    Rev {h.revision} · {h.decision} · {h.reviewerName}
                  </summary>
                  <p>
                    {h.note} · Kanıt: {h.evidence}
                  </p>
                  {h.values.lines.map(l => (
                    <p key={l.key}>
                      {l.label} · Net{" "}
                      {l.netMl == null ? "Bilinmiyor" : litres(l.netMl)} L ·
                      Sevk{" "}
                      {l.dispatchMl == null
                        ? "Bilinmiyor"
                        : litres(l.dispatchMl)}{" "}
                      L
                    </p>
                  ))}
                  {h.values.documentFields?.fields.map((f, index) => (
                    <p key={index}>
                      {f.label}: {f.value ?? "Bilinmiyor"} {f.unit ?? ""}
                    </p>
                  ))}
                </details>
              ))}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
