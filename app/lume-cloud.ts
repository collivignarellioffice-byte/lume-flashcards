import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  increment,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

export type CloudAccount = {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
};

export type CloudFolder = {
  id: string;
  parentId: string | null;
  title: string;
  color: string;
  visibility: "private" | "public";
  createdAt: number;
};

export type CloudCard = {
  id: string;
  position?: number;
  front: string;
  back: string;
  known: number;
  missed: number;
  pinned?: boolean;
  pinComment?: string;
};

export type CloudDeck = {
  id: string;
  folderId: string | null;
  title: string;
  description: string;
  color: string;
  pattern: string;
  visibility: "private" | "public";
  keywordHelp: boolean;
  order: "sequential" | "random";
  direction: "front-first" | "back-first";
  cardColorMode?: "single" | "random";
  cardColor?: string;
  cards: CloudCard[];
  createdAt: number;
  lastStudied?: number;
};

export type CloudLibrary = {
  folders: CloudFolder[];
  decks: CloudDeck[];
  studyDays: string[];
  focusMinutes: number;
};

export type CloudPublicDeck = CloudDeck & {
  publicId: string;
  sourceDeckId: string;
  ownerId: string;
  ownerName: string;
  score: number;
  ratingsCount: number;
  userVote: -1 | 0 | 1 | 2;
};

type FirebaseServices = {
  auth: ReturnType<typeof getAuth>;
  db: ReturnType<typeof initializeFirestore>;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const configured = Object.values(firebaseConfig).every(Boolean);
let persistenceReady: Promise<void> | null = null;
let serviceCache: FirebaseServices | null = null;

export function cloudIsConfigured() {
  return configured;
}

function services(): FirebaseServices {
  if (!configured) throw new Error("Firebase non è configurato per questa versione del sito.");
  if (serviceCache) return serviceCache;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  if (!persistenceReady) {
    persistenceReady = setPersistence(auth, browserLocalPersistence);
  }
  serviceCache = { auth, db: initializeFirestore(app, { ignoreUndefinedProperties: true }) };
  return serviceCache;
}

async function readyServices() {
  const result = services();
  await persistenceReady;
  return result;
}

export async function getCloudDatabase() {
  return (await readyServices()).db;
}

function accountFromUser(user: User): CloudAccount {
  return {
    uid: user.uid,
    email: user.email ?? "",
    displayName: user.displayName ?? user.email?.split("@")[0] ?? "Studente",
    photoURL: user.photoURL,
  };
}

export function observeAccount(callback: (account: CloudAccount | null) => void) {
  if (!configured) {
    callback(null);
    return () => undefined;
  }
  const { auth } = services();
  return onAuthStateChanged(auth, (user) => callback(user ? accountFromUser(user) : null));
}

export async function loginWithGoogle() {
  const { auth } = await readyServices();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  return accountFromUser(credential.user);
}

export async function loginWithEmail(email: string, password: string) {
  const { auth } = await readyServices();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return accountFromUser(credential.user);
}

export async function registerWithEmail(name: string, email: string, password: string) {
  const { auth } = await readyServices();
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
  return accountFromUser(credential.user);
}

export async function resetAccountPassword(email: string) {
  const { auth } = await readyServices();
  await sendPasswordResetEmail(auth, email.trim());
}

export async function logoutAccount() {
  const { auth } = await readyServices();
  await signOut(auth);
}

const emptyLibrary = (): CloudLibrary => ({ folders: [], decks: [], studyDays: [], focusMinutes: 25 });

function deckMeta(deck: CloudDeck) {
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
    createdAt: deck.createdAt,
    lastStudied: deck.lastStudied,
  };
}

function publicDeckMeta(deck: CloudDeck) {
  const meta = deckMeta(deck);
  return {
    id: meta.id,
    folderId: null,
    title: meta.title,
    description: meta.description,
    color: meta.color,
    pattern: meta.pattern,
    visibility: "public" as const,
    keywordHelp: meta.keywordHelp,
    order: meta.order,
    direction: meta.direction,
    cardColorMode: meta.cardColorMode,
    cardColor: meta.cardColor,
    createdAt: meta.createdAt,
  };
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function commitOperations(db: ReturnType<typeof initializeFirestore>, operations: Array<(batch: ReturnType<typeof writeBatch>) => void>) {
  for (let index = 0; index < operations.length; index += 450) {
    const batch = writeBatch(db);
    operations.slice(index, index + 450).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

export async function loadPrivateLibrary(uid: string): Promise<{ exists: boolean; library: CloudLibrary }> {
  const { db } = await readyServices();
  const profileRef = doc(db, "users", uid);
  const [profile, folderDocs, deckDocs] = await Promise.all([
    getDoc(profileRef),
    getDocs(collection(db, "users", uid, "folders")),
    getDocs(collection(db, "users", uid, "decks")),
  ]);
  const data = profile.data() ?? {};
  const libraryInitialized = data.libraryInitialized === true;
  if (!libraryInitialized && folderDocs.empty && deckDocs.empty) return { exists: false, library: emptyLibrary() };

  const decks = await Promise.all(deckDocs.docs.map(async (deckDocument) => {
    const cardDocs = await getDocs(collection(db, "users", uid, "decks", deckDocument.id, "cards"));
    return {
      ...(deckDocument.data() as Omit<CloudDeck, "id" | "cards">),
      id: deckDocument.id,
      cards: cardDocs.docs
        .map((cardDocument) => ({ ...(cardDocument.data() as Omit<CloudCard, "id">), id: cardDocument.id }))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    } as CloudDeck;
  }));
  return {
    exists: true,
    library: {
      folders: folderDocs.docs.map((folderDocument) => ({ ...(folderDocument.data() as Omit<CloudFolder, "id">), id: folderDocument.id })),
      decks,
      studyDays: Array.isArray(data.studyDays) ? data.studyDays.filter((item): item is string => typeof item === "string") : [],
      focusMinutes: typeof data.focusMinutes === "number" ? data.focusMinutes : 25,
    },
  };
}

export async function syncPrivateLibrary(account: CloudAccount, previous: CloudLibrary | null, next: CloudLibrary) {
  const { db } = await readyServices();
  const before = previous ?? emptyLibrary();
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const previousFolders = new Map(before.folders.map((folder) => [folder.id, folder]));
  const nextFolders = new Map(next.folders.map((folder) => [folder.id, folder]));
  const previousDecks = new Map(before.decks.map((deck) => [deck.id, deck]));
  const nextDecks = new Map(next.decks.map((deck) => [deck.id, deck]));

  nextFolders.forEach((folder, id) => {
    if (!same(previousFolders.get(id), folder)) operations.push((batch) => batch.set(doc(db, "users", account.uid, "folders", id), folder));
  });
  previousFolders.forEach((_folder, id) => {
    if (!nextFolders.has(id)) operations.push((batch) => batch.delete(doc(db, "users", account.uid, "folders", id)));
  });

  nextDecks.forEach((deck, id) => {
    const oldDeck = previousDecks.get(id);
    if (!same(oldDeck ? deckMeta(oldDeck) : undefined, deckMeta(deck))) {
      operations.push((batch) => batch.set(doc(db, "users", account.uid, "decks", id), deckMeta(deck)));
    }
    const oldCards = new Map((oldDeck?.cards ?? []).map((card) => [card.id, card]));
    const newCards = new Map(deck.cards.map((card) => [card.id, card]));
    deck.cards.forEach((card, position) => {
      const cardWithPosition = { ...card, position };
      if (!same(oldCards.get(card.id), cardWithPosition)) operations.push((batch) => batch.set(doc(db, "users", account.uid, "decks", id, "cards", card.id), cardWithPosition));
    });
    oldCards.forEach((_card, cardId) => {
      if (!newCards.has(cardId)) operations.push((batch) => batch.delete(doc(db, "users", account.uid, "decks", id, "cards", cardId)));
    });
  });
  previousDecks.forEach((deck, id) => {
    if (nextDecks.has(id)) return;
    deck.cards.forEach((card) => operations.push((batch) => batch.delete(doc(db, "users", account.uid, "decks", id, "cards", card.id))));
    operations.push((batch) => batch.delete(doc(db, "users", account.uid, "decks", id)));
  });

  operations.push((batch) => batch.set(doc(db, "users", account.uid), {
    email: account.email,
    displayName: account.displayName,
    photoURL: account.photoURL,
    libraryInitialized: true,
    studyDays: next.studyDays,
    focusMinutes: next.focusMinutes,
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  await commitOperations(db, operations);
}

function publicId(uid: string, deckId: string) {
  return `${uid}_${deckId}`;
}

export async function syncPublicLibrary(account: CloudAccount, previous: CloudDeck[], next: CloudDeck[]) {
  const { db } = await readyServices();
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const before = new Map(previous.map((deck) => [deck.id, deck]));
  const after = new Map(next.map((deck) => [deck.id, deck]));

  after.forEach((deck, id) => {
    const oldDeck = before.get(id);
    const idPublic = publicId(account.uid, id);
    const nextMeta = {
      ...publicDeckMeta(deck),
      sourceDeckId: deck.id,
      ownerId: account.uid,
      ownerName: account.displayName || account.email.split("@")[0] || "Studente",
      updatedAt: serverTimestamp(),
    };
    if (!oldDeck || !same(publicDeckMeta(oldDeck), publicDeckMeta(deck))) {
      operations.push((batch) => batch.set(doc(db, "publicSets", idPublic), nextMeta));
    }
    const oldCards = new Map((oldDeck?.cards ?? []).map((card) => [card.id, card]));
    const newCards = new Map(deck.cards.map((card) => [card.id, card]));
    deck.cards.forEach((card, position) => {
      const publicCard = { id: card.id, front: card.front, back: card.back, ownerId: account.uid, position };
      const oldPublicCard = oldCards.get(card.id) ? { id: oldCards.get(card.id)?.id, front: oldCards.get(card.id)?.front, back: oldCards.get(card.id)?.back, ownerId: account.uid, position: oldCards.get(card.id)?.position ?? position } : undefined;
      if (!same(oldPublicCard, publicCard)) operations.push((batch) => batch.set(doc(db, "publicSets", idPublic, "cards", card.id), publicCard));
    });
    oldCards.forEach((_card, cardId) => {
      if (!newCards.has(cardId)) operations.push((batch) => batch.delete(doc(db, "publicSets", idPublic, "cards", cardId)));
    });
  });
  before.forEach((deck, id) => {
    if (after.has(id)) return;
    const idPublic = publicId(account.uid, id);
    deck.cards.forEach((card) => operations.push((batch) => batch.delete(doc(db, "publicSets", idPublic, "cards", card.id))));
    operations.push((batch) => batch.delete(doc(db, "publicSets", idPublic)));
  });
  if (operations.length) await commitOperations(db, operations);
}

export async function loadPublicDecks(uid?: string): Promise<CloudPublicDeck[]> {
  const { db } = await readyServices();
  const documents = await getDocs(collection(db, "publicSets"));
  return Promise.all(documents.docs.map(async (setDocument) => {
    const [cards, votes, progress] = await Promise.all([
      getDocs(collection(db, "publicSets", setDocument.id, "cards")),
      getDocs(collection(db, "publicSets", setDocument.id, "votes")),
      uid ? getDocs(collection(db, "users", uid, "publicProgress", setDocument.id, "cards")) : Promise.resolve(null),
    ]);
    const progressByCard = new Map(progress?.docs.map((item) => [item.id, item.data()]) ?? []);
    const voteValues = votes.docs.map((item) => Number(item.data().value)).filter((value): value is -1 | 1 | 2 => value === -1 || value === 1 || value === 2);
    const ownVote = uid ? votes.docs.find((item) => item.id === uid)?.data().value : 0;
    const data = setDocument.data() as Omit<CloudPublicDeck, "id" | "cards" | "publicId" | "score" | "ratingsCount" | "userVote">;
    return {
      ...data,
      id: `public:${setDocument.id}`,
      publicId: setDocument.id,
      cards: cards.docs.map((cardDocument) => {
        const card = cardDocument.data() as Omit<CloudCard, "id" | "known" | "missed">;
        const cardProgress = progressByCard.get(cardDocument.id);
        return {
          ...card,
          id: cardDocument.id,
          known: typeof cardProgress?.known === "number" ? cardProgress.known : 0,
          missed: typeof cardProgress?.missed === "number" ? cardProgress.missed : 0,
        };
      }).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      score: voteValues.reduce((sum, value) => sum + value, 0),
      ratingsCount: voteValues.length,
      userVote: ownVote === -1 || ownVote === 1 || ownVote === 2 ? ownVote : 0,
    } as CloudPublicDeck;
  }));
}

export async function setPublicVote(publicSetId: string, uid: string, value: -1 | 0 | 1 | 2) {
  const { db } = await readyServices();
  const voteRef = doc(db, "publicSets", publicSetId, "votes", uid);
  if (value === 0) await deleteDoc(voteRef);
  else await setDoc(voteRef, { value, userId: uid, updatedAt: serverTimestamp() });
}

export async function savePublicStudyResult(uid: string, publicSetId: string, cardId: string, known: boolean) {
  const { db } = await readyServices();
  await Promise.all([
    setDoc(doc(db, "users", uid, "publicProgress", publicSetId), { lastStudied: serverTimestamp() }, { merge: true }),
    setDoc(doc(db, "users", uid, "publicProgress", publicSetId, "cards", cardId), {
      known: increment(known ? 1 : 0),
      missed: increment(known ? 0 : 1),
      updatedAt: serverTimestamp(),
    }, { merge: true }),
  ]);
}

export function friendlyCloudError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const messages: Record<string, string> = {
    "auth/email-already-in-use": "Esiste già un account con questa email.",
    "auth/invalid-credential": "Email o password non corretti.",
    "auth/invalid-email": "Inserisci un indirizzo email valido.",
    "auth/missing-password": "Inserisci la password.",
    "auth/popup-closed-by-user": "Accesso Google annullato.",
    "auth/popup-blocked": "Il browser ha bloccato la finestra Google. Consenti i popup e riprova.",
    "auth/unauthorized-domain": "Questo indirizzo del sito deve essere autorizzato nelle impostazioni Firebase.",
    "auth/weak-password": "La password deve contenere almeno 6 caratteri.",
    "lume/invalid-username": "Usa da 3 a 24 caratteri: lettere, numeri, punto, trattino o underscore.",
    "lume/username-taken": "Questo nome utente è già stato scelto.",
    "lume/class-not-found": "Il codice della classe non è valido.",
    "lume/request-not-found": "Questa richiesta non è più disponibile.",
    "permission-denied": "Non hai il permesso di completare questa operazione.",
  };
  return messages[code] ?? (error instanceof Error && error.message ? error.message : "Non è stato possibile completare l’operazione. Riprova tra poco.");
}
