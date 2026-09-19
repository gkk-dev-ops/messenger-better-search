import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeMetaText,
  deduplicateImportedMessages,
  isMetaMessageHtmlPath,
  isMetaMessageJsonPath,
  normalizeMetaConversation
} from "../src/meta-parser.js";

const SAMPLE = {
  participants: [
    { name: "Grzegorz" },
    { name: "Paweł" }
  ],
  title: "Paweł",
  thread_path: "inbox/pawel_123",
  messages: [
    {
      sender_name: "Paweł",
      timestamp_ms: 1780000000000,
      content: "Soft flask",
      photos: [{ uri: "messages/inbox/pawel_123/photos/1.jpg" }]
    },
    {
      sender_name: "Grzegorz",
      timestamp_ms: 1780000001000,
      content: "OK"
    },
    {
      sender_name: "Grzegorz",
      timestamp_ms: 1780000001000,
      content: "OK"
    }
  ]
};

test("recognizes Meta Messenger JSON paths", () => {
  assert.equal(
    isMetaMessageJsonPath("your_facebook_activity/messages/inbox/pawel/message_1.json"),
    true
  );
  assert.equal(
    isMetaMessageJsonPath("messages/inbox/pawel/message_17.json"),
    true
  );
  assert.equal(isMetaMessageJsonPath("messages/inbox/pawel/photos/a.jpg"), false);
  assert.equal(isMetaMessageHtmlPath("messages/inbox/pawel/message_1.html"), true);
});

test("normalizes conversation, text and media", () => {
  const result = normalizeMetaConversation(
    SAMPLE,
    "messages/inbox/pawel_123/message_1.json"
  );

  assert.equal(result.conversation.id, "meta:inbox/pawel_123");
  assert.equal(result.conversation.title, "Paweł");
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].media.images.length, 1);
  assert.equal(result.messages[0].media.images[0].src.includes("photos/1.jpg"), true);
});

test("preserves real repeated messages with duplicate ordinals", () => {
  const { messages } = normalizeMetaConversation(
    SAMPLE,
    "messages/inbox/pawel_123/message_1.json"
  );

  const firstImport = deduplicateImportedMessages(messages, new Map());
  assert.equal(firstImport.insert.length, 3);
  assert.equal(firstImport.skipped, 0);
  assert.notEqual(firstImport.insert[1].id, firstImport.insert[2].id);

  const existingCounts = new Map();
  for (const message of firstImport.insert) {
    existingCounts.set(
      message.fingerprint,
      Math.max(existingCounts.get(message.fingerprint) || 0, message.duplicateOrdinal + 1)
    );
  }

  const repeatedImport = deduplicateImportedMessages(messages, existingCounts);
  assert.equal(repeatedImport.insert.length, 0);
  assert.equal(repeatedImport.skipped, 3);
});

test("repairs historical UTF-8 mojibake when safe", () => {
  assert.equal(decodeMetaText("PaweÅ‚"), "Paweł");
  assert.equal(decodeMetaText("Normal text"), "Normal text");
});
