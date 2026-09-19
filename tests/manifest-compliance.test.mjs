import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public manifest has no Messenger scraping permissions", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal("content_scripts" in manifest, false);
  assert.equal("host_permissions" in manifest, false);

  const optional = manifest.optional_host_permissions || [];
  assert.equal(optional.some(item => item.includes("messenger.com")), false);
  assert.equal(optional.some(item => item.includes("facebook.com/messages")), false);
  assert.equal(optional.some(item => item.includes("fbcdn")), false);
});
