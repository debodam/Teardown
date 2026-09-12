// popup.js
// Saturday: wire this to grab page text + run the soft check.
// Sunday: build the one-at-a-time write-then-reveal flow here.

const statusEl = document.getElementById("status");
const fallbackActions = document.getElementById("fallbackActions");
const fallbackYesBtn = document.getElementById("fallbackYesBtn");
const fallbackNoBtn = document.getElementById("fallbackNoBtn");

// Set by showFallbackPrompt(), read by the Yes button's handler.
let pendingFallbackDomain = null;

function showSuccess() {
  fallbackActions.hidden = true;
  statusEl.textContent = "This looks like a product page. Ready to start your teardown.";
}

function showFallbackPrompt(domain) {
  pendingFallbackDomain = domain;
  console.log("pendingFallbackDomain set to:", pendingFallbackDomain);
  statusEl.textContent = `This doesn't look like a product or company page. Want to teardown ${domain} instead?`;
  fallbackActions.hidden = false;
}

document.getElementById("startBtn").addEventListener("click", () => {
  console.log("Start Teardown clicked");
  fallbackActions.hidden = true;
  statusEl.textContent = "Reading page…";

  const message = { type: "GRAB_PAGE_CONTENT" };

  try {
    console.log("Sending message to background.js", message);
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
        return;
      }

      if (!response || !response.ok) {
        const errMsg = response && response.error ? response.error : "Unknown error.";
        statusEl.textContent = `Error: ${errMsg}`;
        return;
      }

      // Full extraction detail (title/meta description/raw text) is for our
      // own debugging only — the popup UI just shows a clean verdict.
      console.log("GRAB_PAGE_CONTENT response received", response);
      console.log("response.rootDomain:", response.rootDomain);

      if (response.isProductPage) {
        showSuccess();
      } else {
        showFallbackPrompt(response.rootDomain);
      }
    });
  } catch (error) {
    console.error("Error sending message:", error);
  }
});

fallbackYesBtn.addEventListener("click", () => {
  const domain = pendingFallbackDomain;
  console.log("Homepage fallback accepted for domain:", domain);
  fallbackActions.hidden = true;
  statusEl.textContent = `Checking ${domain}…`;

  const message = { type: "CHECK_HOMEPAGE_FALLBACK", domain };
  console.log("Sending CHECK_HOMEPAGE_FALLBACK message", message);

  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
      return;
    }

    if (!response || !response.ok) {
      const errMsg = response && response.error ? response.error : "Unknown error.";
      console.error("Homepage fallback check failed:", errMsg);
      statusEl.textContent = "Couldn't find a clear product page here.";
      return;
    }

    console.log("Homepage fallback content received", response);

    if (response.isProductPage) {
      showSuccess();
    } else {
      // No further fallback attempts — stop here.
      statusEl.textContent = "Couldn't find a clear product page here.";
    }
  });
});

fallbackNoBtn.addEventListener("click", () => {
  console.log("Homepage fallback declined");
  fallbackActions.hidden = true;
  // Ending here is intentional — same as closing the popup, no further action.
});

// --- Settings: Claude API key ---

const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
const claudeApiKeyInput = document.getElementById("claudeApiKeyInput");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const settingsStatus = document.getElementById("settingsStatus");

settingsToggle.addEventListener("click", () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

// Pre-fill the input with whatever key is already stored, if any.
chrome.storage.local.get("claudeApiKey", ({ claudeApiKey }) => {
  if (claudeApiKey) {
    claudeApiKeyInput.value = claudeApiKey;
  }
});

saveTokenBtn.addEventListener("click", () => {
  const key = claudeApiKeyInput.value.trim();
  chrome.storage.local.set({ claudeApiKey: key }, () => {
    settingsStatus.textContent = key ? "Key saved." : "Key cleared.";
  });
});
