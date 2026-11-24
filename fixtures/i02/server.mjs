import http from "node:http";
import { workerScript } from "../i22/workers.mjs";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const config = JSON.parse(await readFile(new URL("config.json", import.meta.url), "utf8"));
const firstScript = await readFile(new URL("first-read.js", import.meta.url), "utf8");
const clientScript = await readFile(new URL("client.js", import.meta.url), "utf8");
const lifecycleClient = await readFile(new URL("../i22/client.js", import.meta.url), "utf8");
const styles = await readFile(new URL("styles.css", import.meta.url), "utf8");
// In the workspace use the shared source; the standalone diagnostic archive
// carries the same browser-ready assets inside dist-probe.
async function sharedThemeAsset(name) {
  try { return await readFile(new URL(`../../src/ui/${name}`, import.meta.url), "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return readFile(new URL(`../../dist-probe/ui/${name}`, import.meta.url), "utf8");
  }
}
const themeStyles = await sharedThemeAsset("theme.css");
const themeScript = await sharedThemeAsset("theme.js");
const runPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const maxEvents = 512;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function renderDocument({ network, runId, origin, frame, port, protocol }) {
  const role = config.hosts.find((entry) => entry.host === new URL(origin).hostname);
  const links = config.hosts.map((entry) => `<a href="${protocol}//${entry.host}:${port}/?run=${runId}">${escapeHtml(entry.label)}</a>`).join(" ");
  const frames = frame ? "" : `<section><h2>Первые чтения в iframe</h2>${config.hosts.map((entry) => `<h3>${escapeHtml(entry.host)}</h3><iframe title="${escapeHtml(entry.label)}" allow="geolocation" src="${protocol}//${entry.host}:${port}/frame?run=${runId}"></iframe>`).join("")}</section>`;
  // This inline script is deliberately the first executable code in the document.
  return `<!doctype html><html lang="ru"><head><script data-request-id="${network.id}" data-run-id="${runId}">${firstScript}</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oboro Check — ${escapeHtml(role.label)}</title><script src="/theme.js"></script><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/styles.css">
<script>Object.defineProperty(window, "__REGION_I02_NETWORK__", { value: Object.freeze(${inlineJson(network)}) });Object.defineProperty(window, "__REGION_I02_HOSTS__", { value: Object.freeze(${inlineJson(config.hosts.map((entry) => entry.host))}) });</script>
<script src="${protocol}//control.localhost:${port}/external.js?run=${runId}" defer></script><script src="/client.js" defer></script>${frame ? "" : '<script src="/i22-client.js" defer></script>'}</head><body>
<main><header class="check-header"><p class="eyebrow">Oboro Check</p><label class="theme-control">Тема <select data-theme-select aria-describedby="theme-feedback"><option value="system">Как в системе</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label></header><p id="theme-feedback" class="theme-feedback" data-theme-feedback role="status" hidden></p><h1>${escapeHtml(role.label)}</h1>
<p>${escapeHtml(origin)} · ${frame ? "iframe" : "основной документ"}</p>
<p>Запуск: <code>${runId}</code>. <strong id="capture-status">Сбор наблюдений…</strong></p>
<nav>${links}</nav><section class="columns"><article><h2>Первый скрипт страницы</h2><pre id="first-read"></pre></article>
<article><h2>Первый запрос документа на сервере</h2><pre id="network"></pre></article></section>
<section><h2>Fetch: адресаты запросов</h2><pre id="fetch-results"></pre></section>
<section><h2>Внешний script в контексте документа</h2><pre id="external-script"></pre></section>
<section><h2>Геолокация</h2><p>Запрос выполняется только по нажатию. Разрешение выдаётся обычным диалогом браузера. Координаты остаются на этой странице и не отправляются в серверный журнал.</p>
<label>timeout, мс <input id="geo-timeout" type="number" min="0" value="5000"></label>
<label>maximumAge, мс <input id="geo-maximum-age" type="number" min="0" value="0"></label>
<label><input id="geo-high-accuracy" type="checkbox"> enableHighAccuracy</label>
<button id="request-geolocation" type="button">Запросить getCurrentPosition</button><pre id="geo-result">Не запрошено</pre>
<button id="watch-geolocation" type="button">Начать watchPosition</button><button id="clear-geolocation" type="button" disabled>clearWatch</button><pre id="geo-watch-result">Наблюдение не запущено</pre></section>
<section><h2>Карта раскладки</h2><p>Запрос выполняется только по кнопке. Проверьте также ввод, сочетания клавиш и IME: они должны оставаться системными.</p><button id="request-keyboard" type="button">Запросить getLayoutMap</button><pre id="keyboard-result">Не запрошено</pre><label>Проверка обычного ввода <input id="keyboard-input" autocomplete="off"></label><pre id="keyboard-events">Событий нет</pre></section>
${frame ? "" : `<section><h2>Жизненный цикл страниц и границы покрытия</h2><p>Workers, ранний about:blank, srcdoc и blob не получают базовую подмену. Отрицательный результат показывается явно; совпадение значений с профилем само по себе не доказывает инъекцию.</p><button id="spa-nav" type="button">SPA: history.pushState</button><button id="go-back" type="button">Назад по истории</button><a href="/lifecycle-target?run=${runId}">Перейти для проверки BFCache</a> <a href="/?run=${runId}" target="_blank" rel="noopener">Новая вкладка</a><pre id="lifecycle-events"></pre><button id="run-contexts" type="button">Проверить ранний iframe, srcdoc и blob</button><pre id="context-results">Не запрошено</pre><div id="context-fixtures"></div><button id="run-workers" type="button">Проверить Dedicated / Shared / Service Workers</button><button id="cleanup-workers" type="button">Закрыть тестовые контексты и убрать тестовый Service Worker</button><pre id="worker-results">Не запрошено</pre></section>`}
<section><h2>Редиректы</h2><nav>${config.hosts.map((entry) => `<a href="/redirect?to=${entry.role}&run=${runId}">На ${escapeHtml(entry.host)}</a>`).join(" ")}</nav></section>
<p><a href="/api/report?run=${runId}" target="_blank" rel="noopener">Открыть серверный отчёт JSON</a></p>${frames}</main></body></html>`;
}

export function createFixtureServer({ tls } = {}) {
  const protocol = tls ? "https:" : "http:";
  const runs = new Map();
  let server;

  function getRun(runId) {
    if (!runs.has(runId)) {
      if (runs.size >= 32) runs.delete(runs.keys().next().value);
      runs.set(runId, { runId, truncated: false, requests: [], resources: [], observations: [] });
    }
    return runs.get(runId);
  }

  function append(run, list, item) {
    if (run[list].length >= maxEvents) {
      run.truncated = true;
      return;
    }
    run[list].push(item);
  }

  const handler = async (req, res) => {
    const reply = (status, body, type = "application/json; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const address = server.address();
      const port = address.port;
      const authority = req.headers.host;
      const acceptedHosts = [...config.hosts.map((entry) => entry.host), "localhost", "127.0.0.1"];
      if (!authority || !acceptedHosts.some((host) => authority === `${host}:${port}`)) {
        return reply(421, { error: "Неизвестный Host. Используйте адрес из списка стенда." });
      }
      const origin = `${protocol}//${authority}`;
      const url = new URL(req.url, origin);
      const allowedOrigins = config.hosts.map((entry) => `${protocol}//${entry.host}:${port}`);
      const requestOrigin = req.headers.origin;
      if (requestOrigin && !allowedOrigins.includes(requestOrigin) && !/^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin)) {
        return reply(403, { error: "Origin не относится к стенду." });
      }
      if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        res.setHeader("Access-Control-Allow-Origin", requestOrigin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        return reply(204, "", "text/plain");
      }
      if (url.pathname === "/health" && req.method === "GET") {
        return reply(200, { fixture: "region-i02", protocol, port, hosts: config.hosts });
      }
      if (req.method === "GET" && url.pathname === "/styles.css") return reply(200, styles, "text/css; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/theme.css") return reply(200, themeStyles, "text/css; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/theme.js") return reply(200, themeScript, "text/javascript; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/client.js") return reply(200, clientScript, "text/javascript; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/i22-client.js") return reply(200, lifecycleClient, "text/javascript; charset=utf-8");
      const workerKind = new Map([["/i22/dedicated-worker.js", "dedicated"], ["/i22/shared-worker.js", "shared"], ["/i22/service-worker.js", "service"]]).get(url.pathname);
      if (req.method === "GET" && workerKind) return reply(200, workerScript(workerKind), "text/javascript; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/favicon.ico") return reply(204, "", "text/plain");

      const runId = url.searchParams.get("run") ?? (url.pathname === "/" || url.pathname === "/frame" || url.pathname === "/lifecycle-target" ? randomUUID() : "");
      if (!runPattern.test(runId)) return reply(400, { error: "Нужен корректный идентификатор run." });

      if (req.method === "GET" && url.pathname === "/api/report") {
        return runs.has(runId) ? reply(200, runs.get(runId)) : reply(404, { error: "Наблюдений этого запуска пока нет." });
      }

      if (req.method === "POST" && url.pathname === "/api/observations") {
        if (requestOrigin !== origin) return reply(403, { error: "Наблюдение принимается только от того же origin." });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32_768) return reply(413, { error: "Слишком большой отчёт." });
          chunks.push(chunk);
        }
        let observation;
        try { observation = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return reply(400, { error: "Ожидается JSON." }); }
        const run = runs.get(runId);
        const documentRequest = run?.requests.find((entry) => entry.id === observation?.firstRead?.requestId && entry.kind === "document");
        if (!documentRequest || documentRequest.origin !== origin || observation.firstRead.runId !== runId || observation.firstRead.href !== documentRequest.url) {
          return reply(400, { error: "Наблюдение не соответствует запросу документа." });
        }
        if (run.observations.some((entry) => entry.firstRead.requestId === documentRequest.id)) {
          return reply(409, { error: "Наблюдение этого документа уже записано." });
        }
        append(run, "observations", observation);
        return reply(201, { recorded: true });
      }

      if (req.method !== "GET" || !["/", "/frame", "/lifecycle-target", "/api/echo", "/external.js", "/redirect"].includes(url.pathname)) {
        return reply(404, { error: "Маршрут не найден." });
      }
      if (!config.hosts.some((entry) => entry.host === url.hostname)) {
        return reply(400, { error: "Откройте страницу через selected.localhost или другой хост стенда." });
      }
      // Only these headers are kept. Cookies and authorization are never copied.
      const network = {
        id: randomUUID(), runId, kind: url.pathname === "/api/echo" ? "fetch" : "document",
        origin, host: url.hostname, url: url.href, method: req.method,
        acceptLanguage: req.headers["accept-language"] ?? null,
        probeHeader: req.headers[config.probeHeader.toLowerCase()] ?? null,
        fetchDest: req.headers["sec-fetch-dest"] ?? null,
        receivedAt: new Date().toISOString()
      };
      if (url.pathname === "/external.js") {
        append(getRun(runId), "resources", { ...network, kind: "script" });
        return reply(200, `Object.defineProperty(window, "__REGION_I02_EXTERNAL_SCRIPT__", { value: Object.freeze({ href: location.href, language: navigator.language, languages: Object.freeze([...navigator.languages]) }) });`, "text/javascript; charset=utf-8");
      }
      if (url.pathname === "/redirect") {
        const target = config.hosts.find((entry) => entry.role === url.searchParams.get("to"));
        if (!target) return reply(400, { error: "Неизвестная цель редиректа; доступны только роли стенда." });
        append(getRun(runId), "resources", { ...network, kind: "redirect" });
        res.setHeader("Location", `${protocol}//${target.host}:${port}/?run=${runId}`);
        return reply(302, "Redirecting", "text/plain; charset=utf-8");
      }
      append(getRun(runId), "requests", network);
      if (url.pathname === "/api/echo") return reply(200, network);
      return reply(200, renderDocument({ network, runId, origin, frame: url.pathname === "/frame", port, protocol }), "text/html; charset=utf-8");
    } catch (error) {
      if (!res.headersSent) reply(500, { error: "Ошибка локального стенда." });
      else res.end();
      console.error(error);
    }
  };

  server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.requestTimeout = 15_000;
  server.headersTimeout = 15_000;
  return server;
}

export async function startFixtureServer({ port = config.httpPort, tls } = {}) {
  const server = createFixtureServer({ tls });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { cert: { type: "string" }, key: { type: "string" } } });
  if (Boolean(values.cert) !== Boolean(values.key)) throw new Error("Для HTTPS нужны оба аргумента: --cert и --key.");
  const servers = [await startFixtureServer()];
  if (values.cert && values.key) {
    const tls = { cert: await readFile(values.cert), key: await readFile(values.key) };
    servers.push(await startFixtureServer({ port: config.httpsPort, tls }));
  }
  for (const server of servers) {
    const protocol = server instanceof https.Server ? "https:" : "http:";
    for (const entry of config.hosts) console.log(`${entry.label}: ${protocol}//${entry.host}:${server.address().port}/`);
  }
  console.log("Сервер слушает только 127.0.0.1. Остановка: Ctrl+C.");
  const close = () => {
    for (const server of servers) { server.close(); server.closeAllConnections(); }
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
