const DB_NAME = "messenger-memory";
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const messages = db.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("conversationId", "conversationId");
      messages.createIndex("timestamp", "timestamp");
      messages.createIndex("dayKey", "dayKey");
      db.createObjectStore("sessions", { keyPath: "conversationId" });
      db.createObjectStore("embeddings", { keyPath: "messageId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putMessages(items) {
  if (!items?.length) return;
  const db = await openDb();
  const tx = db.transaction("messages", "readwrite");
  for (const item of items) tx.objectStore("messages").put(item);
  await txDone(tx);
}

export async function getMessages(conversationId) {
  const db = await openDb();
  const tx = db.transaction("messages", "readonly");
  const index = tx.objectStore("messages").index("conversationId");
  const req = index.getAll(conversationId);
  const result = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return result.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

export async function putSession(session) {
  const db = await openDb();
  const tx = db.transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(session);
  await txDone(tx);
}

export async function getSession(conversationId) {
  const db = await openDb();
  const tx = db.transaction("sessions", "readonly");
  const req = tx.objectStore("sessions").get(conversationId);
  return await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listSessions() {
  const db = await openDb();
  const tx = db.transaction("sessions", "readonly");
  const req = tx.objectStore("sessions").getAll();
  return await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putEmbedding(messageId, vector) {
  const db = await openDb();
  const tx = db.transaction("embeddings", "readwrite");
  tx.objectStore("embeddings").put({ messageId, vector });
  await txDone(tx);
}

export async function getEmbeddings() {
  const db = await openDb();
  const tx = db.transaction("embeddings", "readonly");
  const req = tx.objectStore("embeddings").getAll();
  return await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
