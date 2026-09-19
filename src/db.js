const DB_NAME = "messenger-better-search";
const DB_VERSION = 1;

/**
 * Opens the extension IndexedDB and initializes stores on first use.
 * @returns {Promise<IDBDatabase>}
 */
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

/**
 * Resolves once an IndexedDB transaction commits.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Upserts messages while preserving already-computed enrichment on recapture.
 * @param {object[]} items
 * @returns {Promise<void>}
 */
export async function putMessages(items) {
  if (!items?.length) return;
  const db = await openDb();
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  for (const item of items) {
    const getRequest = store.get(item.id);
    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      if (!existing) {
        store.put(item);
        return;
      }

      store.put({
        ...existing,
        ...item,
        transcript: item.transcript ?? existing.transcript,
        imageContext: item.imageContext ?? existing.imageContext,
        enrichment: {
          ...(existing.enrichment || {}),
          ...(item.enrichment || {})
        }
      });
    };
  }

  await txDone(tx);
}

/**
 * Loads all messages for one conversation in chronological order.
 * @param {string} conversationId
 * @returns {Promise<object[]>}
 */
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

/**
 * Stores the latest resumable capture session state.
 * @param {object} session
 * @returns {Promise<void>}
 */
export async function putSession(session) {
  const db = await openDb();
  const tx = db.transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(session);
  await txDone(tx);
}

/**
 * Gets a capture session by conversation id.
 * @param {string} conversationId
 * @returns {Promise<object|null>}
 */
export async function getSession(conversationId) {
  const db = await openDb();
  const tx = db.transaction("sessions", "readonly");
  const req = tx.objectStore("sessions").get(conversationId);
  return await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Lists all captured conversation sessions.
 * @returns {Promise<object[]>}
 */
export async function listSessions() {
  const db = await openDb();
  const tx = db.transaction("sessions", "readonly");
  const req = tx.objectStore("sessions").getAll();
  return await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Stores one semantic vector for a message.
 * @param {string} messageId
 * @param {number[]} vector
 * @returns {Promise<void>}
 */
export async function putEmbedding(messageId, vector) {
  const db = await openDb();
  const tx = db.transaction("embeddings", "readwrite");
  tx.objectStore("embeddings").put({ messageId, vector });
  await txDone(tx);
}

/**
 * Loads all locally persisted semantic vectors.
 * @returns {Promise<Array<{messageId:string,vector:number[]}>>}
 */
export async function getEmbeddings() {
  const db = await openDb();
  const tx = db.transaction("embeddings", "readonly");
  const req = tx.objectStore("embeddings").getAll();
  return await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
