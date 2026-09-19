const fields = [
  "enableTranscription",
  "elevenLabsKey",
  "enableVision",
  "enableEmbeddings",
  "openAiKey",
  "autoEnrich"
];

const PROVIDER_ORIGINS = {
  elevenlabs: "https://api.elevenlabs.io/*",
  openai: "https://api.openai.com/*"
};

const MESSENGER_MEDIA_ORIGINS = [
  "https://*.fbcdn.net/*",
  "https://*.fbsbx.com/*"
];

/**
 * Shows settings success or failure feedback.
 * @param {string} message
 * @param {boolean} [isError]
 */
function showStatus(message, isError = false) {
  const status = document.getElementById("saved");
  status.textContent = message;
  status.style.color = isError ? "var(--danger)" : "";
}

/**
 * Requests an optional host permission from a direct user gesture.
 * @param {"elevenlabs"|"openai"} provider
 * @returns {Promise<boolean>}
 */
async function ensureOriginsPermission(origins) {
  const hasPermission = await chrome.permissions.contains({ origins });
  if (hasPermission) return true;
  return chrome.permissions.request({ origins });
}

/**
 * Requests one provider origin and, when needed, Messenger CDN access.
 * @param {"elevenlabs"|"openai"} provider
 * @param {boolean} includeMessengerMedia
 * @returns {Promise<boolean>}
 */
async function ensureProviderPermission(provider, includeMessengerMedia = false) {
  const origins = [PROVIDER_ORIGINS[provider]];
  if (includeMessengerMedia) origins.push(...MESSENGER_MEDIA_ORIGINS);
  return ensureOriginsPermission(origins);
}

/**
 * Loads saved settings without assuming background messaging succeeded.
 * @returns {Promise<void>}
 */
async function initialize() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!response?.ok || !response.settings) {
      throw new Error(response?.error || "Could not load settings.");
    }

    for (const field of fields) {
      const element = document.getElementById(field);
      if (element.type === "checkbox") {
        element.checked = Boolean(response.settings[field]);
      } else {
        element.value = response.settings[field] || "";
      }
    }
  } catch (error) {
    showStatus(String(error?.message || error), true);
  }
}

document.getElementById("save").addEventListener("click", async () => {
  try {
    showStatus("");

    const settings = {};
    for (const field of fields) {
      const element = document.getElementById(field);
      settings[field] = element.type === "checkbox"
        ? element.checked
        : element.value.trim();
    }

    if (settings.enableTranscription) {
      const granted = await ensureProviderPermission("elevenlabs", true);
      if (!granted) {
        throw new Error("ElevenLabs and Messenger media permissions were not granted.");
      }
    }

    if (settings.enableVision) {
      const granted = await ensureProviderPermission("openai", true);
      if (!granted) {
        throw new Error("OpenAI and Messenger media permissions were not granted.");
      }
    } else if (settings.enableEmbeddings) {
      const granted = await ensureProviderPermission("openai");
      if (!granted) throw new Error("OpenAI permission was not granted.");
    }

    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not save settings.");
    }

    showStatus("Saved locally");
    setTimeout(() => showStatus(""), 1800);
  } catch (error) {
    showStatus(String(error?.message || error), true);
  }
});

await initialize();
