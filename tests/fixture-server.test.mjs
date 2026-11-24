import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import vm from "node:vm";
import { config, inlineJson, startFixtureServer } from "../fixtures/i02/server.mjs";

test("стенд: первый документ, echo, iframe и серверный журнал", async (t) => {
  const server = await startFixtureServer({ port: 0 });
  const port = server.address().port;
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  function request(host, pathname, { headers = {}, method = "GET", body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method, headers: { Host: `${host}:${port}`, ...headers } }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  await t.test("четыре точных хоста; неизвестный и похожий хост отвергаются", async () => {
    for (const { host } of config.hosts) {
      const result = await request(host, "/health");
      assert.equal(result.status, 200);
      assert.equal(JSON.parse(result.text).fixture, "region-i02");
      assert.equal(result.headers["cache-control"], "no-store");
    }
    for (const host of ["notselected.localhost", "selected.localhost.evil.example", "another.localhost"]) {
      assert.equal((await request(host, "/health")).status, 421);
    }
  });

  let html;
  let documentRequest;
  await t.test("первый inline script предшествует другим скриптам; iframe не рекурсивны", async () => {
    const result = await request("selected.localhost", "/?run=server-test", {
      headers: { "Accept-Language": "ru-RU,ru;q=0.9", [config.probeHeader]: "network-only", Cookie: "private=do-not-log", Authorization: "do-not-log" }
    });
    assert.equal(result.status, 200);
    html = result.text;
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    const first = scripts.filter(([tag]) => !/<script\b[^>]*\bsrc=/.test(tag));
    assert.equal(scripts[0], first[0], "Снимок окружения выполняется до скрипта темы и остальных скриптов");
    assert.ok(first[0][1].includes("__REGION_I02_FIRST_READ__"));
    assert.ok(first[1][1].includes("__REGION_I02_NETWORK__"));
    for (const [asset, type, content] of [["theme.css", /text\/css/, /--color-bg/], ["theme.js", /javascript/, /oboro\.theme/]]) {
      const theme = await request("selected.localhost", "/" + asset);
      assert.equal(theme.status, 200); assert.match(theme.headers["content-type"], type); assert.match(theme.text, content);
    }
    assert.equal((html.match(/<iframe /g) ?? []).length, 4);
    for (const { host } of config.hosts) assert.ok(html.includes(`${host}:${port}/frame?run=server-test`));
    const frame = await request("control.localhost", "/frame?run=server-test");
    assert.equal((frame.text.match(/<iframe /g) ?? []).length, 0);
    const report = JSON.parse((await request("selected.localhost", "/api/report?run=server-test")).text);
    documentRequest = report.requests[0];
    assert.equal(documentRequest.kind, "document");
    assert.equal(documentRequest.acceptLanguage, "ru-RU,ru;q=0.9");
    assert.equal(documentRequest.probeHeader, "network-only");
    assert.ok(!JSON.stringify(report).includes("do-not-log"));
    assert.ok(!JSON.stringify(report).includes("private="));
  });

  let firstRead;
  await t.test("поздняя установка маркера не переписывает первый снимок", () => {
    const match = /<script data-request-id="([^"]+)" data-run-id="([^"]+)">([\s\S]*?)<\/script>/.exec(html);
    const window = { isSecureContext: true };
    window.top = window;
    const context = {
      window, location: { href: documentRequest.url },
      document: { readyState: "loading", currentScript: { dataset: { requestId: match[1], runId: match[2] } } },
      navigator: { language: "ru-RU", languages: ["ru-RU", "ru"], userAgent: "Synthetic unit test, not Chrome" }
    };
    vm.runInNewContext(match[3], context);
    firstRead = window.__REGION_I02_FIRST_READ__;
    assert.equal(firstRead.marker, null);
    window.__REGION_I02_PROBE__ = { runId: "server-test", readyState: "loading" };
    assert.equal(firstRead.marker, null);
    assert.ok(Object.isFrozen(firstRead));
    assert.ok(Object.isFrozen(firstRead.languages));
    assert.throws(() => { firstRead.marker = { runId: "fake" }; }, TypeError);
  });

  await t.test("echo отражает свой запрос, а не заголовки предыдущего документа", async () => {
    const response = await request("selected.localhost", "/api/echo?run=server-test", { headers: { "Accept-Language": "en-US", [config.probeHeader]: "fetch-only" } });
    const echo = JSON.parse(response.text);
    assert.equal(echo.kind, "fetch");
    assert.equal(echo.acceptLanguage, "en-US");
    assert.equal(echo.probeHeader, "fetch-only");
    assert.notEqual(echo.id, documentRequest.id);
    const report = JSON.parse((await request("selected.localhost", "/api/report?run=server-test")).text);
    assert.equal(report.requests[0].probeHeader, "network-only");
    assert.equal(report.requests.at(-1).probeHeader, "fetch-only");
  });

  await t.test("наблюдение связано с адресом и уникальным запросом документа", async () => {
    const body = JSON.stringify({ firstRead, browser: { fullVersionList: null }, echoes: [] });
    const submit = (host, content) => request(host, "/api/observations?run=server-test", {
      method: "POST", headers: { Origin: `http://${host}:${port}`, "Content-Type": "application/json" }, body: content
    });
    assert.equal((await submit("control.localhost", body)).status, 400);
    assert.equal((await submit("selected.localhost", body)).status, 201);
    assert.equal((await submit("selected.localhost", body)).status, 409);
    assert.equal((await submit("selected.localhost", "{broken")).status, 400);
  });

  await t.test("CORS разрешён только локальным адресатам стенда", async () => {
    const localOrigin = `http://control.localhost:${port}`;
    const allowed = await request("selected.localhost", "/api/echo?run=cors-test", { headers: { Origin: localOrigin } });
    assert.equal(allowed.headers["access-control-allow-origin"], localOrigin);
    assert.equal((await request("selected.localhost", "/api/report?run=server-test", { headers: { Origin: "https://example.com" } })).status, 403);
  });

  await t.test("неизвестный запуск и неверный идентификатор не создают успешный отчёт", async () => {
    assert.equal((await request("selected.localhost", "/api/report?run=missing-run")).status, 404);
    assert.equal((await request("selected.localhost", "/?run=%3Cscript%3E")).status, 400);
  });

  await t.test("JSON не может закрыть inline script через значение заголовка", () => {
    const value = "</script><script>alert(1)</script>\u2028";
    const escaped = inlineJson({ value });
    assert.ok(!escaped.includes("</script>"));
    assert.deepEqual(JSON.parse(escaped), { value });
  });
  await t.test("I07: редирект ограничен ролями стенда и сохраняет первый серверный запрос", async () => {
    const result = await request("control.localhost", "/redirect?to=selected&run=redirect-test", { headers: { "Accept-Language": "native-first" } });
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, `http://selected.localhost:${port}/?run=redirect-test`);
    const next = await request("selected.localhost", "/?run=redirect-test", { headers: { "Accept-Language": "profile-after-redirect" } });
    assert.equal(next.status, 200);
    const report = JSON.parse((await request("selected.localhost", "/api/report?run=redirect-test")).text);
    assert.equal(report.resources[0].acceptLanguage, "native-first");
    assert.equal(report.requests[0].acceptLanguage, "profile-after-redirect");
    assert.equal((await request("control.localhost", "/redirect?to=https://example.com&run=redirect-test")).status, 400);
  });
  await t.test("I09: внешний script читает realm документа; сетевой адресат журналируется отдельно", async () => {
    const result = await request("control.localhost", "/external.js?run=script-test", { headers: { "Accept-Language": "native-script-request" } });
    const window = {};
    vm.runInNewContext(result.text, { window, location: { href: "https://selected.example/page" }, navigator: { language: "de-DE", languages: ["de-DE", "de"] } });
    assert.equal(window.__REGION_I02_EXTERNAL_SCRIPT__.language, "de-DE");
    const report = JSON.parse((await request("control.localhost", "/api/report?run=script-test")).text);
    assert.equal(report.resources[0].host, "control.localhost"); assert.equal(report.resources[0].acceptLanguage, "native-script-request");
    assert.equal(report.requests.length, 0);
  });
});
