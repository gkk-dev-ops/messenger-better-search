const BRIDGE_ATTRIBUTE = "data-mbs-search-bridge";
const SEARCH_TERMS = [
  "search in conversation",
  "search conversation",
  "szukaj w konwersacji",
  "wyszukaj w konwersacji",
  "szukaj w rozmowie",
  "wyszukaj w rozmowie"
];

/**
 * Normalizes visible UI labels for loose matching across Messenger locales.
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalizeLabel(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Returns true only for controls that look like Messenger's in-conversation
 * search box. It intentionally does not inspect conversation messages/results.
 * @param {Element} element
 * @returns {boolean}
 */
function isConversationSearchControl(element) {
  const values = [
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    element.getAttribute("data-placeholder")
  ].map(normalizeLabel);

  return SEARCH_TERMS.some(term =>
    values.some(value => value.includes(term))
  );
}

/**
 * Finds the currently visible Messenger conversation-search control.
 * @returns {HTMLInputElement|HTMLElement|null}
 */
function findSearchControl() {
  const candidates = document.querySelectorAll(
    'input, textarea, [role="textbox"], [contenteditable="true"]'
  );

  for (const element of candidates) {
    if (!isConversationSearchControl(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    return element;
  }

  return null;
}

/**
 * Reads only the user's current search query from the search control.
 * @param {HTMLInputElement|HTMLElement} control
 * @returns {string}
 */
function readQuery(control) {
  if ("value" in control) return String(control.value || "").trim();
  return String(control.textContent || "").trim();
}

/**
 * Chooses a nearby UI container for the bridge button.
 * @param {Element} control
 * @returns {Element}
 */
function findMountPoint(control) {
  return (
    control.closest('[role="dialog"]') ||
    control.closest('[role="complementary"]') ||
    control.parentElement?.parentElement ||
    control.parentElement ||
    document.body
  );
}

/**
 * Creates or refreshes the Better Search shortcut next to Messenger search.
 */
function syncBridge() {
  const control = findSearchControl();
  const existing = document.querySelector(`[${BRIDGE_ATTRIBUTE}]`);

  if (!control) {
    existing?.remove();
    return;
  }

  const mount = findMountPoint(control);
  let button = mount.querySelector(`[${BRIDGE_ATTRIBUTE}]`);

  if (!button) {
    existing?.remove();

    button = document.createElement("button");
    button.type = "button";
    button.setAttribute(BRIDGE_ATTRIBUTE, "");
    button.setAttribute("aria-label", "Open this query in Messenger Better Search");
    button.textContent = "Open in Better Search";

    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
      margin: "8px 8px 8px 0",
      padding: "8px 12px",
      border: "0",
      borderRadius: "10px",
      background: "linear-gradient(135deg, #168aff, #8f35ff)",
      color: "#fff",
      font: "600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(83, 70, 255, .28)",
      zIndex: "2147483647"
    });

    button.addEventListener("mouseenter", () => {
      button.style.filter = "brightness(1.08)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.filter = "";
    });

    button.addEventListener("click", () => {
      const query = readQuery(control);
      const url = new URL(chrome.runtime.getURL("src/search.html"));
      if (query) url.searchParams.set("q", query);
      window.open(url.toString(), "_blank", "noopener");
    });

    mount.append(button);
  }

  button.disabled = !readQuery(control);
  button.style.opacity = button.disabled ? ".55" : "1";
}

let scheduled = false;

/**
 * Coalesces Messenger's frequent React DOM mutations into one bridge refresh.
 */
function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    syncBridge();
  });
}

const observer = new MutationObserver(scheduleSync);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["aria-label", "placeholder", "data-placeholder"]
});

document.addEventListener("input", scheduleSync, true);
document.addEventListener("change", scheduleSync, true);
scheduleSync();
