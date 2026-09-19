import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { readMetaZip } from "../src/meta-zip.js";

test("streaming ZIP reader extracts only Messenger JSON chunks", async () => {
  const archive = zipSync({
    "your_facebook_activity/messages/inbox/pawel/message_1.json":
      strToU8(JSON.stringify({
        participants: [{ name: "Paweł" }],
        messages: [{ sender_name: "Paweł", timestamp_ms: 1, content: "hello" }]
      })),
    "your_facebook_activity/messages/inbox/pawel/photos/photo.jpg":
      new Uint8Array([1, 2, 3, 4]),
    "unrelated/profile_information.json":
      strToU8("{}")
  });

  const result = await readMetaZip(new Blob([archive]));

  assert.equal(result.entries.length, 1);
  assert.equal(
    result.entries[0].name,
    "your_facebook_activity/messages/inbox/pawel/message_1.json"
  );
  assert.equal(JSON.parse(result.entries[0].text).messages[0].content, "hello");
  assert.equal(result.sawHtml, false);
});

test("streaming ZIP reader reports HTML Messenger exports", async () => {
  const archive = zipSync({
    "messages/inbox/pawel/message_1.html": strToU8("<html></html>")
  });

  const result = await readMetaZip(new Blob([archive]));
  assert.equal(result.entries.length, 0);
  assert.equal(result.sawHtml, true);
});
