export type CountReportSummary = {
  id: string;
  sequence: string;
  draftId: string;
  label: string;
  date: string;
  postedAt: string;
  reason: string;
  approvedBy: { id: number; name: string };
  gainMinor: number;
  lossMinor: number;
  netMinor: number;
};
export type CountReportPage = {
  from: string;
  to: string;
  nextCursor: string | null;
  totals: {
    reports: number;
    gainMinor: number;
    lossMinor: number;
    netMinor: number;
  };
  rows: CountReportSummary[];
};
export type CountReportItem = {
  productId: string;
  name: string;
  barcode: string;
  unit: string;
  labelSource: "SNAPSHOT" | "CURRENT_CARD" | "UNAVAILABLE";
  before: number;
  after: number;
  delta: number;
  gainMinor: number;
  lossMinor: number;
  netMinor: number;
  countedBy: { id: number; name: string } | null;
  deviceId: string | null;
  lots: {
    id: string;
    code: string;
    expiryDate: string | null;
    status: string;
    before: number;
    after: number;
    delta: number;
    countedBy: { id: number; name: string } | null;
    deviceId: string | null;
  }[];
};
export type CountReportDetail = CountReportSummary & {
  items: CountReportItem[];
  snapshotVersion: number;
  approvedDeviceId: string | null;
};
