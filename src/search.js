const $ = id => document.getElementById(id);
let sessions = [];

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[c]);
}

function startOfWeek(d) {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0,0,0,0);
  return copy;
}

function groupKey(ts, mode) {
  if (!ts) return { key:"unknown", label:"Unknown date" };
  const d = new Date(ts);
  if (mode === "year") return { key:String(d.getFullYear()), label:String(d.getFullYear()) };
  if (mode === "month") {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    return { key, label:new Intl.DateTimeFormat(undefined, { month:"long", year:"numeric" }).format(d) };
  }
  if (mode === "week") {
    const w = startOfWeek(d);
    const end = new Date(w); end.setDate(end.getDate()+6);
    return { key:w.toISOString().slice(0,10), label:`${w.toLocaleDateString()} – ${end.toLocaleDateString()}` };
  }
  return { key:d.toISOString().slice(0,10), label:new Intl.DateTimeFormat(undefined, { weekday:"long", day:"numeric", month:"long", year:"numeric" }).format(d) };
}

function messageBody(m) {
  const parts = [];
  if (m.text) parts.push(`<div class="body">${escapeHtml(m.text)}</div>`);
  if (m.transcript) parts.push(`<div class="media-note"><strong>Voice transcript</strong><br>${escapeHtml(m.transcript)}</div>`);
  for (const [i, context] of (m.imageContext || []).entries()) {
    parts.push(`<div class="media-note"><strong>Image ${i+1}</strong><br>${escapeHtml(context)}</div>`);
  }
  if (m.media?.images?.length && !m.imageContext?.length) parts.push(`<div class="media-note">${m.media.images.length} image(s) captured — enable image understanding to make them searchable.</div>`);
  if (m.media?.audio?.length && !m.transcript) parts.push(`<div class="media-note">Voice message captured — enable transcription to search its content.</div>`);
  return parts.join("");
}

async function loadSessions() {
  const res = await chrome.runtime.sendMessage({ type:"LIST_SESSIONS" });
  sessions = (res.sessions || []).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  $("conversation").innerHTML = sessions.map(s =>
    `<option value="${escapeHtml(s.conversationId)}">${escapeHtml(s.conversationId)} · ${s.currentDate ? new Date(s.currentDate).toLocaleDateString() : "no date"}</option>`
  ).join("");
}

async function run() {
  const conversationId = $("conversation").value;
  if (!conversationId) return;
  const from = $("from").value ? new Date($("from").value + "T00:00:00").getTime() : null;
  const to = $("to").value ? new Date($("to").value + "T23:59:59").getTime() : null;
  const res = await chrome.runtime.sendMessage({
    type:"SEARCH_MESSAGES",
    conversationId,
    query:$("query").value,
    from, to,
    semantic:$("semantic").checked
  });

  if (!res.ok) {
    $("timeline").innerHTML = `<div class="card status-reason">${escapeHtml(res.error || "Search failed")}</div>`;
    return;
  }
  render(res.results || []);
}

function render(messages) {
  $("count").textContent = `${messages.length} messages`;
  const mode = $("groupBy").value;
  const groups = new Map();
  for (const m of messages) {
    const g = groupKey(m.timestamp, mode);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, messages:[] });
    groups.get(g.key).messages.push(m);
  }

  $("timeline").innerHTML = [...groups.values()].sort((a,b) => b.key.localeCompare(a.key)).map(group => `
    <details class="group">
      <summary>
        <span>${escapeHtml(group.label)}</span>
        <span class="muted">${group.messages.length} messages</span>
      </summary>
      <div class="message">
        <button class="secondary analyze" data-group="${escapeHtml(group.key)}">Analyze this group with AI</button>
        <div class="media-note analysis-output" data-analysis="${escapeHtml(group.key)}" hidden></div>
      </div>
      ${group.messages.map(m => `
        <article class="message">
          <div class="meta">${escapeHtml(m.sender || "Unknown sender")} · ${m.timestamp ? new Date(m.timestamp).toLocaleString() : "unknown time"}${typeof m.score === "number" ? " · similarity " + m.score.toFixed(3) : ""}</div>
          ${messageBody(m)}
        </article>
      `).join("")}
    </details>
  `).join("");

  document.querySelectorAll(".analyze").forEach(button => button.addEventListener("click", async () => {
    const group = groups.get(button.dataset.group);
    const out = document.querySelector(`[data-analysis="${CSS.escape(button.dataset.group)}"]`);
    out.hidden = false;
    out.textContent = "Analyzing…";
    const res = await chrome.runtime.sendMessage({ type:"ANALYZE_GROUP", messages:group.messages });
    out.textContent = res.ok ? res.analysis : res.error;
  }));
}

$("run").addEventListener("click", run);
$("groupBy").addEventListener("change", run);
$("conversation").addEventListener("change", run);
$("query").addEventListener("keydown", e => { if (e.key === "Enter") run(); });

await loadSessions();
await run();
