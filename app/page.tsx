"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cloudIsConfigured,
  friendlyCloudError,
  loadPrivateLibrary,
  loadPublicDecks,
  loginWithEmail,
  loginWithGoogle,
  logoutAccount,
  observeAccount,
  registerWithEmail,
  resetAccountPassword,
  savePublicStudyResult,
  setPublicVote,
  syncPrivateLibrary,
  syncPublicLibrary,
  type CloudAccount,
  type CloudDeck,
  type CloudLibrary,
} from "./lume-cloud";
import {
  addClassComment,
  claimUsername,
  createClass,
  joinClass,
  loadClasses,
  loadClassWorkspace,
  loadCopyRequest,
  loadNotifications,
  loadUsername,
  markCopyRequestCopied,
  markNotificationRead,
  notifyClassContent,
  notifyPublicRating,
  requestClassCopy,
  respondToCopyRequest,
  saveClassAnnotation,
  saveClassBundle,
  saveClassDeck,
  saveClassFolder,
  toggleClassFavorite,
  validateUsername,
  type AnnotationFilter,
  type ClassAnnotation,
  type ClassComment,
  type ClassDeck,
  type ClassFavorite,
  type ClassFolder,
  type ClassItemKind,
  type ClassWorkspace,
  type LumeClass,
  type LumeNotification,
} from "./lume-classes";

type Visibility = "private" | "public";
type Pattern = "plain" | "lines" | "grid" | "waves" | "dots" | "botanical";
type Order = "sequential" | "random";
type Direction = "front-first" | "back-first";
type StudyMode = "learn" | "test";
type StudyFont = "current" | "comic" | "helvetica" | "serif" | "mono";
type CardColorMode = "single" | "random";
type PublicVote = -1 | 0 | 1 | 2;

type Card = {
  id: string;
  front: string;
  back: string;
  known: number;
  missed: number;
  pinned?: boolean;
  pinComment?: string;
};

type Folder = {
  id: string;
  parentId: string | null;
  title: string;
  color: string;
  visibility: Visibility;
  createdAt: number;
};

type Deck = {
  id: string;
  folderId: string | null;
  title: string;
  description: string;
  color: string;
  pattern: Pattern;
  visibility: Visibility;
  keywordHelp: boolean;
  order: Order;
  direction: Direction;
  cardColorMode?: CardColorMode;
  cardColor?: string;
  cards: Card[];
  createdAt: number;
  lastStudied?: number;
  votes?: number;
  userVote?: PublicVote;
  publicId?: string;
  ownerId?: string;
  ownerName?: string;
  ratingsCount?: number;
  community?: boolean;
  classId?: string;
  shared?: boolean;
  sharedOwnerId?: string;
  sharedOwnerName?: string;
};

type CloudStatus = "unavailable" | "checking" | "signed-out" | "loading" | "syncing" | "synced" | "error";

type View =
  | { name: "home" }
  | { name: "folders" }
  | { name: "explore" }
  | { name: "classes" }
  | { name: "class"; id: string; folderId?: string | null }
  | { name: "folder"; id: string }
  | { name: "deck"; id: string };

type DeleteRequest = {
  kind: "folder" | "decks";
  title: string;
  folderIds: string[];
  deckIds: string[];
  subfolderCount: number;
  deckCount: number;
  returnFolderId?: string | null;
};

type StudyState = {
  deckIds: string[];
  cardIds: string[];
  initialCardIds: string[];
  index: number;
  flipped: boolean;
  mode: StudyMode | null;
  known: number;
  missed: string[];
  learnedIds: string[];
  attempts: number;
  attemptsByCard: Record<string, number>;
  missesByCard: Record<string, number>;
  streak: number;
  bestStreak: number;
  complete: boolean;
  direction: Direction;
  order: Order;
  font: StudyFont;
  cardColor: string;
};

const LEARN_REVIEW_GAP = 3;

const LEGACY_STORE_KEY = "lume-clean-v2";
const STORE_PREFIX = "lume-library-v3";
const THEME_KEY = "lume-clean-theme";

function libraryStoreKey(uid: string | null) {
  return `${STORE_PREFIX}:${uid ?? "guest"}`;
}

const colors = [
  "#d7b56d",
  "#cda6a2",
  "#91aaa4",
  "#a995aa",
  "#afbd91",
  "#cf8e72",
  "#8099b5",
  "#c6b596",
];

const cardColors = [...colors, "#34383b"];

const patterns: Array<{ value: Pattern; label: string }> = [
  { value: "plain", label: "Pulito" },
  { value: "lines", label: "Righe" },
  { value: "grid", label: "Griglia" },
  { value: "waves", label: "Onde" },
  { value: "dots", label: "Punti" },
  { value: "botanical", label: "Botanico" },
];

const markdownPrompt = `Turn my rough study notes into a UTF-8 Markdown file named flashcards.md. Repeat this exact block for every flashcard:
<!-- LUME_CARD -->
term :: definition

Use one concept per block. Reorder and deduplicate the concepts, correct obvious mistakes, and keep definitions clear and concise. Never merge two cards. Return only these blocks, with no headings, bullets, numbering, tables, or code fences.

My rough notes:
[PASTE HERE]`;

const keywordMarkdownPrompt = `Turn my rough study notes into a UTF-8 Markdown file named flashcards.md. Repeat this exact block for every flashcard:
<!-- LUME_CARD -->
term :: definition

Use one concept per block. Reorder and deduplicate the concepts, correct obvious mistakes, and never merge two cards. In each definition, wrap only its best recall anchors in **double asterisks**: 1 for a short definition, 2 for a medium one, and no more than 3 for a long one. Return only these blocks, with no headings, bullets, numbering, tables, or code fences.

My rough notes:
[PASTE HERE]`;

function emptyLibrary(): CloudLibrary {
  return { folders: [], decks: [], studyDays: [], focusMinutes: 25 };
}

function firstAccessLibrary(): CloudLibrary {
  const createdAt = Date.now();
  return {
    folders: [{
      id: "lume-example-folder",
      parentId: null,
      title: "Esempio · Inizia da qui",
      color: "#91aaa4",
      visibility: "private",
      createdAt,
    }],
    decks: [{
      id: "lume-example-deck",
      folderId: "lume-example-folder",
      title: "Scopri Lume",
      description: "Un piccolo set per provare lo studio",
      color: "#91aaa4",
      pattern: "waves",
      visibility: "private",
      keywordHelp: true,
      order: "sequential",
      direction: "front-first",
      cardColorMode: "single",
      cardColor: "#91aaa4",
      createdAt: createdAt + 1,
      cards: [
        {
          id: "lume-example-card-flip",
          front: "Come giro una flashcard?",
          back: "Premi la <strong>barra spaziatrice</strong> oppure tocca la carta.",
          known: 0,
          missed: 0,
        },
        {
          id: "lume-example-card-answer",
          front: "Come indico se conosco la risposta?",
          back: "Premi <strong>1</strong> se la sai e <strong>2</strong> se vuoi rivederla.",
          known: 0,
          missed: 0,
        },
        {
          id: "lume-example-card-keywords",
          front: "Che cos’è Keyword Help?",
          back: "Tenendo premuta la barra spaziatrice restano visibili soltanto le <strong>parole chiave</strong> evidenziate in neretto.",
          known: 0,
          missed: 0,
        },
      ],
    }],
    studyDays: [],
    focusMinutes: 25,
  };
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function plainText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function getContrast(color: string) {
  const hex = color.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 156 ? "#24231f" : "#fffdf8";
}

function tint(color: string, amount = 0.78) {
  const hex = color.replace("#", "");
  const rgb = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `#${rgb
    .map((channel) => Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

function darken(color: string, amount = 0.38) {
  const hex = color.replace("#", "");
  const rgb = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `#${rgb.map((channel) => Math.round(channel * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeRichText(value: string) {
  const source = /<[a-z][\s\S]*>/i.test(value) ? value : escapeHtml(value);
  return source
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

function parseMarkdownFlashcards(value: string) {
  const source = value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^```(?:markdown|md)?\s*$/gim, "")
    .replace(/^```\s*$/gim, "")
    .trim();

  const toPair = (block: string) => {
    const compact = block.replace(/\s+/g, " ").trim();
    const separator = compact.indexOf("::");
    if (separator <= 0) return null;
    const front = compact.slice(0, separator).replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
    const back = compact.slice(separator + 2).trim();
    return front && back
      ? { front: normalizeRichText(front), back: normalizeRichText(back) }
      : null;
  };

  const marker = /<!--\s*LUME_CARD\s*-->/i;
  if (marker.test(source)) {
    return source
      .split(/<!--\s*LUME_CARD\s*-->/gi)
      .map(toPair)
      .filter((item): item is { front: string; back: string } => Boolean(item));
  }

  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length && lines.every((line) => (line.match(/::/g) ?? []).length === 1)) {
    return lines
      .map(toPair)
      .filter((item): item is { front: string; back: string } => Boolean(item));
  }

  // Alcuni editor e LLM inseriscono ritorni a capo nel mezzo di una coppia o
  // subito prima del termine seguente. Ricostruiamo il testo e usiamo l'ultima
  // frase completa prima di ogni :: come confine tra due flashcard.
  const compact = lines.join(" ").replace(/\s+/g, " ").trim();
  const separators = Array.from(compact.matchAll(/::/g), (match) => match.index);
  if (!separators.length) return [];

  const starts = [0];
  for (let index = 1; index < separators.length; index += 1) {
    const previousSeparatorEnd = separators[index - 1] + 2;
    const betweenCards = compact.slice(previousSeparatorEnd, separators[index]);
    let boundary = -1;
    for (const match of betweenCards.matchAll(/[.!?](?:["'’”)}\]]*)\s+(?=\S)/g)) {
      boundary = (match.index ?? 0) + match[0].length;
    }
    starts.push(boundary >= 0 ? previousSeparatorEnd + boundary : previousSeparatorEnd);
  }

  return separators
    .map((separator, index) => {
      const front = compact
        .slice(starts[index], separator)
        .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
        .trim();
      const backEnd = index + 1 < starts.length ? starts[index + 1] : compact.length;
      const back = compact.slice(separator + 2, backEnd).trim();
      return front && back
        ? { front: normalizeRichText(front), back: normalizeRichText(back) }
        : null;
    })
    .filter((item): item is { front: string; back: string } => Boolean(item));
}

function normalizeDeck(deck: Deck): Deck {
  return {
    ...deck,
    cardColorMode: deck.cardColorMode ?? "single",
    cardColor: deck.cardColor ?? deck.color,
    votes: deck.votes ?? 0,
    userVote: deck.userVote ?? 0,
    cards: deck.cards.map((card) => ({
      ...card,
      front: normalizeRichText(card.front),
      back: normalizeRichText(card.back),
      pinComment: card.pinComment ?? "",
    })),
  };
}

function toCloudDeck(deck: Deck): CloudDeck {
  return {
    id: deck.id,
    folderId: deck.folderId,
    title: deck.title,
    description: deck.description,
    color: deck.color,
    pattern: deck.pattern,
    visibility: deck.visibility,
    keywordHelp: deck.keywordHelp,
    order: deck.order,
    direction: deck.direction,
    cardColorMode: deck.cardColorMode,
    cardColor: deck.cardColor,
    cards: deck.cards.map((card, position) => ({
      id: card.id,
      position,
      front: card.front,
      back: card.back,
      known: card.known,
      missed: card.missed,
      pinned: card.pinned,
      pinComment: card.pinComment,
    })),
    createdAt: deck.createdAt,
    lastStudied: deck.lastStudied,
  };
}

function fromCloudDeck(deck: CloudDeck): Deck {
  const validPatterns: Pattern[] = ["plain", "lines", "grid", "waves", "dots", "botanical"];
  return normalizeDeck({
    ...deck,
    pattern: validPatterns.includes(deck.pattern as Pattern) ? deck.pattern as Pattern : "plain",
    cards: deck.cards.map((card) => ({ ...card })),
  });
}

function fromClassDeck(deck: ClassDeck, classId: string, annotations: ClassAnnotation[], uid?: string): Deck {
  const ownAnnotations = new Map(
    annotations
      .filter((annotation) => annotation.authorId === uid && annotation.cardId)
      .map((annotation) => [annotation.cardId as string, annotation]),
  );
  return {
    ...fromCloudDeck(deck),
    id: `class:${classId}:${deck.id}`,
    folderId: deck.folderId,
    visibility: "private",
    classId,
    shared: true,
    sharedOwnerId: deck.ownerId,
    sharedOwnerName: deck.ownerName,
    cards: deck.cards.map((card) => {
      const annotation = ownAnnotations.get(card.id);
      return {
        ...card,
        pinned: annotation?.pinned ?? false,
        pinComment: annotation?.note ?? "",
      };
    }),
  };
}

function classSourceDeckId(deckId: string) {
  return deckId.split(":").slice(2).join(":");
}

function cloudLibrarySnapshot(folders: Folder[], decks: Deck[], studyDays: string[], focusMinutes: number): CloudLibrary {
  return {
    folders: folders.map((folder) => ({ ...folder })),
    decks: decks.filter((deck) => !deck.community).map(toCloudDeck),
    studyDays: [...studyDays],
    focusMinutes,
  };
}

type StoredLibraryRecord = {
  library: CloudLibrary;
  dirty: boolean;
  savedAt: number;
};

function normalizeStoredLibrary(value: unknown): CloudLibrary | null {
  try {
    const parsed = value as Partial<CloudLibrary>;
    if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.decks)) return null;
    const decks = parsed.decks.map((deck) => toCloudDeck(fromCloudDeck(deck)));
    const restoredDays = Array.isArray(parsed.studyDays) ? parsed.studyDays.filter((day): day is string => typeof day === "string") : [];
    return {
      folders: parsed.folders,
      decks,
      studyDays: restoredDays.length ? restoredDays : decks.flatMap((deck) => deck.lastStudied ? [localDayKey(deck.lastStudied)] : []),
      focusMinutes: typeof parsed.focusMinutes === "number" ? Math.min(240, Math.max(1, parsed.focusMinutes)) : 25,
    };
  } catch {
    return null;
  }
}

function readStoredLibraryRecord(key: string): StoredLibraryRecord | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLibraryRecord & CloudLibrary>;
    const wrapped = parsed.library && typeof parsed.library === "object";
    const library = normalizeStoredLibrary(wrapped ? parsed.library : parsed);
    if (!library) return null;
    return {
      library,
      dirty: wrapped ? parsed.dirty === true : false,
      savedAt: wrapped && typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

function readStoredLibrary(key: string) {
  return readStoredLibraryRecord(key)?.library ?? null;
}

function writeStoredLibrary(key: string, library: CloudLibrary, dirty: boolean) {
  localStorage.setItem(key, JSON.stringify({ library, dirty, savedAt: Date.now() } satisfies StoredLibraryRecord));
}

function isLegacyDemoLibrary(library: CloudLibrary) {
  const folderSignature = new Map([
    ["f-uni", "Università"],
    ["f-psy", "Psicologia"],
    ["f-exams", "Esami di gennaio"],
    ["f-language", "Lingue"],
  ]);
  const deckSignature = new Map([
    ["d-cognition", "Psicologia cognitiva"],
    ["d-methods", "Metodologia della ricerca"],
    ["d-english", "English · C1"],
  ]);
  return library.folders.length === folderSignature.size
    && library.decks.length === deckSignature.size
    && library.folders.every((folder) => folderSignature.get(folder.id) === folder.title)
    && library.decks.every((deck) => deckSignature.get(deck.id) === deck.title);
}

function publicDecksFromLibrary(library: CloudLibrary) {
  const folderMap = new Map(library.folders.map((folder) => [folder.id, folder]));
  const folderIsPublic = (folderId: string | null) => {
    const visited = new Set<string>();
    let current = folderId ? folderMap.get(folderId) : undefined;
    while (current && !visited.has(current.id)) {
      if (current.visibility === "public") return true;
      visited.add(current.id);
      current = current.parentId ? folderMap.get(current.parentId) : undefined;
    }
    return false;
  };
  return library.decks.filter((deck) => deck.visibility === "public" || folderIsPublic(deck.folderId));
}

function formatRelative(timestamp?: number) {
  if (!timestamp) return "Mai studiato";
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 2) return "Adesso";
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  return `${Math.round(hours / 24)} giorni fa`;
}

function localDayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function consecutiveStudyDays(days: string[]) {
  const studied = new Set(days);
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  if (!studied.has(localDayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (studied.has(localDayKey(cursor.getTime()))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function extractKeywords(html: string) {
  return Array.from(html.matchAll(/<strong[^>]*>(.*?)<\/strong>/gi))
    .map((match) => plainText(match[1]))
    .filter(Boolean);
}

function migrateOldData(): { folders: Folder[]; decks: Deck[] } | null {
  try {
    const oldFolders = JSON.parse(localStorage.getItem("lume-folders-v1") ?? "null");
    const oldDecks = JSON.parse(localStorage.getItem("lume-flashcards-v1") ?? "null");
    if (!Array.isArray(oldFolders) || !Array.isArray(oldDecks)) return null;
    const folders = oldFolders.map((folder: Record<string, unknown>, index: number): Folder => ({
      id: String(folder.id ?? makeId("folder")),
      parentId: null,
      title: String(folder.title ?? `Cartella ${index + 1}`),
      color: String(folder.color ?? colors[index % colors.length]),
      visibility: folder.visibility === "public" ? "public" : "private",
      createdAt: Number(folder.createdAt ?? Date.now() + index),
    }));
    const decks = oldDecks.map((deck: Record<string, unknown>, index: number): Deck => ({
      id: String(deck.id ?? makeId("deck")),
      folderId: typeof deck.folderId === "string" && folders.some((folder) => folder.id === deck.folderId) ? deck.folderId : null,
      title: String(deck.title ?? `Set ${index + 1}`),
      description: String(deck.description ?? ""),
      color: String(deck.color ?? colors[index % colors.length]),
      pattern: (["plain", "lines", "grid", "waves", "dots", "botanical"] as string[]).includes(String(deck.pattern)) ? (deck.pattern as Pattern) : "plain",
      visibility: deck.visibility === "public" ? "public" : "private",
      keywordHelp: Boolean(deck.keywordHelp),
      order: deck.defaultOrder === "random" ? "random" : "sequential",
      direction: deck.defaultDirection === "back-first" ? "back-first" : "front-first",
      cardColorMode: "single",
      cardColor: String(deck.color ?? colors[index % colors.length]),
      createdAt: Number(deck.createdAt ?? Date.now() + index),
      lastStudied: typeof deck.lastStudied === "number" ? deck.lastStudied : undefined,
      votes: Number(deck.votes ?? 0),
      userVote: deck.userVote === 2 || deck.userVote === 1 || deck.userVote === -1 ? deck.userVote : 0,
      cards: Array.isArray(deck.cards)
        ? deck.cards.map((card: Record<string, unknown>): Card => ({
            id: String(card.id ?? makeId("card")),
            front: String(card.front ?? ""),
            back: String(card.back ?? ""),
            known: Number(card.known ?? 0),
            missed: Number(card.missed ?? 0),
            pinned: Boolean(card.pinned),
            pinComment: String(card.pinComment ?? ""),
          }))
        : [],
    }));
    return { folders, decks };
  } catch {
    return null;
  }
}

export default function LumeApp() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarWidth, setSidebarWidth] = useState(226);
  const [view, setView] = useState<View>({ name: "home" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createMenu, setCreateMenu] = useState(false);
  const [folderCreator, setFolderCreator] = useState<{ parentId: string | null; editId?: string } | null>(null);
  const [deckCreator, setDeckCreator] = useState<{ folderId: string | null; editId?: string } | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [randomKey, setRandomKey] = useState(0);
  const [randomFlipped, setRandomFlipped] = useState(false);
  const [study, setStudy] = useState<StudyState | null>(null);
  const [showKeywords, setShowKeywords] = useState(false);
  const [studySettingsOpen, setStudySettingsOpen] = useState(false);
  const spaceHoldTimer = useRef<number | null>(null);
  const spaceLongPress = useRef(false);
  const [deckTransfer, setDeckTransfer] = useState<{ deckId: string; targetFolderId: string } | null>(null);
  const [batchMove, setBatchMove] = useState<string[] | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [focusSetup, setFocusSetup] = useState(false);
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [studyDays, setStudyDays] = useState<string[]>([]);
  const [focus, setFocus] = useState<{ startedAt: number; duration: number; pausedAt?: number; finishedAt?: number } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [timerVisible, setTimerVisible] = useState(true);
  const [breathing, setBreathing] = useState<{ startedAt: number } | null>(null);
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [usernameChecked, setUsernameChecked] = useState(false);
  const [classes, setClasses] = useState<LumeClass[]>([]);
  const [classWorkspace, setClassWorkspace] = useState<ClassWorkspace | null>(null);
  const [classBusy, setClassBusy] = useState(false);
  const [classNotice, setClassNotice] = useState("");
  const [classDialog, setClassDialog] = useState<{ mode: "create" | "join"; code?: string } | null>(null);
  const [classCreateMenu, setClassCreateMenu] = useState(false);
  const [classImportOpen, setClassImportOpen] = useState(false);
  const [classFolderCreator, setClassFolderCreator] = useState<{ classId: string; parentId: string | null; editId?: string } | null>(null);
  const [classDeckCreator, setClassDeckCreator] = useState<{ classId: string; folderId: string | null; editId?: string } | null>(null);
  const [annotationFilter, setAnnotationFilter] = useState<AnnotationFilter>("all");
  const [notifications, setNotifications] = useState<LumeNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(cloudIsConfigured() ? "checking" : "unavailable");
  const [cloudReady, setCloudReady] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountNotice, setAccountNotice] = useState("");
  const [publicDecks, setPublicDecks] = useState<Deck[]>([]);
  const [voteBusy, setVoteBusy] = useState(false);
  const cloudBaselineRef = useRef<CloudLibrary | null>(null);
  const publicBaselineRef = useRef<CloudDeck[]>([]);
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const localSnapshotRef = useRef<string | null>(null);
  const applyLibrary = useCallback((library: CloudLibrary) => {
    setFolders(library.folders.map((folder) => ({ ...folder })));
    setDecks(library.decks.map(fromCloudDeck));
    setStudyDays(library.studyDays);
    setFocusMinutes(Math.min(240, Math.max(1, library.focusMinutes)));
  }, []);

  useEffect(() => {
    try {
      const guestKey = libraryStoreKey(null);
      const guestLibrary = readStoredLibrary(guestKey);
      const legacyLibrary = guestLibrary ? null : readStoredLibrary(LEGACY_STORE_KEY);
      const stored = guestLibrary ?? legacyLibrary;
      if (stored) {
        applyLibrary(stored);
        if (legacyLibrary) writeStoredLibrary(guestKey, legacyLibrary, false);
      } else {
        const migrated = migrateOldData();
        if (migrated) {
          setFolders(migrated.folders);
          setDecks(migrated.decks.map(normalizeDeck));
          setStudyDays(migrated.decks.flatMap((deck) => deck.lastStudied ? [localDayKey(deck.lastStudied)] : []));
          writeStoredLibrary(guestKey, cloudLibrarySnapshot(migrated.folders, migrated.decks.map(normalizeDeck), [], 25), false);
        }
      }
      const storedTheme = localStorage.getItem(THEME_KEY);
      if (storedTheme === "dark") setTheme("dark");
    } finally {
      setHydrated(true);
    }
  }, [applyLibrary]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (hydrated) localStorage.setItem(THEME_KEY, theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated || (account && !cloudReady)) return;
    const snapshot = cloudLibrarySnapshot(folders, decks, studyDays, focusMinutes);
    if (!account) {
      writeStoredLibrary(libraryStoreKey(null), snapshot, false);
      return;
    }
    const serialized = JSON.stringify(snapshot);
    if (serialized === localSnapshotRef.current) return;
    localSnapshotRef.current = serialized;
    writeStoredLibrary(libraryStoreKey(account.uid), snapshot, true);
  }, [folders, decks, studyDays, focusMinutes, hydrated, account, cloudReady]);

  const refreshPublicDecks = useCallback(async (uid?: string) => {
    if (!cloudIsConfigured()) {
      setPublicDecks([]);
      return;
    }
    const remote = await loadPublicDecks(uid);
    setPublicDecks(remote.map((deck) => normalizeDeck({
      ...fromCloudDeck(deck),
      id: deck.id,
      publicId: deck.publicId,
      ownerId: deck.ownerId,
      ownerName: deck.ownerName,
      votes: deck.score,
      ratingsCount: deck.ratingsCount,
      userVote: deck.userVote,
      community: true,
    })));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!cloudIsConfigured()) {
      return;
    }
    let active = true;
    const unsubscribe = observeAccount((nextAccount) => {
      if (!active) return;
      setAccount(nextAccount);
      setUsername(null);
      setUsernameChecked(false);
      setClasses([]);
      setClassWorkspace(null);
      setNotifications([]);
      setCloudReady(false);
      localSnapshotRef.current = null;
      setView({ name: "home" });
      setStudy(null);
      setFolderCreator(null);
      setDeckCreator(null);
      setDeckTransfer(null);
      setBatchMove(null);
      setDeleteRequest(null);
      void (async () => {
        try {
          if (!nextAccount) {
            cloudBaselineRef.current = null;
            publicBaselineRef.current = [];
            setCloudStatus("signed-out");
            setUsernameChecked(true);
            applyLibrary(readStoredLibrary(libraryStoreKey(null)) ?? emptyLibrary());
            await refreshPublicDecks();
            return;
          }
          setCloudStatus("loading");
          const accountStoreKey = libraryStoreKey(nextAccount.uid);
          const cached = readStoredLibraryRecord(accountStoreKey);
          applyLibrary(cached?.library ?? emptyLibrary());
          const [stored, existingPublic, profileUsername, joinedClasses, alerts] = await Promise.all([
            loadPrivateLibrary(nextAccount.uid),
            loadPublicDecks(nextAccount.uid),
            loadUsername(nextAccount.uid),
            loadClasses(nextAccount.uid),
            loadNotifications(nextAccount.uid),
          ]);
          if (!active) return;
          setUsername(profileUsername);
          setUsernameChecked(true);
          setClasses(joinedClasses);
          setNotifications(alerts);
          let selectedLibrary: CloudLibrary;
          const replaceLegacyDemo = stored.exists && isLegacyDemoLibrary(stored.library);
          const recoverLocalChanges = cached?.dirty === true;
          if (recoverLocalChanges) {
            selectedLibrary = cached.library;
            applyLibrary(selectedLibrary);
            await syncPrivateLibrary(nextAccount, stored.exists ? stored.library : null, selectedLibrary);
          } else if (stored.exists && !replaceLegacyDemo) {
            selectedLibrary = normalizeStoredLibrary(stored.library) ?? stored.library;
            applyLibrary(selectedLibrary);
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          } else {
            const firstLibrary = firstAccessLibrary();
            selectedLibrary = normalizeStoredLibrary(firstLibrary) ?? firstLibrary;
            applyLibrary(selectedLibrary);
            await syncPrivateLibrary(nextAccount, stored.exists ? stored.library : null, selectedLibrary);
          }
          const nextPublic = publicDecksFromLibrary(selectedLibrary);
          const previousPublic = existingPublic
            .filter((deck) => deck.ownerId === nextAccount.uid)
            .map((deck) => ({ ...toCloudDeck(fromCloudDeck(deck)), id: deck.sourceDeckId }));
          await syncPublicLibrary({ ...nextAccount, displayName: profileUsername ?? nextAccount.displayName }, previousPublic, nextPublic);
          cloudBaselineRef.current = selectedLibrary;
          publicBaselineRef.current = nextPublic;
          localSnapshotRef.current = JSON.stringify(selectedLibrary);
          writeStoredLibrary(accountStoreKey, selectedLibrary, false);
          setCloudReady(true);
          setCloudStatus("synced");
          setAccountNotice(recoverLocalChanges
            ? "Le modifiche rimaste sul dispositivo sono state recuperate e salvate online."
            : stored.exists && !replaceLegacyDemo
              ? "Account collegato. I tuoi dati sono sincronizzati."
              : "Il tuo spazio personale è pronto con un set di esempio.");
          await refreshPublicDecks(nextAccount.uid);
        } catch (error) {
          if (!active) return;
          setUsernameChecked(true);
          setCloudStatus("error");
          setAccountNotice(friendlyCloudError(error));
        }
      })();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [hydrated, refreshPublicDecks, applyLibrary]);

  useEffect(() => {
    if (!hydrated) return;
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code) return;
    const timeout = window.setTimeout(() => setClassDialog({ mode: "join", code }), 0);
    return () => window.clearTimeout(timeout);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !account || !cloudReady) return;
    const timeout = window.setTimeout(() => {
      const snapshot = cloudLibrarySnapshot(folders, decks, studyDays, focusMinutes);
      const serialized = JSON.stringify(snapshot);
      syncChainRef.current = syncChainRef.current.then(async () => {
        setCloudStatus("syncing");
        const nextPublic = publicDecksFromLibrary(snapshot);
        await syncPrivateLibrary(account, cloudBaselineRef.current, snapshot);
        await syncPublicLibrary({ ...account, displayName: username ?? account.displayName }, publicBaselineRef.current, nextPublic);
        cloudBaselineRef.current = snapshot;
        publicBaselineRef.current = nextPublic;
        if (localSnapshotRef.current === serialized) writeStoredLibrary(libraryStoreKey(account.uid), snapshot, false);
        setCloudStatus("synced");
        await refreshPublicDecks(account.uid);
      }).catch((error) => {
        setCloudStatus("error");
        setAccountNotice(friendlyCloudError(error));
      });
    }, 850);
    return () => window.clearTimeout(timeout);
  }, [folders, decks, studyDays, focusMinutes, hydrated, account, username, cloudReady, refreshPublicDecks]);

  useEffect(() => {
    if (!focus && !breathing) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      setFocus((current) => {
        if (!current || current.pausedAt) return current;
        if (current.finishedAt) return current;
        return now - current.startedAt >= current.duration ? { ...current, finishedAt: now } : current;
      });
      setBreathing((current) => current && now - current.startedAt >= 80000 ? null : current);
    }, 120);
    return () => window.clearInterval(id);
  }, [focus, breathing]);

  useEffect(() => {
    if (!focus?.finishedAt) return;
    const timeout = window.setTimeout(() => {
      setFocus(null);
      setView({ name: "home" });
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [focus?.finishedAt]);

  const refreshClassList = useCallback(async () => {
    if (!account) {
      setClasses([]);
      return;
    }
    setClasses(await loadClasses(account.uid));
  }, [account]);

  const refreshNotificationList = useCallback(async () => {
    if (!account) {
      setNotifications([]);
      return;
    }
    setNotifications(await loadNotifications(account.uid));
  }, [account]);

  const refreshActiveClass = useCallback(async (classId: string) => {
    if (!account) return;
    setClassBusy(true);
    try {
      const workspace = await loadClassWorkspace(classId, account.uid);
      setClassWorkspace(workspace);
      setClasses((current) => current.map((item) => item.id === classId ? workspace.summary : item));
      setClassNotice("");
    } catch (error) {
      setClassNotice(friendlyCloudError(error));
    } finally {
      setClassBusy(false);
    }
  }, [account]);

  useEffect(() => {
    if (view.name !== "class" || !account) return;
    if (classWorkspace?.summary.id === view.id) return;
    const timeout = window.setTimeout(() => { void refreshActiveClass(view.id); }, 0);
    return () => window.clearTimeout(timeout);
  }, [view, account, classWorkspace?.summary.id, refreshActiveClass]);

  const folderById = useCallback((id: string | null) => folders.find((folder) => folder.id === id), [folders]);

  const folderAncestors = useCallback(
    (id: string | null) => {
      const result: Folder[] = [];
      let current = folderById(id);
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        result.unshift(current);
        visited.add(current.id);
        current = folderById(current.parentId);
      }
      return result;
    },
    [folderById],
  );

  const folderIsPublic = useCallback(
    (id: string | null) => folderAncestors(id).some((folder) => folder.visibility === "public"),
    [folderAncestors],
  );

  const deckIsPublic = useCallback(
    (deck: Deck) => deck.visibility === "public" || folderIsPublic(deck.folderId),
    [folderIsPublic],
  );

  const descendantFolderIds = useCallback(
    (rootId: string) => {
      const result = new Set<string>([rootId]);
      let changed = true;
      while (changed) {
        changed = false;
        folders.forEach((folder) => {
          if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
            result.add(folder.id);
            changed = true;
          }
        });
      }
      return result;
    },
    [folders],
  );

  const totalCards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const allAttempts = decks.flatMap((deck) => deck.cards).reduce((sum, card) => sum + card.known + card.missed, 0);
  const knownAttempts = decks.flatMap((deck) => deck.cards).reduce((sum, card) => sum + card.known, 0);
  const mastery = allAttempts ? Math.round((knownAttempts / allAttempts) * 100) : 0;
  const due = decks.flatMap((deck) => deck.cards).filter((card) => card.missed > card.known / 2).length;
  const studyDayStreak = consecutiveStudyDays(studyDays);
  const resumeDeck = [...decks].sort((a, b) => (b.lastStudied ?? 0) - (a.lastStudied ?? 0))[0] ?? decks[0];
  const randomCards = useMemo(
    () => decks.flatMap((deck) => deck.cards.map((card) => ({ deck, card }))),
    [decks],
  );
  const randomEntry = randomCards.length ? randomCards[Math.abs(randomKey) % randomCards.length] : null;
  const sharedDecks = useMemo(
    () => classWorkspace?.decks.map((deck) => fromClassDeck(deck, classWorkspace.summary.id, classWorkspace.annotations, account?.uid)) ?? [],
    [classWorkspace, account?.uid],
  );
  const studyLibrary = useMemo(() => [...decks, ...publicDecks, ...sharedDecks], [decks, publicDecks, sharedDecks]);
  const exploreDecks = cloudIsConfigured() ? publicDecks : decks.filter(deckIsPublic);

  const resolveStudyCard = useCallback(
    (state: StudyState | null) => {
      if (!state || state.complete) return null;
      const cardId = state.cardIds[state.index];
      for (const deckId of state.deckIds) {
        const deck = studyLibrary.find((item) => item.id === deckId);
        const card = deck?.cards.find((item) => item.id === cardId);
        if (deck && card) return { deck, card };
      }
      return null;
    },
    [studyLibrary],
  );

  const studyEntry = resolveStudyCard(study);

  const startStudy = useCallback(
    (deckIds: string[], startCardId?: string) => {
      const sourceDecks = deckIds.map((id) => studyLibrary.find((deck) => deck.id === id)).filter((deck): deck is Deck => Boolean(deck));
      if (!sourceDecks.length) return;
      const cards = sourceDecks.flatMap((deck) => deck.cards);
      if (!cards.length) return;
      const order = sourceDecks[0].order;
      let cardIds = cards.map((card) => card.id);
      if (order === "random") cardIds = [...cardIds].sort(() => Math.random() - 0.5);
      if (startCardId && cardIds.includes(startCardId)) {
        cardIds = [startCardId, ...cardIds.filter((id) => id !== startCardId)];
      }
      setStudy({
        deckIds,
        cardIds,
        initialCardIds: cardIds,
        index: 0,
        flipped: false,
        mode: null,
        known: 0,
        missed: [],
        learnedIds: [],
        attempts: 0,
        attemptsByCard: {},
        missesByCard: {},
        streak: 0,
        bestStreak: 0,
        complete: false,
        direction: sourceDecks[0].direction,
        order,
        font: "current",
        cardColor: sourceDecks[0].cardColorMode === "random"
          ? cardColors[Math.floor(Math.random() * cardColors.length)]
          : sourceDecks[0].cardColor ?? sourceDecks[0].color,
      });
      setStudyDays((current) => {
        const today = localDayKey();
        return current.includes(today) ? current : [...current, today];
      });
      setShowKeywords(false);
      setStudySettingsOpen(false);
    },
    [studyLibrary],
  );

  const chooseStudyMode = useCallback((mode: StudyMode) => {
    setStudy((current) => current ? {
      ...current,
      mode,
      cardIds: [...current.initialCardIds],
      index: 0,
      flipped: false,
      known: 0,
      missed: [],
      learnedIds: [],
      attempts: 0,
      attemptsByCard: {},
      missesByCard: {},
      streak: 0,
      bestStreak: 0,
      complete: false,
    } : current);
    setShowKeywords(false);
  }, []);

  const answerStudy = useCallback(
    (known: boolean) => {
      if (!studyEntry || !study?.mode) return;
      const updateDeck = (deck: Deck) => deck.id !== studyEntry.deck.id
        ? deck
        : {
            ...deck,
            lastStudied: Date.now(),
            cards: deck.cards.map((card) =>
              card.id !== studyEntry.card.id
                ? card
                : { ...card, known: card.known + (known ? 1 : 0), missed: card.missed + (known ? 0 : 1) },
            ),
          };
      if (studyEntry.deck.community) {
        setPublicDecks((current) => current.map(updateDeck));
        if (account && studyEntry.deck.publicId) {
          void savePublicStudyResult(account.uid, studyEntry.deck.publicId, studyEntry.card.id, known).catch((error) => {
            setAccountNotice(friendlyCloudError(error));
            setCloudStatus("error");
          });
        }
      } else if (!studyEntry.deck.shared) {
        setDecks((current) => current.map(updateDeck));
      }
      setStudy((current) => {
        if (!current?.mode) return current;
        const cardId = studyEntry.card.id;
        const nextCardIds = [...current.cardIds];
        if (!known && current.mode === "learn") {
          const revisitAt = Math.min(nextCardIds.length, current.index + LEARN_REVIEW_GAP + 1);
          nextCardIds.splice(revisitAt, 0, cardId);
        }
        const nextStreak = known ? current.streak + 1 : 0;
        const atEnd = current.index >= nextCardIds.length - 1;
        const learnedIds = known && !current.learnedIds.includes(cardId)
          ? [...current.learnedIds, cardId]
          : current.learnedIds;
        const missed = !known && !current.missed.includes(cardId)
          ? [...current.missed, cardId]
          : current.missed;
        return {
          ...current,
          cardIds: nextCardIds,
          index: atEnd ? current.index : current.index + 1,
          flipped: false,
          known: current.known + (known ? 1 : 0),
          missed,
          learnedIds,
          attempts: current.attempts + 1,
          attemptsByCard: {
            ...current.attemptsByCard,
            [cardId]: (current.attemptsByCard[cardId] ?? 0) + 1,
          },
          missesByCard: {
            ...current.missesByCard,
            [cardId]: (current.missesByCard[cardId] ?? 0) + (known ? 0 : 1),
          },
          streak: nextStreak,
          bestStreak: Math.max(current.bestStreak, nextStreak),
          complete: atEnd,
        };
      });
      setShowKeywords(false);
    },
    [study, studyEntry, account],
  );

  const moveStudy = useCallback((delta: -1 | 1) => {
    setStudy((current) => {
      if (!current || current.complete || current.mode) return current;
      const nextIndex = Math.min(current.cardIds.length - 1, Math.max(0, current.index + delta));
      if (nextIndex === current.index) return current;
      return { ...current, index: nextIndex, flipped: false };
    });
    setShowKeywords(false);
  }, []);

  const toggleStudyPin = useCallback(() => {
    if (!studyEntry) return;
    if (studyEntry.deck.shared && studyEntry.deck.classId && account && username) {
      const deckId = classSourceDeckId(studyEntry.deck.id);
      const existing = classWorkspace?.annotations.find((annotation) => annotation.authorId === account.uid && annotation.deckId === deckId && annotation.cardId === studyEntry.card.id);
      void saveClassAnnotation(studyEntry.deck.classId, account, username, {
        deckId,
        cardId: studyEntry.card.id,
        pinned: !existing?.pinned,
        note: existing?.note ?? "",
      }).then((annotation) => {
        setClassWorkspace((current) => {
          if (!current) return current;
          const id = `${account.uid}_${deckId}_${studyEntry.card.id}`;
          const annotations = current.annotations.filter((item) => item.id !== id);
          return { ...current, annotations: annotation ? [annotation, ...annotations] : annotations };
        });
      }).catch((error) => setClassNotice(friendlyCloudError(error)));
      return;
    }
    setDecks((current) => current.map((deck) => deck.id !== studyEntry.deck.id ? deck : {
      ...deck,
      cards: deck.cards.map((card) => card.id === studyEntry.card.id ? { ...card, pinned: !card.pinned } : card),
    }));
  }, [studyEntry, account, username, classWorkspace?.annotations]);

  const updateStudyPinComment = useCallback((pinComment: string) => {
    if (!studyEntry) return;
    if (studyEntry.deck.shared && studyEntry.deck.classId && account && username) {
      const deckId = classSourceDeckId(studyEntry.deck.id);
      void saveClassAnnotation(studyEntry.deck.classId, account, username, {
        deckId,
        cardId: studyEntry.card.id,
        pinned: true,
        note: pinComment,
      }).then((annotation) => {
        setClassWorkspace((current) => {
          if (!current) return current;
          const id = `${account.uid}_${deckId}_${studyEntry.card.id}`;
          const annotations = current.annotations.filter((item) => item.id !== id);
          return { ...current, annotations: annotation ? [annotation, ...annotations] : annotations };
        });
      }).catch((error) => setClassNotice(friendlyCloudError(error)));
      return;
    }
    setDecks((current) => current.map((deck) => deck.id !== studyEntry.deck.id ? deck : {
      ...deck,
      cards: deck.cards.map((card) => card.id === studyEntry.card.id ? { ...card, pinned: true, pinComment } : card),
    }));
  }, [studyEntry, account, username]);

  const updateStudySettings = useCallback((changes: Partial<Pick<StudyState, "font" | "order" | "direction">>) => {
    setStudy((current) => {
      if (!current) return current;
      const nextOrder = changes.order ?? current.order;
      let nextIds = current.cardIds;
      let nextIndex = current.index;
      if (nextOrder !== current.order) {
        const currentId = current.cardIds[current.index];
        nextIds = current.deckIds.flatMap((deckId) => studyLibrary.find((deck) => deck.id === deckId)?.cards.map((card) => card.id) ?? []);
        if (nextOrder === "random") nextIds = [...nextIds].sort(() => Math.random() - 0.5);
        if (currentId && nextIds.includes(currentId)) nextIds = [currentId, ...nextIds.filter((id) => id !== currentId)];
        nextIndex = 0;
      }
      return {
        ...current,
        ...changes,
        order: nextOrder,
        cardIds: nextIds,
        initialCardIds: current.mode ? current.initialCardIds : nextIds,
        index: nextIndex,
        flipped: changes.direction && changes.direction !== current.direction ? false : current.flipped,
      };
    });
    setShowKeywords(false);
  }, [studyLibrary]);

  useEffect(() => {
    if (!study) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (studySettingsOpen) {
        if (event.key === "Escape") setStudySettingsOpen(false);
        return;
      }
      if (!study.mode) {
        if (event.key === "Escape") setStudy(null);
        return;
      }
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (event.repeat || spaceHoldTimer.current !== null) return;
        spaceLongPress.current = false;
        if (studyEntry && extractKeywords(studyEntry.card.back).length > 0) {
          spaceHoldTimer.current = window.setTimeout(() => {
            spaceLongPress.current = true;
            setShowKeywords(true);
          }, 420);
        }
        return;
      }
      if (event.repeat) return;
      if (event.key === "1") { event.preventDefault(); answerStudy(true); }
      if (event.key === "2") { event.preventDefault(); answerStudy(false); }
      if (event.key === "3") { event.preventDefault(); toggleStudyPin(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); moveStudy(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); moveStudy(1); }
      if (event.key === "Escape") setStudy(null);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (!study.mode) return;
      event.preventDefault();
      if (spaceHoldTimer.current !== null) {
        window.clearTimeout(spaceHoldTimer.current);
        spaceHoldTimer.current = null;
      }
      if (spaceLongPress.current) {
        setShowKeywords(false);
      } else {
        setStudy((current) => current ? { ...current, flipped: !current.flipped } : current);
      }
      spaceLongPress.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      if (spaceHoldTimer.current !== null) {
        window.clearTimeout(spaceHoldTimer.current);
        spaceHoldTimer.current = null;
      }
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [study, studyEntry, studySettingsOpen, answerStudy, moveStudy, toggleStudyPin]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (focus) setFocus(null);
        if (breathing) setBreathing(null);
      }
      if (event.code === "Space" && focus) {
        event.preventDefault();
        setTimerVisible((visible) => !visible);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focus, breathing]);

  const saveFolder = (data: Omit<Folder, "id" | "createdAt">, editId?: string) => {
    if (editId) {
      setFolders((current) => current.map((folder) => (folder.id === editId ? { ...folder, ...data } : folder)));
    } else {
      setFolders((current) => [...current, { ...data, id: makeId("folder"), createdAt: Date.now() }]);
    }
    setFolderCreator(null);
  };

  const saveDeck = (data: Omit<Deck, "id" | "createdAt">, editId?: string) => {
    if (editId) {
      setDecks((current) => current.map((deck) => (deck.id === editId ? { ...deck, ...data } : deck)));
    } else {
      setDecks((current) => [...current, { ...data, id: makeId("deck"), createdAt: Date.now() }]);
    }
    setDeckCreator(null);
  };

  const completeDeckTransfer = (copy: boolean) => {
    if (!deckTransfer) return;
    const source = decks.find((deck) => deck.id === deckTransfer.deckId);
    const target = folders.find((folder) => folder.id === deckTransfer.targetFolderId);
    if (!source || !target) {
      setDeckTransfer(null);
      return;
    }
    if (copy) {
      setDecks((current) => [...current, {
        ...source,
        id: makeId("deck"),
        title: `${source.title} — copia`,
        folderId: target.id,
        color: target.color,
        createdAt: Date.now(),
        lastStudied: undefined,
        cards: source.cards.map((card) => ({ ...card, id: makeId("card"), known: 0, missed: 0 })),
      }]);
    } else {
      setDecks((current) => current.map((deck) => deck.id === source.id ? { ...deck, folderId: target.id, color: target.color } : deck));
    }
    setDeckTransfer(null);
  };

  const requestDeleteDecks = (deckIds: string[]) => {
    if (!deckIds.length) return;
    setDeleteRequest({ kind: "decks", title: deckIds.length === 1 ? "Eliminare questo set?" : `Eliminare ${deckIds.length} set?`, folderIds: [], deckIds, subfolderCount: 0, deckCount: deckIds.length });
  };

  const requestDeleteFolder = (folderId: string) => {
    const ids = descendantFolderIds(folderId);
    const nestedDeckIds = decks.filter((deck) => deck.folderId && ids.has(deck.folderId)).map((deck) => deck.id);
    const parentId = folders.find((folder) => folder.id === folderId)?.parentId ?? null;
    setDeleteRequest({ kind: "folder", title: parentId ? "Eliminare questa sottocartella?" : "Eliminare questa cartella?", folderIds: Array.from(ids), deckIds: nestedDeckIds, subfolderCount: ids.size - 1, deckCount: nestedDeckIds.length, returnFolderId: parentId });
  };

  const confirmDelete = () => {
    if (!deleteRequest) return;
    setDecks((current) => current.filter((deck) => !deleteRequest.deckIds.includes(deck.id)));
    if (deleteRequest.folderIds.length) setFolders((current) => current.filter((folder) => !deleteRequest.folderIds.includes(folder.id)));
    if (deleteRequest.kind === "folder") setView(deleteRequest.returnFolderId ? { name: "folder", id: deleteRequest.returnFolderId } : { name: "home" });
    if (deleteRequest.kind === "decks" && view.name === "deck" && deleteRequest.deckIds.includes(view.id)) setView({ name: "home" });
    setDeleteRequest(null);
  };

  const moveDecks = (deckIds: string[], folderId: string | null) => {
    const target = folders.find((folder) => folder.id === folderId);
    setDecks((current) => current.map((deck) => deckIds.includes(deck.id) ? { ...deck, folderId, color: target?.color ?? deck.color } : deck));
    setBatchMove(null);
  };

  const moveFolder = (folderId: string, targetFolderId: string | null) => {
    if (folderId === targetFolderId) return;
    const blocked = descendantFolderIds(folderId);
    if (targetFolderId && blocked.has(targetFolderId)) return;
    setFolders((current) => current.map((folder) => folder.id === folderId ? { ...folder, parentId: targetFolderId } : folder));
    if (targetFolderId) setExpanded((current) => new Set(current).add(targetFolderId));
  };

  const runAccountAction = async (action: () => Promise<unknown>, successMessage?: string) => {
    setAccountBusy(true);
    setAccountNotice("");
    try {
      await action();
      if (successMessage) setAccountNotice(successMessage);
    } catch (error) {
      setAccountNotice(friendlyCloudError(error));
    } finally {
      setAccountBusy(false);
    }
  };

  const voteDeck = async (deckId: string, vote: -1 | 1 | 2) => {
    const target = studyLibrary.find((deck) => deck.id === deckId);
    if (!target) return;
    if (!account) {
      setAccountNotice("Accedi per votare e ritrovare la tua valutazione su ogni dispositivo.");
      setPreferencesOpen(true);
      return;
    }
    const previous = target.userVote ?? 0;
    const next: PublicVote = previous === vote ? 0 : vote;
    const setId = target.publicId ?? `${account.uid}_${target.id}`;
    const updateVote = (deck: Deck) => deck.id === deckId
      ? { ...deck, votes: (deck.votes ?? 0) - previous + next, userVote: next }
      : deck;
    setDecks((current) => current.map(updateVote));
    setPublicDecks((current) => current.map(updateVote));
    setVoteBusy(true);
    try {
      await setPublicVote(setId, account.uid, next);
      if (target.ownerId && next !== 0) {
        await notifyPublicRating(target.ownerId, account.uid, username ?? account.displayName ?? account.email.split("@")[0], setId, target.title, next);
      }
      await refreshPublicDecks(account.uid);
    } catch (error) {
      setAccountNotice(friendlyCloudError(error));
      setPreferencesOpen(true);
      setDecks((current) => current.map((deck) => deck.id === deckId ? { ...deck, votes: target.votes, userVote: previous } : deck));
      setPublicDecks((current) => current.map((deck) => deck.id === deckId ? { ...deck, votes: target.votes, userVote: previous } : deck));
    } finally {
      setVoteBusy(false);
    }
  };

  const openClass = (classId: string, folderId: string | null = null) => {
    if (classWorkspace?.summary.id !== classId) setClassWorkspace(null);
    setView({ name: "class", id: classId, folderId });
  };

  const handleClassDialog = async (mode: "create" | "join", value: string) => {
    if (!account || !username) {
      setPreferencesOpen(true);
      return;
    }
    setClassBusy(true);
    setClassNotice("");
    try {
      const result = mode === "create"
        ? await createClass(account, username, value)
        : await joinClass(account, username, value);
      setClassDialog(null);
      await refreshClassList();
      openClass(result.id);
      await refreshActiveClass(result.id);
      if (typeof window !== "undefined" && mode === "join") {
        const url = new URL(window.location.href);
        url.searchParams.delete("join");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch (error) {
      setClassNotice(friendlyCloudError(error));
    } finally {
      setClassBusy(false);
    }
  };

  const handleSaveClassFolder = async (data: Omit<Folder, "id" | "createdAt">, editId?: string) => {
    if (!account || !username || !classWorkspace) return;
    const existing = editId ? classWorkspace.folders.find((folder) => folder.id === editId) : undefined;
    const folder: ClassFolder = {
      ...data,
      id: editId ?? makeId("class-folder"),
      createdAt: existing?.createdAt ?? Date.now(),
      ownerId: existing?.ownerId ?? account.uid,
      ownerName: existing?.ownerName ?? username,
    };
    setClassBusy(true);
    try {
      await saveClassFolder(classWorkspace.summary.id, account, username, folder);
      if (!existing) await notifyClassContent(classWorkspace.summary.id, account, username, classWorkspace.members, { kind: "folder", id: folder.id, title: folder.title });
      setClassFolderCreator(null);
      await refreshActiveClass(classWorkspace.summary.id);
      await refreshNotificationList();
    } catch (error) {
      setClassNotice(friendlyCloudError(error));
    } finally {
      setClassBusy(false);
    }
  };

  const handleSaveClassDeck = async (data: Omit<Deck, "id" | "createdAt">, editId?: string) => {
    if (!account || !username || !classWorkspace) return;
    const existing = editId ? classWorkspace.decks.find((deck) => deck.id === editId) : undefined;
    const deck: ClassDeck = {
      ...toCloudDeck({ ...data, id: editId ?? makeId("class-deck"), createdAt: existing?.createdAt ?? Date.now() }),
      ownerId: existing?.ownerId ?? account.uid,
      ownerName: existing?.ownerName ?? username,
    };
    setClassBusy(true);
    try {
      await saveClassDeck(classWorkspace.summary.id, account, username, deck);
      if (!existing) await notifyClassContent(classWorkspace.summary.id, account, username, classWorkspace.members, { kind: "deck", id: deck.id, title: deck.title });
      setClassDeckCreator(null);
      await refreshActiveClass(classWorkspace.summary.id);
      await refreshNotificationList();
    } catch (error) {
      setClassNotice(friendlyCloudError(error));
    } finally {
      setClassBusy(false);
    }
  };

  const importPersonalIntoClass = async (kind: ClassItemKind, id: string) => {
    if (!account || !username || !classWorkspace || view.name !== "class") return;
    const classId = classWorkspace.summary.id;
    const destinationId = view.folderId ?? null;
    const nextFolders: ClassFolder[] = [];
    const nextDecks: ClassDeck[] = [];
    let rootTitle = "Materiale";
    let rootId = "";
    if (kind === "deck") {
      const source = decks.find((deck) => deck.id === id);
      if (!source) return;
      rootId = makeId("class-deck");
      rootTitle = source.title;
      nextDecks.push({ ...toCloudDeck({ ...source, id: rootId, folderId: destinationId, createdAt: Date.now(), cards: source.cards.map((card) => ({ ...card, id: makeId("card") })) }), ownerId: account.uid, ownerName: username });
    } else {
      const source = folders.find((folder) => folder.id === id);
      if (!source) return;
      rootTitle = source.title;
      const sourceIds = descendantFolderIds(source.id);
      const idMap = new Map(Array.from(sourceIds).map((folderId) => [folderId, makeId("class-folder")]));
      rootId = idMap.get(source.id) as string;
      folders.filter((folder) => sourceIds.has(folder.id)).forEach((folder) => nextFolders.push({ ...folder, id: idMap.get(folder.id) as string, parentId: folder.id === source.id ? destinationId : folder.parentId ? idMap.get(folder.parentId) ?? destinationId : destinationId, createdAt: Date.now(), ownerId: account.uid, ownerName: username }));
      decks.filter((deck) => deck.folderId && sourceIds.has(deck.folderId)).forEach((deck) => nextDecks.push({ ...toCloudDeck({ ...deck, id: makeId("class-deck"), folderId: idMap.get(deck.folderId as string) ?? rootId, createdAt: Date.now(), cards: deck.cards.map((card) => ({ ...card, id: makeId("card") })) }), ownerId: account.uid, ownerName: username }));
    }
    setClassBusy(true);
    try {
      await saveClassBundle(classId, nextFolders, nextDecks);
      await notifyClassContent(classId, account, username, classWorkspace.members, { kind, id: rootId, title: rootTitle });
      setClassImportOpen(false);
      await refreshActiveClass(classId);
    } catch (error) {
      setClassNotice(friendlyCloudError(error));
    } finally {
      setClassBusy(false);
    }
  };

  const copyClassItemToPersonal = async (workspace: ClassWorkspace, kind: ClassItemKind, id: string) => {
    if (kind === "deck") {
      const source = workspace.decks.find((deck) => deck.id === id);
      if (!source) return;
      const local = fromCloudDeck(source);
      setDecks((current) => [...current, { ...local, id: makeId("deck"), folderId: null, title: `${local.title} — copia`, visibility: "private", createdAt: Date.now(), lastStudied: undefined, cards: local.cards.map((card) => ({ ...card, id: makeId("card"), known: 0, missed: 0 })) }]);
      return;
    }
    const source = workspace.folders.find((folder) => folder.id === id);
    if (!source) return;
    const sourceIds = new Set<string>([source.id]);
    let changed = true;
    while (changed) {
      changed = false;
      workspace.folders.forEach((folder) => {
        if (folder.parentId && sourceIds.has(folder.parentId) && !sourceIds.has(folder.id)) { sourceIds.add(folder.id); changed = true; }
      });
    }
    const idMap = new Map(Array.from(sourceIds).map((folderId) => [folderId, makeId("folder")]));
    setFolders((current) => [...current, ...workspace.folders.filter((folder) => sourceIds.has(folder.id)).map((folder) => ({ id: idMap.get(folder.id) as string, parentId: folder.id === source.id ? null : folder.parentId ? idMap.get(folder.parentId) ?? null : null, title: folder.id === source.id ? `${folder.title} — copia` : folder.title, color: folder.color, visibility: "private" as Visibility, createdAt: Date.now() }))]);
    setDecks((current) => [...current, ...workspace.decks.filter((deck) => deck.folderId && sourceIds.has(deck.folderId)).map((deck) => { const local = fromCloudDeck(deck); return { ...local, id: makeId("deck"), folderId: idMap.get(deck.folderId as string) ?? null, visibility: "private" as Visibility, createdAt: Date.now(), lastStudied: undefined, cards: local.cards.map((card) => ({ ...card, id: makeId("card"), known: 0, missed: 0 })) }; })]);
  };

  const handleNotificationAction = async (notification: LumeNotification, action: "read" | "approve" | "reject" | "copy") => {
    if (!account || !username) return;
    try {
      if (action === "approve" || action === "reject") {
        if (!notification.requestId) return;
        await respondToCopyRequest(account, username, notification.requestId, action === "approve");
      } else if (action === "copy") {
        if (!notification.requestId) return;
        const request = await loadCopyRequest(notification.requestId);
        if (!request || request.requesterId !== account.uid || request.status !== "approved") return;
        const workspace = await loadClassWorkspace(request.classId, account.uid);
        await copyClassItemToPersonal(workspace, request.itemKind, request.itemId);
        await markCopyRequestCopied(request.id);
      }
      await markNotificationRead(account.uid, notification.id);
      await refreshNotificationList();
      setClassNotice(action === "copy" ? "La copia è ora nel tuo spazio personale." : "Notifica aggiornata.");
    } catch (error) {
      setClassNotice(friendlyCloudError(error));
    }
  };

  const currentFolder = view.name === "folder" ? folderById(view.id) : null;
  const selectedDeck = view.name === "deck" ? studyLibrary.find((deck) => deck.id === view.id) : null;
  const studyActive = Boolean(study);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [view, studyActive]);

  if (focus) {
    const elapsed = Math.max(0, (focus.pausedAt ?? clock) - focus.startedAt);
    const remaining = Math.max(0, focus.duration - elapsed);
    return (
      <FocusScreen
        remaining={remaining}
        duration={focus.duration}
        visible={timerVisible}
        paused={Boolean(focus.pausedAt)}
        finished={Boolean(focus.finishedAt)}
        onPause={() =>
          setFocus((current) => {
            if (!current || current.finishedAt) return current;
            if (current.pausedAt) {
              const pausedFor = Date.now() - current.pausedAt;
              return { ...current, startedAt: current.startedAt + pausedFor, pausedAt: undefined };
            }
            return { ...current, pausedAt: Date.now() };
          })
        }
        onExit={() => setFocus(null)}
      />
    );
  }

  if (breathing) {
    const elapsed = clock - breathing.startedAt;
    return <BreathingScreen elapsed={elapsed} onExit={() => setBreathing(null)} />;
  }

  if (study) {
    return (
      <StudyScreen
        theme={theme}
        state={study}
        entry={studyEntry}
        library={studyLibrary}
        showKeywords={showKeywords}
        settingsOpen={studySettingsOpen}
        onChooseMode={chooseStudyMode}
        onFlip={() => setStudy((current) => (current ? { ...current, flipped: !current.flipped } : current))}
        onKnow={() => answerStudy(true)}
        onMiss={() => answerStudy(false)}
        onPin={toggleStudyPin}
        onPinComment={updateStudyPinComment}
        onOpenSettings={() => setStudySettingsOpen(true)}
        onCloseSettings={() => setStudySettingsOpen(false)}
        onSettingsChange={updateStudySettings}
        onKeywords={() => {
          setShowKeywords(true);
          window.setTimeout(() => setShowKeywords(false), 3000);
        }}
        onRestartMissed={() => {
          const difficultIds = difficultStudyCardIds(study);
          if (!difficultIds.length) return;
          setStudy({ ...study, mode: "learn", initialCardIds: difficultIds, cardIds: difficultIds, index: 0, flipped: false, known: 0, missed: [], learnedIds: [], attempts: 0, attemptsByCard: {}, missesByCard: {}, streak: 0, bestStreak: 0, complete: false });
        }}
        onRestartAll={() => {
          setStudy({ ...study, cardIds: [...study.initialCardIds], index: 0, flipped: false, known: 0, missed: [], learnedIds: [], attempts: 0, attemptsByCard: {}, missesByCard: {}, streak: 0, bestStreak: 0, complete: false });
        }}
        onExit={() => {
          setStudySettingsOpen(false);
          setStudy(null);
        }}
      />
    );
  }

  return (
    <div className="lume-app" style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      <Sidebar
        theme={theme}
        view={view}
        classes={classes}
        folders={folders}
        decks={decks}
        expanded={expanded}
        onToggle={(id) =>
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onNavigate={setView}
        onOpenClass={(id) => openClass(id)}
        onCreate={() => setCreateMenu((open) => !open)}
        onTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        onPreferences={() => setPreferencesOpen(true)}
        onMoveDeck={(deckId, folderId) => moveDecks([deckId], folderId)}
        onMoveDecks={moveDecks}
        onMoveFolder={moveFolder}
        onResize={setSidebarWidth}
      />

      <div className="app-main">
        <Topbar
          onHome={() => setView({ name: "home" })}
          onFocus={() => setFocusSetup(true)}
          onBreathe={() => setBreathing({ startedAt: Date.now() })}
          notificationCount={notifications.filter((notification) => !notification.read).length}
          onNotifications={() => setNotificationsOpen((open) => !open)}
          onPreferences={() => setPreferencesOpen(true)}
        />

        <main className="app-content">
          {view.name === "home" && (
            <Home
              folders={folders}
              decks={decks}
              resumeDeck={resumeDeck}
              randomEntry={randomEntry}
              randomFlipped={randomFlipped}
              mastery={mastery}
              due={due}
              totalCards={totalCards}
              studyDayStreak={studyDayStreak}
              focusMinutes={focusMinutes}
              onOpenFolder={(id) => setView({ name: "folder", id })}
              onOpenDeck={(id) => setView({ name: "deck", id })}
              onRandom={() => {
                setRandomKey((key) => key + 1);
                setRandomFlipped(false);
              }}
              onFlipRandom={() => setRandomFlipped((flipped) => !flipped)}
              onStudyRandom={() => randomEntry && startStudy([randomEntry.deck.id], randomEntry.card.id)}
              onResume={() => resumeDeck && startStudy([resumeDeck.id])}
              onFocus={() => {
                setFocus({ startedAt: Date.now(), duration: focusMinutes * 60000 });
                setTimerVisible(true);
              }}
              onReview={() => {
                const reviewDecks = decks.filter((deck) => deck.cards.some((card) => card.missed > card.known / 2));
                if (reviewDecks.length) startStudy(reviewDecks.map((deck) => deck.id));
              }}
              onCreateFolder={() => setFolderCreator({ parentId: null })}
            />
          )}

          {view.name === "folders" && (
            <FolderLibrary
              folders={folders}
              decks={decks}
              onOpen={(id) => setView({ name: "folder", id })}
              onCreate={() => setFolderCreator({ parentId: null })}
            />
          )}

          {view.name === "explore" && (
            <Explore
              search={search}
              onSearch={setSearch}
              decks={exploreDecks}
              cloudStatus={cloudStatus}
              onOpen={(id) => setView({ name: "deck", id })}
            />
          )}

          {view.name === "classes" && (
            <ClassesPage
              account={account}
              username={username}
              classes={classes}
              notice={classNotice}
              busy={classBusy}
              onLogin={() => setPreferencesOpen(true)}
              onCreate={() => setClassDialog({ mode: "create" })}
              onJoin={() => setClassDialog({ mode: "join" })}
              onOpen={(id) => openClass(id)}
            />
          )}

          {view.name === "class" && (
            <ClassView
              account={account}
              username={username}
              workspace={classWorkspace?.summary.id === view.id ? classWorkspace : null}
              folderId={view.folderId ?? null}
              busy={classBusy}
              notice={classNotice}
              annotationFilter={annotationFilter}
              onAnnotationFilter={setAnnotationFilter}
              onBack={() => setView({ name: "classes" })}
              onOpenFolder={(folderId) => openClass(view.id, folderId)}
              onCreate={() => setClassCreateMenu(true)}
              onImport={() => setClassImportOpen(true)}
              onEdit={(kind, id) => {
                if (kind === "folder") setClassFolderCreator({ classId: view.id, parentId: classWorkspace?.folders.find((folder) => folder.id === id)?.parentId ?? null, editId: id });
                else setClassDeckCreator({ classId: view.id, folderId: classWorkspace?.decks.find((deck) => deck.id === id)?.folderId ?? null, editId: id });
              }}
              onStudy={(ids) => startStudy(ids.map((id) => `class:${view.id}:${id}`))}
              onFavorite={async (kind, id, active) => {
                if (!account || !classWorkspace) return;
                const item = kind === "folder" ? classWorkspace.folders.find((folder) => folder.id === id) : classWorkspace.decks.find((deck) => deck.id === id);
                if (!item) return;
                const favorite: ClassFavorite = { id: `${view.id}_${kind}_${id}`, classId: view.id, classTitle: classWorkspace.summary.title, itemKind: kind, itemId: id, itemTitle: item.title, color: item.color, createdAt: Date.now() };
                await toggleClassFavorite(account.uid, favorite, active);
                await refreshActiveClass(view.id);
              }}
              onCopy={async (kind, id) => {
                if (!account || !username || !classWorkspace) return;
                const item = kind === "folder" ? classWorkspace.folders.find((folder) => folder.id === id) : classWorkspace.decks.find((deck) => deck.id === id);
                if (!item) return;
                if (item.ownerId === account.uid) {
                  await copyClassItemToPersonal(classWorkspace, kind, id);
                  setClassNotice("La copia è ora nel tuo spazio personale.");
                } else {
                  await requestClassCopy(classWorkspace.summary, account, username, { kind, id, title: item.title, ownerId: item.ownerId, ownerName: item.ownerName });
                  setClassNotice(`Richiesta inviata a ${item.ownerName}.`);
                }
              }}
              onComment={async (kind, id, text) => {
                if (!account || !username || !classWorkspace) return;
                const item = kind === "folder" ? classWorkspace.folders.find((folder) => folder.id === id) : classWorkspace.decks.find((deck) => deck.id === id);
                if (!item || !text.trim()) return;
                await addClassComment(view.id, account, username, { kind, id, title: item.title, ownerId: item.ownerId }, text);
                await refreshActiveClass(view.id);
                await refreshNotificationList();
              }}
              onAnnotation={async (deckId, note, pinned) => {
                if (!account || !username) return;
                await saveClassAnnotation(view.id, account, username, { deckId, cardId: null, note, pinned });
                await refreshActiveClass(view.id);
              }}
            />
          )}

          {currentFolder && (
            <FolderView
              folder={currentFolder}
              ancestors={folderAncestors(currentFolder.id)}
              childFolders={folders.filter((folder) => folder.parentId === currentFolder.id)}
              decks={decks.filter((deck) => deck.folderId === currentFolder.id)}
              allDecks={decks}
              descendantIds={descendantFolderIds(currentFolder.id)}
              onHome={() => setView({ name: "home" })}
              onOpenFolder={(id) => setView({ name: "folder", id })}
              onOpenDeck={(id) => setView({ name: "deck", id })}
              onCreateFolder={() => setFolderCreator({ parentId: currentFolder.id })}
              onCreateDeck={() => setDeckCreator({ folderId: currentFolder.id })}
              onEdit={() => setFolderCreator({ parentId: currentFolder.parentId, editId: currentFolder.id })}
              onDeleteFolder={() => requestDeleteFolder(currentFolder.id)}
              onDeleteDecks={requestDeleteDecks}
              onMoveDecks={(ids) => setBatchMove(ids)}
              onRequestTransfer={(deckId, targetFolderId) => setDeckTransfer({ deckId, targetFolderId })}
              onStudy={() => {
                const ids = descendantFolderIds(currentFolder.id);
                startStudy(decks.filter((deck) => deck.folderId && ids.has(deck.folderId)).map((deck) => deck.id));
              }}
            />
          )}

          {selectedDeck && (
            <DeckView
              deck={selectedDeck}
              folder={selectedDeck.community ? undefined : folderById(selectedDeck.folderId)}
              publicEffective={selectedDeck.community || deckIsPublic(selectedDeck)}
              readOnly={Boolean(selectedDeck.community)}
              voteBusy={voteBusy}
              onBack={() => selectedDeck.community ? setView({ name: "explore" }) : selectedDeck.folderId ? setView({ name: "folder", id: selectedDeck.folderId }) : setView({ name: "home" })}
              onStudy={() => startStudy([selectedDeck.id])}
              onEdit={() => setDeckCreator({ folderId: selectedDeck.folderId, editId: selectedDeck.id })}
              onDelete={() => requestDeleteDecks([selectedDeck.id])}
              onVote={(vote) => { void voteDeck(selectedDeck.id, vote); }}
            />
          )}
        </main>

        <MobileNav
          view={view}
          onHome={() => setView({ name: "home" })}
          onFolders={() => setView({ name: "folders" })}
          onExplore={() => setView({ name: "explore" })}
          onClasses={() => setView({ name: "classes" })}
          onCreate={() => setCreateMenu((open) => !open)}
        />
      </div>

      {createMenu && (
        <CreateMenu
          onClose={() => setCreateMenu(false)}
          onFolder={() => {
            setFolderCreator({ parentId: view.name === "folder" ? view.id : null });
            setCreateMenu(false);
          }}
          onDeck={() => {
            setDeckCreator({ folderId: view.name === "folder" ? view.id : null });
            setCreateMenu(false);
          }}
        />
      )}

      {classCreateMenu && view.name === "class" && (
        <CreateMenu
          onClose={() => setClassCreateMenu(false)}
          onFolder={() => { setClassFolderCreator({ classId: view.id, parentId: view.folderId ?? null }); setClassCreateMenu(false); }}
          onDeck={() => { setClassDeckCreator({ classId: view.id, folderId: view.folderId ?? null }); setClassCreateMenu(false); }}
        />
      )}

      {classImportOpen && view.name === "class" && <ClassImportModal folders={folders} decks={decks} onImport={(kind, id) => { void importPersonalIntoClass(kind, id); }} onClose={() => setClassImportOpen(false)} />}

      {classFolderCreator && classWorkspace && (
        <FolderCreator
          folder={classFolderCreator.editId ? classWorkspace.folders.find((folder) => folder.id === classFolderCreator.editId) : undefined}
          folders={classWorkspace.folders}
          defaultParentId={classFolderCreator.parentId}
          parentPublic={() => false}
          onSave={(data, editId) => { void handleSaveClassFolder(data, editId); }}
          onClose={() => setClassFolderCreator(null)}
        />
      )}

      {classDeckCreator && classWorkspace && (
        <DeckCreator
          deck={classDeckCreator.editId ? fromClassDeck(classWorkspace.decks.find((deck) => deck.id === classDeckCreator.editId) as ClassDeck, classWorkspace.summary.id, classWorkspace.annotations, account?.uid) : undefined}
          folders={classWorkspace.folders}
          defaultFolderId={classDeckCreator.folderId}
          folderPublic={() => false}
          theme={theme}
          onSave={(data, editId) => { void handleSaveClassDeck(data, editId ? classSourceDeckId(editId) : undefined); }}
          onClose={() => setClassDeckCreator(null)}
        />
      )}

      {classDialog && <ClassDialog mode={classDialog.mode} initialCode={classDialog.code} busy={classBusy} notice={classNotice} onSubmit={(value) => { void handleClassDialog(classDialog.mode, value); }} onClose={() => setClassDialog(null)} />}

      {notificationsOpen && <NotificationCenter notifications={notifications} onAction={(notification, action) => { void handleNotificationAction(notification, action); }} onClose={() => setNotificationsOpen(false)} />}

      {folderCreator && (
        <FolderCreator
          folder={folderCreator.editId ? folders.find((folder) => folder.id === folderCreator.editId) : undefined}
          folders={folders}
          defaultParentId={folderCreator.parentId}
          parentPublic={folderIsPublic}
          onSave={saveFolder}
          onClose={() => setFolderCreator(null)}
        />
      )}

      {deckCreator && (
        <DeckCreator
          deck={deckCreator.editId ? decks.find((deck) => deck.id === deckCreator.editId) : undefined}
          folders={folders}
          defaultFolderId={deckCreator.folderId}
          folderPublic={folderIsPublic}
          theme={theme}
          onSave={saveDeck}
          onClose={() => setDeckCreator(null)}
        />
      )}

      {preferencesOpen && (
        <Preferences
          theme={theme}
          account={account}
          cloudStatus={cloudStatus}
          busy={accountBusy}
          notice={accountNotice}
          onTheme={setTheme}
          onGoogle={() => runAccountAction(async () => setAccount(await loginWithGoogle()))}
          onEmailLogin={(email, password) => runAccountAction(async () => setAccount(await loginWithEmail(email, password)))}
          onEmailRegister={(name, email, password) => runAccountAction(async () => {
            const created = await registerWithEmail(name, email, password);
            const claimed = await claimUsername(created, name);
            setUsername(claimed);
            setUsernameChecked(true);
            setAccount({ ...created, displayName: claimed });
          })}
          onPasswordReset={(email) => runAccountAction(() => resetAccountPassword(email), "Ti abbiamo inviato l’email per scegliere una nuova password.")}
          onLogout={() => runAccountAction(() => logoutAccount(), "Sei uscita dall’account. I dati online restano al sicuro.")}
          onClose={() => setPreferencesOpen(false)}
        />
      )}

      {focusSetup && (
        <FocusSetup
          minutes={focusMinutes}
          onMinutes={setFocusMinutes}
          onClose={() => setFocusSetup(false)}
          onStart={() => {
            setFocus({ startedAt: Date.now(), duration: focusMinutes * 60000 });
            setTimerVisible(true);
            setFocusSetup(false);
          }}
        />
      )}

      {deckTransfer && (
        <DeckTransferModal
          deck={decks.find((deck) => deck.id === deckTransfer.deckId)}
          folder={folders.find((folder) => folder.id === deckTransfer.targetFolderId)}
          onMove={() => completeDeckTransfer(false)}
          onCopy={() => completeDeckTransfer(true)}
          onClose={() => setDeckTransfer(null)}
        />
      )}
      {batchMove && <FolderPickerModal folders={folders} onSelect={(folderId) => moveDecks(batchMove, folderId)} onClose={() => setBatchMove(null)} />}
      {deleteRequest && <DeleteConfirmModal request={deleteRequest} onConfirm={confirmDelete} onClose={() => setDeleteRequest(null)} />}
      {account && usernameChecked && !username && <UsernameGate account={account} busy={accountBusy} notice={accountNotice} onSave={(value) => runAccountAction(async () => { const claimed = await claimUsername(account, value); setUsername(claimed); setAccount((current) => current ? { ...current, displayName: claimed } : current); })} />}
    </div>
  );
}

function Sidebar({
  theme,
  view,
  classes,
  folders,
  decks,
  expanded,
  onToggle,
  onNavigate,
  onOpenClass,
  onCreate,
  onTheme,
  onPreferences,
  onMoveDeck,
  onMoveDecks,
  onMoveFolder,
  onResize,
}: {
  theme: "light" | "dark";
  view: View;
  classes: LumeClass[];
  folders: Folder[];
  decks: Deck[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (view: View) => void;
  onOpenClass: (id: string) => void;
  onCreate: () => void;
  onTheme: () => void;
  onPreferences: () => void;
  onMoveDeck: (deckId: string, folderId: string | null) => void;
  onMoveDecks: (deckIds: string[], folderId: string | null) => void;
  onMoveFolder: (folderId: string, targetFolderId: string | null) => void;
  onResize: (width: number) => void;
}) {
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => onResize(Math.min(window.innerWidth / 3, Math.max(210, event.clientX)));
    const stop = () => setResizing(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [resizing, onResize]);
  const dropInto = (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault();
    const groupedDecks = event.dataTransfer.getData("application/x-lume-decks");
    const deckId = event.dataTransfer.getData("application/x-lume-deck");
    const draggedFolderId = event.dataTransfer.getData("application/x-lume-folder");
    if (groupedDecks) {
      try { onMoveDecks(JSON.parse(groupedDecks) as string[], folderId); } catch { /* Ignore invalid drag data. */ }
    } else if (deckId) onMoveDeck(deckId, folderId);
    if (draggedFolderId) onMoveFolder(draggedFolderId, folderId);
    setDropTarget(undefined);
  };
  const renderTree = (parentId: string | null, depth = 0): React.ReactNode =>
    folders
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((folder) => {
        const children = folders.some((item) => item.parentId === folder.id) || decks.some((deck) => deck.folderId === folder.id);
        const open = expanded.has(folder.id);
        return (
          <div className="tree-group" key={folder.id}>
            <div className={`${view.name === "folder" && view.id === folder.id ? "tree-row active" : "tree-row"}${dropTarget === folder.id ? " drop-target" : ""}`} style={{ "--depth": depth } as React.CSSProperties} onDragOver={(event) => { event.preventDefault(); setDropTarget(folder.id); }} onDragLeave={() => setDropTarget(undefined)} onDrop={(event) => dropInto(event, folder.id)}>
              <button className={open ? "tree-chevron open" : "tree-chevron"} type="button" disabled={!children} onClick={() => onToggle(folder.id)} aria-label={open ? "Chiudi cartella" : "Apri cartella"}>{children ? "›" : ""}</button>
              <button className="tree-folder" title={folder.title} type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-lume-folder", folder.id); }} onClick={() => { if (children && !open) onToggle(folder.id); onNavigate({ name: "folder", id: folder.id }); }}>
                <i style={{ "--folder": folder.color } as React.CSSProperties} />
                <span>{folder.title}</span>
              </button>
            </div>
            <div className={open ? "tree-children open" : "tree-children"} aria-hidden={!open}>
                {renderTree(folder.id, depth + 1)}
                {decks.filter((deck) => deck.folderId === folder.id).map((deck) => (
                  <button className={view.name === "deck" && view.id === deck.id ? "tree-deck active" : "tree-deck"} title={deck.title} style={{ "--depth": depth + 1, "--deck": deck.color } as React.CSSProperties} key={deck.id} type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-lume-deck", deck.id); }} onClick={() => onNavigate({ name: "deck", id: deck.id })}>
                    <i /> <span>{deck.title}</span>
                  </button>
                ))}
            </div>
          </div>
        );
      });

  return (
    <aside className="sidebar-new">
      <button className="wordmark" type="button" onClick={() => onNavigate({ name: "home" })}>Lume</button>
      <nav className="primary-nav" aria-label="Navigazione principale">
        <button className={view.name === "home" ? "active" : ""} type="button" onClick={() => onNavigate({ name: "home" })}><i className="icon-home" />Il mio spazio</button>
        <button className={view.name === "explore" ? "active" : ""} type="button" onClick={() => onNavigate({ name: "explore" })}><i className="icon-search" />Esplora</button>
        <button className={view.name === "classes" || view.name === "class" ? "active" : ""} type="button" onClick={() => onNavigate({ name: "classes" })}><i className="icon-classes" />Classi</button>
      </nav>
      {classes.length > 0 && <div className="sidebar-classes">{classes.slice(0, 5).map((item) => <button className={view.name === "class" && view.id === item.id ? "active" : ""} type="button" key={item.id} onClick={() => onOpenClass(item.id)}><i /><span>{item.title}</span></button>)}</div>}
      <div className={dropTarget === null ? "sidebar-folders-heading drop-target" : "sidebar-folders-heading"} onDragOver={(event) => { event.preventDefault(); setDropTarget(null); }} onDragLeave={() => setDropTarget(undefined)} onDrop={(event) => dropInto(event, null)}>
        <span>Le mie cartelle</span>
        <button type="button" onClick={onCreate} aria-label="Crea cartella o set">＋</button>
      </div>
      <div className="folder-tree">{renderTree(null)}</div>
      {decks.some((deck) => !deck.folderId) && (
        <div className="independent-tree">
          <span>Set indipendenti</span>
          {decks.filter((deck) => !deck.folderId).map((deck) => (
            <button type="button" title={deck.title} key={deck.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-lume-deck", deck.id); }} onClick={() => onNavigate({ name: "deck", id: deck.id })}><i style={{ background: deck.color }} />{deck.title}</button>
          ))}
        </div>
      )}
      <div className="sidebar-bottom">
        <button type="button" onClick={onTheme} aria-label={theme === "dark" ? "Passa alla modalità chiara" : "Passa alla modalità scura"}><i className={theme === "dark" ? "theme-night" : "theme-day"} /></button>
        <button type="button" onClick={onPreferences} aria-label="Preferenze"><i className="icon-profile" /></button>
      </div>
      <button className={resizing ? "sidebar-resizer active" : "sidebar-resizer"} type="button" onPointerDown={(event) => { event.preventDefault(); setResizing(true); }} aria-label="Ridimensiona la colonna laterale"><i /></button>
    </aside>
  );
}

function Topbar({ onHome, onFocus, onBreathe, notificationCount, onNotifications, onPreferences }: { onHome: () => void; onFocus: () => void; onBreathe: () => void; notificationCount: number; onNotifications: () => void; onPreferences: () => void }) {
  return (
    <header className="topbar-new">
      <button className="mobile-wordmark" type="button" onClick={onHome}>Lume</button>
      <div className="top-tools">
        <button className="notification-tool" type="button" onClick={onNotifications} aria-label={`${notificationCount} notifiche non lette`}><i className="icon-bell" />{notificationCount > 0 && <b>{notificationCount > 9 ? "9+" : notificationCount}</b>}<span>Notifiche</span></button>
        <button type="button" onClick={onFocus} aria-label="Timer Lume"><i className="mini-candle" /><span>Timer Lume</span></button>
        <button type="button" onClick={onBreathe} aria-label="Respira"><i className="breath-dot" /><span>Respira</span></button>
        <button className="mobile-preferences-tool" type="button" onClick={onPreferences} aria-label="Preferenze"><i className="icon-profile" /><span>Preferenze</span></button>
      </div>
    </header>
  );
}

function Home({
  folders,
  decks,
  resumeDeck,
  randomEntry,
  randomFlipped,
  mastery,
  due,
  totalCards,
  studyDayStreak,
  focusMinutes,
  onOpenFolder,
  onOpenDeck,
  onRandom,
  onFlipRandom,
  onStudyRandom,
  onResume,
  onFocus,
  onReview,
  onCreateFolder,
}: {
  folders: Folder[];
  decks: Deck[];
  resumeDeck?: Deck;
  randomEntry: { deck: Deck; card: Card } | null;
  randomFlipped: boolean;
  mastery: number;
  due: number;
  totalCards: number;
  studyDayStreak: number;
  focusMinutes: number;
  onOpenFolder: (id: string) => void;
  onOpenDeck: (id: string) => void;
  onRandom: () => void;
  onFlipRandom: () => void;
  onStudyRandom: () => void;
  onResume: () => void;
  onFocus: () => void;
  onReview: () => void;
  onCreateFolder: () => void;
}) {
  const rootFolders = folders.filter((folder) => !folder.parentId);
  return (
    <div className="home-new">
      <section className="home-primary-grid">
        <article className="resume-panel">
          <div className="panel-heading"><span>Riprendi da qui</span><button type="button" onClick={() => resumeDeck && onOpenDeck(resumeDeck.id)}>›</button></div>
          {resumeDeck ? (
            <button className="resume-content" type="button" onClick={onResume}>
              <span className={`resume-notebook pattern-${resumeDeck.pattern}`} style={{ "--resume-deck": resumeDeck.color, "--resume-deck-text": getContrast(resumeDeck.color) } as React.CSSProperties}><span className="resume-spine" /><b>{resumeDeck.title}</b></span>
              <span><strong>{resumeDeck.title}</strong><i className="thin-progress"><b style={{ width: `${Math.min(100, Math.round((resumeDeck.cards.reduce((sum, card) => sum + card.known, 0) / Math.max(1, resumeDeck.cards.length * 4)) * 100))}%` }} /></i><small>{resumeDeck.cards.length} flashcard · {formatRelative(resumeDeck.lastStudied)}</small></span>
            </button>
          ) : <p className="empty-copy">Crea il tuo primo set per iniziare.</p>}
        </article>

        <article className="random-panel">
          <div className="panel-heading"><span>Flashcard a caso</span><button type="button" onClick={onRandom} aria-label="Mostra un’altra flashcard">↻</button></div>
          {randomEntry ? (
            <>
              <button className={randomFlipped ? "random-stack flipped" : "random-stack"} type="button" onClick={onFlipRandom}>
                <span className="stack-sheet sheet-one" /><span className="stack-sheet sheet-two" />
                <span className="random-card front"><small>{randomEntry.deck.title}</small><RichText value={randomEntry.card.front} /><em>Clicca per rivelare</em></span>
                <span className="random-card back"><small>Significato</small><RichText value={randomEntry.card.back} /><em>Torna alla domanda</em></span>
              </button>
              <button className="continue-random" type="button" onClick={onStudyRandom}>Continua a studiare →</button>
            </>
          ) : <p className="empty-copy">Nessuna flashcard disponibile.</p>}
        </article>
      </section>

      <section className="metrics-strip">
        <div><span>Il tuo percorso</span><strong>{studyDayStreak}</strong><small>{studyDayStreak === 1 ? "giorno consecutivo" : "giorni consecutivi"}</small></div>
        <button className="metric-action" type="button" onClick={onFocus}><span>Timer Lume</span><strong>{focusMinutes} min</strong><small>Avvia subito la candela →</small></button>
        <div><span>Flashcards</span><strong>{totalCards}</strong><small>totali</small></div>
        <button className="metric-action" type="button" onClick={onReview}><span>Da rivedere</span><strong>{due}</strong><small>Ripassa le più ostinate →</small></button>
        <div><span>Padronanza</span><strong>{mastery}%</strong><small>su tutte le risposte</small></div>
      </section>

      <section className="home-folders">
        <div className="section-title"><h1>Le mie cartelle</h1></div>
        <div className="folder-card-grid">
          {rootFolders.map((folder) => (
            <FolderCard key={folder.id} folder={folder} count={decks.filter((deck) => deck.folderId === folder.id).length + folders.filter((item) => item.parentId === folder.id).length} onOpen={() => onOpenFolder(folder.id)} />
          ))}
          <button className="new-folder-card" type="button" onClick={onCreateFolder}><b>＋</b><strong>Nuova cartella</strong><small>Può contenere cartelle e set</small></button>
        </div>
      </section>
    </div>
  );
}

function FolderCard({ folder, count, onOpen, onDeckDrop }: { folder: Folder; count: number; onOpen: () => void; onDeckDrop?: (deckId: string) => void }) {
  const [dropActive, setDropActive] = useState(false);
  return (
    <button
      className={dropActive ? "folder-card drop-active" : "folder-card"}
      style={{ "--folder": folder.color, "--folder-text": getContrast(folder.color) } as React.CSSProperties}
      type="button"
      onClick={onOpen}
      onDragOver={onDeckDrop ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropActive(true); } : undefined}
      onDragLeave={onDeckDrop ? () => setDropActive(false) : undefined}
      onDrop={onDeckDrop ? (event) => {
        event.preventDefault();
        setDropActive(false);
        const deckId = event.dataTransfer.getData("application/x-lume-deck");
        if (deckId) onDeckDrop(deckId);
      } : undefined}
    >
      <span className="folder-tab" />
      <span className="folder-body"><small>{folder.visibility === "public" ? "Pubblica" : "Privata"}</small><strong>{folder.title}</strong><em>{count} elementi</em></span>
      {onDeckDrop && <span className="drop-copy">Rilascia qui</span>}
    </button>
  );
}

function FolderLibrary({ folders, decks, onOpen, onCreate }: { folders: Folder[]; decks: Deck[]; onOpen: (id: string) => void; onCreate: () => void }) {
  const roots = folders.filter((folder) => !folder.parentId);
  return (
    <div className="library-page">
      <div className="page-intro"><span>Archivio</span><h1>Tutte le cartelle</h1><p>Organizza lo studio in livelli: materia, corso, esame o qualunque struttura funzioni per te.</p></div>
      <div className="folder-card-grid large">
        {roots.map((folder) => <FolderCard key={folder.id} folder={folder} count={decks.filter((deck) => deck.folderId === folder.id).length + folders.filter((item) => item.parentId === folder.id).length} onOpen={() => onOpen(folder.id)} />)}
        <button className="new-folder-card" type="button" onClick={onCreate}><b>＋</b><strong>Nuova cartella</strong><small>Crea un nuovo livello</small></button>
      </div>
    </div>
  );
}

function Explore({ search, onSearch, decks, cloudStatus, onOpen }: { search: string; onSearch: (value: string) => void; decks: Deck[]; cloudStatus: CloudStatus; onOpen: (id: string) => void }) {
  const visible = decks.filter((deck) => `${deck.title} ${deck.description}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="explore-page">
      <div className="page-intro"><span>Biblioteca pubblica</span><h1>Esplora flashcards</h1><p>Cerca tra i set pubblicati dalla comunità. Puoi aprirli, studiarli e lasciare una valutazione.</p></div>
      <label className="search-box"><i className="icon-search" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Cerca parole chiave, materie o titoli…" /></label>
      <div className="notebook-grid public-grid">
        {visible.map((deck) => <Notebook key={deck.id} deck={deck} onOpen={() => onOpen(deck.id)} />)}
        {!visible.length && <p className="empty-copy">{cloudStatus === "checking" || cloudStatus === "loading" ? "Sto caricando la biblioteca pubblica…" : "Nessun set pubblico corrisponde alla ricerca."}</p>}
      </div>
    </div>
  );
}

function ClassesPage({ account, username, classes, notice, busy, onLogin, onCreate, onJoin, onOpen }: { account: CloudAccount | null; username: string | null; classes: LumeClass[]; notice: string; busy: boolean; onLogin: () => void; onCreate: () => void; onJoin: () => void; onOpen: (id: string) => void }) {
  return <div className="classes-page"><div className="page-intro"><span>Spazi condivisi</span><h1>Classi</h1><p>Raccogli materiali insieme alle persone con cui studi, senza mescolare i rispettivi spazi personali.</p></div>
    {!account ? <section className="class-access-card"><div><span>Account necessario</span><h2>Accedi per entrare in una classe.</h2><p>Le classi e le notifiche restano collegate al tuo profilo.</p></div><button className="primary-dark" type="button" onClick={onLogin}>Accedi</button></section> : !username ? <section className="class-access-card"><div><span>Profilo da completare</span><h2>Scegli prima il tuo nome utente.</h2><p>È il nome pubblico che gli altri membri vedranno accanto ai tuoi materiali.</p></div></section> : <>
      <section className="class-actions-hero"><div><span>Il tuo profilo in classe</span><strong>@{username}</strong><small>L’email sarà visibile soltanto agli altri membri delle classi a cui partecipi.</small></div><div><button className="outline-button" type="button" onClick={onJoin}>Entra con un codice</button><button className="primary-dark" type="button" onClick={onCreate}>Crea una classe</button></div></section>
      {notice && <p className="class-notice">{notice}</p>}
      <section className="class-library"><div className="section-title"><h2>Le tue classi</h2><span>{classes.length}</span></div><div className="class-grid">{classes.map((item) => <button className="class-card" type="button" key={item.id} onClick={() => onOpen(item.id)}><i className="class-card-mark" /><span>{item.role === "owner" ? "Creata da te" : `Di @${item.ownerName}`}</span><strong>{item.title}</strong><small>{item.memberCount} {item.memberCount === 1 ? "membro" : "membri"}</small><em>Apri →</em></button>)}{!classes.length && <div className="class-empty"><strong>Non fai ancora parte di nessuna classe.</strong><p>Crea uno spazio oppure usa il codice ricevuto da un’altra persona.</p></div>}</div></section>
    </>}
    {busy && <p className="class-loading">Aggiornamento in corso…</p>}
  </div>;
}

function ClassView({ account, username, workspace, folderId, busy, notice, annotationFilter, onAnnotationFilter, onBack, onOpenFolder, onCreate, onImport, onEdit, onStudy, onFavorite, onCopy, onComment, onAnnotation }: { account: CloudAccount | null; username: string | null; workspace: ClassWorkspace | null; folderId: string | null; busy: boolean; notice: string; annotationFilter: AnnotationFilter; onAnnotationFilter: (filter: AnnotationFilter) => void; onBack: () => void; onOpenFolder: (id: string | null) => void; onCreate: () => void; onImport: () => void; onEdit: (kind: ClassItemKind, id: string) => void; onStudy: (deckIds: string[]) => void; onFavorite: (kind: ClassItemKind, id: string, active: boolean) => void | Promise<void>; onCopy: (kind: ClassItemKind, id: string) => void | Promise<void>; onComment: (kind: ClassItemKind, id: string, text: string) => void | Promise<void>; onAnnotation: (deckId: string, note: string, pinned: boolean) => void | Promise<void> }) {
  const [membersOpen, setMembersOpen] = useState(false);
  if (!workspace || !account || !username) return <div className="class-loading-page"><button type="button" onClick={onBack}>← Tutte le classi</button><p>{busy ? "Sto aprendo la classe…" : notice || "Classe non disponibile."}</p></div>;
  const currentFolder = folderId ? workspace.folders.find((folder) => folder.id === folderId) : null;
  const children = workspace.folders.filter((folder) => folder.parentId === folderId);
  const visibleDecks = workspace.decks.filter((deck) => deck.folderId === folderId);
  const ancestors: ClassFolder[] = [];
  let ancestor = currentFolder;
  const seen = new Set<string>();
  while (ancestor && !seen.has(ancestor.id)) {
    ancestors.unshift(ancestor);
    seen.add(ancestor.id);
    ancestor = ancestor.parentId ? workspace.folders.find((folder) => folder.id === ancestor?.parentId) : undefined;
  }
  const deckIdsForFolder = () => {
    if (!folderId) return workspace.decks.map((deck) => deck.id);
    const ids = new Set<string>([folderId]);
    let changed = true;
    while (changed) { changed = false; workspace.folders.forEach((folder) => { if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; } }); }
    return workspace.decks.filter((deck) => deck.folderId && ids.has(deck.folderId)).map((deck) => deck.id);
  };
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}?join=${workspace.summary.code}`;
  return <div className="class-page"><section className="class-hero"><nav className="class-breadcrumbs"><button type="button" onClick={onBack}>Classi</button><i>›</i><button type="button" onClick={() => onOpenFolder(null)}>{workspace.summary.title}</button>{ancestors.map((item) => <span key={item.id}><i>›</i><button type="button" onClick={() => onOpenFolder(item.id)}>{item.title}</button></span>)}</nav><div className="class-hero-main"><div><span>{workspace.summary.role === "owner" ? "La tua classe" : `Classe di @${workspace.summary.ownerName}`}</span><h1>{currentFolder?.title ?? workspace.summary.title}</h1><p>{workspace.members.length} membri · {workspace.decks.length} set · {workspace.decks.reduce((sum, deck) => sum + deck.cards.length, 0)} flashcard</p></div><div className="class-hero-actions"><button className="outline-button" type="button" onClick={() => setMembersOpen((open) => !open)}>Membri</button><button className="outline-button" type="button" onClick={() => { void navigator.clipboard.writeText(shareUrl); }}>Copia link di invito</button><button className="primary-dark" type="button" disabled={!deckIdsForFolder().length} onClick={() => onStudy(deckIdsForFolder())}>Studia {currentFolder ? "la cartella" : "tutta la classe"}</button></div></div>{membersOpen && <div className="class-members"><header><div><span>Membri della classe</span><small>L’email è visibile soltanto qui, alle persone che fanno parte della classe.</small></div><button type="button" onClick={() => setMembersOpen(false)}>×</button></header><ul>{workspace.members.map((member) => <li key={member.uid}><span><strong>@{member.username}</strong>{member.role === "owner" && <em>Creatore</em>}</span><a href={`mailto:${member.email}`}>{member.email}</a></li>)}</ul><footer><span>Codice classe</span><button type="button" onClick={() => { void navigator.clipboard.writeText(workspace.summary.code); }}>{workspace.summary.code}</button></footer></div>}</section>
    <section className="class-toolbar"><div><button className="primary-dark" type="button" onClick={onCreate}>＋ Nuovo</button><button className="outline-button" type="button" onClick={onImport}>Porta dal mio spazio</button></div><div className="annotation-filter"><span>Note e pin</span><button className={annotationFilter === "all" ? "active" : ""} type="button" onClick={() => onAnnotationFilter("all")}>Tutti</button><button className={annotationFilter === "mine" ? "active" : ""} type="button" onClick={() => onAnnotationFilter("mine")}>Solo i miei</button><button className={annotationFilter === "hidden" ? "active" : ""} type="button" onClick={() => onAnnotationFilter("hidden")}>Nascondi</button></div></section>
    {notice && <p className="class-notice">{notice}</p>}
    <section className="class-content"><div className="section-title"><h2>{currentFolder ? "Contenuti della cartella" : "Materiali condivisi"}</h2><span>{children.length + visibleDecks.length}</span></div><div className="class-item-grid">{children.map((folder) => <ClassItemPanel key={folder.id} kind="folder" item={folder} accountId={account.uid} classOwnerId={workspace.summary.ownerId} favorite={workspace.favorites.some((favorite) => favorite.itemKind === "folder" && favorite.itemId === folder.id)} comments={workspace.comments.filter((comment) => comment.targetKind === "folder" && comment.targetId === folder.id)} annotations={[]} annotationFilter={annotationFilter} onOpen={() => onOpenFolder(folder.id)} onEdit={() => onEdit("folder", folder.id)} onFavorite={(active) => onFavorite("folder", folder.id, active)} onCopy={() => onCopy("folder", folder.id)} onComment={(text) => onComment("folder", folder.id, text)} onAnnotation={() => undefined} />)}{visibleDecks.map((deck) => <ClassItemPanel key={deck.id} kind="deck" item={deck} accountId={account.uid} classOwnerId={workspace.summary.ownerId} favorite={workspace.favorites.some((favorite) => favorite.itemKind === "deck" && favorite.itemId === deck.id)} comments={workspace.comments.filter((comment) => comment.targetKind === "deck" && comment.targetId === deck.id)} annotations={workspace.annotations.filter((annotation) => annotation.deckId === deck.id && !annotation.cardId)} annotationFilter={annotationFilter} onOpen={() => onStudy([deck.id])} onEdit={() => onEdit("deck", deck.id)} onFavorite={(active) => onFavorite("deck", deck.id, active)} onCopy={() => onCopy("deck", deck.id)} onComment={(text) => onComment("deck", deck.id, text)} onAnnotation={(note, pinned) => onAnnotation(deck.id, note, pinned)} />)}{children.length + visibleDecks.length === 0 && <div className="class-empty"><strong>Questo spazio è ancora vuoto.</strong><p>Crea un contenuto nuovo oppure portane una copia dal tuo spazio personale.</p></div>}</div></section>
    {busy && <p className="class-loading">Salvataggio in corso…</p>}
  </div>;
}

function ClassItemPanel({ kind, item, accountId, classOwnerId, favorite, comments, annotations, annotationFilter, onOpen, onEdit, onFavorite, onCopy, onComment, onAnnotation }: { kind: ClassItemKind; item: ClassFolder | ClassDeck; accountId: string; classOwnerId: string; favorite: boolean; comments: ClassComment[]; annotations: ClassAnnotation[]; annotationFilter: AnnotationFilter; onOpen: () => void; onEdit: () => void; onFavorite: (active: boolean) => void | Promise<void>; onCopy: () => void | Promise<void>; onComment: (text: string) => void | Promise<void>; onAnnotation: (note: string, pinned: boolean) => void | Promise<void> }) {
  const ownAnnotation = annotations.find((annotation) => annotation.authorId === accountId);
  const [note, setNote] = useState(ownAnnotation?.note ?? "");
  const [pinned, setPinned] = useState(ownAnnotation?.pinned ?? false);
  const [comment, setComment] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visibleAnnotations = annotationFilter === "mine" ? annotations.filter((annotation) => annotation.authorId === accountId) : annotations;
  const canEdit = item.ownerId === accountId || classOwnerId === accountId;
  return <article className="class-item-card" style={{ "--item-color": item.color } as React.CSSProperties}><button className="class-item-open" type="button" onClick={onOpen}><i className={kind === "folder" ? "class-folder-object" : `class-notebook-object pattern-${(item as ClassDeck).pattern}`} /><span>{kind === "folder" ? "Cartella" : `${(item as ClassDeck).cards.length} flashcard`}</span><strong>{item.title}</strong><small>di @{item.ownerName}</small></button><div className="class-item-actions"><button className={favorite ? "favorite active" : "favorite"} type="button" onClick={() => { void onFavorite(!favorite); }} aria-label={favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}>☆</button>{canEdit && <button type="button" onClick={onEdit}>Modifica</button>}<button type="button" onClick={() => { void onCopy(); }}>{item.ownerId === accountId ? "Copia nel mio spazio" : "Richiedi una copia"}</button><button type="button" onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? "Chiudi" : "Note e commenti"}</button></div>{detailsOpen && <div className="class-collaboration">{kind === "deck" && annotationFilter !== "hidden" && <section className="class-note-editor"><label><span>La tua nota condivisa</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Lascia un appunto utile alla classe…" /></label><label className="class-pin-toggle"><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} /><span>Metti un pin</span></label><button type="button" onClick={() => { void onAnnotation(note, pinned); }}>Salva nota</button>{visibleAnnotations.filter((annotation) => annotation.authorId !== accountId || annotation.note || annotation.pinned).length > 0 && <ul className="shared-note-list">{visibleAnnotations.map((annotation) => <li key={annotation.id}><strong>@{annotation.authorName}{annotation.pinned ? " · Pin" : ""}</strong>{annotation.note && <p>{annotation.note}</p>}</li>)}</ul>}</section>}<section className="class-comments"><span>Commenti</span><ul>{comments.map((entry) => <li key={entry.id}><strong>@{entry.authorName}</strong><p>{entry.text}</p></li>)}</ul><form onSubmit={(event) => { event.preventDefault(); if (!comment.trim()) return; void onComment(comment); setComment(""); }}><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Scrivi un commento…" /><button type="submit" disabled={!comment.trim()}>Invia</button></form></section></div>}</article>;
}

function ClassDialog({ mode, initialCode, busy, notice, onSubmit, onClose }: { mode: "create" | "join"; initialCode?: string; busy: boolean; notice: string; onSubmit: (value: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initialCode ?? "");
  return <div className="modal-backdrop-clean" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="class-dialog" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value); }}><button className="round-close" type="button" onClick={onClose}>×</button><span>{mode === "create" ? "Nuovo spazio condiviso" : "Invito"}</span><h2>{mode === "create" ? "Crea una classe." : "Entra in una classe."}</h2><label><span>{mode === "create" ? "Nome della classe" : "Codice della classe"}</span><input autoFocus value={value} onChange={(event) => setValue(mode === "join" ? event.target.value.toUpperCase() : event.target.value)} maxLength={mode === "join" ? 7 : 70} placeholder={mode === "create" ? "Es. Psicologia cognitiva" : "XXXXXXX"} /></label>{notice && <p className="class-notice">{notice}</p>}<button className="primary-dark" type="submit" disabled={busy || !value.trim()}>{busy ? "Attendi…" : mode === "create" ? "Crea la classe" : "Entra"}</button></form></div>;
}

function ClassImportModal({ folders, decks, onImport, onClose }: { folders: Folder[]; decks: Deck[]; onImport: (kind: ClassItemKind, id: string) => void; onClose: () => void }) {
  return <div className="modal-backdrop-clean" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="class-import-modal"><button className="round-close" type="button" onClick={onClose}>×</button><span>Dal tuo spazio personale</span><h2>Porta una copia nella classe.</h2><p>Il materiale condiviso sarà indipendente dall’originale: le modifiche in classe non toccheranno il tuo archivio.</p><div><h3>Cartelle</h3>{folders.filter((folder) => !folder.parentId).map((folder) => <button type="button" key={folder.id} onClick={() => onImport("folder", folder.id)}><i className="icon-folder-line" /><span>{folder.title}</span><em>Importa</em></button>)}</div><div><h3>Set</h3>{decks.map((deck) => <button type="button" key={deck.id} onClick={() => onImport("deck", deck.id)}><i className="create-deck-icon" /><span>{deck.title}</span><em>Importa</em></button>)}</div></section></div>;
}

function FolderView({
  folder,
  ancestors,
  childFolders,
  decks,
  allDecks,
  descendantIds,
  onHome,
  onOpenFolder,
  onOpenDeck,
  onCreateFolder,
  onCreateDeck,
  onEdit,
  onDeleteFolder,
  onDeleteDecks,
  onMoveDecks,
  onRequestTransfer,
  onStudy,
}: {
  folder: Folder;
  ancestors: Folder[];
  childFolders: Folder[];
  decks: Deck[];
  allDecks: Deck[];
  descendantIds: Set<string>;
  onHome: () => void;
  onOpenFolder: (id: string) => void;
  onOpenDeck: (id: string) => void;
  onCreateFolder: () => void;
  onCreateDeck: () => void;
  onEdit: () => void;
  onDeleteFolder: () => void;
  onDeleteDecks: (ids: string[]) => void;
  onMoveDecks: (ids: string[]) => void;
  onRequestTransfer: (deckId: string, targetFolderId: string) => void;
  onStudy: () => void;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());
  const allCards = allDecks.filter((deck) => deck.folderId && descendantIds.has(deck.folderId)).reduce((sum, deck) => sum + deck.cards.length, 0);
  const toggleSelected = (id: string) => setSelectedDecks((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const dragSelected = (event: React.DragEvent<HTMLButtonElement>) => {
    const ids = Array.from(selectedDecks);
    if (!ids.length) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-lume-decks", JSON.stringify(ids));
    const ghost = document.createElement("div");
    ghost.className = "multi-drag-ghost";
    ghost.innerHTML = `<i></i><i></i><strong>${ids.length}</strong><span>${ids.length === 1 ? "set selezionato" : "set raggruppati"}</span>`;
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 38, 34);
    window.setTimeout(() => ghost.remove(), 0);
  };
  return (
    <div className="folder-page-new" style={{ "--folder": folder.color, "--folder-soft": tint(folder.color, 0.86), "--folder-text": getContrast(folder.color) } as React.CSSProperties}>
      <section className="folder-hero">
        <nav className="breadcrumbs" aria-label="Percorso cartella"><button type="button" onClick={onHome}>Il mio spazio</button>{ancestors.map((item) => <span className="breadcrumb-step" key={item.id}><i>›</i><button type="button" aria-current={item.id === folder.id ? "page" : undefined} onClick={() => onOpenFolder(item.id)}>{item.title}</button></span>)}</nav>
        <div className="folder-hero-content">
          <span className="hero-folder-icon"><i /></span>
          <div><small>{folder.visibility === "public" ? "Cartella pubblica" : "Cartella privata"}</small><h1>{folder.title}</h1><p>{childFolders.length} sottocartelle · {decks.length} set · {allCards} flashcard</p></div>
        </div>
        <div className="folder-actions"><button className="soft-button" type="button" onClick={onEdit}>Personalizza</button><button className="soft-button" type="button" onClick={onCreateFolder}>＋ Sottocartella</button><button className="hero-button" type="button" onClick={onStudy}>Studia tutta la cartella</button><button className="delete-folder-link" type="button" onClick={onDeleteFolder}>{folder.parentId ? "Elimina sottocartella" : "Elimina cartella"}</button></div>
      </section>

      <section className="folder-shelf">
        <div className="subfolder-section"><div className="section-title"><h2>Le tue cartelle</h2></div>{childFolders.length > 0 ? <div className="folder-card-grid compact">{childFolders.map((child) => <FolderCard key={child.id} folder={child} count={allDecks.filter((deck) => deck.folderId === child.id).length} onOpen={() => onOpenFolder(child.id)} onDeckDrop={(deckId) => onRequestTransfer(deckId, child.id)} />)}</div> : <p className="empty-section-copy">Questa cartella non contiene ancora sottocartelle.</p>}</div>
        <div className="section-title folder-set-heading"><h2>I tuoi set</h2>{!selectionMode && <button className="section-select-button" type="button" onClick={() => { setSelectionMode(true); setSelectedDecks(new Set()); }}>Seleziona</button>}</div>
        {selectionMode && <div className="batch-action-bar"><span>{selectedDecks.size} selezionati</span><button type="button" onClick={() => { setSelectionMode(false); setSelectedDecks(new Set()); }}>Annulla</button><button type="button" disabled={!selectedDecks.size} onClick={() => onMoveDecks(Array.from(selectedDecks))}>Sposta</button><button className="danger" type="button" disabled={!selectedDecks.size} onClick={() => { onDeleteDecks(Array.from(selectedDecks)); setSelectedDecks(new Set()); }}>Elimina</button></div>}
        <div className="notebook-grid">
          {decks.map((deck) => <Notebook key={deck.id} deck={{ ...deck, color: folder.color }} onOpen={() => selectionMode ? toggleSelected(deck.id) : onOpenDeck(deck.id)} selected={selectedDecks.has(deck.id)} selectionMode={selectionMode} onDragStartDeck={selectionMode ? (selectedDecks.has(deck.id) ? dragSelected : undefined) : (event) => { event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData("application/x-lume-deck", deck.id); }} />)}
          <button className="new-notebook" type="button" onClick={onCreateDeck}><b>＋</b><strong>Nuovo set</strong><small>Userà il colore della cartella</small></button>
        </div>
      </section>
    </div>
  );
}

function Notebook({ deck, onOpen, onDragStartDeck, selected = false, selectionMode = false }: { deck: Deck; onOpen: () => void; onDragStartDeck?: (event: React.DragEvent<HTMLButtonElement>) => void; selected?: boolean; selectionMode?: boolean }) {
  return (
    <button className={`${onDragStartDeck ? "notebook draggable" : "notebook"} pattern-${deck.pattern}${selected ? " selected" : ""}`} style={{ "--deck": deck.color, "--deck-text": getContrast(deck.color) } as React.CSSProperties} type="button" onClick={onOpen} draggable={Boolean(onDragStartDeck)} onDragStart={onDragStartDeck} aria-pressed={selectionMode ? selected : undefined}>
      {selectionMode && <span className="notebook-check">{selected ? "✓" : ""}</span>}<span className="notebook-spine" /><small>{deck.community ? `Di ${deck.ownerName || "Studente Lume"}` : "Lume / study set"}</small><strong>{deck.title}</strong><i>{deck.description || "Domande e risposte"}</i><em>{String(deck.cards.length).padStart(2, "0")} flashcard{deck.community ? ` · ${deck.votes ?? 0} punti` : ""}</em>
    </button>
  );
}

function DeckView({ deck, folder, publicEffective, readOnly, voteBusy, onBack, onStudy, onEdit, onDelete, onVote }: { deck: Deck; folder?: Folder; publicEffective: boolean; readOnly: boolean; voteBusy: boolean; onBack: () => void; onStudy: () => void; onEdit: () => void; onDelete: () => void; onVote: (vote: -1 | 1 | 2) => void }) {
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const pinnedCards = deck.cards.filter((card) => card.pinned);
  const visibleCards = pinnedOnly ? pinnedCards : deck.cards;
  return (
    <div className="deck-page-new" style={{ "--deck": folder?.color ?? deck.color, "--deck-soft": tint(folder?.color ?? deck.color, 0.9) } as React.CSSProperties}>
      <button className="back-link" type="button" onClick={onBack}>← {readOnly ? "Esplora" : folder?.title ?? "Il mio spazio"}</button>
      <section className="deck-overview">
        <Notebook deck={{ ...deck, color: folder?.color ?? deck.color }} onOpen={() => undefined} />
        <div><span>{publicEffective ? readOnly ? `Set pubblico · ${deck.ownerName || "Comunità Lume"}` : "Set pubblico" : "Set privato"}</span><h1>{deck.title}</h1><p>{deck.description || "Domande e risposte"}</p><dl><div><dt>Flashcards</dt><dd>{deck.cards.length}</dd></div><div><dt>Ordine</dt><dd>{deck.order === "random" ? "Casuale" : "In ordine"}</dd></div><div><dt>Verso</dt><dd>{deck.direction === "front-first" ? "Fronte → retro" : "Retro → fronte"}</dd></div><div><dt>Modalità</dt><dd>{deck.keywordHelp ? "Keyword Help" : "Ripasso normale"}</dd></div></dl><div className="deck-actions"><button className="primary-dark" type="button" onClick={onStudy}>Studia il set</button>{!readOnly && <button className="outline-button" type="button" onClick={onEdit}>Modifica</button>}</div>{publicEffective && <div className="public-vote"><span>Valuta questo set pubblico</span><button disabled={voteBusy} className={deck.userVote === -1 ? "active" : ""} type="button" onClick={() => onVote(-1)} aria-label="Non mi piace"><i className="thumb-icon thumb-down" /></button><button disabled={voteBusy} className={deck.userVote === 1 ? "active" : ""} type="button" onClick={() => onVote(1)} aria-label="Mi piace"><i className="thumb-icon" /></button><button disabled={voteBusy} className={deck.userVote === 2 ? "active" : ""} type="button" onClick={() => onVote(2)} aria-label="Mi piace molto"><span className="double-thumb"><i className="thumb-icon" /><i className="thumb-icon" /></span></button><strong>{deck.votes ?? 0}</strong>{typeof deck.ratingsCount === "number" && <small>{deck.ratingsCount} valutazioni</small>}</div>} {!readOnly && <div className="deck-secondary-actions"><button type="button" disabled={!pinnedCards.length} onClick={() => setPinnedOnly((active) => !active)}>{pinnedOnly ? "Mostra tutte" : `Pin da rivedere (${pinnedCards.length})`}</button><button className="danger-link" type="button" onClick={onDelete}>Elimina set</button></div>}</div>
      </section>
      <section className="card-list"><div className="section-title"><h2>{pinnedOnly ? "Pin da rivedere" : "Le flashcards"}</h2><span>Domanda davanti · risposta dietro</span></div>{visibleCards.map((card, index) => <article key={card.id}><b>{String(index + 1).padStart(2, "0")}</b><RichText value={card.front} /><RichText value={card.back} />{card.pinned && <span className="card-list-pin">Pin · da correggere</span>}{card.pinned && card.pinComment && <p className="pin-comment">{card.pinComment}</p>}</article>)}{pinnedOnly && !visibleCards.length && <p className="empty-copy">Non hai ancora messo pin in questo set.</p>}</section>
    </div>
  );
}

function CreateMenu({ onFolder, onDeck, onClose }: { onFolder: () => void; onDeck: () => void; onClose: () => void }) {
  return (
    <div className="popover-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="create-popover"><span>Cosa vuoi creare?</span><button type="button" onClick={onFolder}><i className="create-folder-icon" /><strong>Una cartella</strong><small>Può contenere altre cartelle e set</small></button><button type="button" onClick={onDeck}><i className="create-deck-icon" /><strong>Un set di flashcards</strong><small>Può vivere da solo o dentro una cartella</small></button></section>
    </div>
  );
}

function FolderCreator({ folder, folders, defaultParentId, parentPublic, onSave, onClose }: { folder?: Folder; folders: Folder[]; defaultParentId: string | null; parentPublic: (id: string | null) => boolean; onSave: (data: Omit<Folder, "id" | "createdAt">, editId?: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState(folder?.title ?? "");
  const [parentId, setParentId] = useState<string | null>(folder?.parentId ?? defaultParentId);
  const [color, setColor] = useState(folder?.color ?? colors[0]);
  const [visibility, setVisibility] = useState<Visibility>(folder?.visibility ?? "private");
  const inheritedPublic = parentPublic(parentId);
  const blockedParents = useMemo(() => {
    const blocked = new Set<string>();
    if (!folder) return blocked;
    blocked.add(folder.id);
    let changed = true;
    while (changed) {
      changed = false;
      folders.forEach((item) => {
        if (item.parentId && blocked.has(item.parentId) && !blocked.has(item.id)) {
          blocked.add(item.id);
          changed = true;
        }
      });
    }
    return blocked;
  }, [folder, folders]);
  const possibleParents = folders.filter((item) => !blockedParents.has(item.id));
  return (
    <div className="creator-layer">
      <header className="creator-header"><button type="button" onClick={onClose}>Lume</button><div><span>Nuova struttura</span><h2>{folder ? "Modifica cartella" : "Crea una cartella"}</h2></div><button className="round-close" type="button" onClick={onClose} aria-label="Chiudi">×</button></header>
      <main className="folder-creator-main">
        <section className="creator-fields"><span className="step-number">01</span><h1>Dai forma al tuo archivio.</h1><p>Una cartella può contenere set e altre cartelle, senza limiti di profondità.</p>
          <label className="field-clean"><span>Nome della cartella</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Es. Psicologia" maxLength={60} /></label>
          <label className="field-clean"><span>Dentro a</span><select value={parentId ?? ""} onChange={(event) => setParentId(event.target.value || null)}><option value="">Il mio spazio — livello principale</option>{possibleParents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <fieldset className="clean-fieldset"><legend>Colore</legend><div className="color-palette">{colors.map((option) => <button className={color === option ? "selected" : ""} style={{ background: option }} key={option} type="button" onClick={() => setColor(option)} aria-label={`Colore ${option}`} />)}<label className="custom-color"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><span>＋</span></label></div></fieldset>
          <fieldset className="clean-fieldset"><legend>Visibilità</legend>{inheritedPublic ? <div className="inherit-note"><strong>Pubblica tramite la cartella superiore</strong><small>Una cartella inserita in uno spazio pubblico non può contenere elementi privati.</small></div> : <div className="segmented"><button className={visibility === "private" ? "selected" : ""} type="button" onClick={() => setVisibility("private")}>Privata</button><button className={visibility === "public" ? "selected" : ""} type="button" onClick={() => setVisibility("public")}>Pubblica</button></div>}<p className="privacy-explanation">{inheritedPublic || visibility === "public" ? "Tutti i set e tutte le sottocartelle al suo interno saranno pubblici." : "I contenuti resteranno privati. Potrai rendere pubblici singoli set uno per uno."}</p></fieldset>
        </section>
        <aside className="folder-live-preview"><span>Anteprima</span><div className="large-folder-object" style={{ "--folder": color, "--folder-text": getContrast(color) } as React.CSSProperties}><i className="preview-paper one" /><i className="preview-paper two" /><span className="preview-folder-tab" /><div><small>{inheritedPublic || visibility === "public" ? "Cartella pubblica" : "Cartella privata"}</small><strong>{title || "La tua cartella"}</strong><em>{parentId ? `Dentro ${folders.find((item) => item.id === parentId)?.title}` : "Livello principale"}</em></div></div></aside>
      </main>
      <footer className="creator-footer"><button type="button" onClick={onClose}>Annulla</button><button className="primary-dark" type="button" disabled={!title.trim()} onClick={() => onSave({ title: title.trim(), parentId, color, visibility: inheritedPublic ? "public" : visibility }, folder?.id)}>{folder ? "Salva modifiche" : "Crea la cartella"} →</button></footer>
    </div>
  );
}

function LLMPromptModal({ keywordHelp, onClose, onCopied }: { keywordHelp: boolean; onClose: () => void; onCopied: (message: string) => void }) {
  const copy = async (prompt: string, label: string) => {
    await navigator.clipboard.writeText(prompt);
    onCopied(`${label} copiato negli appunti.`);
    onClose();
  };
  return <div className="modal-backdrop-clean llm-prompt-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="llm-prompt-modal"><button className="round-close" type="button" onClick={onClose}>×</button><span>Prepara il set con un LLM</span><h2>Scegli il prompt, leggilo e poi copialo.</h2><p>Incollalo nell’LLM che preferisci insieme ai tuoi appunti. Il file risultante sarà già nel formato <code>parola :: definizione</code>.</p><div className="prompt-choice-grid"><article><h3>Prompt essenziale</h3><p>Per definizioni pulite senza indizi evidenziati.</p><pre>{markdownPrompt}</pre><button className={keywordHelp ? "outline-button" : "primary-dark"} type="button" onClick={() => { void copy(markdownPrompt, "Prompt essenziale"); }}>Copia questo prompt</button></article><article><h3>Prompt con Keyword Help</h3><p>Sceglie da 1 a massimo 3 pilastri concettuali e li prepara in neretto.</p><pre>{keywordMarkdownPrompt}</pre><button className={keywordHelp ? "primary-dark" : "outline-button"} type="button" onClick={() => { void copy(keywordMarkdownPrompt, "Prompt Keyword Help"); }}>Copia questo prompt</button></article></div><small>Alternativa manuale: attiva Keyword Help e metti in neretto le parole-chiave direttamente nell’editor.</small></section></div>;
}

function DeckCreator({ deck, folders, defaultFolderId, folderPublic, theme, onSave, onClose }: { deck?: Deck; folders: Folder[]; defaultFolderId: string | null; folderPublic: (id: string | null) => boolean; theme: "light" | "dark"; onSave: (data: Omit<Deck, "id" | "createdAt">, editId?: string) => void; onClose: () => void }) {
  type DraftPair = { id?: string; front: string; back: string; pinned?: boolean; pinComment?: string };
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState(deck?.title ?? "");
  const [description, setDescription] = useState(deck?.description ?? "");
  const [folderId, setFolderId] = useState<string | null>(deck?.folderId ?? defaultFolderId);
  const [color, setColor] = useState(deck?.color ?? colors[0]);
  const [pattern, setPattern] = useState<Pattern>(deck?.pattern ?? "plain");
  const [visibility, setVisibility] = useState<Visibility>(deck?.visibility ?? "private");
  const [keywordHelp, setKeywordHelp] = useState(deck?.keywordHelp ?? false);
  const [keywordInfoOpen, setKeywordInfoOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [order, setOrder] = useState<Order>(deck?.order ?? "sequential");
  const [direction, setDirection] = useState<Direction>(deck?.direction ?? "front-first");
  const [cardColorMode, setCardColorMode] = useState<CardColorMode>(deck?.cardColorMode ?? "single");
  const [cardColor, setCardColor] = useState(deck?.cardColor ?? deck?.color ?? colors[0]);
  const [pairs, setPairs] = useState<DraftPair[]>(deck?.cards.length ? deck.cards.map((card) => ({ id: card.id, front: card.front, back: card.back, pinned: card.pinned, pinComment: card.pinComment })) : [{ front: "", back: "" }]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewBack, setPreviewBack] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [dragImportActive, setDragImportActive] = useState(false);
  const [deletingPairKey, setDeletingPairKey] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedFolder = folders.find((folder) => folder.id === folderId);
  const effectiveColor = selectedFolder?.color ?? color;
  const inheritedPublic = folderPublic(folderId);
  const completePairs = pairs.filter((pair) => plainText(pair.front) && plainText(pair.back));
  const previewPair = completePairs[previewIndex] ?? completePairs[0];
  const previewFirst = previewPair ? (direction === "front-first" ? previewPair.front : previewPair.back) : "";
  const previewSecond = previewPair ? (direction === "front-first" ? previewPair.back : previewPair.front) : "";

  useEffect(() => {
    if (!importMessage) return;
    const timeout = window.setTimeout(() => setImportMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [importMessage]);

  const goToStep = (next: 1 | 2 | 3) => {
    if (next === 3) {
      setPreviewIndex(0);
      setPreviewBack(false);
    }
    setStep(next);
  };

  useEffect(() => {
    document.querySelector(".deck-creator-stage")?.scrollTo({ top: 0 });
  }, [step]);

  useEffect(() => {
    if (step !== 3 || !previewPair) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") { event.preventDefault(); setPreviewBack((value) => !value); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setPreviewIndex((index) => Math.max(0, index - 1)); setPreviewBack(false); }
      if (event.key === "ArrowRight" || event.key === "1" || event.key === "2") { event.preventDefault(); setPreviewIndex((index) => Math.min(completePairs.length - 1, index + 1)); setPreviewBack(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, previewPair, completePairs.length, direction]);

  const updatePair = (index: number, field: "front" | "back", value: string) => setPairs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  const addPair = () => {
    const nextIndex = pairs.length;
    setPairs((current) => [...current, { front: "", back: "" }]);
    window.setTimeout(() => document.getElementById(`front-${nextIndex}`)?.focus(), 0);
  };
  const deletePair = (index: number) => {
    const pairKey = pairs[index]?.id ?? `draft-${index}`;
    setDeletingPairKey(pairKey);
    window.setTimeout(() => {
      setPairs((current) => current.length === 1 ? [{ front: "", back: "" }] : current.filter((_, itemIndex) => itemIndex !== index));
      setDeletingPairKey(null);
    }, 280);
  };
  const importMarkdown = async (file?: File) => {
    if (!file || !/\.md$/i.test(file.name)) { setImportMessage("Puoi importare soltanto un file .md."); return; }
    const parsed: DraftPair[] = parseMarkdownFlashcards(await file.text());
    if (!parsed.length) { setImportMessage("Nessuna coppia valida. Ogni scheda deve contenere termine :: definizione."); return; }
    setPairs(parsed);
    setPreviewIndex(0);
    setImportMessage(`${parsed.length} flashcard importate.`);
  };
  const submit = () => {
    if (!title.trim() || !completePairs.length) return;
    const oldCards = new Map(deck?.cards.map((card) => [card.id, card]) ?? []);
    onSave({ title: title.trim(), description: description.trim(), folderId, color: effectiveColor, pattern, visibility: inheritedPublic ? "public" : visibility, keywordHelp, order, direction, cardColorMode, cardColor, lastStudied: deck?.lastStudied, cards: completePairs.map((item) => { const previous = item.id ? oldCards.get(item.id) : undefined; return { id: item.id ?? makeId("card"), front: normalizeRichText(item.front), back: normalizeRichText(item.back), known: previous?.known ?? 0, missed: previous?.missed ?? 0, pinned: item.pinned ?? previous?.pinned, pinComment: item.pinComment ?? previous?.pinComment ?? "" }; }) }, deck?.id);
  };

  return <div className="creator-layer deck-creator"><header className="creator-header"><button type="button" onClick={() => setAbandonOpen(true)}>Lume</button><div><span>Percorso guidato</span><h2>{deck ? "Modifica set" : "Nuovo set"}</h2></div><button className="round-close" type="button" onClick={() => setAbandonOpen(true)} aria-label="Chiudi">×</button></header><nav className="creator-stepper" aria-label={`Passaggio ${step} di 3`}>{([1, 2, 3] as const).map((number) => <button className={step === number ? "active" : step > number ? "complete" : ""} type="button" key={number} onClick={() => { if (number === 1 || (number === 2 && title.trim()) || (number === 3 && completePairs.length)) goToStep(number); }}><b>{number}</b><span>{number === 1 ? "Dettagli" : number === 2 ? "Flashcards" : "Riepilogo"}</span></button>)}</nav><main className="deck-creator-stage">
    {step === 1 && <div className="deck-details-layout"><section className="creator-fields"><span className="step-number">01</span><h1>Il tuo set, come lo vuoi tu.</h1><p>Scegli dove vive e come appare. Se entra in una cartella, ne eredita il colore.</p><label className="field-clean"><span>Titolo del set</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Es. Storia del design" /></label><label className="field-clean"><span>Descrizione</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Es. Movimenti, oggetti e progettisti" /></label><label className="field-clean"><span>Cartella facoltativa</span><select value={folderId ?? ""} onChange={(event) => setFolderId(event.target.value || null)}><option value="">Nessuna cartella — set indipendente</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select></label>{!selectedFolder && <fieldset className="clean-fieldset"><legend>Colore del set indipendente</legend><div className="color-palette">{colors.map((option) => <button className={color === option ? "selected" : ""} style={{ background: option }} key={option} type="button" onClick={() => { setColor(option); setCardColor(option); }} aria-label={`Colore ${option}`} />)}<label className="custom-color"><input type="color" value={color} onChange={(event) => { setColor(event.target.value); setCardColor(event.target.value); }} /><span>＋</span></label></div></fieldset>}<fieldset className="clean-fieldset"><legend>Decorazione del quaderno</legend><div className="pattern-picker">{patterns.map((option) => <button className={pattern === option.value ? `selected pattern-${option.value}` : `pattern-${option.value}`} type="button" key={option.value} onClick={() => setPattern(option.value)}><i style={{ "--deck": effectiveColor } as React.CSSProperties} /><span>{option.label}</span></button>)}</div></fieldset><fieldset className="clean-fieldset"><legend>Visibilità</legend>{inheritedPublic ? <div className="inherit-note"><strong>Pubblico tramite la cartella</strong><small>Tutto ciò che entra in questa cartella è pubblico.</small></div> : <div className="segmented"><button className={visibility === "private" ? "selected" : ""} type="button" onClick={() => setVisibility("private")}>Privato</button><button className={visibility === "public" ? "selected" : ""} type="button" onClick={() => setVisibility("public")}>Pubblico</button></div>}</fieldset></section><aside className="notebook-preview-column"><span>Anteprima copertina</span><Notebook deck={{ id: "preview", folderId, title: title || "Il tuo set", description: description || "Domande e risposte", color: effectiveColor, pattern, visibility, keywordHelp, order, direction, cardColorMode, cardColor, cards: completePairs.map((item, index) => ({ id: String(index), front: item.front, back: item.back, known: 0, missed: 0 })), createdAt: 0 }} onOpen={() => undefined} /><p>{selectedFolder ? `Il colore segue “${selectedFolder.title}”. Puoi personalizzare il pattern.` : "Questo set è indipendente: colore e pattern sono soltanto suoi."}</p></aside></div>}
    {step === 2 && <div className="card-writing-layout vertical-editor" onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setDragImportActive(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragImportActive(false); }} onDrop={(event) => { event.preventDefault(); setDragImportActive(false); void importMarkdown(event.dataTransfer.files?.[0]); }}><aside className="set-options-panel sticky-options"><div className="readonly-set-title"><span>Titolo del set</span><h2>{title}</h2></div><fieldset className="clean-fieldset"><legend>Ordine predefinito</legend><div className="segmented"><button className={order === "sequential" ? "selected" : ""} type="button" onClick={() => setOrder("sequential")}>In ordine</button><button className={order === "random" ? "selected" : ""} type="button" onClick={() => setOrder("random")}>Casuale</button></div></fieldset><fieldset className="clean-fieldset"><legend>Verso predefinito</legend><div className="segmented"><button className={direction === "front-first" ? "selected" : ""} type="button" onClick={() => setDirection("front-first")}>Fronte prima</button><button className={direction === "back-first" ? "selected" : ""} type="button" onClick={() => setDirection("back-first")}>Retro prima</button></div></fieldset><div className="keyword-option"><label className="toggle-row"><input type="checkbox" checked={keywordHelp} onChange={(event) => setKeywordHelp(event.target.checked)} /><i /><span><b>Keyword Help</b><small>Usa il neretto come indizio.</small></span></label><button className="help-dot" type="button" onClick={() => setKeywordInfoOpen((open) => !open)} aria-label="Come funziona Keyword Help">?</button></div>{keywordInfoOpen && <p className="keyword-info">Durante lo studio, tieni premuta la barra spaziatrice: il testo si sfoca e restano leggibili soltanto le parole messe in neretto.</p>}<button className="llm-set-button" type="button" onClick={() => setPromptOpen(true)}><span>Prepara il set con un LLM</span><small>Visualizza e copia il prompt adatto.</small></button><button className="sidebar-import-button" type="button" onClick={() => fileRef.current?.click()}>↑ Importa o trascina file .md</button><input ref={fileRef} className="sr-only" type="file" accept=".md" onChange={(event) => { void importMarkdown(event.target.files?.[0]); event.currentTarget.value = ""; }} />{importMessage && <p className="import-status">{importMessage}</p>}<button className="delete-all-cards" type="button" onClick={() => setDeleteAllOpen(true)}>Elimina tutte le flashcards</button></aside><section className="card-editor-workspace vertical-card-workspace"><div className="editor-toolbar-title"><div><span>Flashcards</span><strong>{completePairs.length} pronte</strong></div></div><div className="card-pair-list">{pairs.map((pair, index) => <article className={(pair.id ?? `draft-${index}`) === deletingPairKey ? "card-pair-editor removing" : "card-pair-editor"} key={pair.id ?? `draft-${index}`}><header><span>Flashcard {String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => deletePair(index)} aria-label={`Elimina flashcard ${index + 1}`}>×</button></header><RichEditor id={`front-${index}`} label="Fronte" value={pair.front} placeholder="Scrivi la domanda o il concetto principale…" autoFocus={index === 0} onChange={(value) => updatePair(index, "front", value)} onTab={() => document.getElementById(`back-${index}`)?.focus()} /><RichEditor id={`back-${index}`} label="Retro" value={pair.back} placeholder="Scrivi la risposta o la spiegazione…" onChange={(value) => updatePair(index, "back", value)} onTab={() => document.getElementById("add-pair")?.focus()} /></article>)}</div><button id="add-pair" className="add-pair" type="button" onClick={addPair}>＋ Aggiungi un’altra coppia</button></section>{dragImportActive && <div className="md-drop-overlay"><div><strong>Rilascia qui il file .md</strong><span>Le flashcards verranno importate automaticamente.</span></div></div>}</div>}
    {step === 3 && <div className="summary-layout refined-summary"><aside className="summary-data"><span>Riepilogo</span><h2>{title}</h2><dl><div><dt>Ordine</dt><dd>{order === "random" ? "Casuale" : "In ordine"}</dd></div><div><dt>Verso</dt><dd>{direction === "front-first" ? "Fronte → retro" : "Retro → fronte"}</dd></div><div><dt>Keyword Help</dt><dd>{keywordHelp ? "Attivo" : "Disattivo"}</dd></div></dl><fieldset className="clean-fieldset"><legend>Colore delle flashcards</legend><div className="segmented"><button className={cardColorMode === "single" ? "selected" : ""} type="button" onClick={() => setCardColorMode("single")}>Colore fisso</button><button className={cardColorMode === "random" ? "selected" : ""} type="button" onClick={() => setCardColorMode("random")}>Casuale a ogni studio</button></div>{cardColorMode === "single" && <div className="color-palette compact">{cardColors.map((option) => <button className={cardColor === option ? "selected" : ""} style={{ background: option }} key={option} type="button" onClick={() => setCardColor(option)} aria-label={`Colore flashcard ${option}`} />)}</div>}</fieldset></aside><section className="study-simulation"><span className="step-number">03</span><h1>Prova il tuo set.</h1><p>Spazio gira la carta; 1 e 2 passano alla successiva.</p>{previewPair && <div className="summary-card-wrap"><button key={previewIndex} className={previewBack ? "simulation-card flipped" : "simulation-card"} type="button" onClick={() => setPreviewBack((back) => !back)}><span className="simulation-card-inner"><span className="simulation-face simulation-front" style={{ background: theme === "dark" ? darken(cardColorMode === "single" ? cardColor : effectiveColor, 0.46) : tint(cardColorMode === "single" ? cardColor : effectiveColor, 0.86) }}><small>{direction === "front-first" ? "Fronte" : "Retro"}</small><RichText value={previewFirst} /><em>Clicca o premi spazio per girare</em></span><span className="simulation-face simulation-back" style={{ background: theme === "dark" ? darken(cardColorMode === "single" ? cardColor : effectiveColor, 0.3) : tint(cardColorMode === "single" ? cardColor : effectiveColor, 0.72) }}><small>{direction === "front-first" ? "Retro" : "Fronte"}</small><RichText value={previewSecond} /><em>Clicca o premi spazio per girare</em></span></span></button></div>}<div className="simulation-key-legend two"><span><b>1</b> La so</span><span><b>2</b> Non ancora</span></div><div className="simulation-controls"><button type="button" disabled={previewIndex === 0} onClick={() => { setPreviewIndex((index) => Math.max(0, index - 1)); setPreviewBack(false); }}>←</button><span>{previewIndex + 1} di {completePairs.length}</span><button type="button" disabled={previewIndex >= completePairs.length - 1} onClick={() => { setPreviewIndex((index) => Math.min(completePairs.length - 1, index + 1)); setPreviewBack(false); }}>→</button></div><button className="primary-dark save-summary" type="button" onClick={submit}>{deck ? "Salva modifiche" : "Salva il set"}</button></section></div>}
  </main>{promptOpen && <LLMPromptModal keywordHelp={keywordHelp} onClose={() => setPromptOpen(false)} onCopied={setImportMessage} />}{deleteAllOpen && <DeleteCardsConfirmModal count={pairs.filter((pair) => plainText(pair.front) || plainText(pair.back)).length} onClose={() => setDeleteAllOpen(false)} onConfirm={() => { setPairs([{ front: "", back: "" }]); setDeleteAllOpen(false); }} />}{abandonOpen && <AbandonCreatorModal onClose={() => setAbandonOpen(false)} onConfirm={onClose} />}</div>;
}

function AbandonCreatorModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop-clean" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="delete-confirm-modal abandon-confirm-modal"><button className="round-close" type="button" onClick={onClose}>×</button><h2>Abbandonare la creazione del set?</h2><p>Le modifiche non salvate e le flashcards inserite in questa sessione andranno perse.</p><div><button className="outline-button" type="button" onClick={onClose}>Riprendi</button><button className="destructive-button" type="button" onClick={onConfirm}>Abbandona</button></div></section></div>;
}

function DeleteCardsConfirmModal({ count, onConfirm, onClose }: { count: number; onConfirm: () => void; onClose: () => void }) {
  return <div className="modal-backdrop-clean" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="delete-confirm-modal"><button className="round-close" type="button" onClick={onClose}>×</button><h2>Eliminare tutte le flashcards?</h2><p>Verranno eliminate {count} flashcard da questo set. Il set resterà disponibile ma sarà vuoto.</p><div><button className="outline-button" type="button" onClick={onClose}>Annulla</button><button className="destructive-button" type="button" onClick={onConfirm}>Elimina le flashcards</button></div></section></div>;
}

function RichEditor({ id, label, value, placeholder, autoFocus, onChange, onTab }: { id: string; label: string; value: string; placeholder: string; autoFocus?: boolean; onChange: (value: string) => void; onTab?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [id, value]);
  useEffect(() => {
    if (autoFocus) window.setTimeout(() => ref.current?.focus(), 0);
  }, [id, autoFocus]);
  const format = (command: "bold" | "italic" | "underline") => {
    ref.current?.focus();
    document.execCommand(command);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  return (
    <div className="rich-editor-clean"><span>{label}</span><div className="rich-toolbar" aria-label={`Formattazione ${label}`}><button type="button" onMouseDown={(event) => { event.preventDefault(); format("bold"); }}><b>B</b></button><button type="button" onMouseDown={(event) => { event.preventDefault(); format("italic"); }}><i>I</i></button><button type="button" onMouseDown={(event) => { event.preventDefault(); format("underline"); }}><u>U</u></button></div><div id={id} ref={ref} className="rich-area" contentEditable suppressContentEditableWarning data-placeholder={placeholder} role="textbox" aria-label={label} onInput={(event) => onChange(event.currentTarget.innerHTML)} onKeyDown={(event) => { if (event.key === "Tab" && onTab) { event.preventDefault(); onTab(); } }} /></div>
  );
}

function RichText({ value }: { value: string }) {
  return <span className="rich-text" dangerouslySetInnerHTML={{ __html: value }} />;
}

function studyFontStack(font: StudyFont) {
  if (font === "comic") return '"Comic Sans MS", "Comic Sans", cursive';
  if (font === "helvetica") return 'Helvetica, Arial, sans-serif';
  if (font === "serif") return 'Georgia, "Times New Roman", serif';
  if (font === "mono") return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  return 'var(--font)';
}

function studyTextSize(value: string) {
  const length = plainText(value).length;
  if (length > 900) return "15px";
  if (length > 650) return "17px";
  if (length > 450) return "19px";
  if (length > 300) return "22px";
  if (length > 190) return "27px";
  if (length > 110) return "33px";
  return "clamp(34px, 4vw, 52px)";
}

function studyDifficultyScore(state: StudyState, cardId: string) {
  return (state.missesByCard[cardId] ?? 0) * 2 + (state.attemptsByCard[cardId] ?? 0);
}

function difficultStudyCardIds(state: StudyState) {
  return Array.from(new Set(state.initialCardIds))
    .filter((cardId) => (state.missesByCard[cardId] ?? 0) > 0)
    .sort((a, b) => studyDifficultyScore(state, b) - studyDifficultyScore(state, a));
}

function StudyScreen({ theme, state, entry, library, showKeywords, settingsOpen, onFlip, onKnow, onMiss, onPin, onPinComment, onOpenSettings, onCloseSettings, onSettingsChange, onKeywords, onChooseMode, onRestartMissed, onRestartAll, onExit }: { theme: "light" | "dark"; state: StudyState; entry: { deck: Deck; card: Card } | null; library: Deck[]; showKeywords: boolean; settingsOpen: boolean; onFlip: () => void; onKnow: () => void; onMiss: () => void; onPin: () => void; onPinComment: (value: string) => void; onOpenSettings: () => void; onCloseSettings: () => void; onSettingsChange: (changes: Partial<Pick<StudyState, "font" | "order" | "direction">>) => void; onKeywords: () => void; onChooseMode: (mode: StudyMode) => void; onRestartMissed: () => void; onRestartAll: () => void; onExit: () => void }) {
  const firstDeck = library.find((deck) => state.deckIds.includes(deck.id));
  const baseColor = state.cardColor || firstDeck?.color || "#91aaa4";
  const difficultIds = difficultStudyCardIds(state);
  const totalCards = new Set(state.initialCardIds).size;
  const testScore = totalCards ? Math.round((state.learnedIds.length / totalCards) * 100) : 0;
  const difficultCards = difficultIds.slice(0, 3).flatMap((cardId) => {
    for (const deckId of state.deckIds) {
      const deck = library.find((item) => item.id === deckId);
      const card = deck?.cards.find((item) => item.id === cardId);
      if (deck && card) return [{ deck, card }];
    }
    return [];
  });

  if (!state.mode) {
    return (
      <div className="study-mode-screen" style={{ "--study": baseColor } as React.CSSProperties}>
        <header>
          <button className="study-exit" type="button" onClick={onExit}>× Esci</button>
          <strong>{firstDeck?.title ?? "Sessione di studio"}</strong>
          <button className="study-settings-button" type="button" onClick={onOpenSettings} aria-label="Impostazioni di studio"><i><b /><b /><b /></i><span>Impostazioni</span></button>
        </header>
        <main>
          <span className="eyebrow">Nuova sessione</span>
          <h1>Come vuoi studiare?</h1>
          <p>Scegli il ritmo più adatto a questo ripasso. Potrai sempre cambiare modalità alla prossima sessione.</p>
          <div className="study-mode-grid">
            <button className="study-mode-card learn" type="button" onClick={() => onChooseMode("learn")}>
              <span>01 · Impara</span>
              <strong>Ripeti finché resta.</strong>
              <p>Se non sai una carta, ricompare dopo 3 altre carte. Finisci solo quando le hai ricordate tutte.</p>
              <em>Memorizzazione attiva →</em>
            </button>
            <button className="study-mode-card test" type="button" onClick={() => onChooseMode("test")}>
              <span>02 · Test</span>
              <strong>Una risposta, poi il risultato.</strong>
              <p>Ogni carta appare una volta. Alla fine trovi il punteggio, gli errori e le carte da ripassare.</p>
              <em>Verifica finale →</em>
            </button>
          </div>
          <button className="study-mode-settings" type="button" onClick={onOpenSettings}>Ordine, verso e font</button>
        </main>
        {settingsOpen && <StudySettings state={state} onChange={onSettingsChange} onClose={onCloseSettings} />}
      </div>
    );
  }

  if (state.complete) {
    const isTest = state.mode === "test";
    return (
      <div className="study-screen complete study-results" style={{ "--study": baseColor } as React.CSSProperties}>
        <button className="study-exit" type="button" onClick={onExit}>× Esci</button>
        <section>
          <span>{isTest ? "Test completato" : "Sessione Impara completata"}</span>
          {isTest ? <><strong className="study-score">{testScore}%</strong><h1>{state.learnedIds.length} risposte corrette su {totalCards}.</h1></> : <h1>Hai imparato tutte le {totalCards} carte.</h1>}
          <div className="study-result-metrics">
            <article><span>{isTest ? "Corrette" : "Tentativi"}</span><strong>{isTest ? state.learnedIds.length : state.attempts}</strong></article>
            <article><span>Più difficili</span><strong>{difficultIds.length}</strong></article>
            <article><span>Streak migliore</span><strong>{state.bestStreak}</strong></article>
          </div>
          {difficultCards.length > 0 && <div className="study-difficult-list"><span>Le più difficili della sessione</span><ol>{difficultCards.map(({ deck, card }) => <li key={card.id}><div><RichText value={card.front} /><small>{deck.title}</small></div><strong>{state.missesByCard[card.id]} {state.missesByCard[card.id] === 1 ? "errore" : "errori"}</strong></li>)}</ol></div>}
          <div className="study-result-actions">
            {difficultIds.length > 0 && <button className="primary-dark" type="button" onClick={onRestartMissed}>{isTest ? "Impara dagli errori" : "Ripassa le più difficili"} ({difficultIds.length})</button>}
            <button className="outline-button" type="button" onClick={onRestartAll}>Rifai {isTest ? "il test" : "la sessione"}</button>
            <button className="text-button" type="button" onClick={onExit}>Torna al mio spazio</button>
          </div>
        </section>
      </div>
    );
  }

  if (!entry) return null;
  const keywords = extractKeywords(entry.card.back);
  const firstValue = state.direction === "front-first" ? entry.card.front : entry.card.back;
  const secondValue = state.direction === "front-first" ? entry.card.back : entry.card.front;
  const cardColor = theme === "dark" ? darken(baseColor, 0.46) : tint(baseColor, 0.84);
  const secondColor = theme === "dark" ? darken(baseColor, 0.30) : tint(baseColor, 0.72);
  const modeLabel = state.mode === "learn" ? "Impara" : "Test";
  return (
    <div className="study-screen" style={{ "--study": baseColor, "--study-soft": cardColor, "--study-back": secondColor, "--study-font": studyFontStack(state.font) } as React.CSSProperties}>
      <header><button className="study-exit" type="button" onClick={onExit}>× Esci</button><div><strong>{entry.deck.title}</strong><span>{modeLabel} · {state.index + 1} / {state.cardIds.length}</span></div><div className="study-session-meta"><span>{state.streak} streak</span><span>{state.mode === "learn" ? `${state.learnedIds.length} imparate · ${difficultIds.length} difficili` : `${state.attempts} risposte · ${difficultIds.length} errori`}</span><button className={entry.card.pinned ? "pin-button pinned" : "pin-button"} type="button" onClick={onPin} aria-label={entry.card.pinned ? "Rimuovi pin dalla flashcard" : "Metti un pin alla flashcard"}><i /> <span>{entry.card.pinned ? "Con pin" : "Pin"}</span></button><button className="study-settings-button" type="button" onClick={onOpenSettings} aria-label="Impostazioni di studio"><i><b /><b /><b /></i><span>Impostazioni</span></button></div></header>
      <main><p>{state.mode === "learn" ? "La ricordi ora?" : "Conoscevi la risposta?"}</p><button key={`${entry.card.id}-${state.index}`} className={state.flipped ? "study-card flipped" : "study-card"} type="button" onClick={onFlip}><span className="study-card-inner"><span className="study-face study-front" style={{ "--card-font-size": studyTextSize(firstValue) } as React.CSSProperties}><small>{state.direction === "front-first" ? "Domanda" : "Risposta"}</small><RichText value={firstValue} /><em>Spazio per girare</em>{entry.card.pinned && <i className="card-pin-indicator">Da rivedere</i>}</span><span className="study-face study-back" style={{ "--card-font-size": studyTextSize(secondValue) } as React.CSSProperties}><small>{state.direction === "front-first" ? "Risposta" : "Domanda"}</small><RichText value={secondValue} /><em>Spazio per girare</em>{entry.card.pinned && <i className="card-pin-indicator">Da rivedere</i>}</span></span>{showKeywords && keywords.length > 0 && <span className="keyword-overlay" style={{ "--keyword-font-size": studyTextSize(entry.card.back) } as React.CSSProperties}><small>Keywords</small><RichText value={entry.card.back} /><em>Rilascia la barra spaziatrice per nasconderle</em></span>}</button>{entry.card.pinned && <label className="study-pin-note"><span>Nota per la revisione</span><input value={entry.card.pinComment ?? ""} onChange={(event) => onPinComment(event.target.value)} placeholder="Es. controllare la definizione o correggere un errore…" /></label>}<div className="study-sequence-note"><span>{state.mode === "learn" ? "Le carte non ricordate tornano dopo 3 altre carte." : "Ogni carta conta una sola volta nel punteggio."}</span><strong>{state.mode === "learn" ? `${state.learnedIds.length}/${totalCards} imparate` : `${state.attempts}/${totalCards} risposte`}</strong></div><div className="study-actions"><button type="button" onClick={onKnow}><b>1</b><span><strong>La so</strong><small>{state.mode === "learn" ? "Questa carta è imparata" : "Segna come corretta"}</small></span></button><button type="button" onClick={onMiss}><b>2</b><span><strong>Non la so</strong><small>{state.mode === "learn" ? "Torna dopo 3 altre carte" : "Segna come errore"}</small></span></button></div>{keywords.length > 0 && <button className="keyword-button" type="button" onClick={onKeywords}>Tieni premuta la barra spaziatrice · Mostra keywords</button>}<p className="study-shortcuts">Spazio gira · 1 La so · 2 Non la so · 3 Pin</p></main>
      {settingsOpen && <StudySettings state={state} onChange={onSettingsChange} onClose={onCloseSettings} />}
    </div>
  );
}

function StudySettings({ state, onChange, onClose }: { state: StudyState; onChange: (changes: Partial<Pick<StudyState, "font" | "order" | "direction">>) => void; onClose: () => void }) {
  return <div className="study-settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="study-settings-panel"><button className="round-close" type="button" onClick={onClose}>×</button><span>Impostazioni di studio</span><h2>Adatta le carte al tuo modo di leggere.</h2><label><span>Font delle flashcards</span><select value={state.font} onChange={(event) => onChange({ font: event.target.value as StudyFont })}><option value="current">Attuale</option><option value="comic">Comic Sans DM</option><option value="helvetica">Helvetica</option><option value="serif">Serif</option><option value="mono">Mono</option></select></label><fieldset><legend>Ordine delle carte</legend><div className="segmented"><button className={state.order === "sequential" ? "selected" : ""} type="button" onClick={() => onChange({ order: "sequential" })}>Come create</button><button className={state.order === "random" ? "selected" : ""} type="button" onClick={() => onChange({ order: "random" })}>Casuale</button></div></fieldset><fieldset><legend>Lato mostrato per primo</legend><div className="segmented"><button className={state.direction === "front-first" ? "selected" : ""} type="button" onClick={() => onChange({ direction: "front-first" })}>Fronte</button><button className={state.direction === "back-first" ? "selected" : ""} type="button" onClick={() => onChange({ direction: "back-first" })}>Retro</button></div></fieldset><button className="primary-dark" type="button" onClick={onClose}>Applica e continua</button></section></div>;
}

function DeckTransferModal({ deck, folder, onMove, onCopy, onClose }: { deck?: Deck; folder?: Folder; onMove: () => void; onCopy: () => void; onClose: () => void }) {
  if (!deck || !folder) return null;
  return <div className="modal-backdrop-clean"><section className="deck-transfer-modal"><button className="round-close" type="button" onClick={onClose}>×</button><span>Sposta o crea una copia</span><h2>Portare “{deck.title}” dentro “{folder.title}”?</h2><p>Puoi spostare il set originale oppure crearne una copia indipendente nella sottocartella.</p><div><button className="outline-button" type="button" onClick={onCopy}>Crea una copia</button><button className="primary-dark" type="button" onClick={onMove}>Sposta il set</button></div></section></div>;
}

function FolderPickerModal({ folders, onSelect, onClose }: { folders: Folder[]; onSelect: (folderId: string | null) => void; onClose: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set(folders.filter((folder) => !folder.parentId).map((folder) => folder.id)));
  const renderLevel = (parentId: string | null, depth = 0): React.ReactNode => folders.filter((folder) => folder.parentId === parentId).map((folder) => {
    const hasChildren = folders.some((item) => item.parentId === folder.id);
    const expanded = open.has(folder.id);
    return <div className="picker-tree-group" key={folder.id}><div className="picker-tree-row" style={{ "--picker-depth": depth } as React.CSSProperties}><button className="picker-chevron" type="button" disabled={!hasChildren} onClick={() => setOpen((current) => { const next = new Set(current); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}>{hasChildren ? (expanded ? "⌄" : "›") : ""}</button><button className="picker-destination" type="button" onClick={() => onSelect(folder.id)}><i style={{ "--folder": folder.color } as React.CSSProperties} /><span>{folder.title}</span></button></div>{expanded && renderLevel(folder.id, depth + 1)}</div>;
  });
  return <div className="modal-backdrop-clean" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="folder-picker-modal"><button className="round-close" type="button" onClick={onClose}>×</button><span>Sposta i set</span><h2>Scegli la cartella di destinazione.</h2><button className="picker-root" type="button" onClick={() => onSelect(null)}>Il mio spazio · senza cartella</button><div className="folder-picker-tree">{renderLevel(null)}</div></section></div>;
}

function DeleteConfirmModal({ request, onConfirm, onClose }: { request: DeleteRequest; onConfirm: () => void; onClose: () => void }) {
  return <div className="modal-backdrop-clean" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="delete-confirm-modal"><button className="round-close" type="button" onClick={onClose}>×</button><h2>{request.title}</h2><p>L’operazione eliminerà anche tutto il contenuto incluso e non può essere annullata.</p><dl><div><dt>Sottocartelle</dt><dd>{request.subfolderCount}</dd></div><div><dt>Set di flashcards</dt><dd>{request.deckCount}</dd></div></dl><div><button className="outline-button" type="button" onClick={onClose}>Annulla</button><button className="destructive-button" type="button" onClick={onConfirm}>Elimina definitivamente</button></div></section></div>;
}

function FocusSetup({ minutes, onMinutes, onStart, onClose }: { minutes: number; onMinutes: (minutes: number) => void; onStart: () => void; onClose: () => void }) {
  return <div className="modal-backdrop-clean"><section className="focus-setup"><button className="round-close" type="button" onClick={onClose}>×</button><h2>Quanto durerà la tua candela?</h2><p>Il tempo scelto indica quanto impiegherà la candela a consumarsi completamente mentre studi senza distrazioni.</p><div className="minute-options">{[15, 25, 45, 60].map((option) => <button className={minutes === option ? "selected" : ""} type="button" key={option} onClick={() => onMinutes(option)}><strong>{option}</strong><span>min</span></button>)}</div><label className="custom-focus-time"><span>Tempo di consumo personalizzato</span><div><input type="number" min="1" max="240" value={minutes} onChange={(event) => onMinutes(Math.min(240, Math.max(1, Number(event.target.value) || 1)))} /><span>minuti</span></div></label><button className="primary-dark" type="button" onClick={onStart}>Accendi la candela →</button></section></div>;
}

function FocusScreen({ remaining, duration, visible, paused, finished, onPause, onExit }: { remaining: number; duration: number; visible: boolean; paused: boolean; finished: boolean; onPause: () => void; onExit: () => void }) {
  const progress = Math.max(0, remaining / duration);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return <div className={finished ? "focus-screen finished" : "focus-screen"}><div className={visible ? "focus-time" : "focus-time hidden"}><span>{finished ? "La candela si è consumata." : "Studia senza distrazioni."}</span><strong>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</strong></div><div className="graphic-candle" style={{ "--wax-progress": progress } as React.CSSProperties}><span className="wax"><span className="candle-moving-head"><span className="candle-glow" /><span className="flame"><i /></span><span className="wick" /></span><i /></span><span className="smoke"><i /><i /><i /></span><span className="candle-shadow" /></div><small className="focus-hint">Premi la barra spaziatrice per nascondere il timer</small><div className="focus-controls">{!finished && <button type="button" onClick={onPause}>{paused ? "Riprendi" : "Pausa"}</button>}<button type="button" onClick={onExit}>Esci</button></div></div>;
}

function BreathingScreen({ elapsed, onExit }: { elapsed: number; onExit: () => void }) {
  const cycle = Math.min(10, Math.floor(elapsed / 8000) + 1);
  const inCycle = elapsed % 8000;
  const inhale = inCycle < 4000;
  const seconds = Math.max(1, Math.ceil((4000 - (inCycle % 4000)) / 1000));
  return <div className="breathing-screen"><header><button type="button" onClick={onExit}>Esci</button></header><section className="breathing-copy"><strong>{seconds} secondi</strong><span>{cycle} di 10</span><p>{inhale ? "Inspira lentamente." : "Lascia andare lentamente."}</p></section><div className={inhale ? "breathing-orbit inhale" : "breathing-orbit exhale"}><i /><i /><i /><span className="tiny-candle"><b /><em /></span></div><div className="breath-progress">{Array.from({ length: 10 }, (_, index) => index + 1).map((item) => <i className={item <= cycle ? "done" : ""} key={item} />)}</div></div>;
}

function UsernameGate({ account, busy, notice, onSave }: { account: CloudAccount; busy: boolean; notice: string; onSave: (value: string) => void | Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const username = validateUsername(value);
      setError("");
      void onSave(username);
    } catch (problem) {
      setError(friendlyCloudError(problem));
    }
  };
  return <div className="modal-backdrop-clean username-gate"><form onSubmit={submit}><span>Completa il profilo</span><h2>Scegli il tuo nome utente.</h2><p>Sarà pubblico in Esplora e nelle classi. Nelle classi, soltanto gli altri membri potranno vedere anche l’email <strong>{account.email}</strong>.</p><label><span>Nome utente univoco</span><div><b>@</b><input autoFocus value={value} onChange={(event) => setValue(event.target.value.toLowerCase())} autoComplete="username" placeholder="nomeutente" maxLength={24} /></div></label><small>3–24 caratteri: lettere minuscole, numeri, punto, trattino o underscore.</small>{(error || notice) && <p className="account-message error">{error || notice}</p>}<button className="primary-dark" type="submit" disabled={busy || !value.trim()}>{busy ? "Controllo…" : "Salva nome utente"}</button></form></div>;
}

function NotificationCenter({ notifications, onAction, onClose }: { notifications: LumeNotification[]; onAction: (notification: LumeNotification, action: "read" | "approve" | "reject" | "copy") => void; onClose: () => void }) {
  return <div className="notification-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="notification-center"><header><div><span>Aggiornamenti</span><h2>Notifiche</h2></div><button type="button" onClick={onClose}>×</button></header><div className="notification-list">{notifications.map((notification) => <article className={notification.read ? "read" : ""} key={notification.id}><div><span>{notification.title}</span><small>{new Date(notification.createdAt).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}</small></div><p>{notification.message}</p><footer>{notification.type === "copy_request" && !notification.read ? <><button type="button" onClick={() => onAction(notification, "reject")}>Non approvare</button><button className="primary-dark" type="button" onClick={() => onAction(notification, "approve")}>Autorizza copia</button></> : notification.type === "copy_approved" && !notification.read ? <button className="primary-dark" type="button" onClick={() => onAction(notification, "copy")}>Aggiungi al mio spazio</button> : !notification.read ? <button type="button" onClick={() => onAction(notification, "read")}>Segna come letta</button> : null}</footer></article>)}{!notifications.length && <div className="notification-empty"><strong>Nessuna notifica.</strong><p>Qui appariranno inviti, nuovi materiali, commenti, richieste di copia e valutazioni.</p></div>}</div></aside></div>;
}

function Preferences({ theme, account, cloudStatus, busy, notice, onTheme, onGoogle, onEmailLogin, onEmailRegister, onPasswordReset, onLogout, onClose }: { theme: "light" | "dark"; account: CloudAccount | null; cloudStatus: CloudStatus; busy: boolean; notice: string; onTheme: (theme: "light" | "dark") => void; onGoogle: () => void | Promise<void>; onEmailLogin: (email: string, password: string) => void | Promise<void>; onEmailRegister: (name: string, email: string, password: string) => void | Promise<void>; onPasswordReset: (email: string) => void | Promise<void>; onLogout: () => void | Promise<void>; onClose: () => void }) {
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const statusText = cloudStatus === "synced" ? "Tutto salvato online" : cloudStatus === "syncing" ? "Salvataggio in corso…" : cloudStatus === "loading" || cloudStatus === "checking" ? "Collegamento in corso…" : cloudStatus === "error" ? "Sincronizzazione da controllare" : "Accedi per attivare il salvataggio online";
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!email.trim() || !password) {
      setFormError("Inserisci email e password.");
      return;
    }
    if (registering && password.length < 6) {
      setFormError("La password deve contenere almeno 6 caratteri.");
      return;
    }
    if (registering) void onEmailRegister(name, email, password);
    else void onEmailLogin(email, password);
  };
  return <div className="modal-backdrop-clean" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="preferences-modal account-preferences"><button className="round-close" type="button" onClick={onClose}>×</button><span>Preferenze</span><h2>{account ? "Il tuo spazio, sempre con te." : "Salva e pubblica con il tuo account."}</h2>
    {account ? <section className="account-card"><div className={account.photoURL ? "account-avatar has-photo" : "account-avatar"} style={account.photoURL ? { backgroundImage: `url(${account.photoURL})` } : undefined}>{!account.photoURL && <span>{(account.displayName || account.email || "L").slice(0, 1).toUpperCase()}</span>}</div><div><strong>{account.displayName || "Account Lume"}</strong><p>{account.email}</p><small className={`cloud-state ${cloudStatus}`}>{statusText}</small></div><button className="outline-button" type="button" disabled={busy} onClick={() => { void onLogout(); }}>Esci dall’account</button></section> : <section className="account-login"><button className="google-login" type="button" disabled={busy || cloudStatus === "unavailable"} onClick={() => { void onGoogle(); }}><b>G</b>Continua con Google</button><div className="login-divider"><span>oppure con email</span></div><form onSubmit={submit}>{registering && <label><span>Nome utente</span><input value={name} onChange={(event) => setName(event.target.value.toLowerCase())} autoComplete="username" placeholder="nomeutente" /></label>}<label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="nome@email.it" /></label><label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registering ? "new-password" : "current-password"} placeholder="Almeno 6 caratteri" /></label>{formError && <p className="account-message error">{formError}</p>}<button className="primary-dark account-submit" type="submit" disabled={busy || cloudStatus === "unavailable"}>{busy ? "Attendi…" : registering ? "Crea account" : "Accedi"}</button></form><div className="account-links"><button type="button" onClick={() => { setRegistering((value) => !value); setFormError(""); }}>{registering ? "Hai già un account? Accedi" : "Non hai un account? Crealo"}</button>{!registering && <button type="button" disabled={!email.trim() || busy} onClick={() => { if (email.trim()) void onPasswordReset(email); }}>Password dimenticata?</button>}</div></section>}
    {notice && <p className="account-message" aria-live="polite">{notice}</p>}
    {cloudStatus === "unavailable" && <p className="account-message error">Il salvataggio online non è configurato in questa versione del sito.</p>}
    <div className="preference-separator" /><label className="appearance-field"><span>Aspetto</span><select value={theme} onChange={(event) => onTheme(event.target.value as "light" | "dark")}><option value="light">Modalità chiara</option><option value="dark">Modalità scura</option></select></label><div className="preference-note"><strong>{account ? "Sincronizzazione cloud attiva" : "Puoi continuare anche senza account"}</strong><p>{account ? "Cartelle, set, progressi e preferenze di studio vengono salvati nel tuo account. I set pubblici appaiono nella biblioteca Esplora." : "Senza accesso i dati restano soltanto su questo dispositivo e non puoi votare i set pubblici."}</p></div>
  </section></div>;
}

function MobileNav({ view, onHome, onFolders, onExplore, onClasses, onCreate }: { view: View; onHome: () => void; onFolders: () => void; onExplore: () => void; onClasses: () => void; onCreate: () => void }) {
  return <nav className="mobile-nav-new"><button className={view.name === "home" ? "active" : ""} type="button" onClick={onHome}><i className="icon-home" /><span>Spazio</span></button><button className={view.name === "folders" || view.name === "folder" ? "active" : ""} type="button" onClick={onFolders}><i className="icon-folder-line" /><span>Cartelle</span></button><button className="mobile-create" type="button" onClick={onCreate}>＋</button><button className={view.name === "explore" ? "active" : ""} type="button" onClick={onExplore}><i className="icon-search" /><span>Esplora</span></button><button className={view.name === "classes" || view.name === "class" ? "active" : ""} type="button" onClick={onClasses}><i className="icon-classes" /><span>Classi</span></button></nav>;
}
