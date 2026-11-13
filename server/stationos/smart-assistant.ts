import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  AssistantFinding,
  SmartAssistantReport,
} from "../../shared/smart-assistant";
import { operationalDashboard, dashboardInteger as integer } from "./dashboard";
import { rows, first } from "./db";
import { fail } from "./types";
import { safeAdd } from "./safety";

// No caller-provided SQL, field names, ordering or expressions enter these queries.
export function assistantStationScope(
  stations: { id: string; company_id: string }[],
  stationId: string | null,
  companyId: string | null
) {
  if (stationId && !stations.some(s => s.id === stationId))
    fail("STATION_FORBIDDEN", "İstasyon yetki kapsamı dışında.", 403);
  if (companyId && !stations.some(s => s.company_id === companyId))
    fail("COMPANY_FORBIDDEN", "Şirket yetki kapsamı dışında.", 403);
  const ids = stations
    .filter(
      s =>
        (!stationId || s.id === stationId) &&
        (!companyId || s.company_id === companyId)
    )
    .map(s => s.id);
  if (!ids.length)
    fail("STATION_FORBIDDEN", "Seçilen şirket ve istasyon eşleşmiyor.", 403);
  return ids;
}

type RecordRow = RowDataPacket & { id: string; stationId: string };
const ranks = { HIGH: 0, MEDIUM: 1, INFO: 2 };
export function rankAssistantFindings(findings: AssistantFinding[]) {
  return findings.sort(
    (a, b) =>
      ranks[a.severity] - ranks[b.severity] || a.code.localeCompare(b.code)
  );
}
export async function smartAssistantReport(
  c: PoolConnection,
  tenantId: string,
  stationIds: string[],
  companyId: string | null,
  from: unknown,
  to: unknown,
  geminiAvailable: boolean
): Promise<SmartAssistantReport> {
  const dashboard = await operationalDashboard(
    c,
    tenantId,
    stationIds,
    from,
    to
  );
  const scope = [tenantId, ...stationIds],
    marks = stationIds.map(() => "?").join(",");
  const findings: AssistantFinding[] = [];
  // Each query returns exact aggregates plus at most ten evidence records.
  async function finding(
    config: Omit<AssistantFinding, "count" | "sources" | "metrics">,
    sql: string,
    params: unknown[],
    metricColumns: string[]
  ) {
    const totals = await first<RowDataPacket>(
      c,
      `SELECT COUNT(*) AS count${metricColumns.map(k => `,COALESCE(SUM(ABS(q.${k})),0) AS ${k}`).join("")} FROM (${sql}) q`,
      params
    );
    const count = integer(totals?.count);
    if (!count) return;
    const evidence = await rows<RecordRow[]>(
      c,
      `${sql} ORDER BY id LIMIT 10`,
      params
    );
    const metrics = Object.fromEntries(
      metricColumns.map(k => [k, integer(totals?.[k])])
    );
    findings.push({
      ...config,
      count,
      metrics,
      sources: evidence.map(r => ({
        type: config.code,
        id: String(r.id),
        stationId: String(r.stationId),
        values: Object.fromEntries(
          Object.entries(r)
            .filter(([k]) => !["id", "stationId"].includes(k))
            .map(([k, v]) => [
              k,
              typeof v === "number" || /^-?\d+$/.test(String(v))
                ? integer(v)
                : v === null
                  ? null
                  : String(v),
            ])
        ),
      })),
    });
  }
  const scoped = `tenant_id=? AND station_id IN (${marks})`;
  await finding(
    {
      code: "TANK_DIFFERENCE",
      severity: "HIGH",
      title: "Toleransı aşan tank ölçüm farkı",
      period: "CURRENT",
      formula:
        "|güncel fiziksel ölçüm − teorik stok| > tank toleransı; yalnız eşit revizyon",
      recommendation:
        "Ölçümü ve kanıtını inceleyin; stok kendiliğinden düzeltilmez.",
    },
    `SELECT t.tank_id AS id,t.station_id AS stationId,t.stock_ml AS stockMl,m.measured_ml AS measuredMl,(m.measured_ml-t.stock_ml) AS differenceMl,t.tolerance_ml AS toleranceMl FROM st_tank_cards t JOIN st_tank_measurements m ON m.id=(SELECT x.id FROM st_tank_measurements x WHERE x.tank_id=t.tank_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) WHERE t.tenant_id=? AND t.station_id IN (${marks}) AND m.revision=t.revision AND t.stock_ml IS NOT NULL AND ABS(m.measured_ml-t.stock_ml)>t.tolerance_ml`,
    scope,
    ["differenceMl"]
  );
  await finding(
    {
      code: "TANK_CRITICAL",
      severity: "HIGH",
      title: "Kritik veya kapasite dışı stok",
      period: "CURRENT",
      formula: "stok ≤ kritik seviye veya stok > kapasite; kapasite > 0",
      recommendation: "Tank kartını ve teslim planını kontrol edin.",
    },
    `SELECT tank_id AS id,station_id AS stationId,stock_ml AS stockMl,capacity_ml AS capacityMl,critical_ml AS criticalMl FROM st_tank_cards WHERE ${scoped} AND stock_ml IS NOT NULL AND (stock_ml<=critical_ml OR (capacity_ml>0 AND stock_ml>capacity_ml))`,
    scope,
    []
  );
  await finding(
    {
      code: "TANK_UNKNOWN",
      severity: "MEDIUM",
      title: "Eksik kapasite, stok veya güncel ölçüm",
      period: "CURRENT",
      formula:
        "stok bilinmiyor veya kapasite ≤ 0 veya son ölçüm revizyonu güncel değil",
      recommendation:
        "Ürün ve net hacmi koruyarak doğrulanmış ölçüm girin; sıfırı bilinmeyen kapasite yerine kullanmayın.",
    },
    `SELECT t.tank_id AS id,t.station_id AS stationId,t.stock_ml AS stockMl,t.capacity_ml AS capacityMl,t.revision AS revision,m.revision AS measurementRevision FROM st_tank_cards t LEFT JOIN st_tank_measurements m ON m.id=(SELECT x.id FROM st_tank_measurements x WHERE x.tank_id=t.tank_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) WHERE t.tenant_id=? AND t.station_id IN (${marks}) AND (t.stock_ml IS NULL OR t.capacity_ml<=0 OR m.id IS NULL OR m.revision<>t.revision)`,
    scope,
    []
  );
  const period = [...scope, dashboard.from, dashboard.to];
  await finding(
    {
      code: "METER_INCOMPLETE",
      severity: "HIGH",
      title: "Kapalı sayaç hesabında eksik okuma",
      period: "PERIOD",
      formula:
        "Kapalı hesapta bildirilen litre boş veya atanmış tabancada OPEN/CLOSE eksik",
      recommendation:
        "Eksik okumayı kanıtıyla doğrulayın; bilinmeyen litre sıfır değildir.",
    },
    `SELECT a.id,a.station_id AS stationId,b.reported_ml AS reportedMl FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id JOIN st_fuel_batches b ON b.account_id=a.id WHERE a.tenant_id=? AND a.station_id IN (${marks}) AND b.closed=1 AND DATE(DATE_ADD(s.starts_at,INTERVAL 3 HOUR)) BETWEEN ? AND ? AND (b.reported_ml IS NULL OR NOT EXISTS(SELECT 1 FROM st_fuel_assignments x WHERE x.account_id=a.id) OR EXISTS(SELECT 1 FROM st_fuel_assignments x WHERE x.account_id=a.id AND (NOT EXISTS(SELECT 1 FROM st_fuel_readings r WHERE r.account_id=a.id AND r.nozzle_id=x.nozzle_id AND r.kind='OPEN') OR NOT EXISTS(SELECT 1 FROM st_fuel_readings r WHERE r.account_id=a.id AND r.nozzle_id=x.nozzle_id AND r.kind='CLOSE'))))`,
    period,
    []
  );
  await finding(
    {
      code: "APPROVAL_INTEGRITY",
      severity: "HIGH",
      title: "Kabul edilmiş hesapta bağımsız onay eksikliği",
      period: "PERIOD",
      formula:
        "Güncel onay döngüsünde hesap sahibinden farklı en az iki ayrı APPROVAL kullanıcısı",
      recommendation:
        "Veri bütünlüğünü araştırın; kabul durumunu değiştirmeden sorumlu yöneticiye bildirin.",
    },
    `SELECT a.id,a.station_id AS stationId,(SELECT COUNT(DISTINCT x.user_id) FROM st_account_signatures x WHERE x.account_id=a.id AND x.cycle_no=a.cycle_no AND x.kind='APPROVAL' AND x.user_id<>a.user_id) AS approvals FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id WHERE a.tenant_id=? AND a.station_id IN (${marks}) AND a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND DATE(DATE_ADD(s.starts_at,INTERVAL 3 HOUR)) BETWEEN ? AND ? HAVING approvals<2`,
    period,
    []
  );
  await finding(
    {
      code: "METER_DIFFERENCE",
      severity: "HIGH",
      title: "Sayaç ve bildirilen litre farkı",
      period: "PERIOD",
      formula:
        "Σ(kapanış − açılış) − bildirilen litre; PRICE satırları litre toplamına eklenmez",
      recommendation:
        "Tabanca okumalarını, fiyat dilimlerini ve test yakıtı kayıtlarını inceleyin.",
    },
    `SELECT a.id,a.station_id AS stationId,b.reported_ml AS reportedMl,(SELECT SUM(CASE WHEN r.kind='CLOSE' THEN r.meter_ml WHEN r.kind='OPEN' THEN -r.meter_ml ELSE 0 END) FROM st_fuel_readings r WHERE r.account_id=a.id)-b.reported_ml AS differenceMl FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id JOIN st_fuel_batches b ON b.account_id=a.id WHERE a.tenant_id=? AND a.station_id IN (${marks}) AND b.closed=1 AND DATE(DATE_ADD(s.starts_at,INTERVAL 3 HOUR)) BETWEEN ? AND ? HAVING differenceMl<>0`,
    period,
    ["differenceMl"]
  );
  await finding(
    {
      code: "ACCOUNT_DIFFERENCE",
      severity: "HIGH",
      title: "İcmal tutar farkı",
      period: "CURRENT",
      formula: "Σ |kayıtlı icmal farkı|; iptal edilen hesaplar hariç",
      recommendation:
        "İcmal kaynak satışını ve tahsilat bileşenlerini inceleyin; farkı otomatik kesinleştirmeyin.",
    },
    `SELECT id,station_id AS stationId,status,difference_minor AS differenceMinor FROM st_accounts WHERE ${scoped} AND status<>'CANCELLED' AND difference_minor<>0`,
    scope,
    ["differenceMinor"]
  );
  await finding(
    {
      code: "PENDING_ACCOUNT",
      severity: "MEDIUM",
      title: "Bağımsız onay bekleyen vardiya hesapları",
      period: "CURRENT",
      formula:
        "SUBMITTED veya IN_REVIEW hesap sayısı; gerçekleşmiş satış toplamına eklenmez",
      recommendation:
        "Kaynakları inceletin ve mevcut iki bağımsız onay kuralını tamamlayın.",
    },
    `SELECT id,station_id AS stationId,status,source_sales_minor AS sourceMinor FROM st_accounts WHERE ${scoped} AND status IN ('SUBMITTED','IN_REVIEW')`,
    scope,
    ["sourceMinor"]
  );
  await finding(
    {
      code: "PENDING_TANK",
      severity: "MEDIUM",
      title: "Onay bekleyen tank hareketleri",
      period: "CURRENT",
      formula: "PENDING tank talepleri; onaylanmadan stok girişi değildir",
      recommendation:
        "İrsaliye ve ölçüm kanıtını bağımsız kullanıcıya doğrulatın.",
    },
    `SELECT id,station_id AS stationId,kind FROM st_tank_requests WHERE ${scoped} AND status='PENDING'`,
    scope,
    []
  );
  await finding(
    {
      code: "DRAFT_SPECIAL",
      severity: "INFO",
      title: "Kesinleşmemiş özel işlem taslakları",
      period: "CURRENT",
      formula:
        "DRAFT/PENDING kayıt sayısı; satış veya tahsilat toplamına eklenmez",
      recommendation:
        "TTS, Gift ve Partner modellerini ayrı tutun; iş kuralı onayı olmadan muhasebeleştirmeyin.",
    },
    `SELECT id,station_id AS stationId,status FROM st_shift_special_operations WHERE ${scoped} AND status IN ('DRAFT','PENDING')`,
    scope,
    []
  );
  await finding(
    {
      code: "RECEIVABLE",
      severity: "INFO",
      title: "Güncel cari alacaklar",
      period: "CURRENT",
      formula: "Σ pozitif müşteri bakiyesi; dönem sonu geçmiş bakiye değildir",
      recommendation:
        "Tahsilatları müşteri borcuna bağlayın; tahsilatı tekrar satış saymayın.",
    },
    `SELECT id,station_id AS stationId,balance_minor AS balanceMinor FROM st_debtors WHERE ${scoped} AND balance_minor>0`,
    scope,
    ["balanceMinor"]
  );
  await finding(
    {
      code: "COLLECTION",
      severity: "INFO",
      title: "Dönem cari tahsilatları",
      period: "PERIOD",
      formula:
        "Σ POSTED AR_COLLECTION; Türkiye ödeme kayıt gününe göre; satışa eklenmez",
      recommendation: "Cari hareket ve ödeme kaydını birlikte kontrol edin.",
    },
    `SELECT id,station_id AS stationId,amount_minor AS amountMinor FROM st_payments WHERE ${scoped} AND kind='AR_COLLECTION' AND status='POSTED' AND DATE(DATE_ADD(created_at,INTERVAL 3 HOUR)) BETWEEN ? AND ?`,
    period,
    ["amountMinor"]
  );
  await finding(
    {
      code: "UNCONFIRMED_BANK",
      severity: "INFO",
      title: "Banka teyidi yerine geçmeyen IBAN/FAST/POS beyanları",
      period: "PERIOD",
      formula:
        "Kabul edilmiş hesapların POSTED IBAN/FAST ve manuel VERIFIED POS kayıtları; banka gerçekleşmesi değildir",
      recommendation:
        "Banka/POS entegrasyonu veya bağımsız ekstre teyidi olmadan banka bakiyesi çıkarmayın.",
    },
    `SELECT p.id,p.station_id AS stationId,p.amount_minor AS amountMinor,p.kind FROM st_payments p JOIN st_accounts a ON a.id=p.account_id JOIN st_shifts s ON s.id=a.shift_id WHERE p.tenant_id=? AND p.station_id IN (${marks}) AND p.kind IN ('IBAN','FAST') AND p.status='POSTED' AND a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND DATE(DATE_ADD(s.starts_at,INTERVAL 3 HOUR)) BETWEEN ? AND ? UNION ALL SELECT p.id,p.station_id AS stationId,p.amount_minor AS amountMinor,'POS_MANUAL' AS kind FROM st_slips p JOIN st_accounts a ON a.id=p.account_id JOIN st_shifts s ON s.id=a.shift_id WHERE p.tenant_id=? AND p.station_id IN (${marks}) AND p.status='VERIFIED' AND a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND DATE(DATE_ADD(s.starts_at,INTERVAL 3 HOUR)) BETWEEN ? AND ?`,
    [...period, ...period],
    ["amountMinor"]
  );
  // Include exact accepted account sources and deterministic period totals.
  await finding(
    {
      code: "SALES",
      severity: "INFO",
      title: "İki onaylı operasyonel satış",
      period: "PERIOD",
      formula:
        "Σ kabul edilmiş hesap kaynak satışı; cari tahsilat ve taslaklar hariç; mali defter değildir",
      recommendation:
        "Günlük ve istasyon bazlı dağılımı yönetim paneliyle karşılaştırın.",
    },
    `SELECT a.id,a.station_id AS stationId,a.source_sales_minor AS sourceMinor FROM st_accounts a JOIN st_shifts s ON s.id=a.shift_id WHERE a.tenant_id=? AND a.station_id IN (${marks}) AND a.status IN ('ACCEPTED','ACCEPTED_WITH_PENDING') AND DATE(DATE_ADD(s.starts_at,INTERVAL 3 HOUR)) BETWEEN ? AND ?`,
    period,
    ["sourceMinor"]
  );
  // Overflow checked separately from database aggregates; no floating point money.
  safeAdd(
    dashboard.totals.cashMinor,
    dashboard.totals.cardMinor,
    dashboard.totals.debtMinor,
    dashboard.totals.ibanMinor
  );
  return {
    generatedAt: new Date().toISOString(),
    scope: { companyId, stationIds },
    dashboard,
    collectionsMinor:
      findings.find(f => f.code === "COLLECTION")?.metrics.amountMinor ?? 0,
    findings: rankAssistantFindings(findings),
    geminiAvailable,
  };
}
