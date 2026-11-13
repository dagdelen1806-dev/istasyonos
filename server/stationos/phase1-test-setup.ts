import { beforeEach, vi } from "vitest";

// No production configuration is loaded. Any unmocked database access fails.
vi.mock("mysql2", () => ({
  default: {
    createPool: () => {
      throw new Error("REAL_DATABASE_ACCESS_FORBIDDEN");
    },
  },
}));
vi.mock("mysql2/promise", () => ({
  createConnection: () => {
    throw new Error("REAL_DATABASE_ACCESS_FORBIDDEN");
  },
  createPool: () => {
    throw new Error("REAL_DATABASE_ACCESS_FORBIDDEN");
  },
  default: {
    createConnection: () => {
      throw new Error("REAL_DATABASE_ACCESS_FORBIDDEN");
    },
    createPool: () => {
      throw new Error("REAL_DATABASE_ACCESS_FORBIDDEN");
    },
  },
}));
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("EXTERNAL_NETWORK_FORBIDDEN");
    })
  );
});
