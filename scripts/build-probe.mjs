import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const staging = path.join(root, ".probe-staging");
const output = path.join(root, "dist-probe");
for (const directory of [staging, output]) {
  if (!path.isAbsolute(directory) || path.dirname(directory) !== root) throw new Error("Недопустимый путь сборки.");
}
const manifest = JSON.parse(await readFile(path.join(root, "src/probe/manifest.json"), "utf8"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (manifest.version !== pkg.version) throw new Error("Версии пакета и диагностического manifest должны совпадать.");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
try {
  await build({
    absWorkingDir: root,
    entryPoints: { "probe/probe": "src/probe/probe.ts", "background/service-worker": "src/probe/service-worker.ts" },
    outdir: staging, bundle: true, splitting: false, format: "esm", platform: "browser",
    target: "chrome120", charset: "utf8", logLevel: "info"
  });
  for (const [source, target] of [
    ["src/probe/manifest.json", "manifest.json"],
    ["src/probe/probe.html", "probe/probe.html"],
    ["src/probe/probe.css", "probe/probe.css"],
    ["src/ui/styles.css", "ui/styles.css"],
    ["src/ui/theme.css", "ui/theme.css"],
    ["src/ui/theme.js", "ui/theme.js"],
    ["src/ui/language.js", "ui/language.js"]
  ]) {
    await cp(path.join(root, source), path.join(staging, target), { recursive: true });
  }
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log("Диагностическая сборка: dist-probe/. Обычная сборка dist/ не изменена.");
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
