import { safeAdd } from "./safety";
import { integer } from "./market-accounting-domain";
import type { MarketDaily } from "../../shared/market-accounting";
export function buildMarketDaily(
  date: string,
  b: Record<string, number>,
  totals: Record<string, unknown>,
  count: Record<string, unknown>,
  returns: Record<string, unknown>
): MarketDaily {
  const variance = b.PURCHASE_RETURN_VARIANCE ?? 0;
  const salesNet = -safeAdd(b.SALES ?? 0, b.SALES_RETURNS ?? 0),
    vat = -(b.OUTPUT_VAT ?? 0),
    cogs = b.COGS ?? 0,
    expense = safeAdd(
      b.EXPENSE ?? 0,
      b.BANK_FEES ?? 0,
      b.STOCK_LOSS ?? 0,
      b.CASH_LOSS ?? 0,
      Math.max(0, variance)
    ),
    gains = -safeAdd(
      b.STOCK_GAIN ?? 0,
      b.CASH_GAIN ?? 0,
      Math.min(0, variance)
    );
  return {
    date,
    salesNetMinor: salesNet,
    outputVatMinor: vat,
    salesGrossMinor: safeAdd(salesNet, vat),
    cogsMinor: cogs,
    grossProfitMinor: safeAdd(salesNet, -cogs),
    expensesMinor: expense,
    gainsMinor: gains,
    operatingResultMinor: safeAdd(salesNet, -cogs, -expense, gains),
    purchasesNetMinor: safeAdd(
      integer(totals?.purchase),
      -integer(returns?.purchase_net)
    ),
    inputVatMinor: b.INPUT_VAT ?? 0,
    collectionsMinor: integer(totals?.collection),
    supplierPaymentsMinor: integer(totals?.payment),
    saleCount: integer(count?.n),
    salesReturnsGrossMinor: integer(returns?.sale_gross),
    purchaseReturnsGrossMinor: integer(returns?.purchase_gross),
    saleReturnCount: integer(returns?.sale_count),
  };
}
