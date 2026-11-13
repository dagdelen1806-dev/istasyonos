import type {
  OesseAutomationSaleEvent,
  OesseSaleAttributionScope,
} from "../../shared/oesse-sale-attribution";

/** Entirely fictional sample; these values are not linked to a real station. */
export const syntheticOesseSaleScope: OesseSaleAttributionScope = {
  tenantId: "tenant-demo-contract",
  stationId: "station-demo-contract",
  shiftId: "shift-demo-contract",
  startsAt: "2026-11-10T20:00:00.000Z",
  endsAt: "2026-11-11T08:00:00.000Z",
  assignedStaffUserIds: [101, 102],
  nozzles: [
    {
      nozzleId: "nozzle-demo-1",
      pumpId: "pump-demo-1",
      productId: "fuel-demo-diesel",
    },
    {
      nozzleId: "nozzle-demo-2",
      pumpId: "pump-demo-1",
      productId: "fuel-demo-diesel",
    },
    {
      nozzleId: "nozzle-demo-3",
      pumpId: "pump-demo-2",
      productId: "fuel-demo-gasoline",
    },
  ],
};

export const syntheticOesseSaleEvents: OesseAutomationSaleEvent[] = [
  {
    sourceSystem: "SYNTHETIC_AUTOMATION",
    sourceEventId: "event-demo-0001",
    tenantId: "tenant-demo-contract",
    stationId: "station-demo-contract",
    shiftId: "shift-demo-contract",
    pumpId: "pump-demo-1",
    nozzleId: "nozzle-demo-1",
    soldAt: "2026-11-10T22:15:00.000Z",
    productId: "fuel-demo-diesel",
    volumeMl: 42100,
    amountMinor: 245700,
    staffUserId: 101,
    eventType: "SALE",
    reversesSourceEventId: null,
    evidenceRef: "synthetic://event-demo-0001",
    sourceVerified: true,
  },
  {
    sourceSystem: "SYNTHETIC_AUTOMATION",
    sourceEventId: "event-demo-0002",
    tenantId: "tenant-demo-contract",
    stationId: "station-demo-contract",
    shiftId: "shift-demo-contract",
    pumpId: "pump-demo-2",
    nozzleId: "nozzle-demo-3",
    soldAt: "2026-11-11T02:10:00.000Z",
    productId: "fuel-demo-gasoline",
    volumeMl: 18350,
    amountMinor: 119900,
    staffUserId: 102,
    eventType: "SALE",
    reversesSourceEventId: null,
    evidenceRef: "synthetic://event-demo-0002",
    sourceVerified: true,
  },
];
