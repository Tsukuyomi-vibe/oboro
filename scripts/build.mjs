import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { runtimeBundle } from "./runtime-build.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const output = path.join(root, "dist");
const staging = path.join(root, ".build-staging");
const source = path.join(root, "src");
const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

if (manifest.version !== pkg.version) {
  throw new Error("Версии package.json и manifest.json должны совпадать.");
}

// Never clean or move a directory outside this project's fixed build paths.
for (const directory of [staging, output]) {
  if (!path.isAbsolute(directory) || path.dirname(directory) !== root) {
    throw new Error("Папка сборки должна находиться непосредственно в корне проекта.");
  }
}

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

try {
  await build({
    absWorkingDir: root,
    entryPoints: {
      "background/service-worker": "src/background/service-worker.ts",
      "popup/popup": "src/popup/popup.ts",
      "options/options": "src/options/options.ts",
      "runtime/bridge": "src/runtime/bridge.ts",
      "profile/profile-api": "src/profile/index.ts"
    },
    outdir: staging,
    bundle: true,
    define: { __REGION_RUNTIME_BUNDLE__: JSON.stringify(await runtimeBundle(root)) },
    splitting: false,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    charset: "utf8",
    logLevel: "info"
  });

  for (const relativePath of [
    "manifest.json",
    "popup/popup.html",
    "options/options.html",
    "ui/styles.css",
    "ui/theme.css",
    "ui/theme.js",
    "ui/language.js"
  ]) {
    await cp(path.join(source, relativePath), path.join(staging, relativePath), {
      recursive: true
    });
  }

  await mkdir(path.join(staging, "third-party"), { recursive: true });
  for (const [name, dependency] of [["temporal", "@js-temporal/polyfill"], ["jsbi", "jsbi"]]) {
    await cp(path.join(root, "node_modules", dependency, "LICENSE"), path.join(staging, "third-party", name + "-LICENSE.txt"));
  }

  // Keep the previous installable build until the replacement has compiled.
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log("Сборка готова: dist/ — эту папку нужно загрузить в Chrome.");
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
