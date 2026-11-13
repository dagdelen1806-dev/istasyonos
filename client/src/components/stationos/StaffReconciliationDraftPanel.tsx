import { useMemo, useState, type FormEvent } from "react";
import type { AppState } from "@shared/station";
import {
  buildStaffReconciliationReviewContract,
  createCorrectionDraft,
  isUsableFirstDeclarationSnapshot,
  reconciliationCategories,
  reconcileStaffShift,
  type CorrectionDraft,
  type MobileDeclaration,
  type ReconciliationCategory,
  type ReconciliationSource,
  type SourceRow,
} from "@shared/staff-reconciliation";
import { money, parseMoney } from "@shared/station";
import { Field, Notice, Panel } from "./Common";
import {
  hasCompleteOesseShiftReportEvidence,
  mappedOesseSaleForStaff,
  type OesseShiftReportDraft,
} from "@shared/oesse-shift-report";
import {
  safeDailySourceCellEntries,
  type DailyAccountDraft,
} from "@shared/daily-account-review";

type LiveSourcePanelProps = {
  state: AppState;
  stationId: string;
  packageId: string;
  automationDraft?: OesseShiftReportDraft | null;
  dailyAccountDraft?: DailyAccountDraft | null;
  dailyAccountSourceName?: string | null;
};

function istanbulLocalStamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function sumDeclaredCategory(
  rows: SourceRow[],
  category: ReconciliationCategory
) {
  const matches = rows.filter(row => row.category === category);
  if (!matches.length || matches.some(row => row.amountMinor === null))
    return null;
  const total = matches.reduce((sum, row) => sum + row.amountMinor!, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function LiveSourcePanel({
  state,
  stationId,
  packageId,
  automationDraft,
  dailyAccountDraft,
  dailyAccountSourceName,
  accountantId,
  role,
}: LiveSourcePanelProps & {
  accountantId: number;
  role: "OWNER" | "MANAGER" | "ACCOUNTANT";
}) {
  const accounts = state.accounts.filter(
      account =>
        account.stationId === stationId && account.businessUnit === "FUEL"
    ),
    [accountId, setAccountId] = useState(accounts[0]?.id ?? ""),
    [shiftScopeConfirmed, setShiftScopeConfirmed] = useState(false),
    [snapshotResponse, setSnapshotResponse] = useState<any>(null),
    [numericResponse, setNumericResponse] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [correctionDraft, setCorrectionDraft] = useState<CorrectionDraft | null>(
      null
    ),
    [dailyStaffMappings, setDailyStaffMappings] = useState<
      Record<string, number>
    >({}),
    [correctionField, setCorrectionField] = useState<
      "amountMinor" | "category" | "evidenceRef"
    >("amountMinor"),
    [correctionError, setCorrectionError] = useState("");
  const safeAutomationStaffRows = Array.isArray(automationDraft?.staffRows)
    ? automationDraft.staffRows.filter(row => row && typeof row === "object")
    : [];
  const automationEvidenceReady =
    hasCompleteOesseShiftReportEvidence(automationDraft);
  const safeDailyStaffRows = Array.isArray(dailyAccountDraft?.staffRows)
    ? dailyAccountDraft.staffRows.filter(
        row => !!row && typeof row === "object"
      )
    : [];
  const safeDailyPosRows = Array.isArray(dailyAccountDraft?.posRows)
    ? dailyAccountDraft.posRows.filter(row => !!row && typeof row === "object")
    : [];
  const safeDailyWarnings = Array.isArray(dailyAccountDraft?.warnings)
    ? dailyAccountDraft.warnings.filter(warning => typeof warning === "string")
    : [];
  const safeDailyBlankCategories = Array.isArray(
    dailyAccountDraft?.blankCategories
  )
    ? dailyAccountDraft.blankCategories.filter(
        category => typeof category === "string"
      )
    : [];
  const dailyTotals =
    dailyAccountDraft?.totals && typeof dailyAccountDraft.totals === "object"
      ? dailyAccountDraft.totals
      : null;
  const dailySourceSha =
    typeof dailyAccountDraft?.sourceSha256 === "string" &&
    dailyAccountDraft.sourceSha256.length > 0
      ? dailyAccountDraft.sourceSha256
      : "source-unavailable";
  const dailySheetName =
    typeof dailyAccountDraft?.sheetName === "string" &&
    dailyAccountDraft.sheetName.trim()
      ? dailyAccountDraft.sheetName
      : "Kaynak adı yok";
  const sourceCellAddresses = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const sourceCellReference = (row: unknown, field: string) => {
    if (!row || typeof row !== "object") return null;
    const addresses = sourceCellAddresses(
      (row as { sourceCells?: unknown }).sourceCells
    );
    const address = addresses[field];
    return typeof address === "string" && address.trim() ? address : null;
  };
  const displayDailyAmount = (value: unknown, sourceAddress: unknown) => {
    if (value === null || value === undefined) return "Boş / doğrulama gerekli";
    if (
      !Number.isSafeInteger(value) ||
      Number(value) < 0 ||
      typeof sourceAddress !== "string" ||
      !sourceAddress.trim()
    )
      return "İnceleme gerekli";
    return money(Number(value));
  };

  function proposeCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      snapshotResult?.state !== "FIRST_DECLARATION_AVAILABLE" ||
      !snapshotScopeMatches
    )
      return;
    const form = new FormData(event.currentTarget),
      entryId = String(form.get("entryId") ?? ""),
      rawValue = String(form.get("newValue") ?? ""),
      reason = String(form.get("reason") ?? "").trim(),
      evidenceRef = String(form.get("evidenceRef") ?? "").trim();
    try {
      setCorrectionError("");
      const newValue =
        correctionField === "amountMinor"
          ? parseMoney(rawValue)
          : correctionField === "category"
            ? (rawValue as ReconciliationCategory)
            : rawValue;
      setCorrectionDraft(
        createCorrectionDraft({
          declaration: snapshot as MobileDeclaration,
          prior: correctionDraft ?? undefined,
          accountantRole: role,
          correction: {
            entryId,
            field: correctionField,
            newValue,
            correctedBy: accountantId,
            createdAt: new Date().toISOString(),
            reason,
            evidenceRef,
          },
        })
      );
    } catch (cause) {
      setCorrectionError(
        cause instanceof Error ? cause.message : "Taslak oluşturulamadı."
      );
    }
  }

  async function readSources() {
    const account = accounts.find(item => item.id === accountId);
    if (!account || !packageId) return;
    if (account.stationId !== stationId) {
      setError("Hesap seçili istasyon kapsamıyla eşleşmiyor.");
      return;
    }
    const mappedSale = mappedOesseSaleForStaff(automationDraft, account.userId);
    const shift = state.shifts.find(item => item.id === account.shiftId);
    const shiftMatches =
      !!automationDraft &&
      !!shift &&
      (shift.id === automationDraft.shiftId ||
        shift.label.trim() === automationDraft.shiftId) &&
      istanbulLocalStamp(shift.startsAt) === automationDraft.startsAt &&
      istanbulLocalStamp(shift.endsAt) === automationDraft.endsAt;
    if (
      automationDraft &&
      (!mappedSale || !shiftScopeConfirmed || !shiftMatches)
    ) {
      setError(
        "ÖSSE eşlemesini ve rapordaki vardiya kimliği/zaman aralığının seçili hesapla aynı olduğunu doğrulayın."
      );
      return;
    }
    setError("");
    setLoading(true);
    setSnapshotResponse(null);
    setNumericResponse(null);
    setCorrectionDraft(null);
    setCorrectionError("");
    const snapshotQuery = new URLSearchParams({ accountId: account.id }),
      numericQuery = new URLSearchParams({
        stationId,
        packageId,
        shiftId: account.shiftId,
        staffUserId: String(account.userId),
      });
    const read = async (url: string) => {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "Kaynak okunamadı.");
      return payload;
    };
    const [snapshot, numeric] = await Promise.allSettled([
      read(`/api/stationos/account/declaration-snapshot?${snapshotQuery}`),
      read(`/api/stationos/daily-report/numeric?${numericQuery}`),
    ]);
    if (snapshot.status === "fulfilled") setSnapshotResponse(snapshot.value);
    if (numeric.status === "fulfilled") setNumericResponse(numeric.value);
    const failures = [snapshot, numeric]
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      )
      .map(result =>
        result.reason instanceof Error
          ? result.reason.message
          : "Kaynak okunamadı."
      );
    if (failures.length) setError(failures.join(" · "));
    setLoading(false);
  }

  const snapshotResult = snapshotResponse?.result,
    snapshot = snapshotResult?.snapshot,
    snapshotEnvelopeValid = isUsableFirstDeclarationSnapshot(snapshot),
    numeric = numericResponse,
    latest = numeric?.latest,
    staffRows = (latest?.rows ?? []).filter(
      (row: any) =>
        row.staffUserId === accounts.find(item => item.id === accountId)?.userId
    ),
    automationConfirmed =
      !!latest &&
      latest.decision === "VERIFIED_DRAFT" &&
      latest.sourceConfirmed === true &&
      latest.shiftConfirmed === true &&
      numeric?.stale === false &&
      numeric?.selectedShiftId ===
        accounts.find(item => item.id === accountId)?.shiftId,
    selectedAccount = accounts.find(item => item.id === accountId),
    selectedShift =
      selectedAccount &&
      state.shifts.find(item => item.id === selectedAccount.shiftId),
    mappedAutomationSale = mappedOesseSaleForStaff(
      automationDraft,
      selectedAccount?.userId
    ),
    automationShiftMatches =
      !!automationDraft &&
      !!selectedShift &&
      selectedAccount?.stationId === stationId &&
      (selectedShift.id === automationDraft.shiftId ||
        selectedShift.label.trim() === automationDraft.shiftId) &&
      istanbulLocalStamp(selectedShift.startsAt) === automationDraft.startsAt &&
      istanbulLocalStamp(selectedShift.endsAt) === automationDraft.endsAt,
    automationSalePreviewReady =
      automationEvidenceReady &&
      automationShiftMatches &&
      shiftScopeConfirmed &&
      mappedAutomationSale?.transactionCount != null &&
      mappedAutomationSale?.amountMinor !== null &&
      mappedAutomationSale?.amountMinor !== undefined,
    snapshotScopeMatches =
      snapshotEnvelopeValid &&
      !!selectedAccount &&
      !!selectedShift &&
      snapshot.scope?.tenantId === state.tenant?.id &&
      snapshot.scope?.stationId === selectedAccount.stationId &&
      snapshot.scope?.shiftId === selectedAccount.shiftId &&
      snapshot.scope?.staffUserId === selectedAccount.userId &&
      snapshot.scope?.businessDate ===
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Istanbul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(selectedShift.startsAt)),
    dailyStaffRowsForAccount =
      safeDailyStaffRows.filter(
        row =>
          dailyStaffMappings[`${dailySourceSha}:${row.sourceRow}`] ===
          selectedAccount?.userId
      ) ?? [],
    dailyStaffAmountForAccount =
      dailyStaffRowsForAccount.length &&
      dailyStaffRowsForAccount.every(
        row =>
          Number.isSafeInteger(row.declaredTotalMinor) &&
          (row.declaredTotalMinor ?? -1) >= 0 &&
          ["cash", "cardSlip", "fast", "iban", "debt"].every(field =>
            sourceCellReference(row, field)
          )
      )
        ? dailyStaffRowsForAccount.reduce(
            (sum, row) => sum + (row.declaredTotalMinor ?? 0),
            0
          )
        : null,
    shiftBusinessDate = selectedShift
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Istanbul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(selectedShift.startsAt))
      : null,
    reportScope =
      selectedAccount &&
      state.tenant?.id &&
      (numeric?.sourceDay ??
        (snapshotEnvelopeValid ? snapshot.scope.businessDate : null) ??
        shiftBusinessDate)
        ? {
            tenantId: state.tenant.id,
            stationId,
            businessDate:
              numeric?.sourceDay ??
              (snapshotEnvelopeValid ? snapshot.scope.businessDate : null) ??
              shiftBusinessDate!,
            shiftId: numeric?.selectedShiftId ?? selectedAccount.shiftId,
            staffUserId: selectedAccount.userId,
          }
        : null,
    automationCategory = (value: string): ReconciliationCategory | null => {
      if (value === "CASH") return "CASH";
      if (value === "CARD") return "CARD_SLIP";
      if (value === "IBAN") return "IBAN";
      if (value === "FAST") return "FAST";
      if (value === "DEBT") return "DEBT_SALE";
      if (value === "AR_COLLECTION") return "AR_COLLECTION";
      if (value === "TTS") return "TTS";
      if (
        [
          "GIFT_LOAD",
          "GIFT_USE",
          "PARTNER",
          "TTS_GIFT_COMBINED",
          "OTHER",
        ].includes(value)
      )
        return "SPECIAL";
      return null;
    },
    automationRows = staffRows.flatMap((row: any, index: number) => {
      if (row.kind !== "STAFF_TENDER" || row.amountMinor == null) return [];
      const category = automationCategory(String(row.category));
      return category
        ? [
            {
              id: `automation-${row.pageId ?? index}-${index}`,
              category,
              amountMinor: row.amountMinor,
              transactionCount: row.transactionCount ?? null,
              evidenceRef: row.sourceLocation ?? row.pageId ?? null,
              bankConfirmation: ["CARD_SLIP", "IBAN", "FAST"].includes(category)
                ? ("PENDING" as const)
                : ("NOT_APPLICABLE" as const),
            },
          ]
        : [];
    }),
    reviewContract =
      snapshotResult && reportScope
        ? buildStaffReconciliationReviewContract({
            scope: reportScope,
            firstDeclaration:
              snapshotResult.state === "FIRST_DECLARATION_UNKNOWN" ||
              !snapshotEnvelopeValid ||
              !snapshotScopeMatches
                ? { state: "FIRST_DECLARATION_UNKNOWN" }
                : {
                    state: "FIRST_DECLARATION_AVAILABLE",
                    snapshot: snapshot as MobileDeclaration,
                  },
            automation:
              reportScope && numeric
                ? {
                    sourceKind: "AUTOMATION_REPORT",
                    scope: reportScope,
                    verified: automationConfirmed,
                    rows: automationRows,
                  }
                : null,
            shiftClose: null,
          })
        : null;

  return (
    <Panel
      title="Muhasebe kaynakları · salt okunur"
      subtitle="Sunucu her istekte rol, tenant ve istasyon kapsamını yeniden denetler. Bu görünüm kayıt veya düzeltme göndermez."
    >
      <div className="form-grid two">
        <Field label="Personel vardiya hesabı">
          <select
            value={accountId}
            onChange={event => {
              setAccountId(event.target.value);
              setShiftScopeConfirmed(false);
              setSnapshotResponse(null);
              setNumericResponse(null);
              setCorrectionDraft(null);
              setCorrectionError("");
            }}
          >
            {accounts.map(account => {
              const shift = state.shifts.find(
                item => item.id === account.shiftId
              );
              return (
                <option key={account.id} value={account.id}>
                  {account.userName} · {shift?.label ?? account.shiftId} ·{" "}
                  {account.status}
                </option>
              );
            })}
          </select>
        </Field>
        <div>
          <button
            className="btn"
            type="button"
            disabled={loading || !selectedAccount || !packageId}
            onClick={() => void readSources()}
          >
            {loading ? "Kaynaklar okunuyor…" : "Yetkili kaynakları oku"}
          </button>
          {!packageId && <small>Önce otomasyon rapor paketini seçin.</small>}
        </div>
      </div>
      {automationDraft && (
        <section aria-label="Otomasyon ÖSSE satış satırı">
          <h3>Otomasyon vardiya satış raporu · geçici taslak</h3>
          <Notice warning>
            Kaynak: {automationDraft.shiftId ?? "vardiya kimliği belirsiz"} ·{" "}
            {automationDraft.startsAt ?? "başlangıç belirsiz"} →{" "}
            {automationDraft.endsAt ?? "bitiş belirsiz"}. Bu otomasyon raporu
            bağımsız gün sonu değildir. Kaynak doğrulanana kadar satış tutarları
            öneridir. Vardiya kaynak alanları: kimlik{" "}
            {automationDraft.metadataSourceFields?.shiftId ?? "kaynak yok"},
            başlangıç{" "}
            {automationDraft.metadataSourceFields?.startsAt ?? "kaynak yok"},
            bitiş {automationDraft.metadataSourceFields?.endsAt ?? "kaynak yok"}
            .
          </Notice>
          <p>
            Seçili hesap: {selectedAccount?.userName ?? "seçilmedi"} · eşleşen
            satış satırı:{" "}
            {mappedAutomationSale
              ? automationEvidenceReady
                ? `${mappedAutomationSale.transactionCount} işlem / ${money(mappedAutomationSale.amountMinor)}`
                : "İnceleme gerekli · doğrulanmamış işlem sayısı"
              : "bu kullanıcıya eşlenmemiş"}{" "}
            · vardiya kimliği ve aralık:{" "}
            {automationShiftMatches ? "eşleşti" : "eşleşmedi/doğrulanamadı"}
          </p>
          <div
            className="pompaci-summary-grid"
            aria-label="ÖSSE satış toplamı ön incelemesi"
          >
            <div>
              <span>İlk beyan kontrol toplamı</span>
              <b>
                {!snapshotScopeMatches ||
                snapshot?.declaredTotals?.sourceSalesMinor == null
                  ? "İlk snapshot yok / alan eksik"
                  : money(snapshot.declaredTotals.sourceSalesMinor)}
              </b>
            </div>
            <div>
              <span>Otomasyon personel satış toplamı</span>
              <b>
                {!automationSalePreviewReady
                  ? "Doğrulanmış kapsam yok"
                  : money(mappedAutomationSale.amountMinor)}
              </b>
            </div>
            <div>
              <span>Satış / beyan ön inceleme farkı</span>
              <b>
                {!automationSalePreviewReady ||
                !snapshotScopeMatches ||
                snapshot?.declaredTotals?.sourceSalesMinor == null ||
                mappedAutomationSale?.amountMinor == null
                  ? "Hesaplanmadı"
                  : money(
                      mappedAutomationSale.amountMinor -
                        snapshot.declaredTotals.sourceSalesMinor
                    )}
              </b>
            </div>
          </div>
          <Notice warning>
            Bu yalnız geçici eşleme ve vardiya kapsamı kullanıcı tarafından
            doğrulandığında hesaplanan ön incelemedir. Otomasyon belgesi ayrı
            bağımsız gün sonu kanıtı değildir; kesin mutabakat veya mali kayıt
            oluşturmaz. Ödeme türü beyanları satış toplamından ayrı incelenir.
          </Notice>
          <details>
            <summary>Otomasyon raporu kaynak satırları ve hücre kanıtı</summary>
            <ul>
              {safeAutomationStaffRows.map((row: any, index) => (
                <li key={row.sourceLocation + "-" + index}>
                  {row.sourceLocation} · {row.nameSuggestion} · işlem:{" "}
                  {row.sourceFields?.transactionCount ??
                    "doğrulanmamış işlem sayısı"}{" "}
                  · tutar: {row.sourceFields?.amount ?? "kaynak yok"}
                </li>
              ))}
              {automationDraft.reportedStaffTotal && (
                <li>
                  POMPACI toplamı ·{" "}
                  {automationDraft.reportedStaffTotal.sourceLocation} · işlem:{" "}
                  {automationDraft.reportedStaffTotal.sourceFields
                    ?.transactionCount ?? "doğrulanmamış işlem sayısı"}{" "}
                  · tutar:{" "}
                  {automationDraft.reportedStaffTotal.sourceFields?.amount ??
                    "kaynak yok"}
                </li>
              )}
            </ul>
          </details>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kaynak</th>
                  <th>Durum</th>
                  <th>Ön inceleme</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>ÖSSE ilk beyan snapshot'ı</td>
                  <td>
                    {!snapshotResponse
                      ? "OKUNMADI"
                      : snapshotResult?.state === "FIRST_DECLARATION_UNKNOWN"
                        ? "FIRST_DECLARATION_UNKNOWN"
                        : snapshotEnvelopeValid && snapshotScopeMatches
                          ? "AVAILABLE"
                          : "FIRST_DECLARATION_REVIEW_REQUIRED"}
                  </td>
                  <td>
                    {snapshotEnvelopeValid && snapshotScopeMatches
                      ? "Salt okunur GET"
                      : "İlk beyan bulunamadı veya okunmadı"}
                  </td>
                </tr>
                <tr>
                  <td>Otomasyon vardiya satışı</td>
                  <td>{automationDraft ? "UNVERIFIED" : "MISSING"}</td>
                  <td>
                    {automationDraft?.status ?? "Rapor taslağı seçilmedi"}
                  </td>
                </tr>
                <tr>
                  <td>Bağımsız vardiya/gün sonu</td>
                  <td>MISSING</td>
                  <td>Aynı otomasyon raporu ikinci kaynak sayılmıyor</td>
                </tr>
                <tr>
                  <td>Kesin üç kaynaklı mutabakat</td>
                  <td>
                    {snapshotResult?.state === "FIRST_DECLARATION_UNKNOWN" ||
                    !snapshotEnvelopeValid ||
                    !snapshotScopeMatches
                      ? "FIRST_DECLARATION_UNKNOWN"
                      : "SOURCE_PENDING"}
                  </td>
                  <td>Kesin fark ve personel borcu üretilmedi</td>
                </tr>
              </tbody>
            </table>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={shiftScopeConfirmed}
              onChange={event => setShiftScopeConfirmed(event.target.checked)}
            />
            Rapor vardiya kimliği ve başlangıç/bitiş zamanını seçili
            istasyon/personel hesabıyla karşılaştırdım.
          </label>
          <p>
            ÖSSE adları yalnız öneridir; seçili kalıcı kullanıcı kimliği ve
            sunucunun snapshot GET kapsamı esas alınır. Mobil beyan ödeme
            türleri aşağıda ayrı gösterilir; satış ile tahsilat arasında
            otomatik fark/borç hesaplanmaz.
          </p>
        </section>
      )}
      {dailyAccountDraft && (
        <section aria-label="Excel günlük hesap karşılaştırma taslağı">
          <h3>Excel günlük hesap · geçici kaynak taslağı</h3>
          <p>
            Kaynak: {dailyAccountSourceName ?? "dosya adı yok"} · SHA-256{" "}
            {dailySourceSha === "source-unavailable"
              ? "kaynak özeti yok"
              : dailySourceSha.slice(0, 12) + "…"}{" "}
            · sayfa {dailySheetName}
          </p>
          <Notice warning>
            {dailySheetName} · başlık tarihi:{" "}
            {dailyAccountDraft.headerDateRaw ?? "bulunamadı"} ·{" "}
            {dailyAccountDraft.dateStatus ?? "kaynak durumu bilinmiyor"}. Formül
            hücreleri kullanılmadı; görünen kaynak sayısal hücreleri kuruş
            cinsinden yeniden toplandı. Bu belge muhasebe kaydı veya bağımsız
            banka teyidi değildir. Tarih kaynağı hücresi:{" "}
            {dailyAccountDraft.headerDateLocation ?? "belirsiz"}.
          </Notice>
          {!dailyTotals && (
            <Notice warning>
              Günlük hesap toplam alanları eksik. Kesin toplam veya fark
              gösterilmiyor.
            </Notice>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kaynak</th>
                  <th>Nakit</th>
                  <th>KK-Slip</th>
                  <th>FAST</th>
                  <th>EFT/IBAN</th>
                  <th>Borç/Cari</th>
                  <th>Beyan toplamı</th>
                  <th>Otomasyon satışı</th>
                  <th>Hesap farkı</th>
                  <th>POS gün sonu</th>
                  <th>POS farkı</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Excel · {dailySheetName}</th>
                  <td>{money(dailyTotals?.cashMinor)}</td>
                  <td>{money(dailyTotals?.cardSlipMinor)}</td>
                  <td>
                    {money(dailyTotals?.fastMinor)}
                    {safeDailyBlankCategories.includes("FAST")
                      ? " · boş, teyit gerekli"
                      : ""}
                  </td>
                  <td>{money(dailyTotals?.ibanMinor)}</td>
                  <td>{money(dailyTotals?.debtMinor)}</td>
                  <td>{money(dailyTotals?.declaredTotalMinor)}</td>
                  <td>{money(dailyTotals?.automationMinor)}</td>
                  <td>{money(dailyTotals?.declarationVarianceMinor)}</td>
                  <td>{money(dailyTotals?.posDayEndMinor)}</td>
                  <td>
                    {money(dailyTotals?.posDayEndVarianceMinor)} · POS gün sonu
                    − KK-Slip
                  </td>
                </tr>
                {snapshotEnvelopeValid && snapshotScopeMatches && (
                  <tr>
                    <th>ÖSSE ilk mobil beyanı · salt okunur</th>
                    {(
                      [
                        "CASH",
                        "CARD_SLIP",
                        "FAST",
                        "IBAN",
                        "DEBT_SALE",
                      ] as const
                    ).map(category => (
                      <td key={category}>
                        {money(sumDeclaredCategory(snapshot.rows, category))}
                      </td>
                    ))}
                    <td>
                      {money(
                        snapshot.rows.reduce(
                          (sum: number, row: SourceRow) =>
                            sum + (row.amountMinor ?? 0),
                          0
                        )
                      )}
                    </td>
                    <td colSpan={4}>Banka teyidi değildir</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {automationDraft && (
            <p>
              Otomasyon vardiya satışı:{" "}
              {automationEvidenceReady
                ? money(automationDraft.reportedStaffTotal?.amountMinor)
                : "İnceleme gerekli"}{" "}
              · satış adedi{" "}
              {automationEvidenceReady
                ? automationDraft.reportedStaffTotal?.transactionCount
                : "Doğrulanmamış işlem sayısı"}
              . TTS/Gift Card toplamları personel satışlarına eklenmedi.
            </p>
          )}
          <h4>Excel personel satırları · kalıcı kullanıcı eşlemesi zorunlu</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Satır / ad önerisi</th>
                  <th>Kalıcı FUEL_STAFF kimliği</th>
                  <th>Nakit</th>
                  <th>KK-Slip</th>
                  <th>FAST</th>
                  <th>EFT/IBAN</th>
                  <th>Cari</th>
                  <th>Excel satır toplamı</th>
                  <th>Otomasyon</th>
                </tr>
              </thead>
              <tbody>
                {safeDailyStaffRows.map(row => {
                  const key = `${dailySourceSha}:${row.sourceRow}`;
                  const sourceCells = sourceCellAddresses(row.sourceCells);
                  return (
                    <tr key={key}>
                      <td>
                        {row.sourceLocation} · {row.nameSuggestion ?? "boş ad"}
                        {row.duplicateName ? " · yinelenen ad" : ""}
                        <details>
                          <summary>Kaynak hücre kanıtı</summary>
                          <small>
                            {safeDailySourceCellEntries(sourceCells)
                              .map(([field, address]) => `${field}: ${address}`)
                              .join(" · ") || "Hücre adresi yok"}
                          </small>
                        </details>
                      </td>
                      <td>
                        <select
                          aria-label={`${row.sourceLocation} personel kimliği`}
                          value={dailyStaffMappings[key] ?? ""}
                          onChange={event =>
                            setDailyStaffMappings(current => ({
                              ...current,
                              [key]: Number(event.target.value) || 0,
                            }))
                          }
                        >
                          <option value="">Eşleme seçin</option>
                          {state.members
                            .filter(
                              member =>
                                member.role === "FUEL_STAFF" &&
                                member.stationIds.includes(stationId) &&
                                member.stationAccess?.[stationId] !== "INACTIVE"
                            )
                            .map(member => (
                              <option key={member.userId} value={member.userId}>
                                {member.name} · ID {member.userId}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>
                        {displayDailyAmount(
                          row.cashMinor,
                          sourceCellReference(row, "cash")
                        )}
                      </td>
                      <td>
                        {displayDailyAmount(
                          row.cardSlipMinor,
                          sourceCellReference(row, "cardSlip")
                        )}
                      </td>
                      <td>
                        {displayDailyAmount(
                          row.fastMinor,
                          sourceCellReference(row, "fast")
                        )}
                      </td>
                      <td>
                        {displayDailyAmount(
                          row.ibanMinor,
                          sourceCellReference(row, "iban")
                        )}
                      </td>
                      <td>
                        {displayDailyAmount(
                          row.debtMinor,
                          sourceCellReference(row, "debt")
                        )}
                      </td>
                      <td>
                        {dailyStaffRowsForAccount.includes(row) &&
                        dailyStaffAmountForAccount !== null
                          ? money(row.declaredTotalMinor)
                          : displayDailyAmount(
                              row.declaredTotalMinor,
                              [
                                "cash",
                                "cardSlip",
                                "fast",
                                "iban",
                                "debt",
                              ].every(field => sourceCellReference(row, field))
                                ? "source-cells"
                                : null
                            )}
                      </td>
                      <td>
                        {displayDailyAmount(
                          row.automationMinor,
                          sourceCellReference(row, "automation")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selectedAccount && (
            <p>
              Seçili hesap #{selectedAccount.userId}: açıkça eşlenen Excel
              satırları{" "}
              {dailyStaffRowsForAccount.length
                ? money(dailyStaffAmountForAccount)
                : "yok"}
              ; otomasyon satırı{" "}
              {mappedAutomationSale
                ? money(mappedAutomationSale.amountMinor)
                : "eşlenmedi"}
              . Eşleme bu ekranda geçicidir ve tarih/vardiya uyumu doğrulanana
              kadar fark kesinleştirilmez.
            </p>
          )}
          <p>
            POS 23:00 öncesi: {money(dailyTotals?.posBefore23Minor)} · 23:00
            sonrası: {money(dailyTotals?.posAfter23Minor)} · zaman sınıfı
            belirsiz: {money(dailyTotals?.posTimeUnknownMinor)}.
          </p>
          {safeDailyPosRows.length > 0 && (
            <details>
              <summary>POS satırlarının Excel hücre kanıtı</summary>
              <ul>
                {safeDailyPosRows.map(row => (
                  <li key={dailySourceSha + "-" + row.sourceRow}>
                    {row.sourceLocation ?? "Kaynak satırı yok"} · tutar:{" "}
                    {sourceCellReference(row, "amount") ?? "kaynak yok"} ·
                    dönem: {sourceCellReference(row, "period") ?? "kaynak yok"}{" "}
                    · personel:{" "}
                    {sourceCellReference(row, "staff") ?? "kaynak yok"}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {safeDailyWarnings.map((warning, index) => (
            <Notice key={`${index}-${warning}`} warning>
              {warning}
            </Notice>
          ))}
          <Notice warning>
            FAST ve EFT/IBAN beyanları banka teyidi sayılmaz. POS eşlemesi için
            işlem günü, terminal, banka ve gün sonu kapsamı doğrulanmalı; hesap
            farkı tek başına personel borcu veya maaş kesintisi oluşturmaz.
          </Notice>
        </section>
      )}
      {error && <Notice warning>{error}</Notice>}
      {snapshotResult && (
        <section aria-label="İlk ÖSSE beyanı">
          <h3>İlk ÖSSE beyanı</h3>
          {snapshotResult.state === "FIRST_DECLARATION_UNKNOWN" ||
          !snapshotEnvelopeValid ||
          !snapshotScopeMatches ? (
            <Notice warning>
              {snapshotResult.state === "FIRST_DECLARATION_UNKNOWN"
                ? "FIRST_DECLARATION_UNKNOWN"
                : "FIRST_DECLARATION_REVIEW_REQUIRED"}{" "}
              · İlk beyan snapshot'ı eksik, eski veya hesap kapsamıyla
              eşleşmiyor. Güncel tutarlar ilk beyan olarak kullanılmadı.
            </Notice>
          ) : (
            <>
              <Notice>
                Snapshot salt okunur ·{" "}
                {snapshot?.submittedAt ?? "teslim zamanı yok"} · hesap #
                {snapshot?.accountId}
              </Notice>
              <ul>
                {(snapshot?.rows ?? []).map((row: any) => (
                  <li key={row.id}>
                    {row.category} · {money(row.amountMinor)} ·{" "}
                    {row.bankConfirmation === "PENDING"
                      ? "banka teyidi bekliyor"
                      : "beyan"}
                  </li>
                ))}
              </ul>
              {automationDraft && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Kaynak</th>
                        <th>Tür / satır</th>
                        <th>İşlem</th>
                        <th>Tutar</th>
                        <th>Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Otomasyon vardiya satışı</td>
                        <td>
                          {mappedAutomationSale?.nameSuggestion ??
                            "Eşleşme yok"}
                        </td>
                        <td>
                          {automationEvidenceReady
                            ? mappedAutomationSale?.transactionCount
                            : "Doğrulanmamış işlem sayısı"}
                        </td>
                        <td>
                          {!automationEvidenceReady ||
                          mappedAutomationSale?.amountMinor == null
                            ? "İnceleme gerekli"
                            : money(mappedAutomationSale.amountMinor)}
                        </td>
                        <td>
                          {automationDraft.status}; öneri, kaynak doğrulaması
                          bekliyor
                        </td>
                      </tr>
                      {(snapshot?.rows ?? []).map((row: any) => (
                        <tr key={row.id}>
                          <td>İlk mobil beyan</td>
                          <td>{row.category}</td>
                          <td>—</td>
                          <td>{money(row.amountMinor)}</td>
                          <td>
                            {row.bankConfirmation === "PENDING"
                              ? "banka teyidi bekliyor"
                              : "beyan snapshot'ı"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Notice warning>
                    Otomasyon satış toplamı ile mobil ödeme beyanları farklı
                    kaynak türleridir. İş kuralları ve bağımsız gün sonu kaynağı
                    doğrulanmadan aralarındaki fark kesinleştirilmez.
                  </Notice>
                </div>
              )}
              <Notice warning>
                Muhasebe düzeltmesi yalnız geçici taslaktır. İlk beyan değişmez;
                bağımsız gün sonu kaynağı olmadan fark veya nihai onay
                üretilmez.
              </Notice>
              <form className="form-grid two" onSubmit={proposeCorrection}>
                <Field label="İlk beyan satırı">
                  <select
                    name="entryId"
                    defaultValue={snapshot?.rows?.[0]?.id ?? ""}
                  >
                    {(snapshot?.rows ?? []).map((row: any) => (
                      <option key={row.id} value={row.id}>
                        {row.category} · {money(row.amountMinor)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Düzeltme türü">
                  <select
                    value={correctionField}
                    onChange={event =>
                      setCorrectionField(
                        event.target.value as typeof correctionField
                      )
                    }
                  >
                    <option value="amountMinor">Tutar</option>
                    <option value="category">Ödeme türü</option>
                    <option value="evidenceRef">Slip / kanıt referansı</option>
                  </select>
                </Field>
                <Field label="Önerilen değer">
                  {correctionField === "category" ? (
                    <select name="newValue" defaultValue="CASH">
                      {reconciliationCategories.map(category => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name="newValue"
                      required
                      defaultValue={
                        correctionField === "amountMinor"
                          ? "0,00"
                          : "evidence-reference"
                      }
                    />
                  )}
                </Field>
                <Field label="Gerekçe">
                  <input name="reason" required maxLength={1000} />
                </Field>
                <Field label="Kanıt referansı">
                  <input name="evidenceRef" required maxLength={500} />
                </Field>
                <button className="btn" type="submit">
                  Geçici düzeltme taslağı hazırla
                </button>
              </form>
              {correctionError && <Notice warning>{correctionError}</Notice>}
              {correctionDraft && (
                <div>
                  <h4>Düzeltme taslağı · kalıcı değil</h4>
                  <p>
                    İlk beyan:{" "}
                    {money(
                      correctionDraft.original.rows.find(
                        row =>
                          row.id === correctionDraft.corrections[0]?.entryId
                      )?.amountMinor
                    )}{" "}
                    · Önerilen:{" "}
                    {money(
                      correctionDraft.correctedRows.find(
                        row =>
                          row.id === correctionDraft.corrections.at(-1)?.entryId
                      )?.amountMinor
                    )}
                  </p>
                  <ul>
                    {correctionDraft.corrections.map(item => (
                      <li key={item.revision}>
                        Rev. {item.revision}:{" "}
                        {String(item.previousValue ?? "—")} →{" "}
                        {String(item.newValue ?? "—")} · {item.reason} · kanıt{" "}
                        {item.evidenceRef}
                      </li>
                    ))}
                  </ul>
                  <h4>Mobil beyan kategori özeti · düzeltme sonrası taslak</h4>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Ödeme / işlem türü</th>
                          <th>İlk beyan</th>
                          <th>Düzeltilmiş taslak</th>
                          <th>Taslak değişimi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconciliationCategories.map(category => {
                          const before = sumDeclaredCategory(
                            correctionDraft.original.rows,
                            category
                          );
                          const after = sumDeclaredCategory(
                            correctionDraft.correctedRows,
                            category
                          );
                          return (
                            <tr key={category}>
                              <th>{category}</th>
                              <td>{before === null ? "—" : money(before)}</td>
                              <td>{after === null ? "—" : money(after)}</td>
                              <td>
                                {before === null || after === null
                                  ? "—"
                                  : money(after - before)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Notice warning>
                    Bu tablo yalnız ilk beyan ile geçici düzeltme taslağını
                    yeniden toplar. Bağımsız gün sonu kaynağı olmadığı için
                    otomasyonla kalan kesin fark hesaplanmıyor; ilk snapshot
                    değiştirilmiyor.
                  </Notice>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {numeric && (
        <section aria-label="Otomasyon raporu">
          <h3>Otomasyon raporu</h3>
          <Notice warning>
            {automationConfirmed
              ? "Kaynak ve vardiya eşleşmesi kullanıcı tarafından doğrulanmış taslak. Bu, banka teyidi veya mali kayıt değildir."
              : "Otomasyon kaynağı eksik, eski veya doğrulanmamış; kesin fark hesaplanmadı."}
          </Notice>
          {staffRows.length ? (
            <ul>
              {staffRows.map((row: any, index: number) => (
                <li key={`${row.pageId ?? "row"}-${index}`}>
                  {row.kind} · {row.label} ·{" "}
                  {row.amountMinor == null
                    ? "tutar eksik"
                    : money(row.amountMinor)}
                  {row.volumeMl == null
                    ? ""
                    : ` · ${(row.volumeMl / 1000).toLocaleString("tr-TR")} L`}
                  {row.transactionCount == null
                    ? ""
                    : ` · ${row.transactionCount} işlem`}
                  {row.sourceLocation ? ` · ${row.sourceLocation}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Bu vardiya/personel için doğrulanmış otomasyon satırı bulunamadı.
            </p>
          )}
          {reviewContract && (
            <p>
              Üç kaynaklı inceleme sözleşmesi:{" "}
              <strong>{reviewContract.state}</strong> · vardiya/gün sonu kaynağı
              olmadan fark kesinleştirilmez.
            </p>
          )}
        </section>
      )}
      {selectedAccount && (
        <section aria-label="Vardiya kapanış kaynağı">
          <h3>Vardiya / gün sonu</h3>
          <Notice warning>
            Bu hesap durumu: {selectedAccount.status}. Bağımsız, personel ve
            vardiya kapsamıyla doğrulanmış gün sonu raporu kaynağı
            bulunmadığından karşılaştırma beklemede.
          </Notice>
        </section>
      )}
    </Panel>
  );
}

const scope = {
  tenantId: "synthetic-tenant",
  stationId: "synthetic-station",
  businessDate: "2026-11-09",
  shiftId: "synthetic-shift",
  staffUserId: 700001,
};
const fixtureRows: SourceRow[] = [
  ["CASH", 125000, "NOT_APPLICABLE"],
  ["CARD_SLIP", 84000, "PENDING"],
  ["IBAN", 19000, "PENDING"],
  ["FAST", 22000, "PENDING"],
  ["DEBT_SALE", 11000, "NOT_APPLICABLE"],
  ["AR_COLLECTION", 4000, "NOT_APPLICABLE"],
  ["TTS", 15000, "NOT_APPLICABLE"],
  ["SPECIAL", 3000, "NOT_APPLICABLE"],
].map(([category, amountMinor, bankConfirmation], index) => ({
  id: `fixture-${index}`,
  category: category as SourceRow["category"],
  amountMinor: amountMinor as number,
  evidenceRef: category === "CARD_SLIP" ? null : `synthetic-evidence-${index}`,
  bankConfirmation: bankConfirmation as SourceRow["bankConfirmation"],
}));
const mobile: MobileDeclaration = {
  sourceKind: "MOBILE_DECLARATION",
  scope,
  verified: true,
  rows: fixtureRows.map(row => ({ ...row })),
  declarationId: "synthetic-declaration-01",
  revision: 1,
  submittedAt: "2026-11-09T15:00:00.000Z",
};
function reportSource<T extends "AUTOMATION_REPORT" | "SHIFT_CLOSE_REPORT">(
  sourceKind: T,
  modifier: number
): ReconciliationSource & { sourceKind: T } {
  return {
    sourceKind,
    scope: { ...scope },
    verified: true,
    rows: fixtureRows.map((row, index) => ({
      ...row,
      id: `${sourceKind}-${index}`,
      amountMinor: row.amountMinor! + (index === 0 ? modifier : 0),
    })),
  };
}
const automation = reportSource("AUTOMATION_REPORT", -500),
  shiftClose = reportSource("SHIFT_CLOSE_REPORT", -200);
const categoryLabel: Record<SourceRow["category"], string> = {
  CASH: "Nakit",
  CARD_SLIP: "Kart / slip",
  IBAN: "Havale / IBAN",
  FAST: "FAST",
  DEBT_SALE: "Cari satış",
  AR_COLLECTION: "Cari tahsilat",
  TTS: "TTS",
  SPECIAL: "Özel işlem",
};

export function StaffReconciliationDraftPanel({
  accountantId,
  role,
  liveSources,
}: {
  accountantId: number;
  role: "OWNER" | "MANAGER" | "ACCOUNTANT";
  liveSources?: LiveSourcePanelProps;
}) {
  const [draft, setDraft] = useState<CorrectionDraft | null>(null),
    [snapshotUnknown, setSnapshotUnknown] = useState(false),
    [error, setError] = useState(""),
    [correctionField, setCorrectionField] = useState<
      "amountMinor" | "category" | "evidenceRef"
    >("amountMinor");
  const before = useMemo(
      () => reconcileStaffShift({ mobile, automation, shiftClose }),
      []
    ),
    after = useMemo(
      () =>
        reconcileStaffShift({
          mobile: draft ? { ...mobile, rows: draft.correctedRows } : mobile,
          automation,
          shiftClose,
        }),
      [draft]
    );

  function correct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget),
      entryId = String(data.get("entryId")),
      rawValue = String(data.get("newValue") ?? ""),
      reason = String(data.get("reason") ?? "").trim(),
      evidenceRef = String(data.get("evidenceRef") ?? "").trim();
    try {
      setError("");
      const newValue =
        correctionField === "amountMinor" ? parseMoney(rawValue) : rawValue;
      setDraft(
        createCorrectionDraft({
          declaration: mobile,
          prior: draft ?? undefined,
          accountantRole: role,
          correction: {
            entryId,
            field: correctionField,
            newValue,
            correctedBy: accountantId,
            createdAt: new Date().toISOString(),
            reason,
            evidenceRef,
          },
        })
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Taslak oluşturulamadı."
      );
    }
  }

  return (
    <>
      {liveSources && (
        <LiveSourcePanel
          {...liveSources}
          accountantId={accountantId}
          role={role}
        />
      )}
      <Panel
        title="ÖSSE muhasebe mutabakatı · SENTETİK TASLAK"
        subtitle="Yalnız kurgu verisi. Değişiklikler geçicidir; API'ye, veritabanına veya mali deftere gönderilmez."
      >
        <button
          className="btn"
          type="button"
          onClick={() => {
            setSnapshotUnknown(value => !value);
            setDraft(null);
          }}
        >
          {snapshotUnknown
            ? "Sentetik snapshot örneğini göster"
            : "Snapshot eksik senaryosunu göster"}
        </button>
        {snapshotUnknown ? (
          <Notice warning>
            FIRST_DECLARATION_UNKNOWN · Bu sentetik hesap için teslim anı
            snapshot'ı yok. Güncel hesap toplamları ilk beyan olarak
            kullanılmaz; kaynak tutarlar ve düzeltme formu gösterilmez. Önce
            teslim anı kanıtı sağlanmalıdır.
          </Notice>
        ) : (
          <>
            <Notice warning>
              İlk mobil beyan salt okunur. Buradaki örnek, gerçek hesap veya
              doğrulanmış istasyon raporu değildir. FAST, havale ve kart banka
              teyidi bekleyen beyan olarak kalır.
            </Notice>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kaynak kategori</th>
                    <th>İlk ÖSSE beyanı</th>
                    <th>Otomasyon</th>
                    <th>Vardiya / gün sonu</th>
                    <th>İlk fark</th>
                    <th>Taslak sonrası fark</th>
                  </tr>
                </thead>
                <tbody>
                  {before.cells.map(cell => {
                    const updated = after.cells.find(
                      candidate => candidate.category === cell.category
                    )!;
                    return (
                      <tr key={cell.category}>
                        <th>{categoryLabel[cell.category]}</th>
                        <td>{money(cell.mobileMinor)}</td>
                        <td>{money(cell.automationMinor)}</td>
                        <td>{money(cell.closeMinor)}</td>
                        <td>{money(cell.mobileMinusAutomationMinor)}</td>
                        <td>{money(updated.mobileMinusAutomationMinor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              Durum: <strong>{before.status} · DRAFT_REVIEW_REQUIRED</strong>.
              Kaynak kapsamı sentetik {scope.businessDate} / {scope.shiftId} /
              kullanıcı #{scope.staffUserId}.
            </p>
            <form className="form-grid two" onSubmit={correct}>
              <Field label="Düzeltilecek beyan satırı">
                <select name="entryId" defaultValue={mobile.rows[0].id}>
                  {mobile.rows.map(row => (
                    <option key={row.id} value={row.id}>
                      {categoryLabel[row.category]} · {money(row.amountMinor)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Düzeltme türü">
                <select
                  value={correctionField}
                  onChange={event =>
                    setCorrectionField(
                      event.target.value as typeof correctionField
                    )
                  }
                >
                  <option value="amountMinor">Tutar hatası</option>
                  <option value="category">Ödeme türü sınıflandırması</option>
                  <option value="evidenceRef">
                    Eksik / yanlış slip kanıtı
                  </option>
                </select>
              </Field>
              <Field
                label={
                  correctionField === "amountMinor"
                    ? "Önerilen tutar (TL)"
                    : correctionField === "category"
                      ? "Önerilen ödeme türü"
                      : "Kanıt / slip referansı"
                }
              >
                {correctionField === "amountMinor" ? (
                  <input
                    name="newValue"
                    inputMode="decimal"
                    required
                    defaultValue="1200,00"
                  />
                ) : correctionField === "category" ? (
                  <select name="newValue" defaultValue="CASH">
                    {reconciliationCategories.map(category => (
                      <option key={category} value={category}>
                        {categoryLabel[category]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name="newValue"
                    maxLength={500}
                    required
                    defaultValue="synthetic-corrected-slip"
                  />
                )}
              </Field>
              <Field label="Gerekçe">
                <input name="reason" required maxLength={1000} />
              </Field>
              <Field label="Kanıt referansı">
                <input name="evidenceRef" required maxLength={500} />
              </Field>
              <button className="btn primary" type="submit">
                Geçici düzeltme taslağı oluştur
              </button>
            </form>
            {error && <Notice warning>{error}</Notice>}
            {draft && (
              <>
                <h3>Düzeltme geçmişi · kalıcı değil</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Rev.</th>
                        <th>Önceki</th>
                        <th>Önerilen</th>
                        <th>Gerekçe</th>
                        <th>Kanıt</th>
                        <th>Hazırlayan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.corrections.map(item => (
                        <tr key={item.revision}>
                          <td>{item.revision}</td>
                          <td>
                            {typeof item.previousValue === "number"
                              ? money(item.previousValue)
                              : String(item.previousValue ?? "—")}
                          </td>
                          <td>
                            {typeof item.newValue === "number"
                              ? money(item.newValue)
                              : String(item.newValue ?? "—")}
                          </td>
                          <td>{item.reason}</td>
                          <td>{item.evidenceRef}</td>
                          <td>#{item.correctedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  İlk beyan:{" "}
                  {money(
                    draft.original.rows.find(
                      row => row.id === draft.corrections[0].entryId
                    )?.amountMinor
                  )}{" "}
                  · Taslak:{" "}
                  {money(
                    draft.correctedRows.find(
                      row => row.id === draft.corrections.at(-1)?.entryId
                    )?.amountMinor
                  )}
                </p>
                <Notice warning>
                  İnceleme ve bağımsız onay tamamlanmadı. Personel borcu, kesin
                  tahsilat veya mali kayıt oluşturulmadı.
                </Notice>
              </>
            )}
            <details>
              <summary>Mutabakat durum özeti</summary>
              <ul>
                {reconciliationCategories.map(category => {
                  const cell = after.cells.find(
                    candidate => candidate.category === category
                  )!;
                  return (
                    <li key={category}>
                      {categoryLabel[category]}: banka teyidi bekleyen{" "}
                      {money(cell.bankPendingMinor)}; eksik slip{" "}
                      {cell.missingSlipCount}.
                    </li>
                  );
                })}
              </ul>
            </details>
          </>
        )}
      </Panel>
    </>
  );
}
