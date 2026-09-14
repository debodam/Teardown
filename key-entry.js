// key-entry.js — runs inside key-entry.html, a genuine chrome-extension://
// page that overlay.js (a content script living in the host page's own
// DOM) embeds as an <iframe>. This is the ONLY place in the extension that
// touches chrome.storage.local for the API key directly. That's not just
// a convention here: background.js locks chrome.storage.local down to
// TRUSTED_CONTEXTS on startup (chrome.storage.local.setAccessLevel), which
// means content scripts like overlay.js are flatly denied read/write
// access to it at the platform level — only genuine extension pages (this
// one, the background service worker, a future options page) qualify as
// trusted. The host page embedding this iframe can size and position it
// from the outside via CSS, but its own JS has no way to read this
// document's contents or reach into its storage calls; that's a real
// cross-origin boundary the browser enforces, not a convention like
// Shadow DOM was.
(function () {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "settings" ? "settings" : "onboarding";

  const keyForm = document.getElementById("key-form");
  const settingsIntro = document.getElementById("settings-intro");
  const keyInput = document.getElementById("key-input");
  const saveBtn = document.getElementById("save-btn");
  const removeBtn = document.getElementById("remove-btn");
  const statusEl = document.getElementById("key-status");

  const removeConfirm = document.getElementById("remove-confirm");
  const removeConfirmYesBtn = document.getElementById("remove-confirm-yes");
  const removeConfirmNoBtn = document.getElementById("remove-confirm-no");

  const KEY_PLACEHOLDER_EMPTY = "sk-ant-...";
  const KEY_PLACEHOLDER_SAVED = "Key saved ✓";

  saveBtn.textContent = mode === "settings" ? "Save Key" : "Save & Start Teardown";
  // These two context lines only ever applied to Settings (onboarding has
  // its own separate framing already, outside this iframe). They live
  // inside #key-form specifically so that hiding the form for the
  // remove-key confirmation hides them along with everything else — the
  // confirmation is meant to take over this whole surface, not leave
  // leftover copy sitting above it.
  settingsIntro.hidden = mode !== "settings";
  removeBtn.hidden = mode !== "settings";

  // Every message back to the parent overlay carries no key data
  // whatsoever, ever, just the fact that something happened (saved,
  // removed, resized) so the overlay can move its own UI along. "*" as
  // the target origin is fine here since there's nothing sensitive IN the
  // message to protect on the way out; it's the PARENT's job (see
  // overlay.js's message listener) to check event.origin before trusting
  // anything it receives back, so a malicious page can't fake these.
  function postToParent(message) {
    window.parent.postMessage(Object.assign({ source: "teardown-key-entry" }, message), "*");
  }

  function reportHeight() {
    // Whichever section is actually visible (the form, or the remove
    // confirmation) contributes to this; the hidden one is display:none
    // and adds nothing, so this always reflects real content height.
    // document.body, not document.documentElement — the root <html>
    // element's scrollHeight is defined to never report less than the
    // iframe's OWN current viewport height, only equal or more, so
    // measuring it means every report is silently floored at whatever
    // height the iframe already happens to be and can never shrink back
    // down. body (with no explicit height of its own) reflects the real
    // content height instead.
    postToParent({ type: "KEY_ENTRY_RESIZE", height: document.body.scrollHeight });
  }

  function refreshFromStorage() {
    chrome.storage.local.get("claudeApiKey", ({ claudeApiKey }) => {
      // Never populate the field with the actual stored key — only the
      // placeholder reflects whether one is already on file.
      keyInput.value = "";
      keyInput.placeholder = claudeApiKey ? KEY_PLACEHOLDER_SAVED : KEY_PLACEHOLDER_EMPTY;
      reportHeight();
    });
  }

  function submitKey() {
    const key = keyInput.value.trim();

    if (!key && mode === "onboarding") {
      statusEl.textContent = "Enter your Claude API key to continue.";
      reportHeight();
      return;
    }

    chrome.storage.local.set({ claudeApiKey: key }, () => {
      // Blank the field immediately after a successful save (or clear) —
      // the real key lives in storage and is what every API call actually
      // uses; the visible input is only ever for entry, never a
      // long-term display of it.
      keyInput.value = "";
      keyInput.placeholder = key ? KEY_PLACEHOLDER_SAVED : KEY_PLACEHOLDER_EMPTY;
      statusEl.textContent = key ? "Key saved." : "Key cleared.";
      reportHeight();
      if (key) {
        postToParent({ type: "KEY_SAVED" });
      }
    });
  }

  saveBtn.addEventListener("click", submitKey);

  keyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitKey();
    }
  });

  // Remove Key only exists in settings mode — onboarding has nothing to
  // remove yet.
  if (mode === "settings") {
    removeBtn.addEventListener("click", () => {
      keyForm.hidden = true;
      removeConfirm.hidden = false;
      reportHeight();
    });

    removeConfirmNoBtn.addEventListener("click", () => {
      removeConfirm.hidden = true;
      keyForm.hidden = false;
      reportHeight();
    });

    removeConfirmYesBtn.addEventListener("click", () => {
      chrome.storage.local.remove("claudeApiKey", () => {
        keyInput.value = "";
        keyInput.placeholder = KEY_PLACEHOLDER_EMPTY;
        statusEl.textContent = "";
        removeConfirm.hidden = true;
        keyForm.hidden = false;
        reportHeight();
        postToParent({ type: "KEY_REMOVED" });
      });
    });
  }

  refreshFromStorage();
  window.addEventListener("resize", reportHeight);
  // Catches layout changes reportHeight()'s explicit call sites might
  // miss the exact timing of (web fonts finishing, etc.) — keeps the
  // parent iframe's height in sync with whatever the content actually
  // needs instead of occasionally running a beat behind it.
  new ResizeObserver(reportHeight).observe(document.body);
})();
