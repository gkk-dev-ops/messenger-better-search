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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function getConversationId() {
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, "");
  const id = path.split("/").filter(Boolean).pop();
  return id || hash(location.href);
}

function parseDateLabel(raw, now = new Date()) {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  if (/^(today|dzisiaj)$/.test(text)) return d.getTime();
  if (/^(yesterday|wczoraj)$/.test(text)) {
    d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  const numeric = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return new Date(year, Number(numeric[2]) - 1, Number(numeric[1]), 12).getTime();
  }

  const months = {
    jan:0, january:0, sty:0, stycznia:0,
    feb:1, february:1, lut:1, lutego:1,
    mar:2, march:2, marca:2,
    apr:3, april:3, kwi:3, kwietnia:3,
    may:4, maj:4, maja:4,
    jun:5, june:5, cze:5, czerwca:5,
    jul:6, july:6, lip:6, lipca:6,
    aug:7, august:7, sie:7, sierpnia:7,
    sep:8, september:8, wrz:8, września:8,
    oct:9, october:9, paź:9, października:9,
    nov:10, november:10, lis:10, listopada:10,
    dec:11, december:11, gru:11, grudnia:11
  };
  const named = text.match(/^(\d{1,2})\s+([^\s]+)(?:\s+(\d{4}))?$/);
  if (named) {
    const token = named[2].replace(/[.,]/g, "");
    const month = months[token] ?? months[token.slice(0,3)];
    if (month !== undefined) {
      const year = named[3] ? Number(named[3]) : now.getFullYear();
      return new Date(year, month, Number(named[1]), 12).getTime();
    }
  }
  return null;
}

function findScrollContainer() {
  const candidates = [...document.querySelectorAll("div")].filter(el => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight * 1.5;
  });
  return candidates.sort((a,b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement;
}

function collectVisibleDate() {
  const nodes = [...document.querySelectorAll("[role='main'] *")];
  const hits = [];
  for (const el of nodes) {
    const text = el.textContent?.trim();
    if (!text || text.length > 60 || !DATE_LABEL_RE.test(text)) continue;
    const ts = parseDateLabel(text);
    if (ts) hits.push({ ts, text, top: el.getBoundingClientRect().top });
  }
  hits.sort((a,b) => a.top - b.top);
  return hits[0] || null;
}

function normalizeMessageNode(node, inheritedDate) {
  const text = node.innerText?.trim() || "";
  const imgs = [...node.querySelectorAll("img")].map(img => ({
    src: img.currentSrc || img.src || "",
    alt: img.alt || "",
    width: img.naturalWidth || null,
    height: img.naturalHeight || null
  })).filter(x => x.src && !x.src.startsWith("data:"));

  const audio = [...node.querySelectorAll("audio, source")].map(el => el.currentSrc || el.src).filter(Boolean);
  const time = node.querySelector("time");
  const timestamp = time?.dateTime ? Date.parse(time.dateTime) : inheritedDate?.ts || null;

  if (!text && !imgs.length && !audio.length) return null;
  const sender = node.getAttribute("aria-label") || node.querySelector("[dir='auto']")?.getAttribute("aria-label") || null;
  const fingerprint = [state.conversationId, timestamp, sender, text, imgs.map(x => x.src).join("|"), audio.join("|")].join("::");

  return {
    id: hash(fingerprint),
    conversationId: state.conversationId,
    sender,
    text,
    timestamp,
    dayKey: timestamp ? new Date(timestamp).toISOString().slice(0,10) : "unknown",
    media: { images: imgs, audio },
    capturedAt: Date.now(),
    sourceUrl: location.href
  };
}

function collectMessages() {
  const date = collectVisibleDate();
  if (date) state.lastVisibleDate = date;

  const selectors = [
    "[role='row']",
    "[data-scope='messages_table'] [role='row']",
    "[role='main'] [dir='auto']"
  ];
  const seen = new Set();
  const items = [];
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      if (seen.has(node)) continue;
      seen.add(node);
      const item = normalizeMessageNode(node, state.lastVisibleDate);
      if (item) items.push(item);
    }
    if (items.length) break;
  }
  return items;
}

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

async function runCapture() {
  const scroller = findScrollContainer();
  state.running = true;
  state.paused = false;
  state.stopRequested = false;
  let previousHeight = scroller.scrollHeight;

  try {
    while (!state.stopRequested) {
      const batch = collectMessages();
      if (batch.length) {
        await chrome.runtime.sendMessage({ type: "STORE_MESSAGES", messages: batch });
      }

      const currentTs = state.lastVisibleDate?.ts;
      if (state.targetDate && currentTs && currentTs <= state.targetDate) {
        state.running = false;
        await persistProgress({ status: "completed", reason: "TARGET_DATE_REACHED", completedAt: Date.now() });
        return;
      }

      await persistProgress({ status: "running", messageCountInView: batch.length });

      const beforeTop = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(scroller.clientHeight * 0.85, 700));
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
    await persistProgress({ status: "error", reason: "CAPTURE_ERROR", detail: String(error?.message || error) });
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

  if (message.type === "PING") sendResponse({ ok: true, conversationId: getConversationId(), visibility: document.visibilityState });
});

chrome.runtime.sendMessage({ type: "CONTENT_READY", conversationId: getConversationId(), sourceUrl: location.href }).catch(() => {});
