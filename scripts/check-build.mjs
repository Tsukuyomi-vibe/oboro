import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../dist/", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, "module");
assert.deepEqual(manifest.permissions, ["storage", "activeTab", "userScripts", "scripting", "declarativeNetRequestWithHostAccess", "webNavigation"]);
assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
for (const field of [
  "host_permissions",
  "optional_permissions",
  "content_scripts",
  "declarative_net_request",
  "web_accessible_resources"
]) {
  assert.equal(manifest[field], undefined, `Сборка не должна объявлять ${field}`);
}

await access(path.join(output, manifest.background.service_worker));
await access(path.join(output, "ui/styles.css"));
await access(path.join(output, "profile/profile-api.js"));
await access(path.join(output, "runtime/bridge.js"));
for (const name of ["temporal", "jsbi"]) await access(path.join(output, "third-party", name + "-LICENSE.txt"));

for (const htmlPath of [manifest.action.default_popup, manifest.options_ui.page]) {
  const html = await readFile(path.join(output, htmlPath), "utf8");
  const scriptPaths = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)];
  assert.equal(scriptPaths.length, 3, `${htmlPath}: ожидаются тема, язык и модуль страницы`);
  assert.equal(scriptPaths[0][1], "../ui/theme.js");
  assert.equal(scriptPaths[1][1], "../ui/language.js");
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.indexOf('src="../ui/language.js"') < html.indexOf('href="../ui/theme.css"'));
  assert.ok(html.indexOf('src="../ui/theme.js"') < html.indexOf('href="../ui/theme.css"'), "Тема восстанавливается до загрузки стилей");
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html), "Inline JS запрещён");
  for (const [, scriptPath] of scriptPaths) {
    await access(path.resolve(output, path.dirname(htmlPath), scriptPath));
  }
  for (const [, stylePath] of html.matchAll(/<link\b[^>]*href="([^"]+)"/g)) {
    await access(path.resolve(output, path.dirname(htmlPath), stylePath));
  }
}

const files = await readdir(output, { recursive: true });
assert.ok(!files.some((file) => file.endsWith(".ts")), "TypeScript не должен попадать в сборку");
console.log("Проверка сборки пройдена: MV3, entry points, явные API permissions; host permissions только optional, без статической инъекции.");
