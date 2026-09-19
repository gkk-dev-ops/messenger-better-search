const fields = ["enableTranscription","elevenLabsKey","enableVision","enableEmbeddings","openAiKey","autoEnrich"];
const response = await chrome.runtime.sendMessage({ type:"GET_SETTINGS" });
for (const field of fields) {
  const el = document.getElementById(field);
  if (el.type === "checkbox") el.checked = Boolean(response.settings[field]);
  else el.value = response.settings[field] || "";
}

document.getElementById("save").addEventListener("click", async () => {
  const settings = {};
  for (const field of fields) {
    const el = document.getElementById(field);
    settings[field] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  await chrome.runtime.sendMessage({ type:"SAVE_SETTINGS", settings });
  document.getElementById("saved").textContent = "Saved locally";
  setTimeout(() => document.getElementById("saved").textContent = "", 1800);
});
