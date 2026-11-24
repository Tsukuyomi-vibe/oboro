import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist-probe");
const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
const config = JSON.parse(await readFile(path.join(root, "fixtures/i02/config.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "userScripts", "declarativeNetRequestWithHostAccess"]);
assert.deepEqual(manifest.host_permissions, config.hosts.flatMap(({ host }) => [`http://${host}/*`, `https://${host}/*`]));
for (const field of ["content_scripts", "optional_permissions", "optional_host_permissions", "web_accessible_resources", "externally_connectable", "declarative_net_request"]) {
  assert.equal(manifest[field], undefined, `Стенд не должен объявлять ${field}`);
}
await access(path.join(output, manifest.background.service_worker));
const htmlPath = manifest.options_ui.page;
const html = await readFile(path.join(output, htmlPath), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)];
assert.equal(scripts.length, 3);
assert.equal(scripts[0][1], "../ui/theme.js");
assert.equal(scripts[1][1], "../ui/language.js");
assert.ok(html.includes('<html lang="en">'));
assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html));
for (const [, asset] of [...scripts, ...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)]) {
  await access(path.resolve(output, path.dirname(htmlPath), asset));
}
console.log("Сборка стенда проверена: доступ только к четырём фиксированным localhost-хостам; автоматических инъекций нет.");
