import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("manifest.json", "dist/manifest.json");
await cp("src", "dist/src", { recursive: true });

await build({
  entryPoints: ["src/importer.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  outfile: "dist/src/importer.js",
  minify: false,
  sourcemap: false
});

console.log("Built extension in dist/");
