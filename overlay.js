// overlay.js — content script, injected on demand by background.js's
// chrome.action.onClicked listener (via chrome.scripting.executeScript).
// Not a manifest-declared content script, so this only runs when the icon
// is clicked, same "on demand, not persistent" principle popup.js used to
// rely on. Owns the same UI logic popup.js used to: the page-check
// trigger, the homepage-fallback prompt, the write-then-reveal 5-field
// teardown flow, the summary page, and the settings view — just mounted
// into the page's own DOM instead of a native popup, so it can be
// positioned (anchored near the bottom third of the viewport) the way a
// popup anchored under the toolbar icon never could.
//
// Everything renders inside a Shadow DOM. Real-world testing showed an
// earlier light-DOM version (styled via chrome.scripting.insertCSS) had
// its inputs/buttons rendered white on Amazon and LinkedIn — both sites
// have their own broad, high-specificity styling for raw <input>/<button>
// elements that .teardown-* classes couldn't reliably out-rank no matter
// how the CSS was tuned. A shadow root's whole purpose is blocking exactly
// that: the page's stylesheets never reach in, and ours never leak out.
// The CSS itself lives in overlay-styles.js (window.__teardownOverlay.styles)
// rather than inline here or as a real stylesheet file, since insertCSS
// injects into the page's own <head>, which can't reach into a shadow
// tree at all — a template string appended to the shadow root is still
// the mechanism, just relocated for file size.
//
// This file is the entry point of a 3-file content script (this,
// overlay-styles.js, teardown-flow.js), all injected together by
// background.js's one executeScript({files: [...]}) call, in that order.
// There's no bundler/import-export here, so anything one file needs from
// another is attached to window.__teardownOverlay — a plain object on the
// shared global scope content scripts from the same extension get on the
// same page ("isolated world"), never visible to the host page's own
// scripts. This file owns: mounting/Shadow DOM creation, all element
// references, the key-entry/permission-prompt iframe wiring and their
// message-listener + origin validation, and the small set of low-level
// helpers (setStatus/fadeIn/resetToStartWithError/isExtensionContextValid)
// used everywhere. teardown-flow.js owns the actual screens (onboarding,
// the five questions, summary, settings, confirm/fallback orchestration)
// and the bootstrap call that decides which one shows first.
window.__teardownOverlay = window.__teardownOverlay || {};

(function () {
  const HOST_ID = "teardown-overlay-host";

  // Belt-and-suspenders: background.js already checks for an existing
  // overlay before injecting this file, but guard here too in case of any
  // race between that check and this running.
  if (document.getElementById(HOST_ID)) {
    console.log("Teardown: overlay already present, not building a second one.");
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Set inline (not via the shadow stylesheet) so the host element's own
  // box — position, layering, click-through, the ambient background —
  // can't be knocked over by some page-wide light-DOM rule targeting divs
  // generically. Inline styles beat any external stylesheet short of the
  // page using !important against our specific id, which is vanishingly
  // unlikely. The background is the design spec's ".overlay" gradient,
  // kept behind the modal; pointer-events:none means it's purely visual —
  // it doesn't block clicks/scroll on the real page underneath.
  host.style.cssText =
    "all: initial;" +
    "position: fixed;" +
    "inset: 0;" +
    "z-index: 2147483647;" +
    "display: flex;" +
    "align-items: flex-end;" +
    "justify-content: center;" +
    "padding: 24px;" +
    "padding-bottom: 8vh;" +
    "box-sizing: border-box;" +
    "pointer-events: none;" +
    "background:" +
    "  radial-gradient(circle at 12% 10%, rgba(139, 92, 246, 0.18), transparent 34%)," +
    "  radial-gradient(circle at 88% 90%, rgba(34, 211, 238, 0.12), transparent 30%)," +
    "  rgba(5, 7, 12, 0.66);";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>${window.__teardownOverlay.styles}</style>

    <div id="teardown-card" class="teardown-card">
      <button id="teardown-close-btn" class="icon-button teardown-close-btn" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M6 6L18 18"></path>
          <path d="M18 6L6 18"></path>
        </svg>
      </button>

      <div id="teardown-scroll" class="teardown-scroll">
      <h1 id="teardown-title" class="teardown-title">Teardown this product?</h1>
      <div id="teardown-status" class="teardown-status">Click Start Teardown to analyze this page.</div>

      <div id="teardown-main">
        <div id="teardown-confirm-actions" class="teardown-confirm-actions" hidden>
          <button id="teardown-confirm-yes" class="teardown-btn-block primary-button">Yes</button>
          <button id="teardown-confirm-no" class="teardown-btn-block secondary-button">No</button>
        </div>

        <div id="teardown-permission-step" hidden>
          <iframe id="teardown-permission-frame" class="teardown-key-frame" title="Allow homepage access"></iframe>
        </div>

        <div id="teardown-loading" class="teardown-loading" hidden>
          <div class="analysis-orb"><div class="analysis-orb-spin"></div></div>
          <div id="teardown-loading-status" class="teardown-loading-text"></div>
        </div>

        <div id="teardown-flow" hidden>
          <div id="teardown-progress" class="teardown-progress">
            <div id="teardown-progress-label" class="teardown-progress-label"></div>
            <div class="teardown-progress-row">
              <div class="progress-track"></div>
              <div class="progress-track"></div>
              <div class="progress-track"></div>
              <div class="progress-track"></div>
              <div class="progress-track"></div>
            </div>
          </div>

          <div id="teardown-microprompt" class="teardown-microprompt"></div>

          <div id="teardown-input-area">
            <input type="text" id="teardown-answer-input" class="teardown-input" placeholder="Type your answer…">
            <button id="teardown-submit-btn" class="teardown-btn-block primary-button">Submit</button>
          </div>

          <div id="teardown-reveal-area" hidden>
            <div class="teardown-answer-card user-card">
              <div class="teardown-answer-label">Your take</div>
              <div id="teardown-user-answer" class="teardown-answer-text"></div>
            </div>
            <div class="teardown-answer-card ai-card">
              <div class="teardown-answer-label">The Read</div>
              <div id="teardown-read-answer" class="teardown-answer-text"></div>
            </div>
            <button id="teardown-next-btn" class="teardown-btn-block primary-button" hidden>Next</button>
          </div>
        </div>

        <div id="teardown-summary" hidden>
          <div id="teardown-score-section" class="teardown-score-section" hidden>
            <svg id="teardown-score-ring" class="teardown-score-ring" width="88" height="88" viewBox="0 0 88 88">
              <defs>
                <linearGradient id="teardown-score-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#8B5CF6" />
                  <stop offset="52%" stop-color="#6366F1" />
                  <stop offset="100%" stop-color="#22D3EE" />
                </linearGradient>
              </defs>
              <circle class="teardown-score-ring-track" cx="44" cy="44" r="38"></circle>
              <circle id="teardown-score-ring-fill" class="teardown-score-ring-fill" cx="44" cy="44" r="38"></circle>
              <text id="teardown-score-value" class="teardown-score-value" x="44" y="44" text-anchor="middle" dominant-baseline="central"></text>
            </svg>
            <div id="teardown-score-tier" class="teardown-score-tier"></div>
            <div id="teardown-score-note" class="teardown-score-note"></div>
          </div>

          <div id="teardown-summary-content"></div>
          <button id="teardown-start-over-btn" class="teardown-btn-block primary-button">Teardown Another Page</button>
        </div>

        <button id="teardown-start-btn" class="teardown-btn-block primary-button">Start Teardown</button>

        <button id="teardown-gear-btn" class="icon-button teardown-corner-btn" aria-label="Settings">&#9881;</button>
      </div>

      <div id="teardown-settings-view" hidden>
        <iframe id="teardown-settings-key-frame" class="teardown-key-frame" title="Claude API key entry"></iframe>

        <button id="teardown-home-btn" class="icon-button teardown-corner-btn" aria-label="Home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12l9-9 9 9"></path>
            <path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10"></path>
          </svg>
        </button>
      </div>

      <div id="teardown-onboarding" hidden>
        <div id="teardown-onboarding-slide-0" class="teardown-onboarding-slide">
          <h1 class="teardown-onboarding-heading">Welcome to <span class="teardown-accent">Teardown</span>!</h1>
          <div class="teardown-onboarding-subheading">Practice your product sense by getting the read on any product, in <span class="teardown-accent">one click</span>.</div>
        </div>

        <div id="teardown-onboarding-slide-1" class="teardown-onboarding-slide" hidden>
          <h1 class="teardown-onboarding-heading">How it works</h1>
          <div class="teardown-onboarding-subheading">We check the page, then ask <span class="teardown-accent">five quick questions</span>: who it's for, what job it does, and more.</div>
          <div class="teardown-onboarding-subheading"><span class="teardown-accent">Write your own answer first</span>, then <span class="teardown-accent">reveal the AI's take</span> on that same question.</div>
          <div class="teardown-onboarding-subheading">Finish all five to get a one-time <span class="teardown-accent">score</span> on how sharp your read was.</div>
          <div class="teardown-microprompt">Note: Teardown won't work on Chrome's internal pages (like chrome://extensions) or the Chrome Web Store itself, browser restriction, not a bug.</div>
        </div>

        <div id="teardown-onboarding-slide-2" class="teardown-onboarding-slide" hidden>
          <div class="teardown-onboarding-heading-row">
            <div class="teardown-onboarding-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
            </div>
            <h1 class="teardown-onboarding-heading">Bring your own key</h1>
          </div>
          <div class="teardown-microprompt">Get a key at <a class="teardown-link" href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a></div>
          <iframe id="teardown-onboarding-key-frame" class="teardown-key-frame" title="Claude API key entry"></iframe>
        </div>

        <div class="teardown-onboarding-nav">
          <button id="teardown-onboarding-prev" class="icon-button" aria-label="Previous slide">&#8592;</button>
          <div id="teardown-onboarding-dots" class="teardown-onboarding-dots">
            <span class="teardown-onboarding-dot"></span>
            <span class="teardown-onboarding-dot"></span>
            <span class="teardown-onboarding-dot"></span>
          </div>
          <button id="teardown-onboarding-next" class="icon-button" aria-label="Next slide">&#8594;</button>
        </div>
      </div>
      </div>
    </div>
  `;

  const teardownTitle = shadow.getElementById("teardown-title");
  const statusEl = shadow.getElementById("teardown-status");
  const confirmActions = shadow.getElementById("teardown-confirm-actions");
  const permissionStep = shadow.getElementById("teardown-permission-step");
  const permissionFrame = shadow.getElementById("teardown-permission-frame");
  const startBtn = shadow.getElementById("teardown-start-btn");
  const closeBtn = shadow.getElementById("teardown-close-btn");
  const settingsKeyFrame = shadow.getElementById("teardown-settings-key-frame");

  // Every other element ref (the five-question flow, summary/score,
  // Settings toggle, onboarding carousel) is re-declared in
  // teardown-flow.js instead, by the same ids already in the markup above
  // — this file only keeps the refs its own remaining code (the iframe
  // wiring, message listener, and the setStatus/fadeIn/
  // resetToStartWithError/showPermissionPrompt helpers) actually touches.
  const onboardingKeyFrame = shadow.getElementById("teardown-onboarding-key-frame");

  // The key-entry iframes are the one place in the extension that ever
  // touches the actual API key — see key-entry.js for the full security
  // rationale. Point each at the same page, distinguished only by a mode
  // query param (Settings gets Save + Remove; onboarding gets Save only
  // and requires a non-empty key). chrome.runtime.getURL keeps this
  // correct across dev/packaged builds rather than hardcoding the
  // extension's id.
  const keyEntryBaseUrl = chrome.runtime.getURL("key-entry.html");
  onboardingKeyFrame.src = `${keyEntryBaseUrl}?mode=onboarding`;
  settingsKeyFrame.src = `${keyEntryBaseUrl}?mode=settings`;

  // permission-prompt.html's src is set dynamically per domain (see
  // showPermissionPrompt below) since the domain isn't known until the
  // homepage fallback is actually triggered, unlike the two key-entry
  // iframes above which are fixed for the overlay's whole lifetime.
  const permissionPromptBaseUrl = chrome.runtime.getURL("permission-prompt.html");

  // Precomputed once — chrome.runtime.getURL("") returns
  // "chrome-extension://<id>/", and the trailing slash needs stripping to
  // match a postMessage event's own `origin` string exactly.
  const EXTENSION_ORIGIN = chrome.runtime.getURL("").slice(0, -1);

  // Both key-entry iframes AND the permission-prompt iframe post progress
  // back through the same window message listener below. Every message
  // is checked on three fronts before anything acts on it: it must come
  // from our own extension origin (a malicious host page's own script
  // sharing this same window object could otherwise fake one — content
  // scripts and the page they're injected into both receive 'message'
  // events dispatched to window), it must come from one of the iframe
  // elements this file actually created (not merely SOME
  // chrome-extension:// frame), and it must carry that iframe's own
  // marker field. None of the messages acted on here ever contain key
  // material — only the fact that something happened.

  // Pure validation predicate, deliberately kept free of any DOM/chrome
  // dependency beyond the plain values passed in, so it can be exercised
  // directly by a standalone test (see teardown-verify/origin-validation.
  // test.js) without needing a real browser or extension environment.
  // Returns which known frame the event legitimately came from
  // ("onboarding" | "settings"), or null if it fails any of the three
  // checks and should be ignored: wrong origin (a malicious host page's
  // own script sharing this same window object could otherwise fake one),
  // wrong source (not one of the two iframe windows this file actually
  // created), or a missing/wrong marker field.
  function resolveTrustedKeyEntrySource(event, extensionOrigin, onboardingWindow, settingsWindow) {
    if (event.origin !== extensionOrigin) {
      return null;
    }
    if (event.source !== onboardingWindow && event.source !== settingsWindow) {
      return null;
    }
    if (!event.data || event.data.source !== "teardown-key-entry") {
      return null;
    }
    return event.source === onboardingWindow ? "onboarding" : "settings";
  }

  // Same shape as resolveTrustedKeyEntrySource above, for the one
  // permission-prompt iframe instead of the two key-entry ones — kept as
  // a separate pure function (rather than generalizing the other one)
  // since the two have different origin-of-truth marker strings and it's
  // cheap to just test them independently.
  function resolveTrustedPermissionPromptSource(event, extensionOrigin, promptWindow) {
    if (event.origin !== extensionOrigin) {
      return false;
    }
    if (event.source !== promptWindow) {
      return false;
    }
    if (!event.data || event.data.source !== "teardown-permission-prompt") {
      return false;
    }
    return true;
  }

  // Set by showPermissionPrompt() while it's waiting on the user, called
  // with true/false once PERMISSION_GRANTED or PERMISSION_DECLINED
  // arrives, then cleared. null the rest of the time.
  let permissionPromptCallback = null;

  function handleTrustedFrameMessage(event) {
    if (resolveTrustedPermissionPromptSource(event, EXTENSION_ORIGIN, permissionFrame.contentWindow)) {
      const data = event.data;

      if (data.type === "PERMISSION_PROMPT_RESIZE" && typeof data.height === "number") {
        permissionFrame.style.height = `${Math.max(0, data.height)}px`;
        return;
      }

      if (data.type === "PERMISSION_GRANTED" || data.type === "PERMISSION_DECLINED") {
        const callback = permissionPromptCallback;
        permissionPromptCallback = null;
        if (callback) {
          callback(data.type === "PERMISSION_GRANTED");
        }
      }
      return;
    }

    const trustedFrom = resolveTrustedKeyEntrySource(
      event,
      EXTENSION_ORIGIN,
      onboardingKeyFrame.contentWindow,
      settingsKeyFrame.contentWindow
    );
    if (!trustedFrom) {
      return;
    }

    const fromOnboarding = trustedFrom === "onboarding";
    const fromSettings = trustedFrom === "settings";
    const data = event.data;

    if (data.type === "KEY_ENTRY_RESIZE" && typeof data.height === "number") {
      const frame = fromOnboarding ? onboardingKeyFrame : settingsKeyFrame;
      frame.style.height = `${Math.max(0, data.height)}px`;
      return;
    }

    if (data.type === "KEY_SAVED" && fromOnboarding) {
      // Defined in teardown-flow.js, exposed back onto the shared
      // namespace since this file's message listener is the one thing
      // that needs to reach it.
      window.__teardownOverlay.endOnboarding();
      return;
    }

    if (data.type === "KEY_REMOVED" && fromSettings) {
      // Fully reset the main flow's own state too (not just Settings) —
      // removing the key means whatever mid-teardown state was sitting
      // underneath Settings shouldn't still be there once a new key is
      // entered and the user lands back on the idle screen. Both defined
      // in teardown-flow.js, exposed back onto the shared namespace since
      // this file's message listener is the one thing that needs to reach
      // them.
      window.__teardownOverlay.resetToInitialState();
      window.__teardownOverlay.showOnboarding();
    }
  }

  window.addEventListener("message", handleTrustedFrameMessage);

  // Shows the "Allow access to [domain]" iframe in place of the
  // Yes/No confirm buttons, and resolves the given callback with
  // true/false once the user grants or declines it inside that iframe
  // (see permission-prompt.js for why that click has to happen there).
  function showPermissionPrompt(domain, callback) {
    permissionPromptCallback = callback;
    confirmActions.hidden = true;
    permissionFrame.src = `${permissionPromptBaseUrl}?domain=${encodeURIComponent(domain)}`;
    permissionStep.hidden = false;
    fadeIn(permissionStep);
  }

  function hidePermissionPrompt() {
    permissionPromptCallback = null;
    permissionStep.hidden = true;
  }

  // Central place to set the status line so error styling (red, per the
  // design spec — "actual failures only, never normal states") never
  // lingers onto an unrelated later message.
  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle("teardown-status--error", !!isError);
  }

  // Plays the fade-in defined on .teardown-fade-in against each element
  // passed in. Removing the class before re-adding it (with a forced
  // reflow in between) is what lets the animation restart even when the
  // class is already present from the last transition — just re-adding an
  // already-present class is a no-op as far as CSS animations go. Call
  // this AFTER unhiding an element (an element with `hidden` set has no
  // box, so there's nothing for the animation to render against).
  function fadeIn(...elements) {
    elements.forEach((el) => {
      if (!el) return;
      el.classList.remove("teardown-fade-in");
      void el.offsetWidth;
      el.classList.add("teardown-fade-in");
    });
  }

  // Shared landing spot for the several near-identical "something failed,
  // fall back to the start screen" branches scattered through the message
  // callbacks below — keeps the fade-in wired in one place instead of
  // repeating it at every call site.
  function resetToStartWithError(message) {
    teardownTitle.textContent = "Teardown this product?";
    setStatus(message, true);
    startBtn.hidden = false;
    fadeIn(teardownTitle, statusEl, startBtn);
  }

  // Closing fully removes the overlay from the DOM (not just hides it) —
  // clicking the icon again builds a fresh one from scratch. Explicitly
  // detaching handleTrustedFrameMessage matters here in a way none of
  // this file's other listeners do: everything else is scoped to
  // elements inside `host`, so removing `host` lets them get
  // garbage-collected along with it, but a window-level listener is
  // registered directly on the host page's own global window and would
  // otherwise keep running (holding references to these now-removed
  // iframes) for the rest of the page's lifetime.
  closeBtn.addEventListener("click", () => {
    console.log("Teardown: close button clicked, removing overlay.");
    window.removeEventListener("message", handleTrustedFrameMessage);
    host.remove();
  });

  // Reloading the extension in chrome://extensions invalidates any content
  // script already injected into an open tab from before that reload —
  // chrome.runtime goes undefined in that stale instance, and calling
  // sendMessage on it throws a raw, confusing TypeError. Check for that
  // up front on every entry point that talks to the extension, and show
  // something the user can actually act on instead.
  function isExtensionContextValid() {
    return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  }

  // --- Namespace exports for teardown-flow.js ---
  // Everything teardown-flow.js needs from this file, gathered in one
  // place rather than scattered next to each definition. `shadow` lets it
  // re-declare its own element references by id (same ids already in the
  // markup overlay.js built) instead of this file re-exporting ~45
  // individual refs by hand. The rest are the low-level helpers used
  // throughout the flow that stay owned by this file.
  window.__teardownOverlay.shadow = shadow;
  window.__teardownOverlay.setStatus = setStatus;
  window.__teardownOverlay.fadeIn = fadeIn;
  window.__teardownOverlay.resetToStartWithError = resetToStartWithError;
  window.__teardownOverlay.isExtensionContextValid = isExtensionContextValid;
  window.__teardownOverlay.showPermissionPrompt = showPermissionPrompt;
  window.__teardownOverlay.hidePermissionPrompt = hidePermissionPrompt;
})();
