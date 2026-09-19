/**
 * Meta Download/Export Your Information parser.
 * This module intentionally has no browser APIs so the normalization rules can
 * be unit-tested in Node and reused by future import surfaces.
 */

/**
 * Returns true for JSON conversation chunks from Meta's Messages export.
 * Supports old and newer export directory prefixes.
 * @param {string} path
 * @returns {boolean}
 */
export function isMetaMessageJsonPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/messages/") &&
    /\/message_\d+\.json$/.test(normalized);
}

/**
 * Detects an HTML Messages export so the UI can explain that JSON is required.
 * @param {string} path
 * @returns {boolean}
 */
export function isMetaMessageHtmlPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/messages/") &&
    /\/message_\d+\.html?$/.test(normalized);
}

/**
 * Repairs the common mojibake present in some historical Meta JSON exports.
 * Leaves normal Unicode untouched.
 * @param {unknown} value
 * @returns {string}
 */
export function decodeMetaText(value) {
  const text = value == null ? "" : String(value);
  if (!/[ÃÂð]/.test(text)) return text;
  if ([...text].some(char => char.charCodeAt(0) > 255)) return text;

  try {
    const bytes = Uint8Array.from([...text], char => char.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded || text;
  } catch {
    return text;
  }
}

/**
 * Small deterministic 64-bit-ish hash composed from two independent 32-bit
 * accumulators. Used as a compact lookup fingerprint, not for cryptography.
 * @param {string} value
 * @returns {string}
 */
export function stableHash(value) {
  let a = 2166136261;
  let b = 2246822519;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a ^= code;
    a = Math.imul(a, 16777619);
    b ^= code + index;
    b = Math.imul(b, 3266489917);
  }

  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Returns the conversation directory from a message_N.json path.
 * @param {string} sourcePath
 * @returns {string}
 */
export function conversationPathFromSource(sourcePath) {
  return String(sourcePath || "")
    .replace(/\\/g, "/")
    .replace(/\/message_\d+\.json$/i, "");
}

/**
 * Normalizes Meta attachment arrays and single-value attachment fields.
 * @param {object} message
 * @returns {Array<object>}
 */
export function normalizeAttachments(message) {
  const output = [];
  const groups = [
    ["image", message.photos],
    ["video", message.videos],
    ["audio", message.audio_files],
    ["file", message.files],
    ["gif", message.gifs]
  ];

  for (const [type, items] of groups) {
    for (const item of items || []) {
      if (!item) continue;
      output.push({
        type,
        uri: item.uri || item.url || "",
        creationTimestamp: item.creation_timestamp || null,
        title: decodeMetaText(item.title || "")
      });
    }
  }

  if (message.sticker?.uri) {
    output.push({ type: "sticker", uri: message.sticker.uri });
  }

  if (message.share?.link || message.share?.share_text) {
    output.push({
      type: "share",
      uri: message.share.link || "",
      title: decodeMetaText(message.share.share_text || "")
    });
  }

  return output;
}

/**
 * Produces a base fingerprint that is deliberately independent from export
 * pagination/file name so incremental Meta exports merge correctly.
 * @param {object} input
 * @returns {string}
 */
export function messageFingerprint(input) {
  const attachmentKeys = (input.attachments || [])
    .map(item => [item.type, item.uri, item.title].filter(Boolean).join(":"))
    .sort();

  const canonical = JSON.stringify({
    conversationId: input.conversationId,
    timestamp: input.timestamp || null,
    sender: input.sender || "",
    text: input.text || "",
    attachments: attachmentKeys,
    unsent: Boolean(input.isUnsent),
    callDuration: input.callDuration || null
  });

  return stableHash(canonical);
}

/**
 * Parses one Meta message_N.json document into the source-independent archive
 * model used by Messenger Better Search.
 * @param {object} document
 * @param {string} sourcePath
 * @returns {{conversation: object, messages: object[]}}
 */
export function normalizeMetaConversation(document, sourcePath) {
  if (!document || !Array.isArray(document.messages)) {
    throw new Error("This JSON file is not a Meta Messenger message export.");
  }

  const sourceThreadPath =
    decodeMetaText(document.thread_path || "") ||
    conversationPathFromSource(sourcePath);

  const participants = (document.participants || [])
    .map(item => decodeMetaText(item?.name || ""))
    .filter(Boolean);

  const title =
    decodeMetaText(document.title || "") ||
    participants.join(", ") ||
    "Untitled conversation";

  const fallbackIdentity = [
    title,
    [...participants].sort().join("|")
  ].join("::");

  const conversationId =
    "meta:" + (sourceThreadPath || "fallback:" + stableHash(fallbackIdentity));

  const messages = document.messages.map((raw, sourceIndex) => {
    const attachments = normalizeAttachments(raw);
    const text = raw.content == null ? "" : decodeMetaText(raw.content);
    const sender = decodeMetaText(raw.sender_name || "") || null;
    const timestamp = Number(raw.timestamp_ms) || null;

    const normalized = {
      conversationId,
      sender,
      text,
      timestamp,
      dayKey: timestamp
        ? new Date(timestamp).toISOString().slice(0, 10)
        : "unknown",
      type: raw.is_unsent
        ? "unsent"
        : raw.call_duration
          ? "call"
          : attachments.length
            ? "media"
            : "text",
      media: {
        images: attachments
          .filter(item => ["image", "gif", "sticker"].includes(item.type))
          .map(item => ({ src: item.uri, alt: item.title || "" })),
        audio: attachments
          .filter(item => item.type === "audio")
          .map(item => item.uri),
        video: attachments
          .filter(item => item.type === "video")
          .map(item => item.uri),
        files: attachments
          .filter(item => ["file", "share"].includes(item.type))
          .map(item => ({ src: item.uri, title: item.title || "" }))
      },
      attachments,
      reactions: (raw.reactions || []).map(reaction => ({
        reaction: decodeMetaText(reaction.reaction || ""),
        actor: decodeMetaText(reaction.actor || "")
      })),
      isUnsent: Boolean(raw.is_unsent),
      callDuration: raw.call_duration || null,
      source: {
        provider: "meta",
        format: "dyi-json",
        threadPath: sourceThreadPath,
        sourcePath,
        sourceIndex
      },
      importedAt: Date.now()
    };

    return {
      ...normalized,
      fingerprint: messageFingerprint(normalized)
    };
  });

  messages.sort((left, right) =>
    (left.timestamp || 0) - (right.timestamp || 0)
  );

  const timestamps = messages
    .map(message => message.timestamp)
    .filter(Boolean);

  return {
    conversation: {
      id: conversationId,
      source: "meta-dyi",
      sourceThreadPath,
      title,
      participants,
      firstMessageAt: timestamps.length ? Math.min(...timestamps) : null,
      lastMessageAt: timestamps.length ? Math.max(...timestamps) : null
    },
    messages
  };
}

/**
 * Assigns stable duplicate ordinals and removes records already present locally.
 * existingCounts is the number of records already stored for each fingerprint.
 * @param {object[]} messages
 * @param {Map<string, number>} existingCounts
 * @param {Map<string, number>} seenThisImport Fingerprint counts already seen in the current import for this conversation.\n * @returns {{insert: object[], skipped: number, resultingCounts: Map<string, number>}}\n */\nexport function deduplicateImportedMessages(messages, existingCounts = new Map(), seenThisImport = new Map()) {
  const insert = [];
  let skipped = 0;
  const resultingCounts = new Map(existingCounts);

  for (const message of messages) {
    const ordinal = seenThisImport.get(message.fingerprint) || 0;
    seenThisImport.set(message.fingerprint, ordinal + 1);

    const alreadyStored = existingCounts.get(message.fingerprint) || 0;
    if (ordinal < alreadyStored) {
      skipped += 1;
      continue;
    }

    insert.push({
      ...message,
      duplicateOrdinal: ordinal,
      id: `${message.conversationId}:${message.fingerprint}:${ordinal}`
    });
    resultingCounts.set(
      message.fingerprint,
      Math.max(resultingCounts.get(message.fingerprint) || 0, ordinal + 1)
    );
  }

  return { insert, skipped, resultingCounts };
}
