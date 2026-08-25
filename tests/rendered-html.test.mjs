import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
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

test("renders the Lume application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lume — Flashcards, al tuo ritmo<\/title>/i);
  assert.match(html, /Lume/);
  assert.match(html, /Unlimited learning/);
  assert.match(html, /Nuovo set/);
  assert.match(html, /Le tue flashcards/);
  assert.match(html, /Fai il login per salvare i tuoi set/);
  assert.match(html, /Flashcard a caso/);
  assert.match(html, /Continua a studiare/);
  assert.match(html, /favicon\.svg/);
  assert.match(html, /Esplora/);
  assert.match(html, /Flashcard pubbliche/);
  assert.match(html, /Accedi/);
  assert.doesNotMatch(html, /Recupero attivo/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});
