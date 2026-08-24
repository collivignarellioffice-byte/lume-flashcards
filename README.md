# Lume

Lume è uno spazio gratuito e accogliente per creare set di flashcard, organizzarli
in cartelle e studiare al proprio ritmo. Funziona anche senza account; con un
accesso Google o tramite link email, set, cartelle, progressi e preferenze vengono
sincronizzati in modo privato su Firestore.

## Cosa include

- cartelle, set e flashcard senza limiti imposti dall’app;
- colori, font ed emoji personalizzati per ogni set e per le sue carte;
- modalità chiara e scura, con tre stili di lettura;
- sessioni “La so / Non ancora” e ripasso dei soli errori;
- studio di un singolo set o di un’intera cartella, in ordine o in modalità casuale;
- set pubblici ricercabili e set privati, con sincronizzazione Firebase;
- editor con neretto, corsivo e sottolineato e modalità Keyword Help;
- ricerca, statistiche essenziali ed esportazione/importazione dei dati;
- pioggia e rumore bruno generati nel browser;
- Aria dalle Variazioni Goldberg di Bach, registrazione CC0 da Wikimedia Commons.

## Avvio locale

Serve Node.js 22.13 o successivo.

```bash
npm install
npm run dev:pages
```

## Pubblicazione con GitHub Pages

Il progetto contiene già il workflow `.github/workflows/deploy-pages.yml`.
Dopo averlo caricato su un repository GitHub:

1. apri **Settings → Pages**;
2. in **Build and deployment**, scegli **GitHub Actions**;
3. esegui un push sul branch `main` oppure avvia manualmente il workflow.

Ogni push su `main` costruirà e pubblicherà il sito. La configurazione Firebase
pubblica è già inclusa nel workflow; i dati personali non vengono inviati al
repository. Senza account restano nel browser, mentre dopo l’accesso vengono
salvati nel profilo Firestore protetto dell’utente.

## Firebase

Il progetto usa `lume-flashcards-mcv`, database Firestore `(default)` in area
europea `eur3`, piano Spark gratuito e protezione dall’eliminazione attiva.
Le regole in `firestore.rules` consentono a ogni utente di leggere e modificare
solo il proprio profilo; i set marcati come pubblici sono consultabili da tutti.

Per pubblicare modifiche alle regole:

```bash
npm run firebase:deploy
```

## Comandi utili

- `npm run dev:pages`: anteprima statica, uguale a GitHub Pages;
- `npm run build:pages`: crea il sito statico in `gh-pages/`;
- `npm run dev`: anteprima vinext;
- `npm test`: verifica entrambe le versioni del progetto.
