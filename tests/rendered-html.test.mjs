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

test("keeps each account library separate and seeds a private first-use example", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cloud = await readFile(new URL("../app/lume-cloud.ts", import.meta.url), "utf8");

  assert.match(page, /lume-library-v3/);
  assert.match(page, /libraryStoreKey\(nextAccount\.uid\)/);
  assert.match(page, /writeStoredLibrary\(libraryStoreKey\(account\.uid\), snapshot, true\)/);
  assert.match(page, /recoverLocalChanges/);
  assert.match(page, /Esempio · Inizia da qui/);
  assert.match(page, /title: "Scopri Lume"/);
  assert.match(page, /visibility: "private"/);
  assert.match(page, /front: "Lato Esempio"/);
  assert.match(page, /writeStoredLibrary\(guestKey, initialLibrary, false\)/);
  assert.match(page, /lume-first-access-seeded-v1/);
  assert.match(page, /!sampleWasSeeded && !libraryHasContent\(recoveredLibrary\)/);
  assert.match(cloud, /libraryInitialized: true/);
});

test("supports optional example sides without breaking legacy markdown cards", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cloud = await readFile(new URL("../app/lume-cloud.ts", import.meta.url), "utf8");

  assert.match(page, /LUME_EXAMPLE/);
  assert.match(page, /examplesEnabled/);
  assert.match(page, /Mostra esempio/);
  assert.match(page, /maskExampleAnswer/);
  assert.match(page, /revealedCardIds/);
  assert.match(page, /exact front term or expression exactly once/);
  assert.match(page, /splitInlineExample/);
  assert.match(page, /term :: definition/);
  assert.match(cloud, /example\?: string/);
  assert.match(cloud, /examplesEnabled\?: boolean/);
});

test("presents each study mode with onboarding and its own prompt", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /Modalità del set/);
  assert.match(page, /Modalità normale/);
  assert.match(page, /Le classiche flashcard fronte e retro/);
  assert.match(page, /Come funziona Lato Esempio/);
  assert.match(page, /Come funziona Keyword Help/);
  assert.match(page, /Prompt · Lato Esempio/);
  assert.match(page, /Copia questo prompt/);
  assert.match(page, /Salva il risultato come/);
  assert.doesNotMatch(page, /Prepara il set con un LLM/);
});

test("keeps session preferences out of set creation and uses the new study controls", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(page, /Ordine predefinito|Verso predefinito/);
  assert.match(page, /Ordine delle carte/);
  assert.match(page, /Lato mostrato per primo/);
  assert.match(page, /<strong>Studio<\/strong>/);
  assert.match(page, /<strong>Test<\/strong>/);
  assert.doesNotMatch(page, /01 · Impara|Ripeti finché resta|Una risposta, poi il risultato|Memorizzazione attiva|Verifica finale/);
  assert.match(page, /event\.key === "Enter"/);
  assert.match(page, /event\.key === "Backspace" \|\| event\.key === "Delete"/);
  assert.match(page, /Spazio gira · Invio La so · Cancella Non la so/);
  assert.match(page, /Spazio premuto/);
});
