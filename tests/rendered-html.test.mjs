import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function renderPage(headers = {}, pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${Math.random()}`,
  );
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", ...headers },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders development preview metadata", async () => {
  const response = await renderPage();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("renders registration landing for anonymous visitors", async () => {
  const response = await renderPage();
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Войти или зарегистрироваться/i);
  assert.match(html, /\/signin-with-chatgpt\?return_to=%2F/);
});

test("renders the personal workspace for an authenticated user", async () => {
  const response = await renderPage({
    "oai-authenticated-user-email": "andrey@example.com",
    "oai-authenticated-user-full-name": encodeURIComponent("Андрей Ким"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /FlowTrack/);
  assert.match(html, /andrey@example\.com/);
  assert.match(html, /\/signout-with-chatgpt\?return_to=%2F/);
  assert.match(html, /aria-label="Открыть профиль и настройки"/);
});

test("renders Team Workspace only for an authenticated user", async () => {
  const response = await renderPage(
    {
      "oai-authenticated-user-email": "team@example.com",
      "oai-authenticated-user-full-name": encodeURIComponent("Участник Команды"),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
    "/team",
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Открываем Team Workspace/);
  assert.match(html, /Подключаем общие проекты и участников/);
});
