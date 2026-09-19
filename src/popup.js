const $ = id => document.getElementById(id);

/**
 * Loads local archive statistics for the extension popup.
 */
async function init() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_ARCHIVE_STATS" });
    if (!response?.ok) throw new Error(response?.error || "Could not load archive.");

    const stats = response.stats;
    $("messageCount").textContent = stats.messages.toLocaleString();
    $("conversationCount").textContent = stats.conversations.toLocaleString();

    if (stats.lastImport) {
      $("lastImport").textContent =
        `Last import: ${new Date(stats.lastImport.completedAt).toLocaleString()}`;
      $("onboardingTitle").textContent = "Keep your archive up to date";
      $("onboardingCopy").textContent =
        "Import a newer Meta JSON export. Existing messages are deduplicated locally.";
    } else {
      $("lastImport").textContent = "No Meta export imported yet.";
    }

    $("search").disabled = stats.messages === 0;
  } catch (error) {
    $("lastImport").textContent = String(error?.message || error);
    $("search").disabled = true;
  }
}

$("import").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/importer.html") });
});

$("search").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/search.html") });
});

$("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
