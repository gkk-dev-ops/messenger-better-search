let activeTab = null;
let conversationId = null;
let session = null;

const $ = id => document.getElementById(id);
const fmt = ts => ts ? new Intl.DateTimeFormat(undefined, { day:"2-digit", month:"short", year:"numeric" }).format(new Date(ts)) : "—";

async function init() {
  [activeTab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!activeTab?.id || !/messenger\.com|facebook\.com/.test(activeTab.url || "")) {
    $("statusText").textContent = "Open a Messenger conversation";
    $("start").disabled = true;
    $("pause").disabled = true;
    $("resume").disabled = true;
    return;
  }

  try {
    const pong = await chrome.tabs.sendMessage(activeTab.id, { type:"PING" });
    conversationId = pong.conversationId;
    $("conversationText").textContent = conversationId;
    const response = await chrome.runtime.sendMessage({ type:"GET_SESSION", conversationId });
    session = response.session;
    render();
  } catch {
    $("statusText").textContent = "Refresh Messenger";
    $("reason").hidden = false;
    $("reason").textContent = "The content script is not available yet. Refresh this Messenger tab.";
  }
}

function render() {
  const status = session?.status || "idle";
  $("statusText").textContent = status;
  $("statusDot").className = "dot " + (status === "running" ? "running" : status === "error" ? "error" : "");
  $("currentDate").textContent = fmt(session?.currentDate);

  if (session?.targetDate) $("targetDate").valueAsDate = new Date(session.targetDate);
  $("rangeText").textContent = session?.targetDate
    ? `Current ${fmt(session.currentDate)} → target ${fmt(session.targetDate)}`
    : "Choose a target date";

  const now = Date.now();
  if (session?.targetDate && session?.currentDate) {
    const total = Math.max(1, now - session.targetDate);
    const done = Math.max(0, now - session.currentDate);
    $("progressBar").style.width = Math.min(100, Math.max(0, done / total * 100)) + "%";
  } else $("progressBar").style.width = "0%";

  const showReason = session?.reason && !["TARGET_DATE_REACHED"].includes(session.reason);
  $("reason").hidden = !showReason;
  if (showReason) $("reason").textContent = [session.reason, session.detail].filter(Boolean).join(" — ");

  $("pause").disabled = status !== "running";
  $("resume").disabled = !["paused", "error"].includes(status);
}

$("start").addEventListener("click", async () => {
  const value = $("targetDate").value;
  const targetDate = value ? new Date(value + "T00:00:00").getTime() : null;
  await chrome.tabs.sendMessage(activeTab.id, { type:"START_CAPTURE", targetDate });
  setTimeout(refresh, 500);
});

$("pause").addEventListener("click", async () => {
  await chrome.tabs.sendMessage(activeTab.id, { type:"PAUSE_CAPTURE" });
  setTimeout(refresh, 500);
});

$("resume").addEventListener("click", async () => {
  await chrome.tabs.sendMessage(activeTab.id, {
    type:"RESUME_CAPTURE",
    conversationId,
    targetDate: session?.targetDate || null
  });
  setTimeout(refresh, 500);
});

$("search").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/search.html") }));
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

async function refresh() {
  if (!conversationId) return;
  const response = await chrome.runtime.sendMessage({ type:"GET_SESSION", conversationId });
  session = response.session;
  render();
}

init();
setInterval(refresh, 1500);
