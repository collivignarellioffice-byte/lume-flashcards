import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  getCloudDatabase,
  type CloudAccount,
  type CloudCard,
  type CloudDeck,
  type CloudFolder,
} from "./lume-cloud";

export type ClassRole = "owner" | "member";
export type ClassItemKind = "folder" | "deck";
export type AnnotationFilter = "all" | "mine" | "hidden";

export type LumeClass = {
  id: string;
  title: string;
  code: string;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  createdAt: number;
  role: ClassRole;
};

export type ClassMember = {
  uid: string;
  username: string;
  email: string;
  role: ClassRole;
  joinedAt: number;
};

export type ClassFolder = CloudFolder & {
  ownerId: string;
  ownerName: string;
};

export type ClassDeck = CloudDeck & {
  ownerId: string;
  ownerName: string;
};

export type ClassAnnotation = {
  id: string;
  deckId: string;
  cardId: string | null;
  authorId: string;
  authorName: string;
  note: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ClassComment = {
  id: string;
  targetKind: ClassItemKind;
  targetId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
};

export type ClassFavorite = {
  id: string;
  classId: string;
  classTitle: string;
  itemKind: ClassItemKind;
  itemId: string;
  itemTitle: string;
  color: string;
  createdAt: number;
};

export type LumeNotification = {
  id: string;
  type: "class_joined" | "class_content" | "class_comment" | "copy_request" | "copy_approved" | "copy_rejected" | "public_rating";
  title: string;
  message: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  classId?: string;
  itemId?: string;
  itemKind?: ClassItemKind;
  requestId?: string;
  read: boolean;
  createdAt: number;
};

export type CopyRequest = {
  id: string;
  classId: string;
  classTitle: string;
  itemKind: ClassItemKind;
  itemId: string;
  itemTitle: string;
  ownerId: string;
  ownerName: string;
  requesterId: string;
  requesterName: string;
  status: "pending" | "approved" | "rejected" | "copied";
  createdAt: number;
};

export type ClassWorkspace = {
  summary: LumeClass;
  members: ClassMember[];
  folders: ClassFolder[];
  decks: ClassDeck[];
  annotations: ClassAnnotation[];
  comments: ClassComment[];
  favorites: ClassFavorite[];
};

function createId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 16)
    : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function cleanUsername(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function validateUsername(value: string) {
  const username = cleanUsername(value);
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
    throw Object.assign(new Error("Usa da 3 a 24 caratteri: lettere, numeri, punto, trattino o underscore."), { code: "lume/invalid-username" });
  }
  return username;
}

export async function loadUsername(uid: string) {
  const db = await getCloudDatabase();
  const snapshot = await getDoc(doc(db, "users", uid));
  const value = snapshot.data()?.username;
  return typeof value === "string" && value ? value : null;
}

export async function claimUsername(account: CloudAccount, value: string) {
  const username = validateUsername(value);
  const db = await getCloudDatabase();
  const usernameRef = doc(db, "usernames", username);
  const existing = await getDoc(usernameRef);
  if (existing.exists() && existing.data().uid !== account.uid) {
    throw Object.assign(new Error("Questo nome utente è già stato scelto."), { code: "lume/username-taken" });
  }
  const batch = writeBatch(db);
  batch.set(usernameRef, { uid: account.uid, username, createdAt: Date.now() });
  batch.set(doc(db, "users", account.uid), { username, displayName: username, email: account.email, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return username;
}

function createJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 7 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export async function createClass(account: CloudAccount, username: string, title: string) {
  const db = await getCloudDatabase();
  const id = createId("class");
  let code = createJoinCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!(await getDoc(doc(db, "classCodes", code))).exists()) break;
    code = createJoinCode();
  }
  const createdAt = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(db, "classes", id), { title: title.trim(), code, ownerId: account.uid, ownerName: username, memberCount: 1, createdAt });
  batch.set(doc(db, "classCodes", code), { classId: id, title: title.trim(), ownerId: account.uid, ownerName: username, createdAt });
  batch.set(doc(db, "classes", id, "members", account.uid), { uid: account.uid, username, email: account.email, role: "owner", joinedAt: createdAt, joinCode: code });
  batch.set(doc(db, "users", account.uid, "classes", id), { classId: id, role: "owner", joinedAt: createdAt });
  await batch.commit();
  return { id, title: title.trim(), code, ownerId: account.uid, ownerName: username, memberCount: 1, createdAt, role: "owner" } as LumeClass;
}

export async function loadClasses(uid: string) {
  const db = await getCloudDatabase();
  const references = await getDocs(collection(db, "users", uid, "classes"));
  const result = await Promise.all(references.docs.map(async (reference) => {
    const classId = String(reference.data().classId ?? reference.id);
    const snapshot = await getDoc(doc(db, "classes", classId));
    if (!snapshot.exists()) return null;
    return { ...(snapshot.data() as Omit<LumeClass, "id" | "role">), id: classId, role: reference.data().role === "owner" ? "owner" : "member" } as LumeClass;
  }));
  return result.filter((item): item is LumeClass => Boolean(item)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function joinClass(account: CloudAccount, username: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const db = await getCloudDatabase();
  const codeSnapshot = await getDoc(doc(db, "classCodes", code));
  if (!codeSnapshot.exists()) throw Object.assign(new Error("Il codice della classe non è valido."), { code: "lume/class-not-found" });
  const classId = String(codeSnapshot.data().classId);
  const classSnapshot = await getDoc(doc(db, "classes", classId));
  if (!classSnapshot.exists()) throw Object.assign(new Error("Questa classe non è più disponibile."), { code: "lume/class-not-found" });
  const classData = classSnapshot.data() as Omit<LumeClass, "id" | "role">;
  const membershipRef = doc(db, "classes", classId, "members", account.uid);
  const existing = await getDoc(membershipRef);
  if (!existing.exists()) {
    const joinedAt = Date.now();
    const batch = writeBatch(db);
    batch.set(membershipRef, { uid: account.uid, username, email: account.email, role: "member", joinedAt, joinCode: code });
    batch.set(doc(db, "users", account.uid, "classes", classId), { classId, role: "member", joinedAt });
    batch.update(doc(db, "classes", classId), { memberCount: increment(1) });
    if (classData.ownerId !== account.uid) {
      const notificationId = createId("notification");
      batch.set(doc(db, "users", classData.ownerId, "notifications", notificationId), {
        type: "class_joined", title: "Nuovo membro", message: `${username} è entrato nella classe ${classData.title}.`, senderId: account.uid, senderName: username, recipientId: classData.ownerId, classId, read: false, createdAt: joinedAt,
      });
    }
    await batch.commit();
  }
  return { ...classData, id: classId, memberCount: classData.memberCount + (existing.exists() ? 0 : 1), role: classData.ownerId === account.uid ? "owner" : "member" } as LumeClass;
}

export async function loadClassWorkspace(classId: string, uid: string): Promise<ClassWorkspace> {
  const db = await getCloudDatabase();
  const [classSnapshot, membership, members, folders, decks, annotations, comments, favorites] = await Promise.all([
    getDoc(doc(db, "classes", classId)),
    getDoc(doc(db, "classes", classId, "members", uid)),
    getDocs(collection(db, "classes", classId, "members")),
    getDocs(collection(db, "classes", classId, "folders")),
    getDocs(collection(db, "classes", classId, "decks")),
    getDocs(collection(db, "classes", classId, "annotations")),
    getDocs(collection(db, "classes", classId, "comments")),
    getDocs(collection(db, "users", uid, "classFavorites")),
  ]);
  if (!classSnapshot.exists() || !membership.exists()) throw Object.assign(new Error("Non fai parte di questa classe."), { code: "permission-denied" });
  const deckResults = await Promise.all(decks.docs.map(async (deckSnapshot) => {
    const cards = await getDocs(collection(db, "classes", classId, "decks", deckSnapshot.id, "cards"));
    return {
      ...(deckSnapshot.data() as Omit<ClassDeck, "id" | "cards">),
      id: deckSnapshot.id,
      cards: cards.docs.map((card) => ({ ...card.data(), id: card.id } as CloudCard)).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)),
    } as ClassDeck;
  }));
  return {
    summary: { ...(classSnapshot.data() as Omit<LumeClass, "id" | "role">), id: classId, role: membership.data().role === "owner" ? "owner" : "member" },
    members: members.docs.map((item) => ({ ...(item.data() as Omit<ClassMember, "uid">), uid: item.id })).sort((a, b) => a.role === b.role ? a.username.localeCompare(b.username) : a.role === "owner" ? -1 : 1),
    folders: folders.docs.map((item) => ({ ...(item.data() as Omit<ClassFolder, "id">), id: item.id })),
    decks: deckResults,
    annotations: annotations.docs.map((item) => ({ ...(item.data() as Omit<ClassAnnotation, "id">), id: item.id })).sort((a, b) => b.updatedAt - a.updatedAt),
    comments: comments.docs.map((item) => ({ ...(item.data() as Omit<ClassComment, "id">), id: item.id })).sort((a, b) => a.createdAt - b.createdAt),
    favorites: favorites.docs.map((item) => ({ ...(item.data() as Omit<ClassFavorite, "id">), id: item.id })).filter((item) => item.classId === classId),
  };
}

function classDeckMeta(deck: ClassDeck) {
  return Object.fromEntries(Object.entries(deck).filter(([key]) => key !== "cards")) as Omit<ClassDeck, "cards">;
}

export async function saveClassFolder(classId: string, account: CloudAccount, username: string, folder: ClassFolder) {
  const db = await getCloudDatabase();
  await setDoc(doc(db, "classes", classId, "folders", folder.id), { ...folder, ownerId: folder.ownerId || account.uid, ownerName: folder.ownerName || username });
}

export async function saveClassDeck(classId: string, account: CloudAccount, username: string, deck: ClassDeck) {
  const db = await getCloudDatabase();
  const existingCards = await getDocs(collection(db, "classes", classId, "decks", deck.id, "cards"));
  const nextIds = new Set(deck.cards.map((card) => card.id));
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const normalized = { ...deck, ownerId: deck.ownerId || account.uid, ownerName: deck.ownerName || username };
  operations.push((batch) => batch.set(doc(db, "classes", classId, "decks", deck.id), classDeckMeta(normalized)));
  deck.cards.forEach((card, position) => operations.push((batch) => batch.set(doc(db, "classes", classId, "decks", deck.id, "cards", card.id), { ...card, position, ownerId: normalized.ownerId })));
  existingCards.docs.filter((card) => !nextIds.has(card.id)).forEach((card) => operations.push((batch) => batch.delete(card.ref)));
  await commitInChunks(db, operations);
}

async function commitInChunks(db: Awaited<ReturnType<typeof getCloudDatabase>>, operations: Array<(batch: ReturnType<typeof writeBatch>) => void>) {
  for (let index = 0; index < operations.length; index += 430) {
    const batch = writeBatch(db);
    operations.slice(index, index + 430).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

export async function saveClassBundle(classId: string, folders: ClassFolder[], decks: ClassDeck[]) {
  const db = await getCloudDatabase();
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  folders.forEach((folder) => operations.push((batch) => batch.set(doc(db, "classes", classId, "folders", folder.id), folder)));
  decks.forEach((deck) => {
    operations.push((batch) => batch.set(doc(db, "classes", classId, "decks", deck.id), classDeckMeta(deck)));
    deck.cards.forEach((card, position) => operations.push((batch) => batch.set(doc(db, "classes", classId, "decks", deck.id, "cards", card.id), { ...card, position, ownerId: deck.ownerId })));
  });
  await commitInChunks(db, operations);
}

export async function toggleClassFavorite(uid: string, favorite: ClassFavorite, active: boolean) {
  const db = await getCloudDatabase();
  const reference = doc(db, "users", uid, "classFavorites", favorite.id);
  if (active) await setDoc(reference, favorite);
  else await deleteDoc(reference);
}

export async function saveClassAnnotation(classId: string, account: CloudAccount, username: string, annotation: Omit<ClassAnnotation, "id" | "authorId" | "authorName" | "createdAt" | "updatedAt">) {
  const db = await getCloudDatabase();
  const id = `${account.uid}_${annotation.deckId}_${annotation.cardId ?? "deck"}`;
  const reference = doc(db, "classes", classId, "annotations", id);
  const existing = await getDoc(reference);
  if (!annotation.pinned && !annotation.note.trim()) {
    if (existing.exists()) await deleteDoc(reference);
    return null;
  }
  const result: ClassAnnotation = { id, ...annotation, note: annotation.note.trim(), authorId: account.uid, authorName: username, createdAt: Number(existing.data()?.createdAt ?? Date.now()), updatedAt: Date.now() };
  await setDoc(reference, result);
  return result;
}

export async function addClassComment(classId: string, account: CloudAccount, username: string, target: { kind: ClassItemKind; id: string; title: string; ownerId: string }, text: string) {
  const db = await getCloudDatabase();
  const id = createId("comment");
  const createdAt = Date.now();
  const comment: ClassComment = { id, targetKind: target.kind, targetId: target.id, authorId: account.uid, authorName: username, text: text.trim(), createdAt };
  const batch = writeBatch(db);
  batch.set(doc(db, "classes", classId, "comments", id), comment);
  if (target.ownerId !== account.uid) {
    const notificationId = createId("notification");
    batch.set(doc(db, "users", target.ownerId, "notifications", notificationId), { type: "class_comment", title: "Nuovo commento", message: `${username} ha commentato ${target.title}.`, senderId: account.uid, senderName: username, recipientId: target.ownerId, classId, itemId: target.id, itemKind: target.kind, read: false, createdAt });
  }
  await batch.commit();
  return comment;
}

export async function notifyClassContent(classId: string, account: CloudAccount, username: string, members: ClassMember[], item: { kind: ClassItemKind; id: string; title: string }) {
  const db = await getCloudDatabase();
  const operations = members.filter((member) => member.uid !== account.uid).map((member) => (batch: ReturnType<typeof writeBatch>) => {
    const id = createId("notification");
    batch.set(doc(db, "users", member.uid, "notifications", id), { type: "class_content", title: "Nuovo materiale", message: `${username} ha aggiunto ${item.title} alla classe.`, senderId: account.uid, senderName: username, recipientId: member.uid, classId, itemId: item.id, itemKind: item.kind, read: false, createdAt: Date.now() });
  });
  await commitInChunks(db, operations);
}

export async function requestClassCopy(classInfo: LumeClass, account: CloudAccount, username: string, item: { kind: ClassItemKind; id: string; title: string; ownerId: string; ownerName: string }) {
  const db = await getCloudDatabase();
  const id = createId("copyrequest");
  const createdAt = Date.now();
  const request: CopyRequest = { id, classId: classInfo.id, classTitle: classInfo.title, itemKind: item.kind, itemId: item.id, itemTitle: item.title, ownerId: item.ownerId, ownerName: item.ownerName, requesterId: account.uid, requesterName: username, status: "pending", createdAt };
  const batch = writeBatch(db);
  batch.set(doc(db, "copyRequests", id), request);
  const notificationId = createId("notification");
  batch.set(doc(db, "users", item.ownerId, "notifications", notificationId), { type: "copy_request", title: "Richiesta di copia", message: `${username} vorrebbe copiare ${item.title} nel proprio spazio.`, senderId: account.uid, senderName: username, recipientId: item.ownerId, classId: classInfo.id, itemId: item.id, itemKind: item.kind, requestId: id, read: false, createdAt });
  await batch.commit();
  return request;
}

export async function respondToCopyRequest(account: CloudAccount, username: string, requestId: string, approved: boolean) {
  const db = await getCloudDatabase();
  const reference = doc(db, "copyRequests", requestId);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw Object.assign(new Error("La richiesta non è più disponibile."), { code: "lume/request-not-found" });
  const request = { ...snapshot.data(), id: snapshot.id } as CopyRequest;
  if (request.ownerId !== account.uid) throw Object.assign(new Error("Non puoi rispondere a questa richiesta."), { code: "permission-denied" });
  const status = approved ? "approved" : "rejected";
  const batch = writeBatch(db);
  batch.update(reference, { status, answeredAt: Date.now() });
  const notificationId = createId("notification");
  batch.set(doc(db, "users", request.requesterId, "notifications", notificationId), { type: approved ? "copy_approved" : "copy_rejected", title: approved ? "Copia autorizzata" : "Richiesta non approvata", message: approved ? `${username} ha autorizzato la copia di ${request.itemTitle}.` : `${username} non ha autorizzato la copia di ${request.itemTitle}.`, senderId: account.uid, senderName: username, recipientId: request.requesterId, classId: request.classId, itemId: request.itemId, itemKind: request.itemKind, requestId, read: false, createdAt: Date.now() });
  await batch.commit();
  return { ...request, status } as CopyRequest;
}

export async function loadCopyRequest(requestId: string) {
  const db = await getCloudDatabase();
  const snapshot = await getDoc(doc(db, "copyRequests", requestId));
  return snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as CopyRequest) : null;
}

export async function markCopyRequestCopied(requestId: string) {
  const db = await getCloudDatabase();
  await updateDoc(doc(db, "copyRequests", requestId), { status: "copied", copiedAt: Date.now() });
}

export async function loadNotifications(uid: string) {
  const db = await getCloudDatabase();
  const snapshots = await getDocs(collection(db, "users", uid, "notifications"));
  return snapshots.docs.map((item) => ({ ...(item.data() as Omit<LumeNotification, "id">), id: item.id })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function markNotificationRead(uid: string, notificationId: string) {
  const db = await getCloudDatabase();
  await updateDoc(doc(db, "users", uid, "notifications", notificationId), { read: true });
}

export async function notifyPublicRating(ownerId: string, voterId: string, voterName: string, itemId: string, itemTitle: string, value: number) {
  if (ownerId === voterId || value === 0) return;
  const db = await getCloudDatabase();
  const id = createId("notification");
  await setDoc(doc(db, "users", ownerId, "notifications", id), { type: "public_rating", title: "Nuova valutazione", message: `${voterName} ha valutato ${itemTitle}.`, senderId: voterId, senderName: voterName, recipientId: ownerId, itemId, itemKind: "deck", read: false, createdAt: Date.now() });
}
