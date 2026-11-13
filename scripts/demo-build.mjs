import { build as bundle } from "esbuild";
for (const key of Object.keys(process.env))
  if (
    !/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|APPDATA|LOCALAPPDATA|USERPROFILE|HOME)$/i.test(
      key
    )
  )
    delete process.env[key];
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build({
  envDir: false,
  build: {
    outDir: process.cwd() + "/.local/demo/runtime/public",
    emptyOutDir: false,
  },
});
await bundle({
  entryPoints: ["server/_core/index.ts"],
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  outfile: ".local/demo/runtime/index.js",
});
