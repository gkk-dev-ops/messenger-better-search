import { test, expect, chromium } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSION_PATH = path.join(ROOT, "dist");

async function createMetaFixture(directory) {
  const archive = zipSync({
    "your_facebook_activity/messages/inbox/pawel_123/message_1.json":
      strToU8(JSON.stringify({
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
            content: "Can you print a stand for this soft flask?",
            photos: [{
              uri: "messages/inbox/pawel_123/photos/soft-flask.jpg"
            }]
          },
          {
            sender_name: "Grzegorz",
            timestamp_ms: 1780000060000,
            content: "Sure, send me the bottom diameter."
          },
          {
            sender_name: "Paweł",
            timestamp_ms: 1780000120000,
            content: "52 mm"
          }
        ]
      })),
    "your_facebook_activity/messages/inbox/pawel_123/photos/soft-flask.jpg":
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    "profile_information/profile_information.json":
      strToU8(JSON.stringify({ name: "ignored" }))
  });

  const fixturePath = path.join(directory, "meta-messages.zip");
  await writeFile(fixturePath, archive);
  return fixturePath;
}

async function launchExtension() {
  const userDataDir = path.join(
    tmpdir(),
    `mbs-playwright-${process.pid}-${Date.now()}`
  );
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent("serviceworker");
  }

  const extensionId = new URL(worker.url()).host;
  return { context, extensionId, userDataDir };
}

test("imports official Meta ZIP, searches it, and deduplicates a repeated import", async () => {
  const fixtureDir = path.join(
    tmpdir(),
    `mbs-fixture-${process.pid}-${Date.now()}`
  );
  await mkdir(fixtureDir, { recursive: true });
  const fixturePath = await createMetaFixture(fixtureDir);

  const { context, extensionId, userDataDir } = await launchExtension();

  try {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/importer.html`
    );

    await page.locator("#files").setInputFiles(fixturePath);
    await expect(page.locator("#doneCard")).toBeVisible();
    await expect(page.locator("#doneSummary")).toContainText(
      "3 new messages"
    );
    await expect(page.locator("#doneSummary")).toContainText(
      "0 duplicates skipped"
    );

    await page.locator("#searchArchive").click();
    await expect(page).toHaveURL(/\/src\/search\.html$/);
    await expect(page.locator("#conversation")).toContainText("Paweł");
    await expect(page.locator("#conversation")).toContainText("3 messages");

    await page.locator("#query").fill("soft flask");
    await page.locator("#run").click();
    await expect(page.locator("#timeline")).toContainText(
      "Can you print a stand for this soft flask?"
    );

    await page.goto(
      `chrome-extension://${extensionId}/src/importer.html`
    );
    await page.locator("#files").setInputFiles(fixturePath);
    await expect(page.locator("#doneCard")).toBeVisible();
    await expect(page.locator("#doneSummary")).toContainText(
      "0 new messages"
    );
    await expect(page.locator("#doneSummary")).toContainText(
      "3 duplicates skipped"
    );
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("rejects Meta HTML exports with an actionable message", async () => {
  const fixtureDir = path.join(
    tmpdir(),
    `mbs-html-fixture-${process.pid}-${Date.now()}`
  );
  await mkdir(fixtureDir, { recursive: true });

  const archive = zipSync({
    "messages/inbox/pawel/message_1.html":
      strToU8("<html><body>Messenger export</body></html>")
  });
  const fixturePath = path.join(fixtureDir, "meta-html.zip");
  await writeFile(fixturePath, archive);

  const { context, extensionId, userDataDir } = await launchExtension();

  try {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/importer.html`
    );

    await page.locator("#files").setInputFiles(fixturePath);
    await expect(page.locator("#importError")).toBeVisible();
    await expect(page.locator("#importError")).toContainText(
      "choose JSON format"
    );
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
