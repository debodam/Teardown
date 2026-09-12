// popup.js
// Saturday: wire this to grab page text + run the soft check.
// Sunday: build the one-at-a-time write-then-reveal flow here.

const statusEl = document.getElementById("status");

document.getElementById("startBtn").addEventListener("click", () => {
  statusEl.textContent = "Reading page…";

  chrome.runtime.sendMessage({ type: "GRAB_PAGE_CONTENT" }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (!response || !response.ok) {
      const errMsg = response && response.error ? response.error : "Unknown error.";
      statusEl.textContent = `Error: ${errMsg}`;
      return;
    }

    // Temporary debug display — not final UI. Just confirming capture works.
    const preview = response.pageText.slice(0, 200);
    statusEl.textContent = `[${response.hostname}] ${preview}`;
  });
});
