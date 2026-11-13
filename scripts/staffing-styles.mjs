import { build } from "vite";
import { join } from "node:path";

const VIRTUAL_ENTRY = "virtual:staffing-harness-styles";
const RESOLVED_ENTRY = `\0${VIRTUAL_ENTRY}`;
const STYLE_IMPORTS = new Map([
  ["@staffing-index-style", "client/src/index.css"],
  ["@staffing-station-style", "client/src/station.css"],
  ["@staffing-business-style", "client/src/components/stationos/business.css"],
]);

export async function buildStaffingStylesheet(root) {
  const plugin = {
    name: "stationos-staffing-synthetic-styles",
    resolveId(source) {
      if (source === VIRTUAL_ENTRY) return RESOLVED_ENTRY;
      const relativePath = STYLE_IMPORTS.get(source);
      return relativePath ? join(root, relativePath) : null;
    },
    load(id) {
      if (id !== RESOLVED_ENTRY) return null;
      return [...STYLE_IMPORTS.keys()]
        .map(source => `import ${JSON.stringify(source)};`)
        .join("\n");
    },
  };

  const result = await build({
    configFile: join(root, "vite.config.ts"),
    plugins: [plugin],
    build: {
      write: false,
      emptyOutDir: false,
      cssCodeSplit: false,
      rollupOptions: { input: VIRTUAL_ENTRY },
    },
  });
  const outputs = Array.isArray(result)
    ? result.flatMap(item => item.output)
    : result.output;
  const cssAssets = outputs.filter(
    item =>
      item.type === "asset" && item.fileName.toLowerCase().endsWith(".css")
  );
  if (cssAssets.length !== 1)
    throw new Error(
      "Vite did not emit exactly one synthetic harness CSS asset."
    );

  const source = cssAssets[0].source;
  const css =
    typeof source === "string" ? source : Buffer.from(source).toString("utf8");
  if (
    Buffer.byteLength(css, "utf8") < 1000 ||
    !css.includes(".pompaci-mobile") ||
    !css.includes(".panel-heading")
  ) {
    throw new Error(
      "Vite CSS output is empty or missing StationOS component styles."
    );
  }
  return css;
}
