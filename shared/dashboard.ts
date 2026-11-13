export type Dashboard = {
  from: string;
  to: string;
  days: {
    day: string;
    revenueMinor: number;
    litresMl: number;
    cashMinor: number;
    cardMinor: number;
    debtMinor: number;
    ibanMinor: number;
    fastMinor: number;
  }[];
  totals: {
    revenueMinor: number;
    litresMl: number;
    cashMinor: number;
    cardMinor: number;
    debtMinor: number;
    ibanMinor: number;
    fastMinor: number;
  };
  current: {
    stockMl: number;
    unknownTanks: number;
    absoluteStockDifferenceMl: number;
    unknownMeasurements: number;
    activeShifts: number;
    cashMinor: number;
    receivableMinor: number;
    pendingAccounts: number;
    pendingTankRequests: number;
    draftOperations: number;
    differenceMinor: number;
  };
};
