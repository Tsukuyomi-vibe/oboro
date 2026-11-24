import { build } from "esbuild";
export async function runtimeBundle(root) {
  const result = await build({ absWorkingDir: root, entryPoints: ["src/runtime/main.ts"], bundle: true, write: false, format: "iife", globalName: "RegionRuntime", platform: "browser", target: "chrome120", charset: "utf8", logLevel: "silent" });
  return result.outputFiles[0].text;
}
