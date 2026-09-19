import {
  getEmbeddings,
  getMessages,
  getSession,
  listSessions,
  putEmbedding,
  putMessages,
  putSession
} from "./db.js";

const DEFAULT_SETTINGS = {
  elevenLabsKey: "",
  openAiKey: "",
  enableTranscription: false,
  enableVision: false,
  enableEmbeddings: false,
  autoEnrich: false
};

const PROVIDER_ORIGINS = {
  elevenlabs: "https://api.elevenlabs.io/*",
  openai: "https://api.openai.com/*"
};

const REQUEST_TIMEOUT_MS = 45_000;
const MEDIA_TIMEOUT_MS = 20_000;

class RequestError extends Error {
  /**
   * Represents a bounded network/provider failure.
   * @param {string} message
   * @param {{provider?:string,status?:number,nonRetryable?:boolean}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "RequestError";
    this.provider = options.provider || "network";
    this.status = options.status || null;
    this.nonRetryable = Boolean(options.nonRetryable);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  if (!current.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "STORE_MESSAGES") {
      const messages = message.messages || [];
      await putMessages(messages);
      const cfg = await settings();
      const enrichment = cfg.autoEnrich ? await enrichBatch(messages) : null;
      sendResponse({ ok: true, count: messages.length, enrichment });
      return;
    }

    if (message.type === "SESSION_PROGRESS") {
      const previous = await getSession(message.session.conversationId);
      await putSession({ ...previous, ...message.session });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CONTENT_READY") {
      const previous = await getSession(message.conversationId);
      if (previous?.status === "running") {
        await putSession({
          ...previous,
          status: "paused",
          reason: "TAB_RELOADED",
          detail: "Messenger tab reloaded. Capture can be resumed from the current checkpoint.",
          updatedAt: Date.now()
        });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "LIST_SESSIONS") {
      sendResponse({ ok: true, sessions: await listSessions() });
      return;
    }

    if (message.type === "GET_SESSION") {
      sendResponse({ ok: true, session: await getSession(message.conversationId) });
      return;
    }

    if (message.type === "GET_MESSAGES") {
      sendResponse({ ok: true, messages: await getMessages(message.conversationId) });
      return;
    }

    if (message.type === "EXPORT_CONVERSATION") {
      const messages = await getMessages(message.conversationId);
      const session = await getSession(message.conversationId);
      sendResponse({
        ok: true,
        archive: {
          format: "messenger-memory",
          version: 1,
          exportedAt: new Date().toISOString(),
          session,
          messages
        }
      });
      return;
    }

    if (message.type === "SEARCH_MESSAGES") {
      sendResponse({ ok: true, results: await searchMessages(message) });
      return;
    }

    if (message.type === "ENRICH_MESSAGE") {
      sendResponse({ ok: true, result: await enrichMessage(message.message) });
      return;
    }

    if (message.type === "ANALYZE_GROUP") {
      sendResponse({ ok: true, analysis: await analyzeGroup(message.messages || []) });
      return;
    }

    if (message.type === "GET_SETTINGS") {
      sendResponse({ ok: true, settings: await settings() });
      return;
    }

    if (message.type === "SAVE_SETTINGS") {
      await chrome.storage.local.set({
        settings: { ...DEFAULT_SETTINGS, ...message.settings }
      });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
  })().catch(error => {
    sendResponse({
      ok: false,
      error: String(error?.message || error),
      provider: error?.provider || null,
      status: error?.status || null
    });
  });

  return true;
});

/**
 * Reads settings with defaults applied.
 * @returns {Promise<object>}
 */
async function settings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

/**
 * Ensures the user explicitly granted optional access to an AI provider.
 * @param {"elevenlabs"|"openai"} provider
 * @returns {Promise<void>}
 */
async function requireProviderPermission(provider) {
  const origin = PROVIDER_ORIGINS[provider];
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) {
    throw new RequestError(
      `${provider} permission is required. Enable the feature again from Settings.`,
      { provider, nonRetryable: true }
    );
  }
}

/**
 * Performs a fetch with an AbortController deadline and bounded error surface.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{provider?:string,timeoutMs?:number}} [meta]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, meta = {}) {
  const provider = meta.provider || "network";
  const timeoutMs = meta.timeoutMs || REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new RequestError(
        `${provider} request failed with HTTP ${response.status}`,
        {
          provider,
          status: response.status,
          nonRetryable: response.status === 401 || response.status === 403
        }
      );
    }
    return response;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new RequestError(
        `${provider} request timed out after ${timeoutMs} ms`,
        { provider }
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs automatic enrichment while keeping work attached to the service-worker event.
 * Authentication failures disable further automatic requests to that provider in the batch.
 * @param {object[]} messages
 * @returns {Promise<{processed:number,errors:object[]}>}
 */
async function enrichBatch(messages) {
  const disabledProviders = new Set();
  const errors = [];
  let processed = 0;

  for (const message of messages) {
    try {
      await enrichMessage(message, {
        disabledProviders,
        continueOnProviderError: true,
        onError: error => errors.push({
          messageId: message.id,
          provider: error.provider || "unknown",
          error: error.message
        })
      });
      processed += 1;
    } catch (error) {
      errors.push({
        messageId: message.id,
        provider: error.provider || "unknown",
        error: error.message
      });
    }
  }

  return { processed, errors };
}

/**
 * Executes one provider action with optional batch-level failure containment.
 * @param {string} provider
 * @param {object} context
 * @param {() => Promise<void>} action
 * @returns {Promise<void>}
 */
async function runProviderStep(provider, context, action) {
  const disabledProviders = context.disabledProviders || new Set();
  if (disabledProviders.has(provider)) return;

  try {
    await requireProviderPermission(provider);
    await action();
  } catch (error) {
    if (error?.nonRetryable) disabledProviders.add(provider);
    context.onError?.(error);
    if (!context.continueOnProviderError) throw error;
  }
}

/**
 * Adds optional transcript, image context, and embedding to a message.
 * @param {object} message
 * @param {object} [context]
 * @returns {Promise<object>}
 */
async function enrichMessage(message, context = {}) {
  const cfg = await settings();
  const patch = {
    ...message,
    enrichment: { ...(message.enrichment || {}) }
  };

  const needsTranscription =
    cfg.enableTranscription &&
    cfg.elevenLabsKey &&
    message.media?.audio?.[0] &&
    !patch.transcript;

  if (needsTranscription) {
    await runProviderStep("elevenlabs", context, async () => {
      patch.transcript = await transcribeAudio(
        message.media.audio[0],
        cfg.elevenLabsKey
      );
      patch.enrichment.transcription = {
        provider: "elevenlabs",
        at: Date.now()
      };
    });
  }

  const needsVision =
    cfg.enableVision &&
    cfg.openAiKey &&
    message.media?.images?.length &&
    !patch.imageContext;

  const embeddingText = searchableText(patch);
  const needsEmbedding =
    cfg.enableEmbeddings &&
    cfg.openAiKey &&
    embeddingText.trim();

  if (needsVision || needsEmbedding) {
    await runProviderStep("openai", context, async () => {
      if (needsVision) {
        patch.imageContext = [];
        for (const image of message.media.images.slice(0, 4)) {
          patch.imageContext.push(await describeImage(image.src, cfg.openAiKey));
        }
        patch.enrichment.vision = { provider: "openai", at: Date.now() };
      }

      if (needsEmbedding) {
        const text = searchableText(patch);
        const vector = await embed(text, cfg.openAiKey);
        await putEmbedding(patch.id, vector);
        patch.enrichment.embedding = {
          provider: "openai",
          model: "text-embedding-3-small",
          at: Date.now()
        };
      }
    });
  }

  await putMessages([patch]);
  return patch;
}

/**
 * Fetches a Messenger voice message and transcribes it with ElevenLabs.
 * @param {string} url
 * @param {string} key
 * @returns {Promise<string>}
 */
async function transcribeAudio(url, key) {
  const audio = await fetchWithTimeout(
    url,
    { credentials: "include" },
    { provider: "messenger-media", timeoutMs: MEDIA_TIMEOUT_MS }
  );
  const blob = await audio.blob();
  const form = new FormData();
  form.append("file", blob, "voice-message");
  form.append("model_id", "scribe_v2");

  const response = await fetchWithTimeout(
    "https://api.elevenlabs.io/v1/speech-to-text",
    {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form
    },
    { provider: "elevenlabs" }
  );
  const data = await response.json();
  return data.text || "";
}

/**
 * Downloads a Messenger image and converts it to an inline data URL for vision.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchAsDataUrl(url) {
  const media = await fetchWithTimeout(
    url,
    { credentials: "include" },
    { provider: "messenger-media", timeoutMs: MEDIA_TIMEOUT_MS }
  );
  const blob = await media.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

/**
 * Produces OCR-like searchable visual context for a captured image.
 * @param {string} url
 * @param {string} key
 * @returns {Promise<string>}
 */
async function describeImage(url, key) {
  const imageData = url.startsWith("data:") ? url : await fetchAsDataUrl(url);
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this Messenger image for future search. Include visible text (OCR-like), objects, product names if evident, and why it may matter in conversation. Be factual and concise."
            },
            {
              type: "image_url",
              image_url: { url: imageData }
            }
          ]
        }],
        max_tokens: 250
      })
    },
    { provider: "openai" }
  );

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Creates an OpenAI embedding for searchable conversation context.
 * @param {string} text
 * @param {string} key
 * @returns {Promise<number[]>}
 */
async function embed(text, key) {
  await requireProviderPermission("openai");
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000)
      })
    },
    { provider: "openai" }
  );

  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}

/**
 * Flattens all searchable fields from a stored message.
 * @param {object} message
 * @returns {string}
 */
function searchableText(message) {
  return [
    message.text,
    message.transcript,
    ...(message.imageContext || []),
    message.sender
  ].filter(Boolean).join("\n");
}

/**
 * Computes cosine similarity between two embedding vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosine(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }

  return dot / ((Math.sqrt(aa) * Math.sqrt(bb)) || 1);
}

/**
 * Searches one archive with local date filters and optional semantic scoring.
 * @param {object} options
 * @returns {Promise<object[]>}
 */
async function searchMessages({
  conversationId,
  query = "",
  from = null,
  to = null,
  semantic = false
}) {
  const messages = await getMessages(conversationId);
  const hasDateBoundary = Boolean(from || to);

  const filtered = messages.filter(message => {
    if (hasDateBoundary && !message.timestamp) return false;
    if (from && message.timestamp < from) return false;
    if (to && message.timestamp > to) return false;
    return true;
  });

  if (!query.trim()) return filtered;
  const normalizedQuery = query.toLowerCase();

  if (semantic) {
    const cfg = await settings();
    if (!cfg.enableEmbeddings || !cfg.openAiKey) {
      throw new Error("Semantic search requires embeddings + OpenAI key.");
    }

    const queryVector = await embed(query, cfg.openAiKey);
    const vectors = new Map(
      (await getEmbeddings()).map(item => [item.messageId, item.vector])
    );

    return filtered
      .filter(message => vectors.has(message.id))
      .map(message => ({
        ...message,
        score: cosine(queryVector, vectors.get(message.id))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
  }

  return filtered.filter(message =>
    searchableText(message).toLowerCase().includes(normalizedQuery)
  );
}

/**
 * Summarizes a selected temporal group for retrieval.
 * @param {object[]} messages
 * @returns {Promise<string>}
 */
async function analyzeGroup(messages) {
  const cfg = await settings();
  if (!cfg.openAiKey) {
    throw new Error("Group analysis requires an OpenAI key in Settings.");
  }

  await requireProviderPermission("openai");

  const compact = messages.slice(0, 250).map(message => ({
    at: message.timestamp ? new Date(message.timestamp).toISOString() : null,
    sender: message.sender || null,
    text: searchableText(message).slice(0, 1200)
  })).filter(item => item.text);

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + cfg.openAiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: "Summarize Messenger conversation history for retrieval, not judgment. Return concise sections: Topics, Decisions/requests, People/products/places, and Useful search terms. Do not invent facts."
        }, {
          role: "user",
          content: JSON.stringify(compact)
        }],
        max_tokens: 700
      })
    },
    { provider: "openai" }
  );

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}
