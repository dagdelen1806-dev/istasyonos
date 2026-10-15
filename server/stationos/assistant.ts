import { ENV } from "../_core/env";
import type { AppState } from "../../shared/station";
import { invokeLLM, listLLMModels } from "../_core/llm";
import { safeAdd } from "./safety";
import { StationError } from "./types";

export function classifyQuestion(question: string): string {
  const text = question.toLocaleLowerCase("tr-TR");
  if (/sipariş|siparis|satın|satinal|toptancı|tedarik|stok|ürün/.test(text))
    return "PURCHASE_STOCK";
  if (/alacak|borç|borc|tahsil/.test(text)) return "RECEIVABLES";
  if (/likidite|banka|komisyon|valör|nakit|ödeme|finans/.test(text))
    return "FINANCE";
  if (/vardiya|kapanış|slip|hesap|onay/.test(text)) return "SHIFTS";
  return "OVERVIEW";
}

export function anonymousSummary(state: AppState, topic: string) {
  const role = state.member?.role;
  if (!role)
    throw new StationError(
      "NOT_MEMBER",
      "Asistan için firma üyeliği gerekli.",
      403
    );
  const sum = (values: (number | null)[]) =>
    values.some(v => v === null) ? null : safeAdd(...(values as number[]));
  const hasFinance = ["OWNER", "MANAGER", "ACCOUNTANT", "PURCHASER"].includes(
    role
  );
  const accounts = state.accounts;
  // No real person names, emails, IDs, PAN, IBAN, transaction refs, uploaded images,
  // product/supplier free text or the raw question cross this boundary.
  return {
    role,
    topic,
    scope:
      "Yetkili istasyonlar; tüm kayıtlı dönem. Günlük ciro veya banka bakiyesi değildir.",
    recordDateUtc: new Date().toISOString().slice(0, 10),
    stations: state.stations.length,
    shifts: accounts.length,
    reviewQueue: accounts.filter(a =>
      ["SUBMITTED", "IN_REVIEW"].includes(a.status)
    ).length,
    cashSalesMinor: sum(accounts.map(a => a.cashSalesMinor)),
    cardEvidenceMinor: sum(accounts.map(a => a.cardTotalMinor)),
    pendingIbanMinor: sum(accounts.map(a => a.ibanMinor)),
    debtSalesMinor: sum(accounts.map(a => a.debtMinor)),
    receivableBalanceMinor: hasFinance
      ? sum(state.debtors.map(d => d.balanceMinor))
      : null,
    openSupplierPayablesMinor:
      hasFinance || role === "PURCHASER"
        ? sum(
            state.payables
              .filter(p => p.status === "OPEN")
              .map(p => p.amountMinor)
          )
        : null,
    bankBalanceMinor: null,
    liquidityForecast: null,
    products: state.products.length,
    zeroStockProducts: state.products.filter(p => p.stockQty === 0).length,
    minimumStockProducts: state.products.filter(p => p.stockQty <= p.minimumQty)
      .length,
    proposedQuantity: sum(state.recommendations.map(r => r.recommendedQty)),
    creditBlockedProducts: state.recommendations.filter(
      r => r.status === "CREDIT_BLOCKED"
    ).length,
    recommendations: state.recommendations.slice(0, 10).map((r, i) => ({
      item: i + 1,
      quantity: r.recommendedQty,
      estimatedGrossCostMinor: r.costMinor,
      status: r.status,
      daysCover: r.daysCover,
    })),
    incompleteData: [
      "Banka açılış bakiyesi yok",
      "Gerçek banka mutabakatı yok",
      "Turpak bağlantısı kapalı",
      "Fatura eşleştirmesi ve sipariş taahhüdü ayrı faz",
      "Sipariş önerisi 7 gün inceleme + varsayılan 3 gün tedarik + 2 gün güvenlik stoğu; gerçek tedarik süresi değildir",
    ],
    operationsAllowed:
      "Salt okunur açıklama. Sipariş, ödeme, düzeltme veya onay gerçekleştiremez.",
  };
}

export async function explainSummary(
  summary: ReturnType<typeof anonymousSummary>
): Promise<string> {
  if (ENV.authProvider === "local") {
    const tl = (value: number | null) => value === null ? "bilinmiyor / yetki dışında" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value / 100);
    const lines = ["Kural tabanlı yerel özet — yapay zekâ servisi kullanılmadı.", summary.scope];
    if (["OVERVIEW", "SHIFTS", "FINANCE"].includes(summary.topic)) {
      lines.push(`Vardiya hesabı: ${summary.shifts}; onay bekleyen: ${summary.reviewQueue}.`, `Nakit satış: ${tl(summary.cashSalesMinor)}; kart kanıtı: ${tl(summary.cardEvidenceMinor)}; bekleyen IBAN beyanı: ${tl(summary.pendingIbanMinor)}.`);
    }
    if (["OVERVIEW", "PURCHASE_STOCK"].includes(summary.topic)) lines.push(`Ürün: ${summary.products}; sıfır stok: ${summary.zeroStockProducts}; minimum stokta/altında: ${summary.minimumStockProducts}; kredi nedeniyle bekleyen öneri: ${summary.creditBlockedProducts}.`);
    if (["OVERVIEW", "RECEIVABLES", "FINANCE"].includes(summary.topic)) lines.push(`Cari alacak: ${tl(summary.receivableBalanceMinor)}; açık tedarikçi borcu: ${tl(summary.openSupplierPayablesMinor)}.`);
    lines.push("Gerçek banka bakiyesi ve likidite bilinmiyor. IBAN beyanı banka teyidi değildir. Bu özet hiçbir ödeme, sipariş veya onay gerçekleştirmez.");
    return lines.join("\n\n");
  }
  const catalog = await listLLMModels(15000);
  const model = catalog.data.find(m => m.id === "claude-haiku-4-5")?.id;
  if (!model)
    throw new StationError(
      "AI_UNAVAILABLE",
      "Uygun asistan modeli şu anda kullanılamıyor.",
      503
    );
  const response = await invokeLLM({
    model,
    maxTokens: 1400,
    timeoutMs: 45000,
    messages: [
      {
        role: "system",
        content:
          "Türkçe operasyon analistisin. Sana yalnız sunucu yetki kontrolünden geçmiş anonim sayısal özet verilir. Tutarlar INTEGER KURUŞTUR: TL göstermek için 100'e böl. Yalnız verilen değerleri kullan; null bilinmiyor demektir, sıfır değildir. Tüm kayıtlı dönem günlük ciro diye sunulamaz. Banka bakiyesi, net kâr, vergi veya kesin likidite uydurma. Ödeme/sipariş/onay yaptığını söyleme. Rol ve konuya uygun en fazla 180 kelimelik açıklama, riskler ve kullanıcı kontrol önerisi yaz. Her bulgu için hangi özet alanına dayandığını kısaca belirt. En çok üç alt başlık kullan. İstasyon/kişi/ürün adlarını uydurma. İnternet linki, HTML, yeni işlev veya işlem önerme.",
      },
      { role: "user", content: JSON.stringify(summary) },
    ],
  });
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new StationError(
      "AI_UNAVAILABLE",
      "Asistan yanıt üretmedi; işlem yapılmadı.",
      503
    );
  return content.trim();
}
