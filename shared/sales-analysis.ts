import type { ReportFilters } from "./market-reports";
export interface AnalysisAmounts {
  saleCount: number;
  returnCount: number;
  saleLines: number;
  returnLines: number;
  salesGrossMinor: number;
  salesNetMinor: number;
  salesVatMinor: number;
  salesCostMinor: number;
  returnsGrossMinor: number;
  returnsNetMinor: number;
  returnsVatMinor: number;
  returnsCostMinor: number;
  netGrossMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  averageSaleMinor: number | null;
}
export interface CategoryAnalysis extends AnalysisAmounts {
  category: string | null;
  label: string;
  source: "SNAPSHOT" | "UNCATEGORIZED" | "LEGACY_UNKNOWN";
}
export interface HourAnalysis extends AnalysisAmounts {
  hour: number;
}
export interface SalesAnalysis {
  from: string;
  to: string;
  asOf: string;
  generatedAt: string;
  filters: ReportFilters;
  totals: AnalysisAmounts;
  categories: CategoryAnalysis[];
  hours: HourAnalysis[];
}
