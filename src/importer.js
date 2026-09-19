import {
  getFingerprintCounts,
  putImport,
  putMessages,
  upsertConversation
} from "./db.js";
import {
  deduplicateImportedMessages,
  normalizeMetaConversation
} from "./meta-parser.js";
import { readMetaZip } from "./meta-zip.js";

const $ = id => document.getElementById(id);
const countsCache = new Map();
const seenThisImportCache = new Map();

let state = {
  files: 0,
  fileIndex: 0,
  conversations: new Set(),
  messagesAdded: 0,
  duplicates: 0,
  chunks: 0
};

/**
 * Updates the import progress UI.
 * @param {object} [patch]
 */
function renderProgress(patch = {}) {
  state = { ...state, ...patch };
  $("progressCard").hidden = false;
  $("fileProgress").textContent = `${state.fileIndex} / ${state.files} files`;
  $("conversationCount").textContent = state.conversations.size;
  $("messageCount").textContent = state.messagesAdded.toLocaleString();
  $("duplicateCount").textContent = state.duplicates.toLocaleString();
  $("chunkCount").textContent = state.chunks.toLocaleString();
  $("progressBar").style.width = state.files
    ? `${Math.min(100, state.fileIndex / state.files * 100)}%`
    : "0%";
}

/**
 * Loads the stored fingerprint multiplicities once per conversation.
 * @param {string} conversationId
 * @returns {Promise<Map<string,number>>}
 */
async function existingCounts(conversationId) {
  if (!countsCache.has(conversationId)) {
    countsCache.set(
      conversationId,
      await getFingerprintCounts(conversationId)
    );
  }
  return countsCache.get(conversationId);
}

/**
 * Imports one normalized Meta message chunk.
 * @param {string} path
 * @param {string} text
 * @param {string} importId
 */
async function importJsonChunk(path, text, importId) {
  $("currentPath").textContent = path;
  $("status").textContent = "Indexing Messenger history…";

  const document = JSON.parse(text);
  const { conversation, messages } =
    normalizeMetaConversation(document, path);

  const storedCounts = await existingCounts(conversation.id);
  const seenCounts = seenThisImportCache.get(conversation.id) || new Map();
  seenThisImportCache.set(conversation.id, seenCounts);

  const deduped = deduplicateImportedMessages(
    messages,
    storedCounts,
    seenCounts
  );

  const enriched = deduped.insert.map(message => ({
    ...message,
    importId
  }));

  await putMessages(enriched);
  await upsertConversation(conversation, enriched.length);

  countsCache.set(conversation.id, deduped.resultingCounts);
  state.conversations.add(conversation.id);
  state.messagesAdded += enriched.length;
  state.duplicates += deduped.skipped;
  state.chunks += 1;
  renderProgress();
}

/**
 * Imports one selected ZIP or direct JSON file.
 * @param {File} file
 * @param {string} importId
 */
async function importFile(file, importId) {
  const lower = file.name.toLowerCase();

  if (lower.endsWith(".json")) {
    await importJsonChunk(file.name, await file.text(), importId);
    return;
  }

  if (!lower.endsWith(".zip")) {
    throw new Error(`Unsupported file: ${file.name}`);
  }

  $("status").textContent = `Reading ${file.name}…`;
  $("currentPath").textContent = "Scanning archive entries without extracting media…";

  const { entries, sawHtml } = await readMetaZip(file);

  if (!entries.length) {
    if (sawHtml) {
      throw new Error(
        "This Meta export uses HTML. Request a new export and choose JSON format."
      );
    }
    throw new Error(
      `No Messenger message_*.json files were found in ${file.name}.`
    );
  }

  for (const entry of entries) {
    await importJsonChunk(entry.name, entry.text, importId);
  }
}

/**
 * Runs a complete multi-file import and persists its summary.
 * @param {File[]} files
 */
async function runImport(files) {
  countsCache.clear();
  seenThisImportCache.clear();
  state = {
    files: files.length,
    fileIndex: 0,
    conversations: new Set(),
    messagesAdded: 0,
    duplicates: 0,
    chunks: 0
  };

  $("doneCard").hidden = true;
  $("importError").hidden = true;
  renderProgress();

  const importId = `meta-${Date.now()}`;
  const startedAt = Date.now();

  await putImport({
    id: importId,
    source: "meta-dyi",
    status: "running",
    startedAt,
    fileNames: files.map(file => file.name)
  });

  try {
    for (const [index, file] of files.entries()) {
      state.fileIndex = index;
      renderProgress();
      await importFile(file, importId);
      state.fileIndex = index + 1;
      renderProgress();
    }

    const completedAt = Date.now();
    await putImport({
      id: importId,
      source: "meta-dyi",
      status: "completed",
      startedAt,
      completedAt,
      fileNames: files.map(file => file.name),
      conversations: state.conversations.size,
      messagesAdded: state.messagesAdded,
      duplicatesSkipped: state.duplicates,
      chunks: state.chunks
    });

    $("status").textContent = "Complete";
    $("currentPath").textContent = "";
    $("doneSummary").textContent =
      `${state.messagesAdded.toLocaleString()} new messages across ${state.conversations.size} conversations. ${state.duplicates.toLocaleString()} duplicates skipped.`;
    $("doneCard").hidden = false;
  } catch (error) {
    await putImport({
      id: importId,
      source: "meta-dyi",
      status: "error",
      startedAt,
      failedAt: Date.now(),
      fileNames: files.map(file => file.name),
      error: String(error?.message || error),
      messagesAdded: state.messagesAdded,
      duplicatesSkipped: state.duplicates
    });

    $("status").textContent = "Import stopped";
    $("importError").hidden = false;
    $("importError").textContent = String(error?.message || error);
  }
}

/**
 * Accepts a FileList or array after user selection/drop.
 * @param {FileList|File[]} selected
 */
function handleFiles(selected) {
  const files = [...selected].filter(file =>
    /\.(zip|json)$/i.test(file.name)
  );
  if (!files.length) return;
  runImport(files);
}

$("files").addEventListener("change", event => {
  handleFiles(event.target.files);
});

$("dropZone").addEventListener("dragover", event => {
  event.preventDefault();
  $("dropZone").classList.add("dragging");
});

$("dropZone").addEventListener("dragleave", () => {
  $("dropZone").classList.remove("dragging");
});

$("dropZone").addEventListener("drop", event => {
  event.preventDefault();
  $("dropZone").classList.remove("dragging");
  handleFiles(event.dataTransfer.files);
});

$("searchArchive").addEventListener("click", () => {
  location.href = chrome.runtime.getURL("src/search.html");
});

$("importMore").addEventListener("click", () => {
  $("files").click();
});
