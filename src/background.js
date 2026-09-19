import { getEmbeddings, getMessages, getSession, listSessions, putEmbedding, putMessages, putSession } from "./db.js";

const DEFAULT_SETTINGS = {
  elevenLabsKey: "",
  openAiKey: "",
  enableTranscription: false,
  enableVision: false,
  enableEmbeddings: false,
  autoEnrich: false
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  if (!current.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "STORE_MESSAGES") {
      await putMessages(message.messages || []);
      if ((await settings()).autoEnrich) enrichBatch(message.messages || []).catch(console.error);
      sendResponse({ ok: true, count: message.messages?.length || 0 });
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

    if (message.type === "SEARCH_MESSAGES") {
      sendResponse({ ok: true, results: await searchMessages(message) });
      return;
    }

    if (message.type === "ENRICH_MESSAGE") {
      sendResponse({ ok: true, result: await enrichMessage(message.message) });
      return;
    }

    if (message.type === "GET_SETTINGS") {
      sendResponse({ ok: true, settings: await settings() });
      return;
    }

    if (message.type === "SAVE_SETTINGS") {
      await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...message.settings } });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
  })().catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function settings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function enrichBatch(messages) {
  for (const message of messages) {
    try { await enrichMessage(message); } catch (error) { console.warn("Enrichment failed", error); }
  }
}

async function enrichMessage(message) {
  const cfg = await settings();
  const patch = { ...message, enrichment: { ...(message.enrichment || {}) } };

  if (cfg.enableTranscription && cfg.elevenLabsKey && message.media?.audio?.[0] && !patch.transcript) {
    patch.transcript = await transcribeAudio(message.media.audio[0], cfg.elevenLabsKey);
    patch.enrichment.transcription = { provider: "elevenlabs", at: Date.now() };
  }

  if (cfg.enableVision && cfg.openAiKey && message.media?.images?.length && !patch.imageContext) {
    patch.imageContext = [];
    for (const image of message.media.images.slice(0, 4)) {
      patch.imageContext.push(await describeImage(image.src, cfg.openAiKey));
    }
    patch.enrichment.vision = { provider: "openai", at: Date.now() };
  }

  if (cfg.enableEmbeddings && cfg.openAiKey) {
    const text = searchableText(patch);
    if (text.trim()) {
      const vector = await embed(text, cfg.openAiKey);
      await putEmbedding(patch.id, vector);
      patch.enrichment.embedding = { provider: "openai", model: "text-embedding-3-small", at: Date.now() };
    }
  }

  if (patch !== message) await putMessages([patch]);
  return patch;
}

async function transcribeAudio(url, key) {
  const audio = await fetch(url, { credentials: "include" });
  if (!audio.ok) throw new Error("Could not fetch Messenger audio: " + audio.status);
  const blob = await audio.blob();
  const form = new FormData();
  form.append("file", blob, "voice-message");
  form.append("model_id", "scribe_v2");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form
  });
  if (!res.ok) throw new Error("ElevenLabs: " + res.status);
  const data = await res.json();
  return data.text || "";
}

async function describeImage(url, key) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
          { type: "text", text: "Describe this Messenger image for future search. Include visible text (OCR-like), objects, product names if evident, and why it may matter in conversation. Be factual and concise." },
          { type: "image_url", image_url: { url } }
        ]
      }],
      max_tokens: 250
    })
  });
  if (!res.ok) throw new Error("OpenAI vision: " + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function embed(text, key) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) })
  });
  if (!res.ok) throw new Error("OpenAI embeddings: " + res.status);
  const data = await res.json();
  return data.data?.[0]?.embedding || [];
}

function searchableText(message) {
  return [
    message.text,
    message.transcript,
    ...(message.imageContext || []),
    message.sender
  ].filter(Boolean).join("\n");
}

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  return dot / ((Math.sqrt(aa) * Math.sqrt(bb)) || 1);
}

async function searchMessages({ conversationId, query = "", from = null, to = null, semantic = false }) {
  const messages = await getMessages(conversationId);
  let filtered = messages.filter(m => {
    if (from && m.timestamp && m.timestamp < from) return false;
    if (to && m.timestamp && m.timestamp > to) return false;
    return true;
  });

  if (!query.trim()) return filtered;
  const q = query.toLowerCase();

  if (semantic) {
    const cfg = await settings();
    if (!cfg.enableEmbeddings || !cfg.openAiKey) throw new Error("Semantic search requires embeddings + OpenAI key.");
    const qv = await embed(query, cfg.openAiKey);
    const vectors = new Map((await getEmbeddings()).map(x => [x.messageId, x.vector]));
    return filtered.map(m => ({ ...m, score: vectors.has(m.id) ? cosine(qv, vectors.get(m.id)) : 0 }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 100);
  }

  return filtered.filter(m => searchableText(m).toLowerCase().includes(q));
}
