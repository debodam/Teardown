// overlay.js — content script, injected on demand by background.js's
// chrome.action.onClicked listener (via chrome.scripting.executeScript).
// Not a manifest-declared content script, so this only runs when the icon
// is clicked, same "on demand, not persistent" principle popup.js used to
// rely on. Owns the same UI logic popup.js used to: the page-check
// trigger, the homepage-fallback prompt, the write-then-reveal 4-field
// teardown flow, the summary page, and the settings view — just mounted
// into the page's own DOM instead of a native popup, so it can be
// positioned (anchored near the bottom third of the viewport) the way a
// popup anchored under the toolbar icon never could.
//
// Everything renders inside a Shadow DOM. Real-world testing showed the
// earlier light-DOM version (styled via chrome.scripting.insertCSS) had
// its inputs/buttons rendered white on Amazon and LinkedIn — both sites
// have their own broad, high-specificity styling for raw <input>/<button>
// elements that our .teardown-* classes couldn't reliably out-rank no
// matter how the CSS was tuned. A shadow root's whole purpose is blocking
// exactly that: the page's stylesheets never reach in, and ours never leak
// out. The CSS lives inline here (a template string appended to the
// shadow root) rather than as a separate file, since insertCSS injects
// into the page's own <head>, which can't reach into a shadow tree at all.

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
  // box — position, layering, click-through — can't be knocked over by
  // some page-wide light-DOM rule targeting divs generically. Inline
  // styles beat any external stylesheet short of the page using
  // !important against our specific id, which is vanishingly unlikely.
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
    "pointer-events: none;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      * {
        box-sizing: border-box;
      }

      .teardown-card {
        pointer-events: auto;
        position: relative;
        width: 560px;
        max-width: 92vw;
        max-height: 70vh;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 24px;
        padding-bottom: 56px; /* room for the gear/home button in the corner */
        color: #f5f5f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.5;

        /* Liquid glass treatment, monochrome: clear dark glass, white
           specular highlights and borders, no color tint anywhere.
           backdrop-filter blurs whatever's actually behind the card — on
           a bright page a lower-opacity tint here would let that
           brightness wash straight through. High opacity keeps the card
           reliably dark (and the white text readable) no matter what
           page it's sitting on top of. */
        background: rgba(15, 15, 15, 0.88);
        -webkit-backdrop-filter: blur(24px);
        backdrop-filter: blur(24px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        box-shadow:
          0 12px 40px rgba(0, 0, 0, 0.45),
          0 1px 0 rgba(255, 255, 255, 0.08) inset;

        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
      }

      /* The summary page has meaningfully more to read than any
         single-field step, so it gets a larger card. */
      .teardown-card.teardown-card--summary {
        width: 720px;
        max-width: 94vw;
        max-height: 85vh;
      }

      .teardown-card::-webkit-scrollbar {
        width: 8px;
      }

      .teardown-card::-webkit-scrollbar-track {
        background: transparent;
      }

      .teardown-card::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.25);
        border-radius: 8px;
      }

      .teardown-card::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
      }

      /* Soft white specular highlight in the corner, like a light
         reflection on glass. Kept inside the card's own box since
         overflow-y:auto above would clip anything positioned outside it. */
      .teardown-card::before {
        content: "";
        position: absolute;
        top: -10px;
        left: -10px;
        width: 110px;
        height: 110px;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.2), transparent 70%);
        border-radius: 50%;
        filter: blur(6px);
        pointer-events: none;
      }

      .teardown-close-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 26px;
        height: 26px;
        padding: 0;
        margin: 0;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.08);
        color: #eee;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .teardown-close-btn:hover {
        background: rgba(255, 255, 255, 0.18);
      }

      /* Gear (settings) and home (back from settings) buttons share this
         style and the same bottom-left spot — only one is ever visible. */
      .teardown-corner-btn {
        position: absolute;
        bottom: 16px;
        left: 16px;
        width: 30px;
        height: 30px;
        padding: 0;
        margin: 0;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.08);
        color: #eee;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .teardown-corner-btn:hover {
        background: rgba(255, 255, 255, 0.18);
      }

      .teardown-corner-btn[hidden] {
        display: none;
      }

      .teardown-title {
        font-size: 16px;
        font-weight: 600;
        margin: 0 24px 12px 0;
      }

      .teardown-status {
        font-size: 13px;
        color: #cfcfcf;
        margin-bottom: 4px;
      }

      button {
        font-family: inherit;
      }

      .teardown-btn {
        display: block;
        width: 100%;
        margin-top: 12px;
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.08);
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
        color: #fff;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .teardown-btn:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      .teardown-btn[hidden] {
        display: none;
      }

      /* Primary action stands out through brightness/opacity only, no
         color tint — keeps the whole overlay monochrome. */
      .teardown-btn-primary {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(255, 255, 255, 0.35);
        font-weight: 600;
      }

      .teardown-btn-primary:hover {
        background: rgba(255, 255, 255, 0.28);
      }

      .teardown-fallback-actions {
        display: flex;
        gap: 8px;
      }

      .teardown-fallback-actions[hidden] {
        display: none;
      }

      .teardown-fallback-actions .teardown-btn {
        flex: 1;
      }

      /* Simple CSS spinner for the "Analyzing" loading state. */
      .teardown-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 28px 0;
      }

      .teardown-loading[hidden] {
        display: none;
      }

      .teardown-spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.2);
        border-top-color: rgba(255, 255, 255, 0.9);
        animation: teardown-spin 0.8s linear infinite;
      }

      @keyframes teardown-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .teardown-loading-text {
        font-size: 13px;
        color: rgba(245, 245, 245, 0.75);
      }

      input {
        font-family: inherit;
      }

      .teardown-input {
        width: 100%;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.1);
        color: #f5f5f5;
        font-size: 13px;
        /* Strip native input chrome (autofill tint, platform focus ring,
           etc.) so the shadow root's own glass styling is the only thing
           that ever renders here — the browser's UA stylesheet still
           reaches inside a shadow tree even though page stylesheets
           don't, so this still needs to be explicit. */
        -webkit-appearance: none;
        appearance: none;
      }

      .teardown-input:focus {
        outline: none;
        border-color: rgba(255, 255, 255, 0.4);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.15);
      }

      .teardown-input::placeholder {
        color: rgba(245, 245, 245, 0.45);
      }

      .teardown-answer-block {
        margin-bottom: 10px;
      }

      .teardown-answer-label {
        font-size: 11px;
        color: rgba(245, 245, 245, 0.55);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        margin-bottom: 2px;
      }

      .teardown-answer-text {
        font-size: 13px;
      }

      .teardown-summary-block {
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      }

      .teardown-summary-block:last-of-type {
        border-bottom: none;
      }

      .teardown-summary-label {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
      }

      #teardown-settings-view label {
        display: block;
        font-size: 12px;
        color: rgba(245, 245, 245, 0.6);
        margin-bottom: 4px;
      }

      .teardown-settings-status {
        margin-top: 6px;
        font-size: 11px;
        color: rgba(245, 245, 245, 0.5);
      }
    </style>

    <div id="teardown-card" class="teardown-card">
      <button id="teardown-close-btn" class="teardown-close-btn" aria-label="Close">&times;</button>
      <h1 id="teardown-title" class="teardown-title">Teardown this product?</h1>
      <div id="teardown-status" class="teardown-status">Click Start Teardown to analyze this page.</div>

      <div id="teardown-main">
        <div id="teardown-fallback-actions" class="teardown-fallback-actions" hidden>
          <button id="teardown-fallback-yes" class="teardown-btn">Yes</button>
          <button id="teardown-fallback-no" class="teardown-btn">No</button>
        </div>

        <div id="teardown-loading" class="teardown-loading" hidden>
          <div class="teardown-spinner"></div>
          <div class="teardown-loading-text">Analyzing</div>
        </div>

        <div id="teardown-flow" hidden>
          <div id="teardown-input-area">
            <input type="text" id="teardown-answer-input" class="teardown-input" placeholder="Type your answer…">
            <button id="teardown-submit-btn" class="teardown-btn">Submit</button>
          </div>

          <div id="teardown-reveal-area" hidden>
            <div class="teardown-answer-block">
              <div class="teardown-answer-label">Your answer</div>
              <div id="teardown-user-answer" class="teardown-answer-text"></div>
            </div>
            <div class="teardown-answer-block">
              <div class="teardown-answer-label">The Read</div>
              <div id="teardown-read-answer" class="teardown-answer-text"></div>
            </div>
            <button id="teardown-next-btn" class="teardown-btn" hidden>Next</button>
          </div>
        </div>

        <div id="teardown-summary" hidden>
          <div id="teardown-summary-content"></div>
          <button id="teardown-start-over-btn" class="teardown-btn">Teardown Another Page</button>
        </div>

        <button id="teardown-start-btn" class="teardown-btn teardown-btn-primary">Start Teardown</button>
      </div>

      <div id="teardown-settings-view" hidden>
        <label for="teardown-claude-key-input">Claude API key</label>
        <input type="password" id="teardown-claude-key-input" class="teardown-input" placeholder="sk-ant-...">
        <button id="teardown-save-key-btn" class="teardown-btn">Save Key</button>
        <div id="teardown-settings-status" class="teardown-settings-status"></div>
      </div>

      <button id="teardown-gear-btn" class="teardown-corner-btn" aria-label="Settings">&#9881;</button>
      <button id="teardown-home-btn" class="teardown-corner-btn" aria-label="Home" hidden>&#8962;</button>
    </div>
  `;

  const card = shadow.getElementById("teardown-card");
  const teardownTitle = shadow.getElementById("teardown-title");
  const statusEl = shadow.getElementById("teardown-status");
  const fallbackActions = shadow.getElementById("teardown-fallback-actions");
  const fallbackYesBtn = shadow.getElementById("teardown-fallback-yes");
  const fallbackNoBtn = shadow.getElementById("teardown-fallback-no");
  const startBtn = shadow.getElementById("teardown-start-btn");
  const closeBtn = shadow.getElementById("teardown-close-btn");

  const teardownMain = shadow.getElementById("teardown-main");
  const loadingEl = shadow.getElementById("teardown-loading");

  const teardownFlow = shadow.getElementById("teardown-flow");
  const teardownInputArea = shadow.getElementById("teardown-input-area");
  const teardownAnswerInput = shadow.getElementById("teardown-answer-input");
  const teardownSubmitBtn = shadow.getElementById("teardown-submit-btn");
  const teardownRevealArea = shadow.getElementById("teardown-reveal-area");
  const teardownUserAnswer = shadow.getElementById("teardown-user-answer");
  const teardownReadAnswer = shadow.getElementById("teardown-read-answer");
  const teardownNextBtn = shadow.getElementById("teardown-next-btn");

  const teardownSummary = shadow.getElementById("teardown-summary");
  const teardownSummaryContent = shadow.getElementById("teardown-summary-content");
  const startOverBtn = shadow.getElementById("teardown-start-over-btn");

  const settingsView = shadow.getElementById("teardown-settings-view");
  const gearBtn = shadow.getElementById("teardown-gear-btn");
  const homeBtn = shadow.getElementById("teardown-home-btn");
  const claudeApiKeyInput = shadow.getElementById("teardown-claude-key-input");
  const saveTokenBtn = shadow.getElementById("teardown-save-key-btn");
  const settingsStatus = shadow.getElementById("teardown-settings-status");

  // Closing fully removes the overlay from the DOM (not just hides it) —
  // clicking the icon again builds a fresh one from scratch.
  closeBtn.addEventListener("click", () => {
    console.log("Teardown: close button clicked, removing overlay.");
    host.remove();
  });

  // --- Settings: gear icon swaps the whole card to a dedicated view, home
  // icon swaps back. Opening settings never touches teardownMain's own
  // children (their hidden/visible state is left completely alone), so
  // whatever step was showing before reappears exactly as it was.
  //
  // The title is derived fresh from current state on the way back, rather
  // than snapshotted when settings opened — the 4-field call runs in the
  // background regardless of which screen is showing, so if it resolves
  // while settings is open, a stale snapshot would show the wrong title.
  function currentStepTitle() {
    if (!teardownSummary.hidden) {
      return "Summary";
    }
    if (!teardownFlow.hidden && teardownState) {
      return TEARDOWN_FIELDS[teardownState.currentIndex].question;
    }
    if (!loadingEl.hidden) {
      return "Analyzing";
    }
    return "Teardown this product?";
  }

  gearBtn.addEventListener("click", () => {
    console.log("Teardown: opening settings.");
    teardownTitle.textContent = "Settings";
    teardownMain.hidden = true;
    settingsView.hidden = false;
    gearBtn.hidden = true;
    homeBtn.hidden = false;
  });

  homeBtn.addEventListener("click", () => {
    console.log("Teardown: leaving settings, resuming last step.");
    teardownTitle.textContent = currentStepTitle();
    settingsView.hidden = true;
    teardownMain.hidden = false;
    homeBtn.hidden = true;
    gearBtn.hidden = false;
  });

  // One field at a time, in this order — matches the keys generateTeardown
  // returns in background.js. summaryLabel is the field name shown on the
  // review screen at the end; question is shown as the card's own title
  // during the one-at-a-time flow (not a separate line under a generic
  // title).
  const TEARDOWN_FIELDS = [
    { key: "who", question: "Who is this built for?", summaryLabel: "Who it's for" },
    { key: "job", question: "What job is this product hired to do?", summaryLabel: "The job" },
    { key: "value", question: "Why does this beat the alternative?", summaryLabel: "The value prop" },
    { key: "gap", question: "What's one gap or weak point?", summaryLabel: "The gap" }
  ];

  // Set by showFallbackPrompt(), read by the Yes button's handler.
  let pendingFallbackDomain = null;

  // All in-memory state for the write-then-reveal flow: which field we're
  // on, Claude's four generated answers, and the user's own typed answers.
  // No persistence, this resets whenever the overlay is closed/reopened or
  // Start Over is clicked.
  let teardownState = null;

  // Shared "please wait" state: any request in flight (reading the page,
  // checking a fallback homepage, or generating the teardown) shows the
  // same spinner + "Analyzing" title, no page-specific progress text —
  // the user doesn't need to know which network call is running.
  function showAnalyzing() {
    fallbackActions.hidden = true;
    startBtn.hidden = true;
    teardownFlow.hidden = true;
    teardownSummary.hidden = true;
    card.classList.remove("teardown-card--summary");
    statusEl.textContent = "";
    teardownTitle.textContent = "Analyzing";
    loadingEl.hidden = false;
  }

  // Once the soft check passes, there's no separate confirmation step, this
  // goes straight into calling generateTeardown (showing the loading state
  // while that's in flight) and then the first field's question.
  function startTeardownGeneration(pageText, hostname) {
    showAnalyzing();

    const message = { type: "GENERATE_TEARDOWN", pageText, hostname };
    console.log("Sending GENERATE_TEARDOWN message", message);

    chrome.runtime.sendMessage(message, (response) => {
      loadingEl.hidden = true;

      if (chrome.runtime.lastError) {
        teardownTitle.textContent = "Teardown this product?";
        statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
        startBtn.hidden = false;
        return;
      }

      if (!response || !response.ok) {
        const errMsg = response && response.error ? response.error : "Unknown error.";
        console.error("Teardown generation failed:", errMsg);
        teardownTitle.textContent = "Teardown this product?";
        statusEl.textContent = `Error: ${errMsg}`;
        startBtn.hidden = false;
        return;
      }

      console.log("Teardown generated:", {
        who: response.who,
        job: response.job,
        value: response.value,
        gap: response.gap
      });

      teardownState = {
        currentIndex: 0,
        generatedAnswers: {
          who: response.who,
          job: response.job,
          value: response.value,
          gap: response.gap
        },
        userAnswers: {}
      };

      teardownFlow.hidden = false;
      renderCurrentTeardownField();
    });
  }

  function renderCurrentTeardownField() {
    const field = TEARDOWN_FIELDS[teardownState.currentIndex];
    teardownTitle.textContent = field.question;
    statusEl.textContent = "";
    teardownAnswerInput.value = "";
    teardownInputArea.hidden = false;
    teardownRevealArea.hidden = true;
    teardownNextBtn.hidden = true;
    teardownAnswerInput.focus();
  }

  function submitCurrentTeardownField() {
    const field = TEARDOWN_FIELDS[teardownState.currentIndex];
    const typedAnswer = teardownAnswerInput.value.trim();
    teardownState.userAnswers[field.key] = typedAnswer;

    teardownUserAnswer.textContent = typedAnswer || "(no answer given)";
    teardownReadAnswer.textContent = teardownState.generatedAnswers[field.key];

    teardownInputArea.hidden = true;
    teardownRevealArea.hidden = false;
    teardownNextBtn.hidden = false;

    const isLastField = teardownState.currentIndex === TEARDOWN_FIELDS.length - 1;
    teardownNextBtn.textContent = isLastField ? "View Summary" : "Next";
  }

  // Review screen shown after the fourth field's reveal: all four fields
  // stacked vertically, each with the user's own answer next to The Read.
  // Not a new interaction, just a summary of what already happened. Gets
  // a larger card (teardown-card--summary) since there's meaningfully more
  // to read here than any single-field step.
  function renderSummary() {
    teardownSummaryContent.textContent = "";

    TEARDOWN_FIELDS.forEach((field) => {
      const block = document.createElement("div");
      block.className = "teardown-summary-block";

      const labelEl = document.createElement("div");
      labelEl.className = "teardown-summary-label";
      labelEl.textContent = field.summaryLabel;
      block.appendChild(labelEl);

      const userBlock = document.createElement("div");
      userBlock.className = "teardown-answer-block";
      const userLabel = document.createElement("div");
      userLabel.className = "teardown-answer-label";
      userLabel.textContent = "Your answer";
      const userText = document.createElement("div");
      userText.className = "teardown-answer-text";
      userText.textContent = teardownState.userAnswers[field.key] || "(no answer given)";
      userBlock.appendChild(userLabel);
      userBlock.appendChild(userText);
      block.appendChild(userBlock);

      const readBlock = document.createElement("div");
      readBlock.className = "teardown-answer-block";
      const readLabel = document.createElement("div");
      readLabel.className = "teardown-answer-label";
      readLabel.textContent = "The Read";
      const readText = document.createElement("div");
      readText.className = "teardown-answer-text";
      readText.textContent = teardownState.generatedAnswers[field.key];
      readBlock.appendChild(readLabel);
      readBlock.appendChild(readText);
      block.appendChild(readBlock);

      teardownSummaryContent.appendChild(block);
    });

    teardownFlow.hidden = true;
    teardownSummary.hidden = false;
    card.classList.add("teardown-card--summary");
    teardownTitle.textContent = "Summary";
    statusEl.textContent = "";
  }

  // Fully resets the overlay's in-memory state back to the initial screen,
  // ready to run the soft check again from scratch on a new page.
  function resetToInitialState() {
    console.log("Start Over clicked, resetting state");

    teardownState = null;
    pendingFallbackDomain = null;

    fallbackActions.hidden = true;
    loadingEl.hidden = true;
    teardownFlow.hidden = true;
    teardownInputArea.hidden = false;
    teardownRevealArea.hidden = true;
    teardownAnswerInput.value = "";
    teardownUserAnswer.textContent = "";
    teardownReadAnswer.textContent = "";
    teardownNextBtn.hidden = true;
    teardownNextBtn.textContent = "Next";
    teardownSummary.hidden = true;
    teardownSummaryContent.textContent = "";
    card.classList.remove("teardown-card--summary");

    startBtn.hidden = false;
    teardownTitle.textContent = "Teardown this product?";
    statusEl.textContent = "Click Start Teardown to analyze this page.";
  }

  teardownSubmitBtn.addEventListener("click", submitCurrentTeardownField);

  teardownAnswerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitCurrentTeardownField();
    }
  });

  teardownNextBtn.addEventListener("click", () => {
    const isLastField = teardownState.currentIndex === TEARDOWN_FIELDS.length - 1;
    if (isLastField) {
      renderSummary();
    } else {
      teardownState.currentIndex += 1;
      renderCurrentTeardownField();
    }
  });

  startOverBtn.addEventListener("click", resetToInitialState);

  // Reloading the extension in chrome://extensions invalidates any content
  // script already injected into an open tab from before that reload —
  // chrome.runtime goes undefined in that stale instance, and calling
  // sendMessage on it throws a raw, confusing TypeError. Check for that
  // up front on every entry point that talks to the extension, and show
  // something the user can actually act on instead.
  function isExtensionContextValid() {
    return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  }

  function showFallbackPrompt(domain) {
    pendingFallbackDomain = domain;
    console.log("pendingFallbackDomain set to:", pendingFallbackDomain);
    loadingEl.hidden = true;
    teardownTitle.textContent = "Teardown this product?";
    statusEl.textContent = `This doesn't look like a product or company page. Want to teardown ${domain} instead?`;
    startBtn.hidden = true;
    fallbackActions.hidden = false;
  }

  startBtn.addEventListener("click", () => {
    console.log("Start Teardown clicked");

    if (!isExtensionContextValid()) {
      statusEl.textContent = "This overlay is out of date — refresh the page and click the icon again.";
      return;
    }

    // No "Reading page…" text — straight to the same Analyzing state used
    // for every other wait in this flow, so there's nothing technical for
    // the user to parse, just one consistent "please wait" indicator.
    showAnalyzing();

    const message = { type: "GRAB_PAGE_CONTENT" };

    try {
      console.log("Sending message to background.js", message);
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          loadingEl.hidden = true;
          teardownTitle.textContent = "Teardown this product?";
          statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
          startBtn.hidden = false;
          return;
        }

        if (!response || !response.ok) {
          const errMsg = response && response.error ? response.error : "Unknown error.";
          loadingEl.hidden = true;
          teardownTitle.textContent = "Teardown this product?";
          statusEl.textContent = `Error: ${errMsg}`;
          startBtn.hidden = false;
          return;
        }

        // Full extraction detail (title/meta description/raw text) is for our
        // own debugging only — the overlay UI just shows a clean verdict.
        console.log("GRAB_PAGE_CONTENT response received", response);
        console.log("response.rootDomain:", response.rootDomain);

        if (response.isProductPage) {
          startTeardownGeneration(response.pageText, response.hostname);
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

    if (!isExtensionContextValid()) {
      statusEl.textContent = "This overlay is out of date — refresh the page and click the icon again.";
      return;
    }

    showAnalyzing();

    const message = { type: "CHECK_HOMEPAGE_FALLBACK", domain };
    console.log("Sending CHECK_HOMEPAGE_FALLBACK message", message);

    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        loadingEl.hidden = true;
        teardownTitle.textContent = "Teardown this product?";
        statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
        startBtn.hidden = false;
        return;
      }

      if (!response || !response.ok) {
        const errMsg = response && response.error ? response.error : "Unknown error.";
        console.error("Homepage fallback check failed:", errMsg);
        loadingEl.hidden = true;
        teardownTitle.textContent = "Teardown this product?";
        statusEl.textContent = "Couldn't find a clear product page here.";
        startBtn.hidden = false;
        return;
      }

      console.log("Homepage fallback content received", response);

      if (response.isProductPage) {
        startTeardownGeneration(response.pageText, response.hostname);
      } else {
        // No further fallback attempts — stop here.
        loadingEl.hidden = true;
        teardownTitle.textContent = "Teardown this product?";
        statusEl.textContent = "Couldn't find a clear product page here.";
        startBtn.hidden = false;
      }
    });
  });

  fallbackNoBtn.addEventListener("click", () => {
    console.log("Homepage fallback declined");
    fallbackActions.hidden = true;
    startBtn.hidden = false;
    // Ending here is intentional — same as closing the overlay, no further action.
  });

  // Pre-fill the input with whatever key is already stored, if any.
  chrome.storage.local.get("claudeApiKey", ({ claudeApiKey }) => {
    if (claudeApiKey) {
      claudeApiKeyInput.value = claudeApiKey;
    }
  });

  saveTokenBtn.addEventListener("click", () => {
    if (!isExtensionContextValid()) {
      settingsStatus.textContent = "This overlay is out of date — refresh the page and click the icon again.";
      return;
    }

    const key = claudeApiKeyInput.value.trim();
    chrome.storage.local.set({ claudeApiKey: key }, () => {
      settingsStatus.textContent = key ? "Key saved." : "Key cleared.";
    });
  });
})();
