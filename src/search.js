import "./date-utils.js";

const { localDayKey } = globalThis.MessengerBetterSearchDate;
const $ = id => document.getElementById(id);
const OPENAI_ORIGIN = "https://api.openai.com/*";
let conversations = [];

/**
 * Escapes untrusted captured text before inserting it into archive HTML.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

/**
 * Computes the local Monday for week grouping.
 * @param {Date} date
 * @returns {Date}
 */
function startOfWeek(date) {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Generates a stable local-calendar group key and display label.
 * @param {number|null} timestamp
 * @param {"day"|"week"|"month"|"year"} mode
 * @returns {{key:string,label:string}}
 */
function groupKey(timestamp, mode) {
  if (!timestamp) return { key: "unknown", label: "Unknown date" };
  const date = new Date(timestamp);

  if (mode === "year") {
    return {
      key: String(date.getFullYear()),
      label: String(date.getFullYear())
    };
  }

  if (mode === "month") {
    const key =
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return {
      key,
      label: new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric"
      }).format(date)
    };
  }

  if (mode === "week") {
    const weekStart = startOfWeek(date);
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return {
      key: localDayKey(weekStart),
      label: `${weekStart.toLocaleDateString()} – ${end.toLocaleDateString()}`
    };
  }

  return {
    key: localDayKey(date),
    label: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date)
  };
}

/**
 * Renders text, transcripts, and image context for one message.
 * @param {object} message
 * @returns {string}
 */
function messageBody(message) {
  const parts = [];

  if (message.text) {
    parts.push(`<div class="body">${escapeHtml(message.text)}</div>`);
  }

  if (message.transcript) {
    parts.push(
      `<div class="media-note"><strong>Voice transcript</strong><br>${escapeHtml(message.transcript)}</div>`
    );
  }

  for (const [index, context] of (message.imageContext || []).entries()) {
    parts.push(
      `<div class="media-note"><strong>Image ${index + 1}</strong><br>${escapeHtml(context)}</div>`
    );
  }

  if (message.media?.images?.length && !message.imageContext?.length) {
    parts.push(
      `<div class="media-note">${message.media.images.length} image(s) captured — enable image understanding to make them searchable.</div>`
    );
  }

  if (message.media?.audio?.length && !message.transcript) {
    parts.push(
      '<div class="media-note">Voice message captured — enable transcription to search its content.</div>'
    );
  }

  return parts.join("");
}

/**
 * Requests OpenAI host permission from a direct archive-page user gesture.
 * @returns {Promise<boolean>}
 */
async function ensureOpenAiPermission() {
  const granted = await chrome.permissions.contains({
    origins: [OPENAI_ORIGIN]
  });
  if (granted) return true;
  return chrome.permissions.request({ origins: [OPENAI_ORIGIN] });
}

/**
 * Loads conversation sessions into the archive selector.
 * @returns {Promise<void>}
 */
async function loadConversations() {
  const response = await chrome.runtime.sendMessage({ type: "LIST_CONVERSATIONS" });
  if (!response?.ok) {
    throw new Error(response?.error || "Could not load conversations.");
  }

  conversations = response.conversations || [];
  $("conversation").innerHTML = [
    '<option value="*">All conversations</option>',
    ...conversations.map(conversation =>
      `<option value="${escapeHtml(conversation.id)}">${escapeHtml(conversation.title || conversation.id)} · ${(conversation.messageCount || 0).toLocaleString()} messages</option>`
    )
  ].join("");

  if (!conversations.length) {
    $("timeline").innerHTML =
      '<div class="card"><strong>No imported conversations yet.</strong><p class="muted">Import a Meta Export Your Information JSON archive first.</p></div>';
  }
}

/**
 * Executes local or semantic archive search.
 * @returns {Promise<void>}
 */
async function run() {
  const conversationId = $("conversation").value;
  if (!conversationId) return;

  try {
    if ($("semantic").checked) {
      const permission = await ensureOpenAiPermission();
      if (!permission) {
        throw new Error("OpenAI permission is required for semantic search.");
      }
    }

    const from = $("from").value
      ? new Date($("from").value + "T00:00:00").getTime()
      : null;
    const to = $("to").value
      ? new Date($("to").value + "T23:59:59").getTime()
      : null;

    const response = await chrome.runtime.sendMessage({
      type: "SEARCH_MESSAGES",
      conversationId,
      query: $("query").value,
      from,
      to,
      semantic: $("semantic").checked
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Search failed.");
    }

    render(response.results || []);
  } catch (error) {
    $("timeline").innerHTML =
      `<div class="card status-reason">${escapeHtml(String(error?.message || error))}</div>`;
  }
}

/**
 * Renders grouped search results and attaches group-analysis actions.
 * @param {object[]} messages
 */
function render(messages) {
  $("count").textContent = `${messages.length} messages`;
  const conversationNames = new Map(
    conversations.map(conversation => [
      conversation.id,
      conversation.title || conversation.id
    ])
  );
  const mode = $("groupBy").value;
  const groups = new Map();

  for (const message of messages) {
    const group = groupKey(message.timestamp, mode);
    if (!groups.has(group.key)) {
      groups.set(group.key, { ...group, messages: [] });
    }
    groups.get(group.key).messages.push(message);
  }

  $("timeline").innerHTML = [...groups.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map(group => `
      <details class="group">
        <summary>
          <span>${escapeHtml(group.label)}</span>
          <span class="muted">${group.messages.length} messages</span>
        </summary>
        <div class="message">
          <button class="secondary analyze" data-group="${escapeHtml(group.key)}">Analyze this group with AI</button>
          <div class="media-note analysis-output" data-analysis="${escapeHtml(group.key)}" hidden></div>
        </div>
        ${group.messages.map(message => `
          <article class="message">
            <div class="meta">${escapeHtml(conversationNames.get(message.conversationId) || "Unknown conversation")} · ${escapeHtml(message.sender || "Unknown sender")} · ${message.timestamp ? new Date(message.timestamp).toLocaleString() : "unknown time"}${typeof message.score === "number" ? " · similarity " + message.score.toFixed(3) : ""}</div>
            ${messageBody(message)}
          </article>
        `).join("")}
      </details>
    `).join("");

  document.querySelectorAll(".analyze").forEach(button => {
    button.addEventListener("click", async () => {
      const group = groups.get(button.dataset.group);
      const output = document.querySelector(
        `[data-analysis="${CSS.escape(button.dataset.group)}"]`
      );
      output.hidden = false;
      output.textContent = "Analyzing…";

      try {
        const permission = await ensureOpenAiPermission();
        if (!permission) {
          throw new Error("OpenAI permission is required for group analysis.");
        }

        const response = await chrome.runtime.sendMessage({
          type: "ANALYZE_GROUP",
          messages: group.messages
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Analysis failed.");
        }

        output.textContent = response.analysis;
      } catch (error) {
        output.textContent = String(error?.message || error);
      }
    });
  });
}

$("run").addEventListener("click", run);
$("groupBy").addEventListener("change", run);
$("conversation").addEventListener("change", run);
$("query").addEventListener("keydown", event => {
  if (event.key === "Enter") run();
});

$("export").addEventListener("click", async () => {
  const conversationId = $("conversation").value;
  if (!conversationId) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "EXPORT_CONVERSATION",
      conversationId
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Export failed.");
    }

    const blob = new Blob(
      [JSON.stringify(response.archive, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `messenger-better-search-${conversationId}-${localDayKey(new Date())}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    $("timeline").innerHTML =
      `<div class="card status-reason">${escapeHtml(String(error?.message || error))}</div>`;
  }
});

try {
  const initialQuery = new URL(location.href).searchParams.get("q");
  if (initialQuery) $("query").value = initialQuery;

  await loadConversations();
  if (initialQuery || conversations.length) await run();
} catch (error) {
  $("timeline").innerHTML =
    `<div class="card status-reason">${escapeHtml(String(error?.message || error))}</div>`;
}


$("importMore").addEventListener("click", () => {
  location.href = chrome.runtime.getURL("src/importer.html");
});
