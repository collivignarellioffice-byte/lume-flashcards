import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /Il mio spazio/);
  assert.match(html, /Le mie cartelle/);
  assert.match(html, /Riprendi da qui/);
  assert.match(html, /Flashcard a caso/);
  assert.match(html, /Crea il tuo primo set per iniziare/);
  assert.match(html, /Preferenze/);
  assert.match(html, /Timer Lume/);
  assert.match(html, /Respira/);
  assert.match(html, /Può contenere cartelle e set/);
  assert.match(html, /giorn[oi] consecutiv[oi]/);
  assert.match(html, /Avvia subito la candela/);
  assert.doesNotMatch(html, /I colori iniziano da qui/);
  assert.match(html, /favicon\.svg/);
  assert.match(html, /Esplora/);
  assert.doesNotMatch(html, /Recupero attivo/);
  assert.doesNotMatch(html, /Metti lo studio in pausa/);
  assert.doesNotMatch(html, /<strong>Workspace<\/strong>/);
  assert.doesNotMatch(html, /📚|🧠|🎨|💬/u);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps each account library separate and seeds one private example", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cloud = await readFile(new URL("../app/lume-cloud.ts", import.meta.url), "utf8");

  assert.match(page, /lume-library-v3/);
  assert.match(page, /libraryStoreKey\(nextAccount\.uid\)/);
  assert.match(page, /Esempio · Inizia da qui/);
  assert.match(page, /title: "Scopri Lume"/);
  assert.match(page, /visibility: "private"/);
  assert.match(cloud, /libraryInitialized: true/);
});
