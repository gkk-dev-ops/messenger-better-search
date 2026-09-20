import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Messenger integration is bridge-only and has no scraping/media permissions", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal("host_permissions" in manifest, false);

  const scripts = manifest.content_scripts || [];
  assert.equal(scripts.length, 1);
  assert.deepEqual(scripts[0].js, ["src/search-bridge.js"]);
  assert.deepEqual(scripts[0].matches, [
    "https://www.messenger.com/*",
    "https://www.facebook.com/messages/*"
  ]);

  const optional = manifest.optional_host_permissions || [];
  assert.equal(optional.some(item => item.includes("messenger.com")), false);
  assert.equal(optional.some(item => item.includes("facebook.com/messages")), false);
  assert.equal(optional.some(item => item.includes("fbcdn")), false);

  const bridge = await readFile("src/search-bridge.js", "utf8");
  assert.equal(bridge.includes("STORE_MESSAGES"), false);
  assert.equal(bridge.includes("indexedDB"), false);
  assert.equal(bridge.includes("message_"), false);
});
