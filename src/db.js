const DB_NAME = "messenger-better-search";
const DB_VERSION = 2;

/**
 * Opens the local archive database and applies additive schema migrations.
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;

      let messages;
      if (!db.objectStoreNames.contains("messages")) {
        messages = db.createObjectStore("messages", { keyPath: "id" });
      } else {
        messages = transaction.objectStore("messages");
      }

      if (!messages.indexNames.contains("conversationId")) {
        messages.createIndex("conversationId", "conversationId");
      }
      if (!messages.indexNames.contains("timestamp")) {
        messages.createIndex("timestamp", "timestamp");
      }
      if (!messages.indexNames.contains("dayKey")) {
        messages.createIndex("dayKey", "dayKey");
      }
      if (!messages.indexNames.contains("fingerprint")) {
        messages.createIndex("fingerprint", "fingerprint");
      }

      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "conversationId" });
      }
      if (!db.objectStoreNames.contains("embeddings")) {
        db.createObjectStore("embeddings", { keyPath: "messageId" });
      }
      if (!db.objectStoreNames.contains("conversations")) {
        const conversations = db.createObjectStore("conversations", { keyPath: "id" });
        conversations.createIndex("lastMessageAt", "lastMessageAt");
        conversations.createIndex("source", "source");
      }
      if (!db.objectStoreNames.contains("imports")) {
        const imports = db.createObjectStore("imports", { keyPath: "id" });
        imports.createIndex("startedAt", "startedAt");
        imports.createIndex("status", "status");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resolves when an IndexedDB transaction commits.
 * @param {IDBTransaction} transaction
 * @returns {Promise<void>}
 */
function txDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Converts an IDB request to a Promise.
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Upserts messages while preserving previously generated enrichment.
 * @param {object[]} items
 * @returns {Promise<void>}
 */
export async function putMessages(items) {
  if (!items?.length) return;
  const db = await openDb();
  const transaction = db.transaction("messages", "readwrite");
  const store = transaction.objectStore("messages");

  for (const item of items) {
    const request = store.get(item.id);
    request.onsuccess = () => {
      const existing = request.result;
      store.put(existing ? {
        ...existing,
        ...item,
        transcript: item.transcript ?? existing.transcript,
        imageContext: item.imageContext ?? existing.imageContext,
        enrichment: {
          ...(existing.enrichment || {}),
          ...(item.enrichment || {})
        }
      } : item);
    };
  }

  await txDone(transaction);
}

/**
 * Loads all messages for a conversation in chronological order.
 * @param {string} conversationId
 * @returns {Promise<object[]>}
 */
export async function getMessages(conversationId) {
  const db = await openDb();
  const transaction = db.transaction("messages", "readonly");
  const request = transaction
    .objectStore("messages")
    .index("conversationId")
    .getAll(conversationId);
  const result = await requestResult(request);
  return (result || []).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

/**
 * Loads all archived messages, newest last.
 * @returns {Promise<object[]>}
 */
export async function getAllMessages() {
  const db = await openDb();
  const transaction = db.transaction("messages", "readonly");
  const result = await requestResult(
    transaction.objectStore("messages").getAll()
  );
  return (result || []).sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
  );
}

/**
 * Returns how many records already exist for each import fingerprint.
 * @param {string} conversationId
 * @returns {Promise<Map<string, number>>}
 */
export async function getFingerprintCounts(conversationId) {
  const messages = await getMessages(conversationId);
  const counts = new Map();
  for (const message of messages) {
    if (!message.fingerprint) continue;
    counts.set(
      message.fingerprint,
      Math.max(
        counts.get(message.fingerprint) || 0,
        (message.duplicateOrdinal ?? 0) + 1
      )
    );
  }
  return counts;
}

/**
 * Creates or updates one conversation summary after an import chunk.
 * @param {object} conversation
 * @param {number} addedMessages
 * @returns {Promise<object>}
 */
export async function upsertConversation(conversation, addedMessages = 0) {
  const db = await openDb();
  const transaction = db.transaction("conversations", "readwrite");
  const store = transaction.objectStore("conversations");
  let merged;

  const getRequest = store.get(conversation.id);
  getRequest.onsuccess = () => {
    const existing = getRequest.result;
    merged = {
      ...(existing || {}),
      ...conversation,
      participants: [...new Set([
        ...(existing?.participants || []),
        ...(conversation.participants || [])
      ])],
      firstMessageAt: [existing?.firstMessageAt, conversation.firstMessageAt]
        .filter(Boolean)
        .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY),
      lastMessageAt: [existing?.lastMessageAt, conversation.lastMessageAt]
        .filter(Boolean)
        .reduce((max, value) => Math.max(max, value), 0),
      messageCount: (existing?.messageCount || 0) + addedMessages,
      updatedAt: Date.now()
    };

    if (!Number.isFinite(merged.firstMessageAt)) merged.firstMessageAt = null;
    if (!merged.lastMessageAt) merged.lastMessageAt = null;
    store.put(merged);
  };

  await txDone(transaction);
  return merged;
}

/**
 * Lists all imported conversations, newest activity first.
 * @returns {Promise<object[]>}
 */
export async function listConversations() {
  const db = await openDb();
  const transaction = db.transaction("conversations", "readonly");
  const result = await requestResult(
    transaction.objectStore("conversations").getAll()
  );
  return (result || []).sort(
    (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
  );
}

/**
 * Stores resumable import metadata.
 * @param {object} record
 * @returns {Promise<void>}
 */
export async function putImport(record) {
  const db = await openDb();
  const transaction = db.transaction("imports", "readwrite");
  transaction.objectStore("imports").put(record);
  await txDone(transaction);
}

/**
 * Lists imports, newest first.
 * @returns {Promise<object[]>}
 */
export async function listImports() {
  const db = await openDb();
  const transaction = db.transaction("imports", "readonly");
  const result = await requestResult(transaction.objectStore("imports").getAll());
  return (result || []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

/**
 * Returns high-level archive statistics for the popup.
 * @returns {Promise<object>}
 */
export async function getArchiveStats() {
  const db = await openDb();
  const transaction = db.transaction(
    ["messages", "conversations", "imports"],
    "readonly"
  );
  const [messages, conversations, imports] = await Promise.all([
    requestResult(transaction.objectStore("messages").count()),
    requestResult(transaction.objectStore("conversations").count()),
    requestResult(transaction.objectStore("imports").getAll())
  ]);

  const completed = (imports || [])
    .filter(item => item.status === "completed")
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  return {
    messages,
    conversations,
    lastImport: completed[0] || null
  };
}

/**
 * Legacy session writer retained for pre-v2 local archives.
 * @param {object} session
 * @returns {Promise<void>}
 */
export async function putSession(session) {
  const db = await openDb();
  const transaction = db.transaction("sessions", "readwrite");
  transaction.objectStore("sessions").put(session);
  await txDone(transaction);
}

/**
 * Legacy session reader retained for pre-v2 local archives.
 * @param {string} conversationId
 * @returns {Promise<object|null>}
 */
export async function getSession(conversationId) {
  const db = await openDb();
  const transaction = db.transaction("sessions", "readonly");
  return (await requestResult(
    transaction.objectStore("sessions").get(conversationId)
  )) || null;
}

/**
 * Lists legacy capture sessions.
 * @returns {Promise<object[]>}
 */
export async function listSessions() {
  const db = await openDb();
  const transaction = db.transaction("sessions", "readonly");
  return (await requestResult(
    transaction.objectStore("sessions").getAll()
  )) || [];
}

/**
 * Stores a semantic vector.
 * @param {string} messageId
 * @param {number[]} vector
 * @returns {Promise<void>}
 */
export async function putEmbedding(messageId, vector) {
  const db = await openDb();
  const transaction = db.transaction("embeddings", "readwrite");
  transaction.objectStore("embeddings").put({ messageId, vector });
  await txDone(transaction);
}

/**
 * Loads all semantic vectors.
 * @returns {Promise<Array<{messageId:string,vector:number[]}>>}
 */
export async function getEmbeddings() {
  const db = await openDb();
  const transaction = db.transaction("embeddings", "readonly");
  return (await requestResult(
    transaction.objectStore("embeddings").getAll()
  )) || [];
}
