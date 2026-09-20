import { test, expect, chromium } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSION_PATH = path.join(ROOT, "dist");

async function launchExtension() {
  const userDataDir = path.join(
    tmpdir(),
    `mbs-bridge-${process.pid}-${Date.now()}`
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
  if (!worker) worker = await context.waitForEvent("serviceworker");

  return {
    context,
    extensionId: new URL(worker.url()).host,
    userDataDir
  };
}

test("injects Open in Better Search beside Messenger conversation search and forwards the query", async () => {
  const { context, extensionId, userDataDir } = await launchExtension();

  try {
    await context.route("https://www.messenger.com/**", async route => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html>
          <html>
            <body style="background:#111;color:#fff">
              <main>
                <section role="dialog" aria-label="Search in conversation">
                  <label>
                    Search in conversation
                    <input
                      aria-label="Search in conversation"
                      placeholder="Search in conversation"
                    />
                  </label>
                  <div aria-label="Messenger search results">
                    <div>Fixture result that the extension must not read.</div>
                  </div>
                </section>
              </main>
            </body>
          </html>`
      });
    });

    const messenger = await context.newPage();
    await messenger.goto("https://www.messenger.com/t/fixture");

    const input = messenger.getByRole("textbox", { name: "Search in conversation" });
    await expect(input).toBeVisible();

    const button = messenger.getByRole("button", {
      name: "Open this query in Messenger Better Search"
    });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();

    await input.fill("soft flask");
    await expect(button).toBeEnabled();

    const newPagePromise = context.waitForEvent("page");
    await button.click();
    const betterSearch = await newPagePromise;
    await betterSearch.waitForLoadState("domcontentloaded");

    expect(betterSearch.url()).toBe(
      `chrome-extension://${extensionId}/src/search.html?q=soft+flask`
    );
    await expect(betterSearch.locator("#query")).toHaveValue("soft flask");
    await expect(betterSearch.locator("#conversation")).toContainText(
      "All conversations"
    );
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
