import type { Dashboard } from "./dashboard";

export type AssistantFinding = {
  code: string;
  severity: "HIGH" | "MEDIUM" | "INFO";
  title: string;
  period: "CURRENT" | "PERIOD";
  formula: string;
  recommendation: string;
  count: number;
  metrics: Record<string, number>;
  sources: {
    type: string;
    id: string;
    stationId: string;
    values: Record<string, number | string | null>;
  }[];
};
export type SmartAssistantReport = {
  generatedAt: string;
  scope: { companyId: string | null; stationIds: string[] };
  dashboard: Dashboard;
  collectionsMinor: number;
  findings: AssistantFinding[];
  geminiAvailable: boolean;
};
export type AssistantExplanation = {
  mode: "LOCAL" | "GEMINI";
  message: string;
  suggestions: { code: string; explanation: string; recommendation: string }[];
};
