const { parseDateLabel, localDayKey } = globalThis.MessengerMemoryDate;

const state = {
  running: false,
  paused: false,
  stopRequested: false,
  targetDate: null,
  conversationId: null,
  lastVisibleDate: null,
  noProgressRounds: 0
};

const DATE_LABEL_RE = /(today|yesterday|dzisiaj|wczoraj|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sty|lut|mar|kwi|maj|cze|lip|sie|wrz|paź|lis|gru)[a-ząćęłńóśźż]*)/i;

/**
 * Waits between Messenger scroll/load iterations.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Produces a small deterministic fingerprint for locally deduplicating records.
 * @param {string} input
 * @returns {string}
 */
function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Resolves the current Messenger conversation identifier from the URL.
 * @returns {string}
 */
function getConversationId() {
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, "");
  const id = path.split("/").filter(Boolean).pop();
  return id || hash(location.href);
}

/**
 * Locates the largest scrollable region, which is normally the conversation pane.
 * @returns {Element}
 */
function findScrollContainer() {
  const candidates = [...document.querySelectorAll("div")].filter(el => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight * 1.5;
  });
  return candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement;
}

/**
 * Picks a DOM root for capture that is scoped to the active Messenger conversation.
 * @param {Element} scroller
 * @returns {Element}
 */
function captureRoot(scroller) {
  if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    return document.querySelector("[role='main']") || document.body;
  }
  return scroller;
}

/**
 * Collects parseable date-separator elements in document order.
 * @param {Element} root
 * @returns {Array<{element: Element, ts: number, text: string}>}
 */
function collectDateMarkers(root) {
  const markers = [];
  for (const element of root.querySelectorAll("*")) {
    const text = element.textContent?.trim();
    if (!text || text.length > 60 || !DATE_LABEL_RE.test(text)) continue;
    const ts = parseDateLabel(text);
    if (ts) markers.push({ element, ts, text });
  }
  return markers;
}

/**
 * Resolves the closest date separator that precedes a message node.
 * @param {Element} node
 * @param {Array<{element: Element, ts: number, text: string}>} markers
 * @returns {{element: Element, ts: number, text: string}|null}
 */
function nearestPrecedingDate(node, markers) {
  let nearest = null;
  for (const marker of markers) {
    if (marker.element === node || node.contains(marker.element)) continue;
    const relation = marker.element.compareDocumentPosition(node);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) nearest = marker;
  }
  return nearest;
}

/**
 * Converts one visible Messenger message-like node into a local archive record.
 * @param {Element} node
 * @param {{ts:number,text:string}|null} inheritedDate
 * @returns {object|null}
 */
function normalizeMessageNode(node, inheritedDate) {
  const text = node.innerText?.trim() || "";
  if (text && text.length <= 60 && DATE_LABEL_RE.test(text) && parseDateLabel(text)) return null;

  const images = [...node.querySelectorAll("img")].map(img => ({
    src: img.currentSrc || img.src || "",
    alt: img.alt || "",
    width: img.naturalWidth || null,
    height: img.naturalHeight || null
  })).filter(image => image.src && !image.src.startsWith("data:"));

  const audio = [...node.querySelectorAll("audio, source[type^='audio']")]
    .map(element => element.currentSrc || element.src)
    .filter(Boolean);
  const video = [...node.querySelectorAll("video, source[type^='video']")]
    .map(element => element.currentSrc || element.src)
    .filter(Boolean);

  const time = node.querySelector("time");
  const explicitTimestamp = time?.dateTime ? Date.parse(time.dateTime) : Number.NaN;
  const timestamp = Number.isNaN(explicitTimestamp) ? inheritedDate?.ts || null : explicitTimestamp;

  if (!text && !images.length && !audio.length && !video.length) return null;

  const sender = node.getAttribute("aria-label") ||
    node.querySelector("[dir='auto']")?.getAttribute("aria-label") ||
    null;

  const fingerprint = [
    state.conversationId,
    timestamp,
    sender,
    text,
    images.map(image => image.src).join("|"),
    audio.join("|"),
    video.join("|")
  ].join("::");

  return {
    id: hash(fingerprint),
    conversationId: state.conversationId,
    sender,
    text,
    timestamp,
    dayKey: timestamp ? localDayKey(timestamp) : "unknown",
    dateLabel: inheritedDate?.text || null,
    media: { images, audio, video },
    capturedAt: Date.now(),
    sourceUrl: location.href
  };
}

/**
 * Captures visible records and assigns a date marker independently to each message.
 * @param {Element} scroller
 * @returns {object[]}
 */
function collectMessages(scroller) {
  const root = captureRoot(scroller);
  const markers = collectDateMarkers(root);
  const selectors = [
    "[role='row']",
    "[data-scope='messages_table'] [role='row']",
    "[role='main'] [dir='auto']"
  ];

  const seen = new Set();
  const items = [];

  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      if (seen.has(node)) continue;
      seen.add(node);
      const date = nearestPrecedingDate(node, markers);
      const item = normalizeMessageNode(node, date);
      if (item) items.push(item);
    }
    if (items.length) break;
  }

  const datedItems = items.filter(item => item.timestamp);
  if (datedItems.length) {
    const oldest = datedItems.reduce((current, item) =>
      !current || item.timestamp < current.timestamp ? item : current
    , null);
    state.lastVisibleDate = {
      ts: oldest.timestamp,
      text: oldest.dateLabel || new Date(oldest.timestamp).toLocaleDateString()
    };
  } else if (markers.length) {
    const oldestMarker = markers.reduce((current, marker) =>
      !current || marker.ts < current.ts ? marker : current
    , null);
    state.lastVisibleDate = oldestMarker;
  }

  return items;
}

/**
 * Persists the current capture checkpoint in extension storage.
 * @param {object} [extra]
 * @returns {Promise<void>}
 */
async function persistProgress(extra = {}) {
  await chrome.runtime.sendMessage({
    type: "SESSION_PROGRESS",
    session: {
      conversationId: state.conversationId,
      sourceUrl: location.href,
      status: state.running ? "running" : state.paused ? "paused" : "idle",
      currentDate: state.lastVisibleDate?.ts || null,
      currentDateLabel: state.lastVisibleDate?.text || null,
      targetDate: state.targetDate,
      updatedAt: Date.now(),
      ...extra
    }
  });
}

/**
 * Runs the resumable Messenger capture loop until target, pause, or load exhaustion.
 * @returns {Promise<void>}
 */
async function runCapture() {
  const scroller = findScrollContainer();
  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  state.noProgressRounds = 0;
  let previousHeight = scroller.scrollHeight;

  try {
    while (!state.stopRequested) {
      const batch = collectMessages(scroller);
      if (batch.length) {
        await chrome.runtime.sendMessage({ type: "STORE_MESSAGES", messages: batch });
      }

      const currentTs = batch
        .map(item => item.timestamp)
        .filter(Boolean)
        .reduce((min, ts) => Math.min(min, ts), Number.POSITIVE_INFINITY);

      const checkpointTs = Number.isFinite(currentTs) ? currentTs : state.lastVisibleDate?.ts;
      if (checkpointTs) {
        state.lastVisibleDate = {
          ts: checkpointTs,
          text: state.lastVisibleDate?.text || new Date(checkpointTs).toLocaleDateString()
        };
      }

      if (state.targetDate && checkpointTs && checkpointTs <= state.targetDate) {
        state.running = false;
        await persistProgress({
          status: "completed",
          reason: "TARGET_DATE_REACHED",
          completedAt: Date.now()
        });
        return;
      }

      await persistProgress({ status: "running", messageCountInView: batch.length });

      const beforeTop = scroller.scrollTop;
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollTop - Math.max(scroller.clientHeight * 0.85, 700)
      );
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(document.visibilityState === "hidden" ? 1300 : 800);

      const newHeight = scroller.scrollHeight;
      const stuck = scroller.scrollTop === beforeTop && newHeight === previousHeight;
      state.noProgressRounds = stuck ? state.noProgressRounds + 1 : 0;
      previousHeight = newHeight;

      if (state.noProgressRounds >= 6) {
        state.running = false;
        state.paused = true;
        await persistProgress({
          status: "paused",
          reason: "NO_MORE_HISTORY_OR_TAB_THROTTLED",
          detail: document.visibilityState === "hidden"
            ? "Messenger stopped loading older DOM while the tab was in background. Re-open the tab and resume."
            : "Messenger stopped exposing older messages. This may be the beginning of available history."
        });
        return;
      }
    }

    state.running = false;
    state.paused = true;
    await persistProgress({ status: "paused", reason: "USER_PAUSED" });
  } catch (error) {
    state.running = false;
    state.paused = true;
    await persistProgress({
      status: "error",
      reason: "CAPTURE_ERROR",
      detail: String(error?.message || error)
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_CAPTURE") {
    if (state.running) {
      sendResponse({ ok: true, alreadyRunning: true });
      return;
    }
    state.conversationId = getConversationId();
    state.targetDate = message.targetDate || null;
    state.lastVisibleDate = null;
    runCapture();
    sendResponse({ ok: true, conversationId: state.conversationId });
    return true;
  }

  if (message.type === "PAUSE_CAPTURE") {
    state.stopRequested = true;
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "RESUME_CAPTURE") {
    if (state.running) {
      sendResponse({ ok: true, alreadyRunning: true });
      return;
    }
    state.conversationId = message.conversationId || getConversationId();
    state.targetDate = message.targetDate || state.targetDate;
    runCapture();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PING") {
    sendResponse({
      ok: true,
      conversationId: getConversationId(),
      visibility: document.visibilityState
    });
  }
});

chrome.runtime.sendMessage({
  type: "CONTENT_READY",
  conversationId: getConversationId(),
  sourceUrl: location.href
}).catch(() => {});
