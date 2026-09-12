// background.js — service worker.
// Owns: injecting the page-read script on demand (triggered by popup.js,
// since a default_popup means chrome.action.onClicked never fires),
// calling Claude for the soft check + 4 fields (later), and the homepage
// fallback fetch (later).

chrome.runtime.onInstalled.addListener(() => {
  console.log("Teardown extension installed.");
});

// Runs inside the target page. Keep this self-contained — it's serialized
// and injected, it can't reference anything from background.js's scope.
function grabPageContent() {
  const pageText = document.body ? document.body.innerText || "" : "";
  return {
    pageText,
    hostname: window.location.hostname
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "GRAB_PAGE_CONTENT") {
    return false; // not for us
  }

  (async () => {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!activeTab || !activeTab.id) {
        sendResponse({ ok: false, error: "No active tab found." });
        return;
      }

      const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: grabPageContent
      });

      // injectionResult can be undefined if the page blocked injection
      // (e.g. chrome:// pages) without throwing.
      const data = injectionResult && injectionResult.result;

      if (!data) {
        sendResponse({
          ok: false,
          error: "Could not read this page (unsupported or restricted page)."
        });
        return;
      }

      // Note: short/empty pageText is passed through as-is on purpose —
      // "not enough content" handling is a later step, not here.
      sendResponse({ ok: true, pageText: data.pageText, hostname: data.hostname });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true; // keep the message channel open for the async sendResponse
});
