import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export default mergeConfig(
  base,
  defineConfig({
    envDir: false,
    test: {
      setupFiles: ["./server/stationos/phase1-test-setup.ts"],
      env: {
        DATABASE_URL: "",
        AUTH_PROVIDER: "local",
        SESSION_SECRET: "phase1-isolated-test-secret-not-for-deployment",
      },
    },
  })
);
