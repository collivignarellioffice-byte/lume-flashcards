"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
} from "firebase/firestore";

type Card = {
  id: string;
  front: string;
  back: string;
  known: number;
  missed: number;
};

type FontChoice =
  | "mono"
  | "helvetica"
  | "caecilia"
  | "baskerville"
  | "bookerly"
  | "futura"
  | "palatino"
  | "comic-sans-dm";

type Deck = {
  id: string;
  folderId: string;
  emoji: string;
  title: string;
  description: string;
  color: string;
  cardColor: string;
  font?: FontChoice;
  visibility: "private" | "public";
  keywordHelp: boolean;
  cards: Card[];
  createdAt: number;
  lastStudied?: number;
};

type Folder = {
  id: string;
  title: string;
  color: string;
  emoji: string;
  createdAt: number;
};

type Settings = {
  theme: "light" | "dark";
  font: FontChoice;
  volume: number;
};

type View =
  | { name: "home" }
  | { name: "library" }
  | { name: "community" }
  | { name: "folder"; folderId: string }
  | { name: "deck"; deckId: string }
  | { name: "study" };

type StudyTarget = {
  kind: "deck" | "folder" | "public";
  id: string;
};

type StudyRequest = {
  target: StudyTarget;
  cardIds?: string[];
};

type StudyOrder = "sequential" | "random";

type StudySession = {
  target: StudyTarget;
  queue: string[];
  originalQueue: string[];
  order: StudyOrder;
  index: number;
  known: number;
  wrong: string[];
  streak: number;
  bestStreak: number;
  points: number;
  direction: "front-first" | "back-first";
  flipped: boolean;
  complete: boolean;
};

type PublicDeck = Deck & {
  catalogId: string;
  ownerId: string;
  author: string;
};

type SoundMode = "off" | "rain" | "brown" | "bach";

type ImportPair = {
  front: string;
  back: string;
};

const STORAGE_KEY = "lume-flashcards-v1";
const FOLDERS_KEY = "lume-folders-v1";
const SETTINGS_KEY = "lume-settings-v1";
const DEFAULT_FOLDER_ID = "cartella-prova";
const FLASHCARD_MARKDOWN_PROMPT = `Convert my rough list of study concepts into a downloadable UTF-8 Markdown file named flashcards.md. Inside the file, write exactly one flashcard per line in this format:
term :: definition

Organize and deduplicate the concepts, correct obvious mistakes, and write concise, clear definitions without changing the meaning. Do not add headings, bullets, numbering, tables, code fences, comments, or any text before or after the cards.

My rough list:
[PASTE IT HERE]`;
const AUTH_EMAIL_KEY = "lume-auth-email-v1";
const BACH_AUDIO =
  "https://commons.wikimedia.org/wiki/Special:Redirect/file/Bach%2C%20Goldberg%20Variations%2C%20Aria%20%28Musopen%20version%29.ogg";
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ?? "",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() ?? "",
};
const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);
const firebaseApp = firebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;
const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
const firestore = firebaseApp ? getFirestore(firebaseApp) : null;

const fontOptions: Array<{
  value: FontChoice;
  label: string;
  family: string;
}> = [
  {
    value: "mono",
    label: "Mono",
    family: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  {
    value: "helvetica",
    label: "Helvetica",
    family: "Helvetica, Arial, ui-sans-serif, sans-serif",
  },
  {
    value: "caecilia",
    label: "Caecilia",
    family: 'Caecilia, "PMN Caecilia", Rockwell, Georgia, serif',
  },
  {
    value: "baskerville",
    label: "Baskerville",
    family: 'Baskerville, "Baskerville Old Face", Georgia, serif',
  },
  {
    value: "bookerly",
    label: "Bookerly",
    family: 'Bookerly, Georgia, "Times New Roman", serif',
  },
  {
    value: "futura",
    label: "Futura",
    family: 'Futura, "Century Gothic", "Avenir Next", Arial, sans-serif',
  },
  {
    value: "palatino",
    label: "Palatino",
    family: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
  },
  {
    value: "comic-sans-dm",
    label: "ComicSansDM",
    family: 'ComicSansDM, "Comic Sans MS", "Comic Sans", cursive',
  },
];

const supportedFonts = new Set<FontChoice>(
  fontOptions.map((option) => option.value),
);

function normalizeFont(value: unknown): FontChoice {
  return typeof value === "string" && supportedFonts.has(value as FontChoice)
    ? (value as FontChoice)
    : "helvetica";
}

function fontFamily(font?: FontChoice) {
  return (
    fontOptions.find((option) => option.value === font)?.family ??
    "var(--body-font)"
  );
}

const palettes = [
  { name: "Terracotta", color: "#bf664f", card: "#f5ddd4" },
  { name: "Salvia", color: "#668171", card: "#dce8df" },
  { name: "Prugna", color: "#775566", card: "#eadde3" },
  { name: "Blu sera", color: "#526b84", card: "#dce5ed" },
  { name: "Ocra", color: "#b4863e", card: "#f2e6c9" },
];

const emojiOptions = ["📚", "🧠", "📝", "🎨", "🌍", "🔬", "🏛️", "💬", "✨", "📌"];

const demoFolders: Folder[] = [
  {
    id: DEFAULT_FOLDER_ID,
    title: "Cartella prova",
    color: "#e8c47d",
    emoji: "📚",
    createdAt: 1,
  },
];

const demoDecks: Deck[] = [
  {
    id: "psicologia-cognitiva",
    folderId: DEFAULT_FOLDER_ID,
    emoji: "🧠",
    title: "Psicologia cognitiva",
    description: "Memoria, attenzione e apprendimento",
    color: "#bf664f",
    cardColor: "#f5ddd4",
    visibility: "private",
    keywordHelp: true,
    createdAt: 1,
    lastStudied: Date.now() - 1000 * 60 * 60 * 22,
    cards: [
      {
        id: "p1",
        front: "Che cos’è la memoria di lavoro?",
        back: "Un sistema a <strong>capacità limitata</strong> che mantiene e manipola temporaneamente le informazioni necessarie a un compito.",
        known: 5,
        missed: 1,
      },
      {
        id: "p2",
        front: "Effetto di posizione seriale",
        back: "Tendenza a ricordare meglio gli elementi all’inizio (<strong>primacy</strong>) e alla fine (<strong>recency</strong>) di una lista.",
        known: 2,
        missed: 3,
      },
      {
        id: "p3",
        front: "Che cos’è la pratica distribuita?",
        back: "La distribuzione dello studio in <strong>sessioni separate nel tempo</strong>, più efficace della pratica concentrata.",
        known: 4,
        missed: 0,
      },
      {
        id: "p4",
        front: "Interferenza retroattiva",
        back: "Le <strong>informazioni apprese più di recente</strong> ostacolano il recupero di quelle apprese in precedenza.",
        known: 1,
        missed: 2,
      },
      {
        id: "p5",
        front: "Metacognizione",
        back: "La <strong>consapevolezza</strong> e la <strong>regolazione</strong> dei propri processi cognitivi e di apprendimento.",
        known: 3,
        missed: 1,
      },
      {
        id: "p6",
        front: "Testing effect",
        back: "Il <strong>recupero attivo</strong> delle informazioni migliora la memoria più della semplice rilettura.",
        known: 2,
        missed: 0,
      },
    ],
  },
  {
    id: "storia-design",
    folderId: DEFAULT_FOLDER_ID,
    emoji: "🎨",
    title: "Storia del design",
    description: "Movimenti, oggetti e progettisti",
    color: "#775566",
    cardColor: "#eadde3",
    visibility: "private",
    keywordHelp: false,
    createdAt: 2,
    cards: [
      {
        id: "d1",
        front: "In che anno nasce il Bauhaus?",
        back: "Nel 1919 a Weimar, fondato da Walter Gropius.",
        known: 1,
        missed: 0,
      },
      {
        id: "d2",
        front: "Principio centrale del Bauhaus",
        back: "Unire arte, artigianato e produzione industriale in una progettazione funzionale.",
        known: 0,
        missed: 1,
      },
      {
        id: "d3",
        front: "Chi progettò la sedia Wassily?",
        back: "Marcel Breuer, tra il 1925 e il 1926.",
        known: 0,
        missed: 0,
      },
      {
        id: "d4",
        front: "Che cos’è il Good Design?",
        back: "Un approccio che promuove oggetti accessibili, funzionali e adatti alla produzione di massa.",
        known: 0,
        missed: 0,
      },
    ],
  },
  {
    id: "inglese-c1",
    folderId: DEFAULT_FOLDER_ID,
    emoji: "💬",
    title: "English · C1",
    description: "Lessico per scrittura e conversazione",
    color: "#668171",
    cardColor: "#dce8df",
    visibility: "private",
    keywordHelp: false,
    createdAt: 3,
    cards: [
      {
        id: "e1",
        front: "To shed light on",
        back: "Fare luce su; chiarire o rendere più comprensibile qualcosa.",
        known: 3,
        missed: 0,
      },
      {
        id: "e2",
        front: "Compelling",
        back: "Convincente, avvincente, capace di attirare fortemente l’attenzione.",
        known: 1,
        missed: 2,
      },
      {
        id: "e3",
        front: "Notwithstanding",
        back: "Nonostante; malgrado. Può funzionare come preposizione, avverbio o congiunzione.",
        known: 0,
        missed: 0,
      },
    ],
  },
];

const demoCommunityDecks: PublicDeck[] = [
  {
    id: "community-neuroscienze",
    catalogId: "demo:community-neuroscienze",
    ownerId: "lume-curated",
    author: "Lume Curated",
    folderId: "community",
    emoji: "🧬",
    title: "Neuroscienze essenziali",
    description: "Neuroni, sinapsi e plasticità cerebrale",
    color: "#526b84",
    cardColor: "#dce5ed",
    font: "helvetica",
    visibility: "public",
    keywordHelp: true,
    createdAt: 10,
    cards: [
      { id: "cn1", front: "Che cos’è la plasticità sinaptica?", back: "La capacità delle <strong>connessioni tra neuroni</strong> di rafforzarsi o indebolirsi in risposta all’esperienza.", known: 0, missed: 0 },
      { id: "cn2", front: "Funzione della mielina", back: "Isola gli assoni e rende più rapida la <strong>trasmissione dell’impulso nervoso</strong>.", known: 0, missed: 0 },
    ],
  },
  {
    id: "community-storia-arte",
    catalogId: "demo:community-storia-arte",
    ownerId: "studio-aperto",
    author: "Studio Aperto",
    folderId: "community",
    emoji: "🖼️",
    title: "Avanguardie artistiche",
    description: "Un ripasso rapido dal Futurismo al Surrealismo",
    color: "#b4863e",
    cardColor: "#f2e6c9",
    font: "baskerville",
    visibility: "public",
    keywordHelp: false,
    createdAt: 11,
    cards: [
      { id: "ca1", front: "Quando nasce il Futurismo?", back: "Nel 1909 con la pubblicazione del manifesto di Filippo Tommaso Marinetti.", known: 0, missed: 0 },
      { id: "ca2", front: "Tema centrale del Surrealismo", back: "L’esplorazione dell’inconscio, del sogno e dell’automatismo psichico.", known: 0, missed: 0 },
    ],
  },
  {
    id: "community-inglese-academic",
    catalogId: "demo:community-inglese-academic",
    ownerId: "language-notes",
    author: "Language Notes",
    folderId: "community",
    emoji: "✍️",
    title: "Academic English",
    description: "Espressioni utili per saggi e presentazioni",
    color: "#668171",
    cardColor: "#dce8df",
    font: "bookerly",
    visibility: "public",
    keywordHelp: false,
    createdAt: 12,
    cards: [
      { id: "ce1", front: "To account for", back: "Spiegare o rappresentare la causa di qualcosa.", known: 0, missed: 0 },
      { id: "ce2", front: "A compelling argument", back: "Un’argomentazione particolarmente convincente e persuasiva.", known: 0, missed: 0 },
    ],
  },
];

const defaultSettings: Settings = {
  theme: "light",
  font: "helvetica",
  volume: 0.28,
};

function sanitizeRichText(value: unknown) {
  if (typeof value !== "string") return "";
  const tokens: string[] = [];
  const protectedValue = value.replace(
    /<\s*(\/?)\s*(strong|b|em|i|u|br)\b[^>]*>/gi,
    (_, closing: string, tag: string) => {
      const canonical = tag.toLowerCase() === "b"
        ? "strong"
        : tag.toLowerCase() === "i"
          ? "em"
          : tag.toLowerCase();
      const token = canonical === "br" ? "<br>" : `<${closing ? "/" : ""}${canonical}>`;
      tokens.push(token);
      return `%%LUME_TAG_${tokens.length - 1}%%`;
    },
  );
  return protectedValue
    .replace(/<[^>]*>/g, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/%%LUME_TAG_(\d+)%%/g, (_, index: string) => tokens[Number(index)] ?? "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function plainText(value: unknown) {
  return sanitizeRichText(value)
    .replace(/<br>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function inlineMarkdown(value: string) {
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return sanitizeRichText(
    escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>"),
  );
}

function hasBoldKeywords(value: string) {
  return /<strong>[^<]+<\/strong>/i.test(sanitizeRichText(value));
}

function keywordMarkup(value: string) {
  let insideStrong = false;
  return sanitizeRichText(value)
    .split(/(<\/?(?:strong|em|u)>|<br>)/i)
    .map((part) => {
      if (!part) return "";
      if (/^<strong>$/i.test(part)) {
        insideStrong = true;
        return part;
      }
      if (/^<\/strong>$/i.test(part)) {
        insideStrong = false;
        return part;
      }
      if (/^</.test(part)) return part;
      return `<span class="${insideStrong ? "keyword-visible" : "keyword-hidden"}">${part}</span>`;
    })
    .join("");
}

const psychologyKeywordPatterns: Record<string, string[]> = {
  p1: ["capacità limitata"],
  p2: ["primacy", "recency"],
  p3: ["sessioni separate nel tempo"],
  p4: ["informazioni apprese più di recente"],
  p5: ["consapevolezza", "regolazione"],
  p6: ["recupero attivo"],
};

function addPsychologyKeywords(card: Card) {
  if (hasBoldKeywords(card.back)) return card;
  const patterns = psychologyKeywordPatterns[card.id] ?? [];
  return {
    ...card,
    back: patterns.reduce(
      (text, pattern) => text.replace(pattern, `<strong>${pattern}</strong>`),
      card.back,
    ),
  };
}

function normalizeFolders(value: unknown): Folder[] {
  if (!Array.isArray(value) || !value.length) return demoFolders;
  return value
    .filter((folder) => folder && typeof folder === "object")
    .map((folder, index) => {
      const candidate = folder as Partial<Folder>;
      return {
        id: typeof candidate.id === "string" ? candidate.id : uid("folder"),
        title:
          typeof candidate.title === "string" && candidate.title.trim()
            ? candidate.title
            : `Cartella ${index + 1}`,
        color: typeof candidate.color === "string" ? candidate.color : "#e8c47d",
        emoji: typeof candidate.emoji === "string" ? candidate.emoji : emojiOptions[index % emojiOptions.length],
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now() + index,
      };
    });
}

function normalizeDecks(value: unknown): Deck[] {
  if (!Array.isArray(value)) return demoDecks;
  return value
    .filter((deck) => deck && typeof deck === "object")
    .map((deck, index) => {
      const candidate = deck as Partial<Deck>;
      const title =
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title
          : `Set ${index + 1}`;
      const keywordHelp =
        typeof candidate.keywordHelp === "boolean"
          ? candidate.keywordHelp
          : title.toLowerCase() === "psicologia cognitiva";
      const cards = (Array.isArray(candidate.cards) ? candidate.cards : [])
        .filter((card) => card && typeof card === "object")
        .map((card) => {
          const item = card as Partial<Card>;
          return {
            id: typeof item.id === "string" ? item.id : uid("card"),
            front: sanitizeRichText(item.front),
            back: sanitizeRichText(item.back),
            known: typeof item.known === "number" ? item.known : 0,
            missed: typeof item.missed === "number" ? item.missed : 0,
          } satisfies Card;
        })
        .map((card) =>
          keywordHelp && title.toLowerCase() === "psicologia cognitiva"
            ? addPsychologyKeywords(card)
            : card,
        );
      return {
        ...candidate,
        id: typeof candidate.id === "string" ? candidate.id : uid("deck"),
        folderId:
          typeof candidate.folderId === "string"
            ? candidate.folderId
            : DEFAULT_FOLDER_ID,
        emoji:
          typeof candidate.emoji === "string"
            ? candidate.emoji
            : emojiOptions[(index + 1) % emojiOptions.length],
        title,
        description:
          typeof candidate.description === "string" ? candidate.description : "",
        color: typeof candidate.color === "string" ? candidate.color : palettes[0].color,
        cardColor:
          typeof candidate.cardColor === "string" ? candidate.cardColor : palettes[0].card,
        font: normalizeFont(candidate.font),
        visibility: candidate.visibility === "public" ? "public" : "private",
        keywordHelp,
        cards,
        createdAt:
          typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now() + index,
      } as Deck;
    });
}

function normalizePublicDeck(value: unknown, fallbackId: string): PublicDeck | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PublicDeck>;
  const normalized = normalizeDecks([{ ...candidate, folderId: "community", visibility: "public" }])[0];
  if (!normalized) return null;
  return {
    ...normalized,
    catalogId: typeof candidate.catalogId === "string" ? candidate.catalogId : fallbackId,
    ownerId: typeof candidate.ownerId === "string" ? candidate.ownerId : "community",
    author: typeof candidate.author === "string" && candidate.author.trim() ? candidate.author : "Studente Lume",
  };
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return "Mai studiato";
  const hours = Math.floor((Date.now() - timestamp) / 3_600_000);
  if (hours < 1) return "Poco fa";
  if (hours < 24) return `${hours} ${hours === 1 ? "ora" : "ore"} fa`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "giorno" : "giorni"} fa`;
}

function mastery(deck: Deck) {
  const known = deck.cards.reduce((sum, card) => sum + card.known, 0);
  const attempts = deck.cards.reduce(
    (sum, card) => sum + card.known + card.missed,
    0,
  );
  return attempts ? Math.round((known / attempts) * 100) : 0;
}

function getTextColor(hex: string) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 155
    ? "#2b2925"
    : "#fffdf8";
}

function cleanMarkdown(value: string) {
  return inlineMarkdown(value.replace(/^[-*+]\s+/, "").trim());
}

function parseStudyMarkdown(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const pairs = lines
    .map((line) => {
      const match = line.match(/^\s*(.+?)\s*::\s*(.+?)\s*$/);
      return match
        ? { front: cleanMarkdown(match[1]), back: cleanMarkdown(match[2]) }
        : null;
    })
    .filter((pair): pair is ImportPair => Boolean(pair?.front && pair?.back));

  return pairs;
}

export default function Home() {
  const [decks, setDecks] = useState<Deck[]>(demoDecks);
  const [folders, setFolders] = useState<Folder[]>(demoFolders);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [view, setView] = useState<View>({ name: "home" });
  const [hydrated, setHydrated] = useState(false);
  const [deckModalOpen, setDeckModalOpen] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState<string>();
  const [draftFolderId, setDraftFolderId] = useState(DEFAULT_FOLDER_ID);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string>();
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [studyCardEditId, setStudyCardEditId] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authResolved, setAuthResolved] = useState(!firebaseAuth);
  const [authMessage, setAuthMessage] = useState("");
  const [cloudReady, setCloudReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundPanelOpen, setSoundPanelOpen] = useState(false);
  const [soundMode, setSoundMode] = useState<SoundMode>("off");
  const [study, setStudy] = useState<StudySession>();
  const [studyRequest, setStudyRequest] = useState<StudyRequest>();
  const [studySettingsOpen, setStudySettingsOpen] = useState(false);
  const [remotePublicDecks, setRemotePublicDecks] = useState<PublicDeck[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const noiseSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const storedDecks = localStorage.getItem(STORAGE_KEY);
        const storedFolders = localStorage.getItem(FOLDERS_KEY);
        const storedSettings = localStorage.getItem(SETTINGS_KEY);
        if (storedDecks) setDecks(normalizeDecks(JSON.parse(storedDecks)));
        setFolders(
          storedFolders
            ? normalizeFolders(JSON.parse(storedFolders))
            : demoFolders,
        );
        if (storedSettings) {
          const parsedSettings = JSON.parse(storedSettings);
          setSettings({
            ...defaultSettings,
            ...parsedSettings,
            font: normalizeFont(parsedSettings.font),
          });
        }
      } catch {
        // If local data is malformed, the app safely falls back to demo content.
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  }, [decks, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  }, [folders, hydrated]);

  useEffect(() => {
    if (hydrated)
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.font = settings.font;
    document.documentElement.style.colorScheme = settings.theme;
    if (gainRef.current) gainRef.current.gain.value = settings.volume;
    if (audioRef.current) audioRef.current.volume = settings.volume;
  }, [settings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (!firebaseAuth) {
      setAuthResolved(true);
      return;
    }

    let cancelled = false;
    let unsubscribe: () => void = () => undefined;

    const restoreSession = async () => {
      try {
        await setPersistence(firebaseAuth, browserLocalPersistence);
      } catch {
        // Firebase will fall back to the persistence available in the browser.
      }

      if (isSignInWithEmailLink(firebaseAuth, window.location.href)) {
        const email = localStorage.getItem(AUTH_EMAIL_KEY);
        if (email) {
          try {
            await signInWithEmailLink(firebaseAuth, email, window.location.href);
            localStorage.removeItem(AUTH_EMAIL_KEY);
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch {
            setAuthMessage("Il link non è più valido. Richiedine uno nuovo.");
          }
        }
      }

      if (cancelled) return;
      unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
        setUser(nextUser);
        setAuthResolved(true);
        if (nextUser) setAccountOpen(false);
        if (!nextUser) setCloudReady(false);
      });
    };

    void restoreSession();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hydrated]);

  const stopSound = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    try {
      noiseSourceRef.current?.stop();
    } catch {
      // The node may already be stopped.
    }
    noiseSourceRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    gainRef.current = null;
  }, []);

  useEffect(() => stopSound, [stopSound]);

  const playSound = (mode: SoundMode) => {
    stopSound();
    setSoundMode(mode);
    if (mode === "off") return;

    if (mode === "bach") {
      const audio = new Audio(BACH_AUDIO);
      audio.loop = true;
      audio.volume = settings.volume;
      audioRef.current = audio;
      void audio.play().catch(() => setSoundMode("off"));
      return;
    }

    const context = new AudioContext();
    const length = context.sampleRate * 4;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (mode === "brown") {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white * 0.34;
      }
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = mode === "rain" ? "highpass" : "lowpass";
    filter.frequency.value = mode === "rain" ? 900 : 850;
    gain.gain.value = settings.volume;
    source.buffer = buffer;
    source.loop = true;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    audioContextRef.current = context;
    noiseSourceRef.current = source;
    gainRef.current = gain;
  };

  const selectedDeck =
    view.name === "deck"
      ? decks.find((deck) => deck.id === view.deckId)
      : undefined;
  const selectedFolder =
    view.name === "folder"
      ? folders.find((folder) => folder.id === view.folderId)
      : selectedDeck
        ? folders.find((folder) => folder.id === selectedDeck.folderId)
        : undefined;
  const authUserId = user?.uid;
  const localPublicDecks = useMemo<PublicDeck[]>(
    () =>
      decks
        .filter((deck) => deck.visibility === "public")
        .map((deck) => ({
          ...deck,
          catalogId: authUserId ? `${authUserId}_${deck.id}` : `local:${deck.id}`,
          ownerId: authUserId ?? "local-user",
          author: user?.email?.split("@")[0] ?? "Il tuo set pubblico",
        })),
    [authUserId, decks, user?.email],
  );
  const publicCatalog = useMemo(() => {
    const catalog = [...localPublicDecks, ...remotePublicDecks, ...demoCommunityDecks];
    const seen = new Set<string>();
    return catalog.filter((deck) => {
      const key = deck.catalogId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [localPublicDecks, remotePublicDecks]);
  const studySourceDecks = useMemo(() => {
    if (!study) return [];
    if (study.target.kind === "deck") {
      const deck = decks.find((item) => item.id === study.target.id);
      return deck ? [deck] : [];
    }
    if (study.target.kind === "folder") {
      return decks.filter((deck) => deck.folderId === study.target.id);
    }
    const publicDeck = publicCatalog.find((deck) => deck.catalogId === study.target.id);
    return publicDeck ? [publicDeck] : [];
  }, [decks, publicCatalog, study]);
  const studyDisplayDeck = useMemo<Deck | undefined>(() => {
    if (!study || !studySourceDecks.length) return undefined;
    if (study.target.kind !== "folder") return studySourceDecks[0];
    const folder = folders.find((item) => item.id === study.target.id);
    const first = studySourceDecks[0];
    return {
      ...first,
      id: `folder-study:${folder?.id ?? study.target.id}`,
      title: folder?.title ?? "Cartella",
      description: "Studio completo della cartella",
      color: folder?.color ?? first.color,
      cards: studySourceDecks.flatMap((deck) => deck.cards),
      keywordHelp: studySourceDecks.some((deck) => deck.keywordHelp),
    };
  }, [folders, study, studySourceDecks]);
  const currentStudyCardId = study?.queue[study.index];
  const currentStudyOwnerDeck = studySourceDecks.find((deck) =>
    deck.cards.some((card) => card.id === currentStudyCardId),
  );
  const editingStudyCard = decks
    .flatMap((deck) => deck.cards)
    .find((card) => card.id === studyCardEditId);

  useEffect(() => {
    if (!firestore || !authUserId || !hydrated) return;
    let cancelled = false;

    const loadCloudProfile = async () => {
      setCloudReady(false);
      try {
        const profileRef = doc(firestore, "users", authUserId);
        const snapshot = await getDoc(profileRef);
        if (cancelled) return;
        const data = snapshot.exists() ? snapshot.data() : null;
        if (data?.decks && Array.isArray(data.decks)) {
          setFolders(normalizeFolders(data.folders));
          setDecks(normalizeDecks(data.decks));
          if (data.settings && typeof data.settings === "object") {
            const remoteSettings = data.settings as Partial<Settings>;
            setSettings((current) => ({
              ...current,
              ...remoteSettings,
              font: normalizeFont(remoteSettings.font),
            }));
          }
        } else {
          await setDoc(
            profileRef,
            {
              decks: JSON.parse(JSON.stringify(decks)),
              folders: JSON.parse(JSON.stringify(folders)),
              settings,
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        }
        if (!cancelled) setCloudReady(true);
      } catch {
        setAuthMessage(
          "Accesso riuscito, ma la sincronizzazione Firebase deve ancora essere attivata.",
        );
      }
    };

    void loadCloudProfile();
    return () => {
      cancelled = true;
    };
    // The first cloud load intentionally uses the current local data only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, hydrated]);

  useEffect(() => {
    if (!firestore || !authUserId || !cloudReady) return;
    const timer = window.setTimeout(() => {
      void setDoc(
        doc(firestore, "users", authUserId),
        {
          decks: JSON.parse(JSON.stringify(decks)),
          folders: JSON.parse(JSON.stringify(folders)),
          settings,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }, 700);
    return () => window.clearTimeout(timer);
  }, [authUserId, cloudReady, decks, folders, settings]);

  const refreshCommunity = useCallback(async () => {
    if (!firestore) return;
    try {
      const snapshot = await getDocs(collection(firestore, "publicSets"));
      const next = snapshot.docs
        .map((item) => normalizePublicDeck(item.data(), item.id))
        .filter((deck): deck is PublicDeck => Boolean(deck));
      setRemotePublicDecks(next);
    } catch {
      // The curated public catalog remains available while Firebase is offline.
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refreshCommunity());
  }, [refreshCommunity]);

  useEffect(() => {
    if (!firestore || !authUserId || !cloudReady) return;
    const timer = window.setTimeout(() => {
      void Promise.all(
        decks.map((deck) => {
          const reference = doc(firestore, "publicSets", `${authUserId}_${deck.id}`);
          if (deck.visibility !== "public") return Promise.resolve();
          return setDoc(reference, {
            id: deck.id,
            folderId: "community",
            emoji: deck.emoji,
            title: deck.title,
            description: deck.description,
            color: deck.color,
            cardColor: deck.cardColor,
            font: deck.font,
            visibility: "public",
            keywordHelp: deck.keywordHelp,
            createdAt: deck.createdAt,
            cards: deck.cards.map((card) => ({
              id: card.id,
              front: card.front,
              back: card.back,
              known: 0,
              missed: 0,
            })),
            catalogId: `${authUserId}_${deck.id}`,
            ownerId: authUserId,
            author: user?.email?.split("@")[0] ?? "Studente Lume",
            publishedAt: Date.now(),
          });
        }),
      ).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [authUserId, cloudReady, decks, user?.email]);

  const totalCards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const dueCards = decks.reduce(
    (sum, deck) =>
      sum + deck.cards.filter((card) => card.missed > card.known).length,
    0,
  );
  const overallMastery = useMemo(() => {
    const all = decks.flatMap((deck) => deck.cards);
    const known = all.reduce((sum, card) => sum + card.known, 0);
    const attempts = all.reduce(
      (sum, card) => sum + card.known + card.missed,
      0,
    );
    return attempts ? Math.round((known / attempts) * 100) : 0;
  }, [decks]);

  const navigate = (next: View) => {
    setView(next);
    setSettingsOpen(false);
    setSoundPanelOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openCreateDeck = (folderId?: string) => {
    setEditingDeckId(undefined);
    setDraftFolderId(folderId ?? folders[0]?.id ?? DEFAULT_FOLDER_ID);
    setDeckModalOpen(true);
  };

  const openCreateFolder = () => {
    setEditingFolderId(undefined);
    setFolderModalOpen(true);
  };

  const saveFolder = (data: Omit<Folder, "id" | "createdAt">) => {
    if (editingFolderId) {
      setFolders((current) =>
        current.map((folder) =>
          folder.id === editingFolderId ? { ...folder, ...data } : folder,
        ),
      );
    } else {
      const folder: Folder = {
        ...data,
        id: uid("folder"),
        createdAt: Date.now(),
      };
      setFolders((current) => [...current, folder]);
      navigate({ name: "folder", folderId: folder.id });
    }
    setFolderModalOpen(false);
  };

  const saveDeck = (data: Omit<Deck, "id" | "cards" | "createdAt">) => {
    if (editingDeckId) {
      const previous = decks.find((deck) => deck.id === editingDeckId);
      if (
        previous?.visibility === "public" &&
        data.visibility === "private" &&
        firestore &&
        authUserId
      ) {
        const catalogId = `${authUserId}_${editingDeckId}`;
        void deleteDoc(doc(firestore, "publicSets", catalogId)).catch(() => undefined);
        setRemotePublicDecks((current) =>
          current.filter((deck) => deck.catalogId !== catalogId),
        );
      }
      setDecks((current) =>
        current.map((deck) =>
          deck.id === editingDeckId ? { ...deck, ...data } : deck,
        ),
      );
    } else {
      const deck: Deck = {
        ...data,
        id: uid("deck"),
        cards: [],
        createdAt: Date.now(),
      };
      setDecks((current) => [deck, ...current]);
      navigate({ name: "deck", deckId: deck.id });
    }
    setDeckModalOpen(false);
  };

  const saveCards = (cards: Array<{ front: string; back: string }>) => {
    if (!selectedDeck) return;
    const additions = cards
      .filter((card) => plainText(card.front) && plainText(card.back))
      .map((card) => ({
        id: uid("card"),
        front: sanitizeRichText(card.front),
        back: sanitizeRichText(card.back),
        known: 0,
        missed: 0,
      }));
    setDecks((current) =>
      current.map((deck) =>
        deck.id === selectedDeck.id
          ? { ...deck, cards: [...deck.cards, ...additions] }
          : deck,
      ),
    );
    setCardModalOpen(false);
  };

  const openImportForSelectedDeck = () => {
    if (!selectedDeck) return;
    setCardModalOpen(false);
    setImportModalOpen(true);
  };

  const saveStudyCard = (cardId: string, front: string, back: string) => {
    if (!plainText(front) || !plainText(back)) return;
    setDecks((current) =>
      current.map((deck) =>
        deck.cards.some((card) => card.id === cardId)
          ? {
              ...deck,
              cards: deck.cards.map((card) =>
                card.id === cardId
                  ? {
                      ...card,
                      front: sanitizeRichText(front),
                      back: sanitizeRichText(back),
                    }
                  : card,
              ),
            }
          : deck,
      ),
    );
    setStudyCardEditId(undefined);
  };

  const saveImportedCards = (pairs: ImportPair[]) => {
    saveCards(pairs);
    setImportModalOpen(false);
  };

  const removeCard = (cardId: string) => {
    if (!selectedDeck || !window.confirm("Eliminare questa flashcard?")) return;
    setDecks((current) =>
      current.map((deck) =>
        deck.id === selectedDeck.id
          ? { ...deck, cards: deck.cards.filter((card) => card.id !== cardId) }
          : deck,
      ),
    );
  };

  const removeDeck = () => {
    if (
      !selectedDeck ||
      !window.confirm(`Eliminare “${selectedDeck.title}” e tutte le sue carte?`)
    )
      return;
    if (selectedDeck.visibility === "public" && firestore && authUserId) {
      const catalogId = `${authUserId}_${selectedDeck.id}`;
      void deleteDoc(doc(firestore, "publicSets", catalogId)).catch(() => undefined);
      setRemotePublicDecks((current) =>
        current.filter((deck) => deck.catalogId !== catalogId),
      );
    }
    setDecks((current) =>
      current.filter((deck) => deck.id !== selectedDeck.id),
    );
    navigate({ name: "folder", folderId: selectedDeck.folderId });
  };

  const resolveStudyDecks = (target: StudyTarget) => {
    if (target.kind === "deck") {
      const deck = decks.find((item) => item.id === target.id);
      return deck ? [deck] : [];
    }
    if (target.kind === "folder") {
      return decks.filter((deck) => deck.folderId === target.id);
    }
    const deck = publicCatalog.find((item) => item.catalogId === target.id);
    return deck ? [deck] : [];
  };

  const openStudySetup = (target: StudyTarget, cardIds?: string[]) => {
    const available = resolveStudyDecks(target).flatMap((deck) => deck.cards);
    const requested = cardIds?.length
      ? available.filter((card) => cardIds.includes(card.id))
      : available;
    if (!requested.length) return;
    setStudyRequest({ target, cardIds });
    setStudySettingsOpen(true);
  };

  const startStudy = (request: StudyRequest, order: StudyOrder) => {
    const sourceDecks = resolveStudyDecks(request.target);
    const originalQueue = request.cardIds?.length
      ? request.cardIds
      : sourceDecks.flatMap((deck) => deck.cards.map((card) => card.id));
    if (!originalQueue.length) return;
    const queue = order === "random"
      ? [...originalQueue].sort(() => Math.random() - 0.5)
      : [...originalQueue];
    setStudy({
      target: request.target,
      queue,
      originalQueue,
      order,
      index: 0,
      known: 0,
      wrong: [],
      streak: 0,
      bestStreak: 0,
      points: 0,
      direction: "front-first",
      flipped: false,
      complete: false,
    });
    setStudySettingsOpen(false);
    navigate({ name: "study" });
  };

  const applyStudyOrder = (order: StudyOrder) => {
    setStudy((current) => {
      if (!current) return current;
      const fixed = current.queue.slice(0, current.index + 1);
      const fixedIds = new Set(fixed);
      const remaining = current.originalQueue.filter((id) => !fixedIds.has(id));
      const orderedRemaining = order === "random"
        ? [...remaining].sort(() => Math.random() - 0.5)
        : remaining;
      return {
        ...current,
        order,
        queue: [...fixed, ...orderedRemaining],
      };
    });
    setStudySettingsOpen(false);
  };

  const rateCard = useCallback(
    (result: "known" | "missed") => {
      if (!study || !study.flipped || study.complete) return;
      const cardId = study.queue[study.index];
      if (study.target.kind !== "public") {
        setDecks((current) =>
          current.map((deck) => {
            if (!deck.cards.some((card) => card.id === cardId)) return deck;
            return {
              ...deck,
              lastStudied: Date.now(),
              cards: deck.cards.map((card) =>
                card.id === cardId
                  ? { ...card, [result]: card[result] + 1 }
                  : card,
              ),
            };
          }),
        );
      }
      setStudy((current) => {
        if (!current) return current;
        const isLast = current.index === current.queue.length - 1;
        const nextStreak = result === "known" ? current.streak + 1 : 0;
        const earnedPoints =
          result === "known" ? 10 + current.streak * 2 : 0;
        return {
          ...current,
          known: current.known + (result === "known" ? 1 : 0),
          wrong:
            result === "missed" && !current.wrong.includes(cardId)
              ? [...current.wrong, cardId]
              : current.wrong,
          streak: nextStreak,
          bestStreak: Math.max(current.bestStreak, nextStreak),
          points: current.points + earnedPoints,
          index: isLast ? current.index : current.index + 1,
          flipped: false,
          complete: isLast,
        };
      });
    },
    [study],
  );

  useEffect(() => {
    if (
      view.name !== "study" ||
      !study ||
      study.complete ||
      studyCardEditId
    )
      return;
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        setStudy((current) =>
          current ? { ...current, flipped: !current.flipped } : current,
        );
      }
      if (event.key === "0") {
        event.preventDefault();
        rateCard("missed");
      }
      if (event.key === "1") {
        event.preventDefault();
        rateCard("known");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [rateCard, study, studyCardEditId, view.name]);

  const exportData = () => {
    const blob = new Blob(
      [JSON.stringify({ version: 3, folders, decks, settings }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lume-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.decks)) throw new Error("invalid");
      if (
        window.confirm(
          "Importare questo backup? Sostituirà cartelle e set presenti su questo dispositivo.",
        )
      ) {
        setFolders(normalizeFolders(parsed.folders));
        setDecks(normalizeDecks(parsed.decks));
        if (parsed.settings) setSettings(parsed.settings);
        navigate({ name: "home" });
      }
    } catch {
      window.alert("Questo file non sembra un backup valido di Lume.");
    }
    event.target.value = "";
  };

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        study={study}
        folders={folders}
        decks={decks}
        onNavigate={navigate}
        onCreateFolder={openCreateFolder}
        onCreateSet={(folderId) => openCreateDeck(folderId)}
      />

      <div className="main-column">
        <Topbar
          theme={settings.theme}
          font={settings.font}
          userEmail={user?.email ?? undefined}
          soundMode={soundMode}
          settingsOpen={settingsOpen}
          soundPanelOpen={soundPanelOpen}
          onToggleTheme={() =>
            setSettings((current) => ({
              ...current,
              theme: current.theme === "light" ? "dark" : "light",
            }))
          }
          onFontChange={(font) =>
            setSettings((current) => ({ ...current, font }))
          }
          onToggleSettings={() => {
            setSettingsOpen((open) => !open);
            setSoundPanelOpen(false);
          }}
          onToggleSound={() => {
            setSoundPanelOpen((open) => !open);
            setSettingsOpen(false);
          }}
          onOpenAccount={() => {
            setAuthMessage("");
            setAccountOpen(true);
          }}
        />

        {settingsOpen && (
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onExport={exportData}
            onImport={() => fileInputRef.current?.click()}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        {soundPanelOpen && (
          <SoundPanel
            mode={soundMode}
            volume={settings.volume}
            onSelect={playSound}
            onVolume={(volume) =>
              setSettings((current) => ({ ...current, volume }))
            }
            onClose={() => setSoundPanelOpen(false)}
          />
        )}

        <main className="page-content">
          {view.name === "home" && (
            <Dashboard
              folders={folders}
              decks={decks}
              totalCards={totalCards}
              dueCards={dueCards}
              mastery={overallMastery}
              onOpenFolder={(folderId) => navigate({ name: "folder", folderId })}
              onStudy={(deck) => openStudySetup({ kind: "deck", id: deck.id })}
              onCreate={() => openCreateDeck(folders[0]?.id)}
              onCreateFolder={openCreateFolder}
              onViewAll={() => navigate({ name: "library" })}
            />
          )}

          {view.name === "library" && (
            <FolderLibrary
              folders={folders}
              decks={decks}
              onOpenFolder={(folderId) => navigate({ name: "folder", folderId })}
              onCreate={openCreateFolder}
            />
          )}

          {view.name === "community" && (
            <CommunityPage
              decks={publicCatalog}
              userId={authUserId}
              firebaseReady={firebaseConfigured}
              onRefresh={() => void refreshCommunity()}
              onStudy={(catalogId) => openStudySetup({ kind: "public", id: catalogId })}
            />
          )}

          {view.name === "folder" && selectedFolder && (
            <FolderPage
              folder={selectedFolder}
              decks={decks.filter((deck) => deck.folderId === selectedFolder.id)}
              onBack={() => navigate({ name: "home" })}
              onOpenDeck={(deckId) => navigate({ name: "deck", deckId })}
              onCreateSet={() => openCreateDeck(selectedFolder.id)}
              onStudyFolder={() => openStudySetup({ kind: "folder", id: selectedFolder.id })}
              onEditFolder={() => {
                setEditingFolderId(selectedFolder.id);
                setFolderModalOpen(true);
              }}
            />
          )}

          {view.name === "deck" && selectedDeck && (
            <DeckDetail
              deck={selectedDeck}
              onBack={() => navigate({ name: "folder", folderId: selectedDeck.folderId })}
              onAddCards={() => setCardModalOpen(true)}
              onImport={openImportForSelectedDeck}
              onStudy={() => openStudySetup({ kind: "deck", id: selectedDeck.id })}
              onReview={() => {
                const difficult = selectedDeck.cards
                  .filter((card) => card.missed > 0)
                  .map((card) => card.id);
                openStudySetup({ kind: "deck", id: selectedDeck.id }, difficult);
              }}
              onEdit={() => {
                setEditingDeckId(selectedDeck.id);
                setDeckModalOpen(true);
              }}
              onDelete={removeDeck}
              onDeleteCard={removeCard}
            />
          )}

          {view.name === "study" && studyDisplayDeck && study && currentStudyCardId && (
            <StudyView
              deck={studyDisplayDeck}
              card={studyDisplayDeck.cards.find((item) => item.id === currentStudyCardId)}
              keywordHelp={Boolean(currentStudyOwnerDeck?.keywordHelp)}
              canEdit={Boolean(currentStudyOwnerDeck && !("catalogId" in currentStudyOwnerDeck))}
              study={study}
              onFlip={() =>
                setStudy((current) =>
                  current ? { ...current, flipped: !current.flipped } : current,
                )
              }
              onRate={rateCard}
              onEditCard={() =>
                setStudyCardEditId(study.queue[study.index])
              }
              onOpenSettings={() => {
                setStudyRequest({ target: study.target });
                setStudySettingsOpen(true);
              }}
              onToggleDirection={() =>
                setStudy((current) =>
                  current
                    ? {
                        ...current,
                        direction:
                          current.direction === "front-first"
                            ? "back-first"
                            : "front-first",
                        flipped: false,
                      }
                    : current,
                )
              }
              onExit={() => {
                if (study.target.kind === "deck") navigate({ name: "deck", deckId: study.target.id });
                else if (study.target.kind === "folder") navigate({ name: "folder", folderId: study.target.id });
                else navigate({ name: "community" });
              }}
              onReviewWrong={() => openStudySetup(study.target, study.wrong)}
              onRestart={() => openStudySetup(study.target)}
            />
          )}
        </main>

        <MobileNav
          view={view}
          onNavigate={navigate}
          onCreate={() => openCreateDeck(selectedFolder?.id ?? folders[0]?.id)}
        />
      </div>

      {welcomeOpen && (
        <WelcomeModal
          userEmail={user?.email ?? undefined}
          authResolved={authResolved}
          onOpenAccount={() => {
            setWelcomeOpen(false);
            setAuthMessage("");
            setAccountOpen(true);
          }}
          onOpenWorkspace={() => {
            navigate({ name: "home" });
            setWelcomeOpen(false);
          }}
          onClose={() => setWelcomeOpen(false)}
        />
      )}

      {deckModalOpen && (
        <DeckModal
          deck={decks.find((deck) => deck.id === editingDeckId)}
          folders={folders}
          defaultFolderId={draftFolderId || folders[0]?.id || DEFAULT_FOLDER_ID}
          defaultFont={settings.font}
          onSave={saveDeck}
          onClose={() => setDeckModalOpen(false)}
        />
      )}

      {folderModalOpen && (
        <FolderModal
          folder={folders.find((folder) => folder.id === editingFolderId)}
          onSave={saveFolder}
          onClose={() => setFolderModalOpen(false)}
        />
      )}

      {studySettingsOpen && studyRequest && (
        <StudySettingsModal
          request={studyRequest}
          title={
            studyRequest.target.kind === "folder"
              ? folders.find((folder) => folder.id === studyRequest.target.id)?.title ?? "Cartella"
              : studyRequest.target.kind === "public"
                ? publicCatalog.find((deck) => deck.catalogId === studyRequest.target.id)?.title ?? "Set pubblico"
                : decks.find((deck) => deck.id === studyRequest.target.id)?.title ?? "Set"
          }
          cardCount={
            studyRequest.cardIds?.length ??
            resolveStudyDecks(studyRequest.target).reduce((sum, deck) => sum + deck.cards.length, 0)
          }
          activeOrder={view.name === "study" ? study?.order : undefined}
          onStart={(order) =>
            view.name === "study" ? applyStudyOrder(order) : startStudy(studyRequest, order)
          }
          onClose={() => setStudySettingsOpen(false)}
        />
      )}

      {cardModalOpen && selectedDeck && (
        <CardModal
          deck={selectedDeck}
          onSave={saveCards}
          onImport={openImportForSelectedDeck}
          onClose={() => setCardModalOpen(false)}
        />
      )}

      {studyCardEditId && editingStudyCard && (
        <StudyCardEditModal
          card={editingStudyCard}
          keywordHelp={Boolean(currentStudyOwnerDeck?.keywordHelp)}
          onSave={(front, back) =>
            saveStudyCard(editingStudyCard.id, front, back)
          }
          onClose={() => setStudyCardEditId(undefined)}
        />
      )}

      {importModalOpen && selectedDeck && (
        <ImportModal
          deck={selectedDeck}
          onImport={saveImportedCards}
          onClose={() => setImportModalOpen(false)}
        />
      )}

      {accountOpen && (
        <AccountModal
          user={user}
          configured={firebaseConfigured}
          message={authMessage}
          onEmail={async (email) => {
            if (!firebaseAuth) {
              setAuthMessage(
                "Per attivare l’accesso online dobbiamo completare il collegamento Firebase.",
              );
              return;
            }
            try {
              await setPersistence(firebaseAuth, browserLocalPersistence);
              await sendSignInLinkToEmail(firebaseAuth, email, {
                url: window.location.href,
                handleCodeInApp: true,
              });
              localStorage.setItem(AUTH_EMAIL_KEY, email);
              setAuthMessage(
                "Ti abbiamo inviato un link di accesso. Controlla la tua email.",
              );
            } catch (error) {
              setAuthMessage(
                error instanceof Error ? error.message : "Invio non riuscito.",
              );
            }
          }}
          onGoogle={async () => {
            if (!firebaseAuth) {
              setAuthMessage(
                "Per attivare Google dobbiamo completare il collegamento Firebase.",
              );
              return;
            }
            try {
              await setPersistence(firebaseAuth, browserLocalPersistence);
              await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
            } catch (error) {
              setAuthMessage(
                error instanceof Error ? error.message : "Accesso non riuscito.",
              );
            }
          }}
          onLogout={async () => {
            if (firebaseAuth) await signOut(firebaseAuth);
            setUser(null);
            setAccountOpen(false);
          }}
          onContinueLocal={() => {
            setAuthMessage("");
            setAccountOpen(false);
          }}
          onClose={() => setAccountOpen(false)}
        />
      )}

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="application/json"
        onChange={importData}
        aria-label="Importa backup"
      />
    </div>
  );
}

function Brand() {
  return (
    <button
      className="brand"
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Lume, torna all’inizio"
    >
      <span className="brand-mark" aria-hidden="true">
        <span>L</span>
      </span>
      <span>Lume</span>
    </button>
  );
}

function RichText({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }}
    />
  );
}

function WelcomeModal({
  userEmail,
  authResolved,
  onOpenAccount,
  onOpenWorkspace,
  onClose,
}: {
  userEmail?: string;
  authResolved: boolean;
  onOpenAccount: () => void;
  onOpenWorkspace: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);

  return (
    <div
      className="modal-backdrop welcome-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="welcome-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close welcome-modal-close"
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
        >
          ×
        </button>

        <div className="welcome-modal-copy">
          <span className="eyebrow">Lume / flashcards</span>
          <h2 id="welcome-modal-title">
            <span>Flashcards.</span>
            <span>Unlimited learning.</span>
            <em>Free.</em>
          </h2>
          <p>
            Organizza i set nelle tue cartelle, scrivi le domande e concentra il
            ripasso sulle carte che conosci meno.
          </p>

          <div className="welcome-entry-actions">
            <button
              className="welcome-entry-button account-entry-button"
              type="button"
              onClick={onOpenAccount}
            >
              <span>{userEmail ? "Account collegato" : "Salva il tuo studio"}</span>
              <strong>
                {!authResolved
                  ? "Controllo accesso…"
                  : userEmail ?? "Fai il login"}
              </strong>
              <small>
                {userEmail
                  ? "Apri e gestisci il tuo profilo"
                  : "Fai il login per salvare i tuoi set"}
              </small>
            </button>
            <button
              className="welcome-entry-button workspace-entry-button"
              type="button"
              onClick={onOpenWorkspace}
            >
              <span>Il mio spazio</span>
              <strong>Le tue flashcards</strong>
              <small>Apri cartelle e set <b aria-hidden="true">→</b></small>
            </button>
          </div>
        </div>

        <div className="editorial-board welcome-board" aria-hidden="true">
          <div className="board-bar">
            <span>STUDY FILE / 001</span><i /><i /><i />
          </div>
          <div className="board-grid">
            <div className="board-index"><span>01</span><strong>QUESTION</strong></div>
            <div className="board-question">Che cosa vuoi<br />ricordare oggi?</div>
            <div className="board-note">Ripassa ciò che non sai.<br />Il resto può aspettare.</div>
            <div className="board-tab">REVIEW</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function RichTextEditor({
  value,
  onChange,
  label,
  placeholder,
  autoFocus = false,
  keywordHelp = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  keywordHelp?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [initialValue] = useState(() => sanitizeRichText(value));

  const applyFormat = (command: "bold" | "italic" | "underline") => {
    editorRef.current?.focus();
    document.execCommand(command);
    if (editorRef.current) onChange(sanitizeRichText(editorRef.current.innerHTML));
  };

  return (
    <div className="rich-field">
      <span>{label}</span>
      <div className="rich-editor-shell">
        <div className="rich-toolbar" aria-label={`Formattazione ${label}`}>
          <button
            className={keywordHelp ? "keyword-format" : ""}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              applyFormat("bold");
            }}
            aria-label={keywordHelp ? "Neretto e keyword" : "Neretto"}
            title={keywordHelp ? "Neretto · diventa una keyword" : "Neretto"}
          ><strong>B</strong></button>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              applyFormat("italic");
            }}
            aria-label="Corsivo"
            title="Corsivo"
          ><em>I</em></button>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              applyFormat("underline");
            }}
            aria-label="Sottolineato"
            title="Sottolineato"
          ><u>U</u></button>
          {keywordHelp && <small>Il neretto identifica le keywords</small>}
        </div>
        <div
          ref={editorRef}
          className="rich-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={label}
          aria-multiline="true"
          data-placeholder={placeholder}
          autoFocus={autoFocus}
          dangerouslySetInnerHTML={{ __html: initialValue }}
          onInput={(event) => onChange(sanitizeRichText(event.currentTarget.innerHTML))}
          onBlur={(event) => onChange(sanitizeRichText(event.currentTarget.innerHTML))}
        />
      </div>
    </div>
  );
}

function Sidebar({
  view,
  study,
  folders,
  decks,
  onNavigate,
  onCreateFolder,
  onCreateSet,
}: {
  view: View;
  study?: StudySession;
  folders: Folder[];
  decks: Deck[];
  onNavigate: (view: View) => void;
  onCreateFolder: () => void;
  onCreateSet: (folderId: string) => void;
}) {
  const activeFolderId =
    view.name === "folder"
      ? view.folderId
      : view.name === "deck"
        ? decks.find((deck) => deck.id === view.deckId)?.folderId
        : view.name === "study" && study?.target.kind === "folder"
          ? study.target.id
          : view.name === "study" && study?.target.kind === "deck"
            ? decks.find((deck) => deck.id === study.target.id)?.folderId
        : undefined;
  const activeDeckId =
    view.name === "deck"
      ? view.deckId
      : view.name === "study" && study?.target.kind === "deck"
        ? study.target.id
        : undefined;
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set([activeFolderId ?? folders[0]?.id].filter(Boolean) as string[]),
  );

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <Brand />
      <nav className="side-nav" aria-label="Navigazione principale">
        <button
          className={view.name === "home" || view.name === "library" ? "active" : ""}
          onClick={() => onNavigate({ name: "home" })}
          type="button"
        >
          <span aria-hidden="true">⌂</span> Il mio spazio
        </button>
        <button
          className={view.name === "community" ? "active" : ""}
          onClick={() => onNavigate({ name: "community" })}
          type="button"
        >
          <span aria-hidden="true">⌕</span>
          <span><strong>Esplora</strong><small>Flashcard pubbliche</small></span>
        </button>
      </nav>

      <div className="sidebar-folder-section">
        <div className="sidebar-section-heading">
          <span>Le mie cartelle</span>
          <button type="button" onClick={onCreateFolder} aria-label="Nuova cartella">＋</button>
        </div>
        <div className="sidebar-folder-tree">
          {folders.map((folder) => {
            const folderDecks = decks.filter((deck) => deck.folderId === folder.id);
            const expanded = expandedFolders.has(folder.id);
            return (
              <div className="sidebar-folder" key={folder.id}>
                <div className={activeFolderId === folder.id ? "sidebar-folder-row active" : "sidebar-folder-row"}>
                  <button
                    className={expanded ? "folder-chevron expanded" : "folder-chevron"}
                    type="button"
                    onClick={() => toggleFolder(folder.id)}
                    aria-label={`${expanded ? "Chiudi" : "Apri"} ${folder.title}`}
                    aria-expanded={expanded}
                  >›</button>
                  <button
                    className="sidebar-folder-link"
                    type="button"
                    onClick={() => {
                      setExpandedFolders((current) => new Set(current).add(folder.id));
                      onNavigate({ name: "folder", folderId: folder.id });
                    }}
                  >
                    <i style={{ background: folder.color }}>{folder.emoji}</i>
                    <span>{folder.title}</span>
                    <small>{folderDecks.length}</small>
                  </button>
                </div>
                {expanded && (
                  <div className="sidebar-set-list">
                    {folderDecks.map((deck) => (
                      <button
                        className={activeDeckId === deck.id ? "active" : ""}
                        type="button"
                        key={deck.id}
                        onClick={() => onNavigate({ name: "deck", deckId: deck.id })}
                      >
                        <span aria-hidden="true">{deck.emoji}</span>{deck.title}
                      </button>
                    ))}
                    <button className="sidebar-new-set" type="button" onClick={() => onCreateSet(folder.id)}>
                      ＋ Nuovo set
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-spacer" />

      <button className="primary-button create-button" type="button" onClick={onCreateFolder}>
        <span aria-hidden="true">＋</span> Nuova cartella
      </button>
      <p className="local-note">Gratuito · I dati restano sul tuo dispositivo</p>
    </aside>
  );
}

function Topbar({
  theme,
  font,
  userEmail,
  soundMode,
  settingsOpen,
  soundPanelOpen,
  onToggleTheme,
  onFontChange,
  onToggleSettings,
  onToggleSound,
  onOpenAccount,
}: {
  theme: Settings["theme"];
  font: FontChoice;
  userEmail?: string;
  soundMode: SoundMode;
  settingsOpen: boolean;
  soundPanelOpen: boolean;
  onToggleTheme: () => void;
  onFontChange: (font: FontChoice) => void;
  onToggleSettings: () => void;
  onToggleSound: () => void;
  onOpenAccount: () => void;
}) {
  return (
    <header className="topbar">
      <div className="mobile-brand">
        <Brand />
      </div>
      <p><strong>Workspace</strong><span>/</span> Il mio spazio</p>
      <div className="top-actions">
        <button
          className={`icon-button sound-button ${soundMode !== "off" ? "is-playing" : ""} ${soundPanelOpen ? "active" : ""}`}
          type="button"
          onClick={onToggleSound}
          aria-label="Suoni per la concentrazione"
          aria-expanded={soundPanelOpen}
        >
          <span aria-hidden="true">♫</span>
          {soundMode !== "off" && <i />}
        </button>
        <label className="top-font-control">
          <span className="sr-only">Font generale</span>
          <select
            value={font}
            onChange={(event) =>
              onFontChange(event.target.value as FontChoice)
            }
            aria-label="Font generale"
          >
            {fontOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "light" ? "Attiva modalità scura" : "Attiva modalità chiara"}
        >
          <span aria-hidden="true">☼</span>
          <i className={theme === "dark" ? "dark" : ""} />
          <span aria-hidden="true">☾</span>
        </button>
        <button
          className={`icon-button ${settingsOpen ? "active" : ""}`}
          type="button"
          onClick={onToggleSettings}
          aria-label="Preferenze"
          aria-expanded={settingsOpen}
        >
          <span aria-hidden="true">•••</span>
        </button>
        <button
          className="account-button"
          type="button"
          onClick={onOpenAccount}
          aria-label={userEmail ? `Profilo ${userEmail}` : "Accedi o crea un profilo"}
        >
          <span aria-hidden="true">◎</span>
          <span>{userEmail ? "Profilo" : "Accedi"}</span>
        </button>
      </div>
    </header>
  );
}

function Dashboard({
  folders,
  decks,
  totalCards,
  dueCards,
  mastery: masteryValue,
  onOpenFolder,
  onStudy,
  onCreate,
  onCreateFolder,
  onViewAll,
}: {
  folders: Folder[];
  decks: Deck[];
  totalCards: number;
  dueCards: number;
  mastery: number;
  onOpenFolder: (id: string) => void;
  onStudy: (deck: Deck) => void;
  onCreate: () => void;
  onCreateFolder: () => void;
  onViewAll: () => void;
}) {
  const recent = [...decks]
    .sort((a, b) => (b.lastStudied ?? b.createdAt) - (a.lastStudied ?? a.createdAt))
    .slice(0, 3);

  return (
    <div className="dashboard">
      <section className="dashboard-grid">
        <div className="continue-card">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Riprendi da qui</span>
              <h2>{recent[0]?.title ?? "Il tuo primo set"}</h2>
            </div>
            {recent[0] && (
              <span className="last-seen">
                {formatRelativeTime(recent[0].lastStudied)}
              </span>
            )}
          </div>
          {recent[0] ? (
            <>
              <div className="continue-progress">
                <div>
                  <span>Padronanza</span>
                  <strong>{mastery(recent[0])}%</strong>
                </div>
                <div className="progress-track">
                  <i style={{ width: `${mastery(recent[0])}%` }} />
                </div>
              </div>
              <div className="continue-footer">
                <span>{recent[0].cards.length} carte nel set</span>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onStudy(recent[0])}
                  disabled={!recent[0].cards.length}
                >
                  Riprendi lo studio <span aria-hidden="true">→</span>
                </button>
              </div>
            </>
          ) : (
            <button className="primary-button" type="button" onClick={onCreate}>
              Crea il primo set
            </button>
          )}
        </div>

        <RandomFlashcard decks={decks} />
      </section>

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">In breve</span>
            <h2>Il tuo percorso</h2>
          </div>
        </div>
        <div className="stat-row">
          <div className="stat-card">
            <span>Cartelle</span>
            <strong>{folders.length}</strong>
            <small>con i tuoi set ordinati</small>
          </div>
          <div className="stat-card">
            <span>Flashcards</span>
            <strong>{totalCards}</strong>
            <small>pronte da ripassare</small>
          </div>
          <div className="stat-card accent-stat">
            <span>Da rivedere</span>
            <strong>{dueCards}</strong>
            <small>le carte più ostinate</small>
          </div>
          <div className="stat-card">
            <span>Padronanza</span>
            <strong>{masteryValue}%</strong>
            <small>su tutte le risposte</small>
          </div>
        </div>
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Il tuo archivio</span>
            <h2>Le tue cartelle</h2>
          </div>
          <button className="text-button" type="button" onClick={onViewAll}>
            Vedi tutti <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="folder-grid">
          {folders.slice(0, 3).map((folder) => (
            <FolderTile
              key={folder.id}
              folder={folder}
              decks={decks.filter((deck) => deck.folderId === folder.id)}
              onOpen={() => onOpenFolder(folder.id)}
            />
          ))}
          <button className="new-folder-tile" type="button" onClick={onCreateFolder}>
            <span aria-hidden="true">＋</span>
            <strong>Nuova cartella</strong>
            <small>Crea un nuovo spazio per i tuoi set</small>
          </button>
        </div>
      </section>
    </div>
  );
}

function RandomFlashcard({ decks }: { decks: Deck[] }) {
  const cards = useMemo(
    () =>
      decks.flatMap((deck) =>
        deck.cards.map((card) => ({
          key: `${deck.id}:${card.id}`,
          card,
          deckTitle: deck.title,
          font: deck.font,
        })),
      ),
    [decks],
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!cards.length) {
      if (selectedKey) setSelectedKey("");
      return;
    }
    if (!cards.some((item) => item.key === selectedKey)) {
      const next = cards[Math.floor(Math.random() * cards.length)];
      setSelectedKey(next.key);
      setFlipped(false);
    }
  }, [cards, selectedKey]);

  const selected = cards.find((item) => item.key === selectedKey) ?? cards[0];
  const pickAnother = () => {
    if (!cards.length) return;
    const currentIndex = cards.findIndex((item) => item.key === selected?.key);
    let nextIndex = Math.floor(Math.random() * cards.length);
    if (cards.length > 1 && nextIndex === currentIndex) {
      nextIndex = (nextIndex + 1) % cards.length;
    }
    setSelectedKey(cards[nextIndex].key);
    setFlipped(false);
  };

  return (
    <article className="calm-card random-flashcard-panel">
      <div className="random-flashcard-toolbar">
        <span className="eyebrow">Flashcard a caso</span>
        <button type="button" onClick={pickAnother} disabled={!cards.length}>
          Un’altra <span aria-hidden="true">↻</span>
        </button>
      </div>

      {selected ? (
        <button
          className={flipped ? "random-flashcard-face is-flipped" : "random-flashcard-face"}
          type="button"
          onClick={() => setFlipped((value) => !value)}
          aria-pressed={flipped}
          aria-label={flipped ? "Mostra il fronte della flashcard" : "Mostra il significato"}
          style={{ fontFamily: fontFamily(selected.font) }}
        >
          <small>{flipped ? "Significato" : selected.deckTitle}</small>
          <RichText value={flipped ? selected.card.back : selected.card.front} />
          <em>{flipped ? "Torna alla domanda" : "Gira la carta"}</em>
        </button>
      ) : (
        <div className="random-flashcard-empty">
          <strong>Qui apparirà una carta a sorpresa.</strong>
          <p>Crea la tua prima flashcard per iniziare.</p>
        </div>
      )}
    </article>
  );
}

function FolderTile({
  folder,
  decks,
  onOpen,
}: {
  folder: Folder;
  decks: Deck[];
  onOpen: () => void;
}) {
  const cards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const previews = decks.slice(0, 3);
  return (
    <button
      className="folder-tile"
      style={{ "--folder": folder.color } as React.CSSProperties}
      onClick={onOpen}
      type="button"
    >
      <span className="folder-papers" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <i key={index} style={{ "--paper-index": index } as React.CSSProperties}>
            {previews[index]?.emoji ?? (index === 0 ? folder.emoji : "")}
          </i>
        ))}
      </span>
      <span className="folder-back" aria-hidden="true" />
      <span className="folder-front">
        <small>Cartella</small>
        <strong>{folder.title}</strong>
        <span>{decks.length} set · {cards} flashcard</span>
      </span>
    </button>
  );
}

function SetCover({
  deck,
  onOpen,
}: {
  deck: Deck;
  onOpen: () => void;
}) {
  return (
    <button className="set-cover-card" type="button" onClick={onOpen}>
      <span className="set-cover-copy">
        <small>{deck.visibility === "public" ? "◉ Pubblico" : "Set privato"}</small>
        <strong>{deck.title}</strong>
        <i aria-hidden="true">{deck.emoji}</i>
        <span>{deck.cards.length} carte{deck.keywordHelp ? " · Keyword Help" : ""}</span>
      </span>
      <span
        className="set-cover-art"
        style={{
          "--deck": deck.color,
          "--card": deck.cardColor,
          "--deck-text": getTextColor(deck.color),
          "--deck-font": fontFamily(deck.font),
        } as React.CSSProperties}
      >
        <small>Lume / study set</small>
        <strong>{deck.title}</strong>
        <b aria-hidden="true">{deck.emoji}</b>
        <i>{deck.description || "Domande e risposte"}</i>
      </span>
    </button>
  );
}

function FolderLibrary({
  folders,
  decks,
  onOpenFolder,
  onCreate,
}: {
  folders: Folder[];
  decks: Deck[];
  onOpenFolder: (id: string) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = folders.filter((folder) => {
    const folderDecks = decks.filter((deck) => deck.folderId === folder.id);
    return `${folder.title} ${folderDecks.map((deck) => deck.title).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  return (
    <div className="library-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">Il tuo spazio</span>
          <h1>Le mie cartelle</h1>
          <p>Ogni cartella raccoglie i set che appartengono allo stesso mondo.</p>
        </div>
        <button className="primary-button" type="button" onClick={onCreate}>
          <span aria-hidden="true">＋</span> Nuova cartella
        </button>
      </div>
      <div className="library-toolbar">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca tra cartelle e set…"
          />
        </label>
        <div className="library-toolbar-actions">
          <span>{filtered.length} {filtered.length === 1 ? "cartella" : "cartelle"}</span>
        </div>
      </div>
      <div className="folder-grid library-folder-grid">
        {filtered.map((folder) => (
          <FolderTile
            key={folder.id}
            folder={folder}
            decks={decks.filter((deck) => deck.folderId === folder.id)}
            onOpen={() => onOpenFolder(folder.id)}
          />
        ))}
        <button className="new-folder-tile" type="button" onClick={onCreate}>
          <span aria-hidden="true">＋</span>
          <strong>Crea una nuova cartella</strong>
          <small>Scegli un nome, un colore e un’emoji</small>
        </button>
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <span aria-hidden="true">◌</span>
          <h2>Nessuna cartella trovata</h2>
          <p>Prova con un’altra parola oppure crea una nuova cartella.</p>
        </div>
      )}
    </div>
  );
}

function CommunityPage({
  decks,
  userId,
  firebaseReady,
  onRefresh,
  onStudy,
}: {
  decks: PublicDeck[];
  userId?: string;
  firebaseReady: boolean;
  onRefresh: () => void;
  onStudy: (catalogId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = decks.filter((deck) => {
    if (!normalizedQuery) return true;
    const searchable = [
      deck.title,
      deck.description,
      deck.author,
      ...deck.cards.flatMap((card) => [plainText(card.front), plainText(card.back)]),
    ].join(" ").toLowerCase();
    return searchable.includes(normalizedQuery);
  });

  return (
    <div className="community-page">
      <div className="page-title-row community-title-row">
        <div>
          <span className="eyebrow">Conoscenza condivisa</span>
          <h1>Esplora flashcard pubbliche</h1>
          <p>Cerca una materia o una keyword e studia i set messi a disposizione dalla community.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!firebaseReady}>
          <span aria-hidden="true">↻</span> Aggiorna catalogo
        </button>
      </div>
      <div className="community-search-panel">
        <label className="search-field community-search">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca: psicologia, inglese, Bauhaus…"
          />
        </label>
        <span>{filtered.length} {filtered.length === 1 ? "set trovato" : "set trovati"}</span>
      </div>
      <div className="community-grid">
        {filtered.map((deck) => (
          <article className="community-deck" key={deck.catalogId}>
            <SetCover deck={deck} onOpen={() => onStudy(deck.catalogId)} />
            <div className="community-deck-meta">
              <span>{deck.ownerId === userId || deck.ownerId === "local-user" ? "Il tuo set" : `di ${deck.author}`}</span>
              <button type="button" onClick={() => onStudy(deck.catalogId)}>
                Studia <span aria-hidden="true">→</span>
              </button>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <span aria-hidden="true">⌕</span>
          <h2>Nessun set con questa keyword</h2>
          <p>Prova una parola più generale oppure torna a esplorare tutti i set.</p>
        </div>
      )}
    </div>
  );
}

function FolderPage({
  folder,
  decks,
  onBack,
  onOpenDeck,
  onCreateSet,
  onStudyFolder,
  onEditFolder,
}: {
  folder: Folder;
  decks: Deck[];
  onBack: () => void;
  onOpenDeck: (id: string) => void;
  onCreateSet: () => void;
  onStudyFolder: () => void;
  onEditFolder: () => void;
}) {
  const cards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  return (
    <div className="folder-page">
      <button className="back-button" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Il mio spazio
      </button>
      <div className="folder-page-heading">
        <div>
          <span className="folder-page-emoji" style={{ background: folder.color }}>{folder.emoji}</span>
          <span className="eyebrow">Fascicolo</span>
          <h1>{folder.title}</h1>
          <p>{decks.length} set · {cards} flashcard</p>
        </div>
        <div>
          <button className="secondary-button" type="button" onClick={onEditFolder}>Modifica cartella</button>
          <button className="secondary-button" type="button" onClick={onStudyFolder} disabled={!cards}>
            <span aria-hidden="true">▶</span> Studia tutta la cartella
          </button>
          <button className="primary-button" type="button" onClick={onCreateSet}>＋ Nuovo set</button>
        </div>
      </div>
      <div className="set-cover-grid">
        {decks.map((deck) => (
          <SetCover key={deck.id} deck={deck} onOpen={() => onOpenDeck(deck.id)} />
        ))}
        <button className="new-set-cover" type="button" onClick={onCreateSet}>
          <span aria-hidden="true">＋</span>
          <strong>Nuovo set</strong>
          <small>Aggiungi una nuova copertina al fascicolo</small>
        </button>
      </div>
    </div>
  );
}

function DeckDetail({
  deck,
  onBack,
  onAddCards,
  onImport,
  onStudy,
  onReview,
  onEdit,
  onDelete,
  onDeleteCard,
}: {
  deck: Deck;
  onBack: () => void;
  onAddCards: () => void;
  onImport: () => void;
  onStudy: () => void;
  onReview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteCard: (cardId: string) => void;
}) {
  const difficult = deck.cards.filter((card) => card.missed > 0).length;
  return (
    <div
      className="deck-page"
      style={{ "--deck-font": fontFamily(deck.font) } as React.CSSProperties}
    >
      <button className="back-button" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Torna alla cartella
      </button>
      <section
        className="deck-hero"
        style={{
          "--deck": deck.color,
          "--card": deck.cardColor,
          "--deck-text": getTextColor(deck.color),
        } as React.CSSProperties}
      >
        <div className="deck-hero-copy">
          <span className="eyebrow">Set di flashcard · {deck.visibility === "public" ? "Pubblico" : "Privato"}</span>
          <h1>{deck.title}</h1>
          <p>{deck.description || "Un posto per tutte le domande che contano."}</p>
          <div className="deck-hero-stats">
            <span><strong>{deck.cards.length}</strong> carte</span>
            <span><strong>{mastery(deck)}%</strong> padronanza</span>
            <span><strong>{difficult}</strong> da rivedere</span>
          </div>
        </div>
        <div className="hero-card-stack" aria-hidden="true">
          <i />
          <i />
          <b>{deck.emoji}</b>
        </div>
      </section>

      <div className="deck-actions-row">
        <div>
          <button
            className="primary-button"
            type="button"
            onClick={onStudy}
            disabled={!deck.cards.length}
          >
            <span aria-hidden="true">▶</span> Studia tutte
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={onReview}
            disabled={!difficult}
          >
            <span aria-hidden="true">↻</span> Ripassa difficili ({difficult})
          </button>
          <button className="secondary-button" type="button" onClick={onAddCards}>
            <span aria-hidden="true">＋</span> Aggiungi carte
          </button>
          <button className="secondary-button deck-import-button" type="button" onClick={onImport}>
            <span aria-hidden="true">↑</span> Importa file .md
          </button>
        </div>
        <div className="deck-menu-actions">
          <button className="text-button" type="button" onClick={onEdit}>Modifica stile</button>
          <button className="text-button danger" type="button" onClick={onDelete}>Elimina</button>
        </div>
      </div>

      <section className="cards-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Contenuti</span>
            <h2>Le flashcards</h2>
          </div>
          <span className="quiet-hint">Domanda davanti · risposta dietro</span>
        </div>
        {deck.cards.length ? (
          <div className="card-list">
            {deck.cards.map((card, index) => (
              <article className="card-row" key={card.id}>
                <span className="card-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>Domanda</small>
                  <p><RichText value={card.front} /></p>
                </div>
                <div>
                  <small>Risposta</small>
                  <p><RichText value={card.back} /></p>
                </div>
                <span className={`memory-dot ${card.missed > card.known ? "weak" : ""}`} title={`${card.known} note · ${card.missed} da rivedere`} />
                <button
                  className="row-delete"
                  type="button"
                  onClick={() => onDeleteCard(card.id)}
                  aria-label={`Elimina la carta ${index + 1}`}
                >
                  ×
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-cards">
            <div aria-hidden="true">?</div>
            <h3>Qui c’è spazio per la prima domanda.</h3>
            <p>Aggiungi una o più coppie domanda-risposta e comincia subito.</p>
            <button className="primary-button" type="button" onClick={onAddCards}>
              Aggiungi le prime carte
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function StudySettingsModal({
  request,
  title,
  cardCount,
  activeOrder,
  onStart,
  onClose,
}: {
  request: StudyRequest;
  title: string;
  cardCount: number;
  activeOrder?: StudyOrder;
  onStart: (order: StudyOrder) => void;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<StudyOrder>(activeOrder ?? "random");
  useEscape(onClose);
  const sourceLabel = request.target.kind === "folder"
    ? "Cartella completa"
    : request.target.kind === "public"
      ? "Set pubblico"
      : "Set di flashcard";

  return (
    <div className="modal-backdrop study-settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal study-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{sourceLabel} · {cardCount} carte</span>
            <h2 id="study-settings-title">Come vuoi studiare “{title}”?</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <p className="modal-intro">Scegli l’ordine delle carte. Potrai riaprire queste impostazioni anche durante il ripasso.</p>
        <fieldset className="study-order-fieldset">
          <legend>Ordine delle flashcard</legend>
          <button
            className={order === "sequential" ? "selected" : ""}
            type="button"
            onClick={() => setOrder("sequential")}
          >
            <span aria-hidden="true">1—2—3</span>
            <div><strong>In ordine</strong><small>Segui la sequenza con cui hai creato le carte.</small></div>
            <i aria-hidden="true">{order === "sequential" ? "●" : "○"}</i>
          </button>
          <button
            className={order === "random" ? "selected" : ""}
            type="button"
            onClick={() => setOrder("random")}
          >
            <span aria-hidden="true">⇄</span>
            <div><strong>Ordine casuale</strong><small>Mescola le carte per un recupero meno prevedibile.</small></div>
            <i aria-hidden="true">{order === "random" ? "●" : "○"}</i>
          </button>
        </fieldset>
        <div className="study-settings-note">
          <span aria-hidden="true">＋</span>
          <p><strong>Altre impostazioni arriveranno qui.</strong><br />Questa schermata è già pronta ad accoglierle.</p>
        </div>
        <div className="modal-actions">
          <button className="text-button" type="button" onClick={onClose}>Annulla</button>
          <button className="primary-button" type="button" onClick={() => onStart(order)}>
            {activeOrder ? "Applica al ripasso" : "Inizia a studiare"} <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function StudyView({
  deck,
  card,
  keywordHelp,
  canEdit,
  study,
  onFlip,
  onRate,
  onEditCard,
  onOpenSettings,
  onToggleDirection,
  onExit,
  onReviewWrong,
  onRestart,
}: {
  deck: Deck;
  card?: Card;
  keywordHelp: boolean;
  canEdit: boolean;
  study: StudySession;
  onFlip: () => void;
  onRate: (result: "known" | "missed") => void;
  onEditCard: () => void;
  onOpenSettings: () => void;
  onToggleDirection: () => void;
  onExit: () => void;
  onReviewWrong: () => void;
  onRestart: () => void;
}) {
  const [keywordRevealKey, setKeywordRevealKey] = useState<string>();
  const keywordTimerRef = useRef<number | undefined>(undefined);
  const progress = study.complete
    ? 100
    : Math.round((study.index / study.queue.length) * 100);
  const frontFirst = study.direction !== "back-first";
  const firstLabel = frontFirst ? "Domanda" : "Risposta";
  const secondLabel = frontFirst ? "Risposta" : "Domanda";
  const firstText = card ? (frontFirst ? card.front : card.back) : "";
  const secondText = card ? (frontFirst ? card.back : card.front) : "";
  const keywordAvailable = Boolean(
    card && keywordHelp && !study.flipped && hasBoldKeywords(secondText),
  );
  const currentKeywordKey = `${card?.id ?? "none"}:${study.direction}`;
  const keywordVisible = keywordRevealKey === currentKeywordKey;

  useEffect(() => {
    if (!keywordAvailable) return;
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      if (event.key === "3") {
        event.preventDefault();
        setKeywordRevealKey(currentKeywordKey);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === "3") setKeywordRevealKey(undefined);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [currentKeywordKey, keywordAvailable]);

  const revealKeywordsForThreeSeconds = () => {
    if (!keywordAvailable) return;
    if (keywordTimerRef.current) window.clearTimeout(keywordTimerRef.current);
    setKeywordRevealKey(currentKeywordKey);
    keywordTimerRef.current = window.setTimeout(() => setKeywordRevealKey(undefined), 3000);
  };

  if (study.complete) {
    const score = Math.round((study.known / study.queue.length) * 100);
    return (
      <div
        className="study-page completion-page"
        style={{ "--deck-font": fontFamily(deck.font) } as React.CSSProperties}
      >
        <button className="back-button" type="button" onClick={onExit}>
          <span aria-hidden="true">←</span> Torna al set
        </button>
        <section className="completion-card">
          <span className="completion-mark" aria-hidden="true">✦</span>
          <span className="eyebrow">Sessione conclusa</span>
          <h1>Hai dato spazio a ciò che stai imparando.</h1>
          <p>
            Hai ricordato {study.known} carte su {study.queue.length}. Le risposte
            incerte sono già pronte per un nuovo giro.
          </p>
          <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{score}%</strong><span>ricordato</span></div>
          </div>
          <div className="completion-stats">
            <span><i className="known" /> {study.known} le sapevi</span>
            <span><i className="missed" /> {study.wrong.length} da rivedere</span>
            <span><i className="points" /> {study.points} punti</span>
            <span><i className="streak" /> streak migliore {study.bestStreak}</span>
          </div>
          <div className="completion-actions">
            <button
              className="primary-button"
              type="button"
              onClick={onReviewWrong}
              disabled={!study.wrong.length}
            >
              Ripassa solo gli errori <span aria-hidden="true">→</span>
            </button>
            <button className="secondary-button" type="button" onClick={onRestart}>
              Ricomincia tutto
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!card) return null;

  return (
    <div
      className="study-page"
      style={{
        "--deck": deck.color,
        "--card": deck.cardColor,
        "--deck-font": fontFamily(deck.font),
      } as React.CSSProperties}
    >
      <div className="study-header">
        <button className="back-button" type="button" onClick={onExit}>
          <span aria-hidden="true">×</span> Esci
        </button>
        <div className="study-title">
          <span>{deck.title}</span>
          <strong>{study.index + 1} / {study.queue.length}</strong>
        </div>
        <div className="study-header-actions">
          <button className="study-direction-toggle" type="button" onClick={onToggleDirection}>
            <span aria-hidden="true">⇄</span>
            <span className="direction-label">{frontFirst ? "Fronte → retro" : "Retro → fronte"}</span>
          </button>
          <button className="study-settings-button" type="button" onClick={onOpenSettings}>
            <span aria-hidden="true">⚙</span> Impostazioni
          </button>
          {canEdit && (
            <button className="edit-study-card" type="button" onClick={onEditCard}>
              <span aria-hidden="true">✎</span> Modifica carta
            </button>
          )}
          <span className="study-score">{study.known} so · {study.wrong.length} rivedo</span>
        </div>
      </div>
      <div className="study-progress"><i style={{ width: `${progress}%` }} /></div>

      <section className="study-stage">
        <p className="study-instruction">
          {study.flipped ? "Quanto ti è sembrata familiare?" : "Prova a rispondere, poi gira la carta."}
        </p>
        <button
          className={`flashcard ${study.flipped ? "flipped" : ""}`}
          type="button"
          onClick={onFlip}
          aria-label={study.flipped ? `Mostra ${firstLabel.toLowerCase()}` : `Mostra ${secondLabel.toLowerCase()}`}
        >
          <span className="flashcard-face flashcard-front">
            <small>{firstLabel}</small>
            <RichText value={firstText} className="flashcard-content" />
            <i>Premi per girare <kbd>spazio</kbd></i>
            {keywordAvailable && keywordVisible && (
              <span className="keyword-help-overlay" aria-live="polite">
                <small>Keyword Help</small>
                <span dangerouslySetInnerHTML={{ __html: keywordMarkup(secondText) }} />
              </span>
            )}
          </span>
          <span className="flashcard-face flashcard-back">
            <small>{secondLabel}</small>
            <RichText value={secondText} className="flashcard-content" />
            <i>Premi per tornare a {firstLabel.toLowerCase()}</i>
          </span>
        </button>

        {keywordAvailable && (
          <button className="keyword-help-button" type="button" onClick={revealKeywordsForThreeSeconds}>
            <span aria-hidden="true">3</span> Mostra keywords per 3 secondi
          </button>
        )}

        <div className={`rating-actions ${study.flipped ? "visible" : ""}`} aria-hidden={!study.flipped}>
          <button
            className="rate-button known"
            type="button"
            onClick={() => onRate("known")}
            tabIndex={study.flipped ? 0 : -1}
          >
            <span aria-hidden="true">1</span>
            <strong>La so</strong>
            <small>Passa alla prossima · tasto 1</small>
          </button>
          <button
            className="rate-button missed"
            type="button"
            onClick={() => onRate("missed")}
            tabIndex={study.flipped ? 0 : -1}
          >
            <span aria-hidden="true">0</span>
            <strong>Non ancora</strong>
            <small>La rivedrò alla fine · tasto 0</small>
          </button>
        </div>
        <div className="study-reward-bar" aria-live="polite">
          <span><i aria-hidden="true">↗</i><strong>{study.streak}</strong> streak</span>
          <span><i aria-hidden="true">✦</i><strong>{study.points}</strong> punti del ripasso</span>
          <small>
            Spazio gira · 1 la so · 0 non ancora{keywordAvailable ? " · tieni premuto 3 per le keywords" : ""}
          </small>
        </div>
      </section>
    </div>
  );
}

function StudyCardEditModal({
  card,
  keywordHelp,
  onSave,
  onClose,
}: {
  card: Card;
  keywordHelp: boolean;
  onSave: (front: string, back: string) => void;
  onClose: () => void;
}) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  useEscape(onClose);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal study-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-edit-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(front, back);
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Modifica momentanea</span>
            <h2 id="study-edit-title">Correggi questa flashcard</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <p className="modal-intro">
          La sessione resta ferma qui. Dopo il salvataggio riprenderai dalla stessa carta.
        </p>
        <div className="study-edit-fields">
          <RichTextEditor
            autoFocus
            value={front}
            onChange={setFront}
            label="Fronte · domanda o termine"
            placeholder="Scrivi il fronte della carta"
            keywordHelp={keywordHelp}
          />
          <RichTextEditor
            value={back}
            onChange={setBack}
            label="Retro · risposta o definizione"
            placeholder="Scrivi il retro della carta"
            keywordHelp={keywordHelp}
          />
        </div>
        <div className="modal-actions">
          <button className="text-button" type="button" onClick={onClose}>Annulla</button>
          <button className="primary-button" type="submit" disabled={!plainText(front) || !plainText(back)}>
            Salva e continua
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportModal({
  deck,
  onImport,
  onClose,
}: {
  deck: Deck;
  onImport: (pairs: ImportPair[]) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pairs, setPairs] = useState<ImportPair[]>([]);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  useEscape(onClose);

  const readFile = async (file?: File) => {
    if (!file) return;
    if (!/\.md$/i.test(file.name)) {
      setFilename("");
      setPairs([]);
      setError("Puoi importare soltanto file Markdown con estensione .md.");
      return;
    }
    const parsedPairs = parseStudyMarkdown(await file.text());
    setFilename(file.name);
    setPairs(parsedPairs);
    setError(
      parsedPairs.length
        ? ""
        : "Non ho trovato flashcard valide. Ogni riga deve usare il formato: parola :: definizione.",
    );
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(FLASHCARD_MARKDOWN_PROMPT);
      setPromptCopied(true);
      setError("");
    } catch {
      setError("Non riesco a copiare automaticamente. Seleziona il testo del prompt e copialo manualmente.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!pairs.some((pair) => pair.front.trim() && pair.back.trim())) return;
          onImport(pairs);
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{deck.title} · importazione guidata</span>
            <h2 id="import-modal-title">Importa flashcard da un file .md</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </div>

        <section className="prompt-helper" aria-labelledby="prompt-helper-title">
          <div className="prompt-helper-heading">
            <div>
              <span className="eyebrow">1 · Prepara il file</span>
              <h3 id="prompt-helper-title">Fatti aiutare dal tuo LLM preferito</h3>
            </div>
            <p>Incolla questo prompt nel modello che preferisci insieme alla tua lista grezza di concetti.</p>
          </div>
          <button
            className={`llm-prompt-card${promptCopied ? " copied" : ""}`}
            type="button"
            onClick={() => void copyPrompt()}
            aria-label="Copia il prompt per creare il file Markdown"
          >
            <pre>{FLASHCARD_MARKDOWN_PROMPT}</pre>
            <span className="prompt-copy-feedback" aria-live="polite">
              {promptCopied ? "✓ Copiato negli appunti" : "Clicca il riquadro per copiare"}
            </span>
          </button>
        </section>

        <span className="eyebrow import-upload-step">2 · Carica il file</span>

        <button
          className="file-dropzone"
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void readFile(event.dataTransfer.files[0]);
          }}
        >
          <span aria-hidden="true">↑</span>
          <strong>{filename || "Scegli o trascina un file .md"}</strong>
          <small>Solo Markdown (.md) · massimo consigliato 5 MB</small>
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".md"
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
        <p className="import-format-hint">
          Una flashcard per riga: <code>parola :: definizione</code>
        </p>
        {error && <p className="form-message error">{error}</p>}

        {pairs.length > 0 && (
          <>
            <div className="import-preview-heading">
              <div><span className="eyebrow">Anteprima modificabile</span><h3>{pairs.length} flashcard trovate</h3></div>
              <button type="button" onClick={() => setPairs((current) => [...current, { front: "", back: "" }])}>
                ＋ Aggiungi riga
              </button>
            </div>
            <div className="import-preview-list">
              {pairs.map((pair, index) => (
                <div className="import-preview-row" key={`${index}-${filename}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <label>
                    <small>Fronte</small>
                    <textarea
                      value={pair.front}
                      onChange={(event) =>
                        setPairs((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, front: event.target.value } : item,
                        ))
                      }
                      rows={2}
                    />
                  </label>
                  <label>
                    <small>Retro</small>
                    <textarea
                      value={pair.back}
                      onChange={(event) =>
                        setPairs((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, back: event.target.value } : item,
                        ))
                      }
                      rows={2}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setPairs((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    aria-label={`Rimuovi la flashcard ${index + 1}`}
                  >×</button>
                </div>
              ))}
            </div>
            <div className="modal-actions sticky-actions">
              <span>Controlla le carte prima di importarle</span>
              <div>
                <button className="text-button" type="button" onClick={onClose}>Annulla</button>
                <button className="primary-button" type="submit">
                  Aggiungi {pairs.length} flashcard a {deck.title}
                </button>
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function AccountModal({
  user,
  configured,
  message,
  onEmail,
  onGoogle,
  onLogout,
  onContinueLocal,
  onClose,
}: {
  user: FirebaseUser | null;
  configured: boolean;
  message: string;
  onEmail: (email: string) => Promise<void>;
  onGoogle: () => Promise<void>;
  onLogout: () => Promise<void>;
  onContinueLocal: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  useEscape(onClose);

  return (
    <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Lume / il tuo spazio</span>
            <h2 id="account-modal-title">{user ? "Il tuo profilo" : "Ritrova le tue flashcard ovunque."}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </div>

        {user ? (
          <div className="signed-in-card">
            <span aria-hidden="true">◎</span>
            <div><small>Accesso effettuato</small><strong>{user.email}</strong></div>
            <button type="button" onClick={() => void onLogout()}>Esci dal profilo</button>
          </div>
        ) : (
          <>
            <p className="account-intro">Accedi gratuitamente per sincronizzare cartelle, set, carte e preferenze tra i tuoi dispositivi.</p>
            <button className="google-auth-button" type="button" onClick={() => void onGoogle()}>
              <span aria-hidden="true">G</span> Continua con Google
            </button>
            <div className="auth-divider"><span>oppure</span></div>
            <form
              className="email-auth-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!email.trim()) return;
                setSending(true);
                await onEmail(email.trim());
                setSending(false);
              }}
            >
              <label className="field">
                <span>La tua email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@email.it" required />
              </label>
              <button className="primary-button" type="submit" disabled={sending}>
                {sending ? "Invio…" : "Ricevi il link di accesso"}
              </button>
            </form>
            {message && <p className="form-message">{message}</p>}
            {!configured && (
              <p className="auth-config-note">
                L’interfaccia è pronta. Il login online si attiverà completando il progetto Firebase.
              </p>
            )}
            <button className="continue-local-button" type="button" onClick={onContinueLocal}>
              Continua senza account <span aria-hidden="true">→</span>
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function FolderModal({
  folder,
  onSave,
  onClose,
}: {
  folder?: Folder;
  onSave: (data: Omit<Folder, "id" | "createdAt">) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(folder?.title ?? "");
  const [color, setColor] = useState(folder?.color ?? "#e8c47d");
  const [emoji, setEmoji] = useState(folder?.emoji ?? "📚");
  useEscape(onClose);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal folder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          onSave({ title: title.trim(), color, emoji });
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Organizza i tuoi set</span>
            <h2 id="folder-modal-title">{folder ? "Modifica la cartella" : "Crea una cartella"}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <div className="form-grid">
          <label className="field full">
            <span>Nome della cartella</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Es. Esami di settembre"
              maxLength={60}
              required
            />
          </label>
        </div>
        <fieldset className="emoji-fieldset">
          <legend>Emoji della cartella</legend>
          <div className="emoji-list">
            {emojiOptions.map((option) => (
              <button
                key={option}
                className={emoji === option ? "selected" : ""}
                type="button"
                onClick={() => setEmoji(option)}
                aria-label={`Usa ${option} come emoji`}
              >{option}</button>
            ))}
          </div>
        </fieldset>
        <div className="folder-color-row">
          <label>
            <span>Colore della cartella</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <div className="folder-mini-preview" style={{ "--folder": color } as React.CSSProperties}>
            <i>{emoji}</i><strong>{title || "La tua cartella"}</strong>
          </div>
        </div>
        <div className="modal-actions">
          <button className="text-button" type="button" onClick={onClose}>Annulla</button>
          <button className="primary-button" type="submit">{folder ? "Salva modifiche" : "Crea cartella"}</button>
        </div>
      </form>
    </div>
  );
}

function DeckModal({
  deck,
  folders,
  defaultFolderId,
  defaultFont,
  onSave,
  onClose,
}: {
  deck?: Deck;
  folders: Folder[];
  defaultFolderId: string;
  defaultFont: FontChoice;
  onSave: (data: Omit<Deck, "id" | "cards" | "createdAt">) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(deck?.title ?? "");
  const [description, setDescription] = useState(deck?.description ?? "");
  const [color, setColor] = useState(deck?.color ?? palettes[0].color);
  const [cardColor, setCardColor] = useState(deck?.cardColor ?? palettes[0].card);
  const [font, setFont] = useState<FontChoice>(deck?.font ?? defaultFont);
  const [folderId, setFolderId] = useState(deck?.folderId ?? defaultFolderId);
  const [emoji, setEmoji] = useState(deck?.emoji ?? "📚");
  const [visibility, setVisibility] = useState<Deck["visibility"]>(deck?.visibility ?? "private");
  const [keywordHelp, setKeywordHelp] = useState(deck?.keywordHelp ?? false);

  useEscape(onClose);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim(),
      color,
      cardColor,
      font,
      folderId,
      emoji,
      visibility,
      keywordHelp,
      lastStudied: deck?.lastStudied,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal deck-modal"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-modal-title"
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{deck ? "Personalizza il set" : "Nuovo set"}</span>
            <h2 id="deck-modal-title">{deck ? "Modifica il set" : "Crea un set di flashcard"}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <div className="form-grid">
          <label className="field full">
            <span>Nome del set</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Es. Letteratura italiana"
              maxLength={70}
              required
            />
          </label>
          <label className="field full">
            <span>Una breve descrizione <small>facoltativa</small></span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Es. Autori, opere e correnti"
              maxLength={110}
            />
          </label>
          <label className="field">
            <span>Cartella</span>
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)} required>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.emoji} {folder.title}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="set-feature-options">
          <label className={visibility === "public" ? "feature-option selected" : "feature-option"}>
            <input
              type="checkbox"
              checked={visibility === "public"}
              onChange={(event) => setVisibility(event.target.checked ? "public" : "private")}
            />
            <span aria-hidden="true">◎</span>
            <div>
              <strong>Set pubblico</strong>
              <small>Può comparire in Esplora ed essere studiato da altre persone.</small>
            </div>
          </label>
          <label className={keywordHelp ? "feature-option selected" : "feature-option"}>
            <input
              type="checkbox"
              checked={keywordHelp}
              onChange={(event) => setKeywordHelp(event.target.checked)}
            />
            <span aria-hidden="true">B</span>
            <div>
              <strong>Keyword Help</strong>
              <small>Le parole in neretto diventano suggerimenti durante lo studio.</small>
            </div>
          </label>
        </div>
        {visibility === "public" && (
          <p className="public-setting-note">
            Il set è subito visibile nel tuo catalogo. Per condividerlo online con altre persone, accedi al profilo.
          </p>
        )}
        <fieldset className="palette-fieldset">
          <legend>Scegli l’atmosfera</legend>
          <div className="palette-list">
            {palettes.map((palette) => (
              <button
                key={palette.name}
                className={color === palette.color && cardColor === palette.card ? "selected" : ""}
                type="button"
                onClick={() => {
                  setColor(palette.color);
                  setCardColor(palette.card);
                }}
                aria-label={palette.name}
                title={palette.name}
              >
                <i style={{ background: palette.color }} />
                <i style={{ background: palette.card }} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="deck-font-fieldset">
          <legend>Font del set</legend>
          <div className="deck-font-list">
            {fontOptions.map((option) => (
              <button
                key={option.value}
                className={font === option.value ? "selected" : ""}
                type="button"
                onClick={() => setFont(option.value)}
                style={{ fontFamily: option.family }}
              >
                <strong>Aa</strong>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <p>Il font verrà usato nel set e durante lo studio.</p>
        </fieldset>
        <fieldset className="emoji-fieldset">
          <legend>Emoji della copertina</legend>
          <div className="emoji-list">
            {emojiOptions.map((option) => (
              <button
                key={option}
                className={emoji === option ? "selected" : ""}
                type="button"
                onClick={() => setEmoji(option)}
                aria-label={`Usa ${option} come emoji`}
              >{option}</button>
            ))}
          </div>
        </fieldset>
        <div className="custom-colors">
          <label>
            <span>Colore set</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <label>
            <span>Colore flashcard</span>
            <input type="color" value={cardColor} onChange={(event) => setCardColor(event.target.value)} />
          </label>
          <div
            className="color-preview"
            style={{
              background: color,
              color: getTextColor(color),
              fontFamily: fontFamily(font),
            }}
          >
            <span style={{ background: cardColor, color: "#2b2925" }}>{emoji}</span>
            <strong>{title || "Il tuo set"}</strong>
          </div>
        </div>
        <div className="modal-actions">
          <button className="text-button" type="button" onClick={onClose}>Annulla</button>
          <button className="primary-button" type="submit">{deck ? "Salva modifiche" : "Crea set"}</button>
        </div>
      </form>
    </div>
  );
}

function CardModal({
  deck,
  onSave,
  onImport,
  onClose,
}: {
  deck: Deck;
  onSave: (cards: Array<{ front: string; back: string }>) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const [pairs, setPairs] = useState([{ front: "", back: "" }]);
  useEscape(onClose);

  const updatePair = (index: number, field: "front" | "back", value: string) => {
    setPairs((current) =>
      current.map((pair, pairIndex) =>
        pairIndex === index ? { ...pair, [field]: value } : pair,
      ),
    );
  };

  const validCount = pairs.filter((pair) => plainText(pair.front) && plainText(pair.back)).length;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal card-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (validCount) onSave(pairs);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-modal-title"
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{deck.title}</span>
            <h2 id="card-modal-title">Aggiungi flashcards</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <div className="modal-intro-row">
          <p className="modal-intro">
            Usa neretto, corsivo e sottolineato. {deck.keywordHelp
              ? "In questo set il neretto identifica le parole che Keyword Help mostrerà come suggerimenti."
              : "Puoi formattare liberamente sia il fronte sia il retro."}
          </p>
          <button className="secondary-button card-import-button" type="button" onClick={onImport}>
            <span aria-hidden="true">↑</span> Importa file .md
          </button>
        </div>
        <div className="pair-list">
          {pairs.map((pair, index) => (
            <div className="card-pair" key={index}>
              <span className="pair-number">{String(index + 1).padStart(2, "0")}</span>
              <RichTextEditor
                autoFocus={index === 0}
                value={pair.front}
                onChange={(value) => updatePair(index, "front", value)}
                label="Domanda o termine"
                placeholder="Che cosa vuoi ricordare?"
                keywordHelp={deck.keywordHelp}
              />
              <RichTextEditor
                value={pair.back}
                onChange={(value) => updatePair(index, "back", value)}
                label="Risposta o definizione"
                placeholder="Scrivi qui la risposta…"
                keywordHelp={deck.keywordHelp}
              />
              {pairs.length > 1 && (
                <button
                  className="remove-pair"
                  type="button"
                  onClick={() => setPairs((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Rimuovi la coppia ${index + 1}`}
                >×</button>
              )}
            </div>
          ))}
        </div>
        <button
          className="add-pair-button"
          type="button"
          onClick={() => setPairs((current) => [...current, { front: "", back: "" }])}
        >
          <span aria-hidden="true">＋</span> Aggiungi un’altra coppia
        </button>
        <div className="modal-actions sticky-actions">
          <span>{validCount} {validCount === 1 ? "carta pronta" : "carte pronte"}</span>
          <div>
            <button className="text-button" type="button" onClick={onClose}>Annulla</button>
            <button className="primary-button" type="submit" disabled={!validCount}>Salva le carte</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onExport,
  onImport,
  onClose,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onExport: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="floating-panel settings-panel" aria-label="Preferenze di lettura">
      <div className="panel-header">
        <div><span className="eyebrow">Il tuo modo di leggere</span><h3>Preferenze</h3></div>
        <button type="button" onClick={onClose} aria-label="Chiudi">×</button>
      </div>
      <fieldset>
        <legend>Carattere</legend>
        <div className="font-choices">
          {fontOptions.map((option) => (
            <button
              key={option.value}
              className={settings.font === option.value ? "selected" : ""}
              type="button"
              onClick={() => onChange({ ...settings, font: option.value })}
              style={{ fontFamily: option.family }}
            >
              <strong>Aa</strong>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Aspetto</legend>
        <div className="appearance-choices">
          <button className={settings.theme === "light" ? "selected" : ""} type="button" onClick={() => onChange({ ...settings, theme: "light" })}><i className="light-preview" /><span>Chiaro</span></button>
          <button className={settings.theme === "dark" ? "selected" : ""} type="button" onClick={() => onChange({ ...settings, theme: "dark" })}><i className="dark-preview" /><span>Scuro</span></button>
        </div>
      </fieldset>
      <div className="backup-section">
        <span>Le tue carte, sempre tue</span>
        <p>Scarica un backup o portalo su un altro dispositivo.</p>
        <div><button type="button" onClick={onExport}>Esporta</button><button type="button" onClick={onImport}>Importa</button></div>
      </div>
    </aside>
  );
}

function SoundPanel({
  mode,
  volume,
  onSelect,
  onVolume,
  onClose,
}: {
  mode: SoundMode;
  volume: number;
  onSelect: (mode: SoundMode) => void;
  onVolume: (volume: number) => void;
  onClose: () => void;
}) {
  return (
    <aside className="floating-panel sound-panel" aria-label="Suoni per la concentrazione">
      <div className="panel-header">
        <div><span className="eyebrow">Ambiente sonoro</span><h3>Trova il tuo ritmo</h3></div>
        <button type="button" onClick={onClose} aria-label="Chiudi">×</button>
      </div>
      <div className="sound-list">
        <button className={mode === "rain" ? "selected" : ""} type="button" onClick={() => onSelect(mode === "rain" ? "off" : "rain")}><span aria-hidden="true">⌇</span><div><strong>Pioggia lieve</strong><small>Rumore generato nel browser</small></div><i>{mode === "rain" ? "■" : "▶"}</i></button>
        <button className={mode === "brown" ? "selected" : ""} type="button" onClick={() => onSelect(mode === "brown" ? "off" : "brown")}><span aria-hidden="true">≈</span><div><strong>Rumore bruno</strong><small>Caldo e uniforme</small></div><i>{mode === "brown" ? "■" : "▶"}</i></button>
        <button className={mode === "bach" ? "selected" : ""} type="button" onClick={() => onSelect(mode === "bach" ? "off" : "bach")}><span aria-hidden="true">♩</span><div><strong>Bach · Aria</strong><small>Goldberg Variations · CC0</small></div><i>{mode === "bach" ? "■" : "▶"}</i></button>
      </div>
      <label className="volume-control">
        <span aria-hidden="true">♪</span>
        <input type="range" min="0" max="0.7" step="0.01" value={volume} onChange={(event) => onVolume(Number(event.target.value))} aria-label="Volume" />
        <span aria-hidden="true">♫</span>
      </label>
      <a className="audio-credit" href="https://commons.wikimedia.org/wiki/File:Bach,_Goldberg_Variations,_Aria_(Musopen_version).ogg" target="_blank" rel="noreferrer">Registrazione CC0 via Wikimedia Commons ↗</a>
    </aside>
  );
}

function MobileNav({
  view,
  onNavigate,
  onCreate,
}: {
  view: View;
  onNavigate: (view: View) => void;
  onCreate: () => void;
}) {
  return (
    <nav className="mobile-nav" aria-label="Navigazione mobile">
      <button className={view.name === "home" ? "active" : ""} type="button" onClick={() => onNavigate({ name: "home" })}><span aria-hidden="true">⌂</span>Spazio</button>
      <button className={view.name === "library" || view.name === "folder" || view.name === "deck" || view.name === "study" ? "active" : ""} type="button" onClick={() => onNavigate({ name: "library" })}><span aria-hidden="true">▱</span>Cartelle</button>
      <button className="mobile-add" type="button" onClick={onCreate} aria-label="Nuovo set">＋</button>
      <button className={view.name === "community" ? "active" : ""} type="button" onClick={() => onNavigate({ name: "community" })}><span aria-hidden="true">⌕</span>Esplora</button>
    </nav>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);
}
