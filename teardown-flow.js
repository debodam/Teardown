// teardown-flow.js — the actual teardown user journey: onboarding, the
// five-question write-then-reveal flow, the summary/score page, Settings,
// and the confirm/portfolio/homepage-fallback orchestration. Split out of
// overlay.js purely for file-size/readability reasons (pure reorg, no
// behavior change).
//
// Loaded after overlay.js in background.js's executeScript files array,
// so window.__teardownOverlay already has: shadow (the Shadow DOM root
// overlay.js built, used here to re-declare this file's own element
// references by id rather than overlay.js re-exporting ~45 of them by
// hand), setStatus, fadeIn, resetToStartWithError,
// isExtensionContextValid, showPermissionPrompt, hidePermissionPrompt.
// This file exposes showOnboarding/endOnboarding/resetToInitialState back
// onto that same namespace, since overlay.js's message listener needs to
// call into them.
window.__teardownOverlay = window.__teardownOverlay || {};

(function () {
  const shadow = window.__teardownOverlay.shadow;
  const setStatus = window.__teardownOverlay.setStatus;
  const fadeIn = window.__teardownOverlay.fadeIn;
  const resetToStartWithError = window.__teardownOverlay.resetToStartWithError;
  const isExtensionContextValid = window.__teardownOverlay.isExtensionContextValid;
  const showPermissionPrompt = window.__teardownOverlay.showPermissionPrompt;
  const hidePermissionPrompt = window.__teardownOverlay.hidePermissionPrompt;

  const card = shadow.getElementById("teardown-card");
  const teardownTitle = shadow.getElementById("teardown-title");
  const statusEl = shadow.getElementById("teardown-status");
  const confirmActions = shadow.getElementById("teardown-confirm-actions");
  const confirmYesBtn = shadow.getElementById("teardown-confirm-yes");
  const confirmNoBtn = shadow.getElementById("teardown-confirm-no");
  const startBtn = shadow.getElementById("teardown-start-btn");

  const teardownMain = shadow.getElementById("teardown-main");
  const loadingEl = shadow.getElementById("teardown-loading");
  const loadingStatusEl = shadow.getElementById("teardown-loading-status");

  const teardownFlow = shadow.getElementById("teardown-flow");
  const progressLabel = shadow.getElementById("teardown-progress-label");
  const progressSegments = Array.from(shadow.querySelectorAll(".teardown-progress-row .progress-track"));
  const teardownMicroPrompt = shadow.getElementById("teardown-microprompt");
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

  const scoreSection = shadow.getElementById("teardown-score-section");
  const scoreRingFill = shadow.getElementById("teardown-score-ring-fill");
  const scoreValueEl = shadow.getElementById("teardown-score-value");
  const scoreTierEl = shadow.getElementById("teardown-score-tier");
  const scoreNoteEl = shadow.getElementById("teardown-score-note");

  const settingsView = shadow.getElementById("teardown-settings-view");
  const gearBtn = shadow.getElementById("teardown-gear-btn");
  const homeBtn = shadow.getElementById("teardown-home-btn");

  const onboardingView = shadow.getElementById("teardown-onboarding");
  const onboardingSlideEls = [
    shadow.getElementById("teardown-onboarding-slide-0"),
    shadow.getElementById("teardown-onboarding-slide-1"),
    shadow.getElementById("teardown-onboarding-slide-2")
  ];
  const onboardingDotEls = Array.from(shadow.querySelectorAll(".teardown-onboarding-dot"));
  const onboardingPrevBtn = shadow.getElementById("teardown-onboarding-prev");
  const onboardingNextBtn = shadow.getElementById("teardown-onboarding-next");

  // --- Onboarding: a 3-slide first-run carousel shown instead of the
  // normal main flow whenever no Claude API key is on file yet (the check
  // that decides this lives near the bottom of this file, alongside
  // Settings' own key-input init, since both start from the same
  // chrome.storage.local read). Deliberately hides the shared
  // title/status header rather than reusing it — see the CSS comment
  // above .teardown-onboarding-heading for why. Slide 3 collects the key
  // and, once saved, hands straight off to the normal idle screen; there's
  // no separate "done" step to click through.
  const ONBOARDING_SLIDE_COUNT = onboardingSlideEls.length;
  let onboardingSlideIndex = 0;

  function renderOnboardingSlide(index) {
    onboardingSlideIndex = index;
    onboardingSlideEls.forEach((slide, i) => {
      slide.hidden = i !== index;
    });
    onboardingDotEls.forEach((dot, i) => {
      dot.classList.toggle("teardown-onboarding-dot--active", i === index);
    });
    onboardingPrevBtn.hidden = index === 0;
    onboardingNextBtn.hidden = index === ONBOARDING_SLIDE_COUNT - 1;
    fadeIn(onboardingSlideEls[index]);
  }

  function showOnboarding() {
    teardownTitle.hidden = true;
    statusEl.hidden = true;
    teardownMain.hidden = true;
    settingsView.hidden = true;
    onboardingView.hidden = false;
    renderOnboardingSlide(0);
  }

  // Drops the carousel onto the exact idle screen a returning user sees —
  // #teardown-main's own children were never touched while onboarding was
  // showing, so nothing needs resetting here beyond un-hiding the header.
  function endOnboarding() {
    onboardingView.hidden = true;
    teardownTitle.hidden = false;
    statusEl.hidden = false;
    teardownMain.hidden = false;
    fadeIn(teardownTitle, statusEl, teardownMain);
  }

  onboardingPrevBtn.addEventListener("click", () => {
    if (onboardingSlideIndex > 0) {
      renderOnboardingSlide(onboardingSlideIndex - 1);
    }
  });

  onboardingNextBtn.addEventListener("click", () => {
    if (onboardingSlideIndex < ONBOARDING_SLIDE_COUNT - 1) {
      renderOnboardingSlide(onboardingSlideIndex + 1);
    }
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
  // currentAnalyzingTitle tracks the exact "Analyzing" / "Analyzing X"
  // text so that round-trip doesn't lose the product name either.
  let currentAnalyzingTitle = "Analyzing";

  function currentStepTitle() {
    if (!teardownSummary.hidden) {
      return "Teardown Summary";
    }
    if (!teardownFlow.hidden && teardownState) {
      return TEARDOWN_FIELDS[teardownState.currentIndex].question;
    }
    if (!loadingEl.hidden) {
      return currentAnalyzingTitle;
    }
    return "Teardown this product?";
  }

  // gearBtn lives inside #teardown-main and homeBtn inside
  // #teardown-settings-view now (see the markup above), so toggling each
  // section's own hidden state already shows/hides its button — no need
  // to toggle the buttons themselves separately.
  gearBtn.addEventListener("click", () => {
    console.log("Teardown: opening settings.");
    teardownTitle.textContent = "Settings";
    // #teardown-status sits above #teardown-main and #teardown-settings-view
    // as a shared sibling, not inside either one — toggling teardownMain's
    // own hidden state never touched it, so whatever main-flow text was
    // last set there (e.g. "Click Start Teardown to analyze this page.")
    // kept rendering right through the Settings view. Hide it explicitly
    // whenever Settings is open; Settings has its own dedicated status line
    // (#teardown-settings-status) for save/clear feedback instead.
    statusEl.hidden = true;
    teardownMain.hidden = true;
    settingsView.hidden = false;
  });

  homeBtn.addEventListener("click", () => {
    console.log("Teardown: leaving settings, resuming last step.");
    teardownTitle.textContent = currentStepTitle();
    statusEl.hidden = false;
    settingsView.hidden = true;
    teardownMain.hidden = false;
  });

  // One field at a time, in this order — matches the keys generateTeardown
  // returns in background.js. question is shown as the card's own title
  // during the one-at-a-time flow AND as each summary card's heading;
  // microPrompt is the smaller helper line shown just under the title to
  // steer the user's own answer.
  const TEARDOWN_FIELDS = [
    {
      key: "who",
      question: "Who is this built for?",
      microPrompt: "Be specific: role, context, situation, not just a segment."
    },
    {
      key: "job",
      question: "What job is this product hired to do?",
      microPrompt: "What progress is the user trying to make?"
    },
    {
      key: "value",
      question: "Why does this beat the alternative?",
      microPrompt: "Name the alternative and the real edge this has over it."
    },
    {
      key: "gap",
      question: "What's the biggest weak point here?",
      microPrompt: "Be specific, not just \"pricing.\""
    },
    {
      key: "metric",
      question: "What metric would this product move?",
      microPrompt: "Think activation, retention, revenue, whatever actually fits."
    }
  ];

  // Set by showConfirmPrompt(), read by the Yes button's handler. Always
  // populated after GRAB_PAGE_CONTENT resolves, whether the soft check
  // passed or not — the confirmation step is the same either way, just
  // "Yes" does different things depending on isProductPage.
  let pendingConfirmation = null;

  // All in-memory state for the write-then-reveal flow: which field we're
  // on, Claude's five generated answers, and the user's own typed answers.
  // No persistence, this resets whenever the overlay is closed/reopened or
  // Start Over is clicked.
  let teardownState = null;

  const ANALYZING_STATUS_LINES = [
    "Reading the page",
    "Mapping the core user and job",
    "Identifying likely alternatives"
  ];
  let analyzingIntervalId = null;

  function startAnalyzingRotation() {
    let index = 0;
    loadingStatusEl.textContent = ANALYZING_STATUS_LINES[0];
    analyzingIntervalId = setInterval(() => {
      index = (index + 1) % ANALYZING_STATUS_LINES.length;
      loadingStatusEl.textContent = ANALYZING_STATUS_LINES[index];
    }, 2000);
  }

  function stopAnalyzingRotation() {
    if (analyzingIntervalId !== null) {
      clearInterval(analyzingIntervalId);
      analyzingIntervalId = null;
    }
  }

  // Shared "please wait" state: any request in flight (reading the page,
  // checking a fallback homepage, or generating the teardown) shows the
  // same orb + rotating status lines. productName, when known, personalizes
  // the heading ("Analyzing Ninja Foodi Air Fryer" instead of the generic
  // "Analyzing") — not known yet during the initial page read or the
  // fallback-homepage check, only once a page has actually been confirmed.
  function showAnalyzing(productName) {
    confirmActions.hidden = true;
    startBtn.hidden = true;
    teardownFlow.hidden = true;
    teardownSummary.hidden = true;
    card.classList.remove("teardown-card--summary");
    setStatus("");
    currentAnalyzingTitle = productName ? `Analyzing ${productName}` : "Analyzing";
    teardownTitle.textContent = currentAnalyzingTitle;
    loadingEl.hidden = false;
    fadeIn(teardownTitle, loadingEl);
    startAnalyzingRotation();
  }

  function hideAnalyzing() {
    loadingEl.hidden = true;
    stopAnalyzingRotation();
  }

  // Once the user confirms, this goes straight into calling
  // generateTeardown (showing the loading state while that's in flight)
  // and then the first field's question.
  function startTeardownGeneration(pageText, hostname, productName) {
    showAnalyzing(productName);

    const message = { type: "GENERATE_TEARDOWN", pageText, hostname, productName };
    // hostname/productName only — pageText is the page's own content, no
    // need to echo the whole thing into this page's own console.
    console.log("Sending GENERATE_TEARDOWN message for:", hostname, productName);

    chrome.runtime.sendMessage(message, (response) => {
      hideAnalyzing();

      if (chrome.runtime.lastError) {
        resetToStartWithError(`Error: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (!response || !response.ok) {
        const errMsg = response && response.error ? response.error : "Unknown error.";
        console.error("Teardown generation failed:", errMsg);
        resetToStartWithError(`Error: ${errMsg}`);
        return;
      }

      console.log("Teardown generated:", {
        who: response.who,
        job: response.job,
        value: response.value,
        gap: response.gap,
        metric: response.metric
      });

      teardownState = {
        currentIndex: 0,
        productName,
        hostname,
        generatedAnswers: {
          who: response.who,
          job: response.job,
          value: response.value,
          gap: response.gap,
          metric: response.metric
        },
        userAnswers: {}
      };

      teardownFlow.hidden = false;
      renderCurrentTeardownField();
    });
  }

  function updateProgress(currentIndex) {
    progressLabel.textContent = `Question ${currentIndex + 1} of ${TEARDOWN_FIELDS.length}`;
    progressSegments.forEach((segment, index) => {
      segment.classList.toggle("progress-fill", index <= currentIndex);
    });
  }

  function renderCurrentTeardownField() {
    const field = TEARDOWN_FIELDS[teardownState.currentIndex];
    teardownTitle.textContent = field.question;
    teardownMicroPrompt.textContent = field.microPrompt;
    updateProgress(teardownState.currentIndex);
    setStatus("");
    teardownAnswerInput.value = "";
    teardownInputArea.hidden = false;
    teardownRevealArea.hidden = true;
    teardownNextBtn.hidden = true;
    fadeIn(teardownTitle, teardownFlow);
    teardownAnswerInput.focus();
  }

  function submitCurrentTeardownField() {
    const field = TEARDOWN_FIELDS[teardownState.currentIndex];
    const typedAnswer = teardownAnswerInput.value.trim();
    teardownState.userAnswers[field.key] = typedAnswer;

    teardownUserAnswer.textContent = typedAnswer || "No Answer Given.";
    teardownReadAnswer.textContent = teardownState.generatedAnswers[field.key];

    teardownInputArea.hidden = true;
    teardownRevealArea.hidden = false;
    teardownNextBtn.hidden = false;
    fadeIn(teardownRevealArea);

    const isLastField = teardownState.currentIndex === TEARDOWN_FIELDS.length - 1;
    teardownNextBtn.textContent = isLastField ? "View Summary" : "Next";
  }

  // Progress-ring math: circumference is fixed (the radius never
  // changes), so dasharray is set once here; only dashoffset moves per
  // score, the standard stroke-dasharray/dashoffset ring technique.
  const SCORE_RING_RADIUS = 38;
  const SCORE_RING_CIRCUMFERENCE = 2 * Math.PI * SCORE_RING_RADIUS;
  scoreRingFill.style.strokeDasharray = String(SCORE_RING_CIRCUMFERENCE);

  function updateScoreRing(score) {
    const clamped = Math.max(0, Math.min(5, score));
    scoreRingFill.style.strokeDashoffset = String(SCORE_RING_CIRCUMFERENCE * (1 - clamped / 5));
    scoreValueEl.textContent = clamped > 0 ? String(clamped) : "";
  }

  // The one summary-level score for the whole session (not per-question,
  // no rubric) — sent as a follow-up call once all five of the user's own
  // answers exist, since scoring them wouldn't make sense any earlier.
  // Failure here just hides the score section rather than showing an
  // error: it's a "cherry on top," not core functionality, and the five
  // Q&A cards below are still fully useful without it.
  function requestSessionScore() {
    scoreSection.hidden = false;
    updateScoreRing(0);
    scoreTierEl.textContent = "Scoring…";
    scoreNoteEl.textContent = "";

    if (!isExtensionContextValid()) {
      scoreSection.hidden = true;
      return;
    }

    const answers = TEARDOWN_FIELDS.map((field) => ({
      question: field.question,
      userAnswer: teardownState.userAnswers[field.key],
      aiAnswer: teardownState.generatedAnswers[field.key]
    }));

    const message = {
      type: "GENERATE_SCORE",
      answers,
      hostname: teardownState.hostname,
      productName: teardownState.productName
    };
    // hostname/productName only — the answers array carries the user's
    // own typed answers, no need to echo those into the console either.
    console.log("Sending GENERATE_SCORE message for:", message.hostname, message.productName);

    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Score generation failed:", chrome.runtime.lastError.message);
        scoreSection.hidden = true;
        return;
      }

      if (!response || !response.ok) {
        console.error("Score generation failed:", response && response.error);
        scoreSection.hidden = true;
        return;
      }

      console.log("Score generated:", response);
      updateScoreRing(response.score);
      scoreTierEl.textContent = response.tier;
      scoreNoteEl.textContent = response.note;
    });
  }

  // Review screen shown after the fifth field's reveal: the single
  // overall score ring at the top, then a small 5/5 check row, then all
  // five fields stacked vertically, each showing the question, "Your
  // take" in user-card styling, and "The Read" in ai-card styling. Just a
  // review of what already happened — no comparisons, insight cards, or
  // animation beyond the one static check row. Gets a larger card
  // (teardown-card--summary) since there's meaningfully more to read here
  // than any single-field step.
  function renderSummary() {
    teardownSummaryContent.textContent = "";

    const checkRow = document.createElement("div");
    checkRow.className = "teardown-summary-checks";
    TEARDOWN_FIELDS.forEach(() => {
      const check = document.createElement("div");
      check.className = "teardown-summary-check";
      check.textContent = "✓";
      checkRow.appendChild(check);
    });
    teardownSummaryContent.appendChild(checkRow);

    TEARDOWN_FIELDS.forEach((field) => {
      const block = document.createElement("div");
      block.className = "teardown-summary-block";

      const questionEl = document.createElement("div");
      questionEl.className = "teardown-summary-question";
      questionEl.textContent = field.question;
      block.appendChild(questionEl);

      const userCard = document.createElement("div");
      userCard.className = "teardown-answer-card user-card";
      const userLabel = document.createElement("div");
      userLabel.className = "teardown-answer-label";
      userLabel.textContent = "Your take";
      const userText = document.createElement("div");
      userText.className = "teardown-answer-text";
      userText.textContent = teardownState.userAnswers[field.key] || "No Answer Given.";
      userCard.appendChild(userLabel);
      userCard.appendChild(userText);
      block.appendChild(userCard);

      const aiCard = document.createElement("div");
      aiCard.className = "teardown-answer-card ai-card";
      const readLabel = document.createElement("div");
      readLabel.className = "teardown-answer-label";
      readLabel.textContent = "The Read";
      const readText = document.createElement("div");
      readText.className = "teardown-answer-text";
      readText.textContent = teardownState.generatedAnswers[field.key];
      aiCard.appendChild(readLabel);
      aiCard.appendChild(readText);
      block.appendChild(aiCard);

      teardownSummaryContent.appendChild(block);
    });

    teardownFlow.hidden = true;
    teardownSummary.hidden = false;
    card.classList.add("teardown-card--summary");
    teardownTitle.textContent = "Teardown Summary";
    // .teardown-status is already the "smaller line under the title"
    // pattern used everywhere else in the overlay — reused here to name
    // the product, falling back to the hostname if no name was ever
    // resolved for this run.
    setStatus(teardownState.productName || teardownState.hostname || "");
    fadeIn(teardownTitle, statusEl, teardownSummary);

    requestSessionScore();
  }

  // Fully resets the overlay's in-memory state back to the initial screen,
  // ready to run the soft check again from scratch on a new page.
  function resetToInitialState() {
    console.log("Start Over clicked, resetting state");

    teardownState = null;
    pendingConfirmation = null;

    confirmActions.hidden = true;
    hideAnalyzing();
    teardownFlow.hidden = true;
    teardownMicroPrompt.textContent = "";
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
    scoreSection.hidden = true;
    updateScoreRing(0);
    scoreTierEl.textContent = "";
    scoreNoteEl.textContent = "";

    startBtn.hidden = false;
    teardownTitle.textContent = "Teardown this product?";
    setStatus("Click Start Teardown to analyze this page.");
    fadeIn(teardownTitle, statusEl, startBtn);
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

  function truncateText(text, maxLength) {
    if (!text) {
      return text;
    }
    const trimmed = text.trim();
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…` : trimmed;
  }

  // Raw <title> text (especially on e-commerce sites) tends to run
  // "Product Name | marketing copy" or "Product Name, spec, spec : Site
  // Name" — the lead segment before the first strong separator is usually
  // the actual product name. Only used as a fallback when Claude's own
  // extracted productName isn't available.
  function cleanProductTitleFromRawTitle(rawTitle) {
    if (!rawTitle) {
      return null;
    }
    const leadSegment = rawTitle.split(/[|:]/)[0].trim();
    return truncateText(leadSegment || rawTitle, 60);
  }

  // Prefer Claude's own extracted name (from the soft check) since it's
  // already the real product/company name, not raw SEO-stuffed title text.
  // No name is available at all for the not-yet-fetched fallback-domain
  // case — that falls through to the generic phrasing in showConfirmPrompt.
  function resolveDisplayName(confirmation) {
    if (!confirmation.isProductPage) {
      return null;
    }
    if (confirmation.productName && confirmation.productName.trim()) {
      return truncateText(confirmation.productName, 60);
    }
    return cleanProductTitleFromRawTitle(confirmation.pageTitle);
  }

  // Always the second step after Start Teardown, whether the soft check
  // passed or not. A confirmed page with a known name gets the "We found
  // X" framing with name-specific buttons; anything without a clear name
  // (no name extracted despite being a product page, or the "try this
  // domain instead" fallback offer, which has no page-specific identity
  // yet) falls back to the plain generic phrasing.
  function showConfirmPrompt(confirmation) {
    pendingConfirmation = confirmation;
    // isProductPage/hostname only — confirmation also carries this page's
    // full text (pageText), no need to echo that into the console.
    console.log("pendingConfirmation set, isProductPage:", confirmation.isProductPage, "hostname:", confirmation.hostname);
    hideAnalyzing();
    teardownTitle.textContent = "Teardown this product?";

    const displayName = resolveDisplayName(confirmation);

    // "Not right now" reads as a plain decline (I don't want to do this
    // right now), not an instruction to go find a different page —
    // "Choose another page" implied the latter, which isn't what this
    // button actually does. Same wording in both branches for consistency.
    if (displayName) {
      setStatus(`We found ${displayName} on this page. Tear it down?`);
      confirmYesBtn.textContent = `Tear down ${displayName}`;
      confirmNoBtn.textContent = "Not right now";
    } else {
      setStatus(`Would you like to teardown ${confirmation.rootDomain}?`);
      confirmYesBtn.textContent = "Yes";
      confirmNoBtn.textContent = "Not right now";
    }

    startBtn.hidden = true;
    confirmActions.hidden = false;
    fadeIn(teardownTitle, statusEl, confirmActions);
  }

  // Personal portfolio/resume sites get their own terminal message instead
  // of the fallback Yes/No offer — offering to teardown that same site's
  // own homepage would just fail again, since there's no "different, more
  // product-y page" to point at. Session ends here, same as clicking "Not
  // right now" on a normal fallback: no further action, no error styling
  // beyond a plain explanation.
  function showPortfolioMessage() {
    console.log("Portfolio site detected, ending session.");
    pendingConfirmation = null;
    hideAnalyzing();
    confirmActions.hidden = true;
    startBtn.hidden = false;
    teardownTitle.textContent = "Teardown this product?";
    setStatus("We don't analyze portfolio sites!", true);
    fadeIn(teardownTitle, statusEl, startBtn);
  }

  startBtn.addEventListener("click", () => {
    console.log("Start Teardown clicked");

    if (!isExtensionContextValid()) {
      setStatus("This overlay is out of date — refresh the page and click the icon again.", true);
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
          hideAnalyzing();
          resetToStartWithError(`Error: ${chrome.runtime.lastError.message}`);
          return;
        }

        if (!response || !response.ok) {
          const errMsg = response && response.error ? response.error : "Unknown error.";
          hideAnalyzing();
          resetToStartWithError(`Error: ${errMsg}`);
          return;
        }

        // isProductPage/rootDomain only — response also carries this
        // page's full extracted text (pageText/pageTitle), no need to
        // echo that into the console.
        console.log("GRAB_PAGE_CONTENT response received, isProductPage:", response.isProductPage, "rootDomain:", response.rootDomain);

        // Portfolio detection only matters when isProductPage is false — a
        // portfolio site that also sells a product/merch is still a
        // product page first, and goes through the normal flow.
        if (!response.isProductPage && response.isPortfolio) {
          showPortfolioMessage();
          return;
        }

        showConfirmPrompt({
          isProductPage: response.isProductPage,
          productName: response.productName,
          pageText: response.pageText,
          pageTitle: response.pageTitle,
          hostname: response.hostname,
          rootDomain: response.rootDomain
        });
      });
    } catch (error) {
      console.error("Error sending message:", error);
    }
  });

  confirmYesBtn.addEventListener("click", () => {
    const confirmation = pendingConfirmation;
    console.log("Teardown confirmed, isProductPage:", confirmation && confirmation.isProductPage);

    if (!isExtensionContextValid()) {
      setStatus("This overlay is out of date — refresh the page and click the icon again.", true);
      return;
    }

    if (!confirmation) {
      // Shouldn't happen, but don't leave the user stuck if it does.
      resetToInitialState();
      return;
    }

    if (confirmation.isProductPage) {
      // Already have this page's content from GRAB_PAGE_CONTENT — no need
      // to fetch anything else, straight into generation.
      startTeardownGeneration(confirmation.pageText, confirmation.hostname, resolveDisplayName(confirmation));
      return;
    }

    // The soft check said no on the current page, so "yes" here means
    // read that domain's actual homepage in the background and try again
    // there — this page stays open the whole time (you don't lose your
    // place on whatever you were reading). That domain isn't covered by
    // host_permissions upfront, so accessing it requires an optional,
    // per-origin permission grant, which needs its own small extra step:
    // chrome.permissions.request() only works "during a user gesture,"
    // and that gesture context survives neither a content script (where
    // chrome.permissions isn't exposed at all) nor a trip through
    // chrome.runtime.sendMessage to the background script (confirmed
    // directly — it throws "This function must be called during a user
    // gesture" there even though it's still handling this same click, one
    // hop later). A real click inside a genuine extension-page iframe
    // (permission-prompt.html) is the only place left where the browser
    // actually credits it — see showPermissionPrompt above and
    // permission-prompt.js for the rest of that reasoning.
    const domain = confirmation.rootDomain;

    function proceedWithHomepageFallback() {
      showAnalyzing();

      const message = { type: "CHECK_HOMEPAGE_FALLBACK", domain };
      console.log("Sending CHECK_HOMEPAGE_FALLBACK message for domain:", domain);

      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          hideAnalyzing();
          resetToStartWithError(`Error: ${chrome.runtime.lastError.message}`);
          return;
        }

        if (!response || !response.ok) {
          const errMsg = response && response.error ? response.error : "Unknown error.";
          console.error("Homepage fallback check failed:", errMsg);
          hideAnalyzing();
          // A bot-check wall is a distinct, honest reason worth actually
          // saying — background.js's own message is already written to
          // be user-presentable for it. Everything else collapses to the
          // generic explanation, since a raw exception message (a
          // network error, a timeout) isn't something a user should have
          // to parse.
          resetToStartWithError(
            response && response.isBotWall ? errMsg : "Couldn't find a clear product page here."
          );
          return;
        }

        console.log("Homepage fallback content received, isProductPage:", response.isProductPage);

        if (response.isProductPage) {
          startTeardownGeneration(response.pageText, response.hostname, response.productName);
        } else if (response.isPortfolio) {
          showPortfolioMessage();
        } else {
          // No further fallback attempts — stop here.
          hideAnalyzing();
          resetToStartWithError("Couldn't find a clear product page here.");
        }
      });
    }

    // Ask background.js (a trusted context where chrome.permissions
    // actually exists) whether this domain is already granted — a plain
    // read, no gesture needed for that part. Only shows the extra
    // permission-prompt iframe step if it isn't.
    chrome.runtime.sendMessage({ type: "HAS_HOMEPAGE_PERMISSION", domain }, (permResponse) => {
      if (chrome.runtime.lastError) {
        resetToStartWithError(`Error: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (permResponse && permResponse.ok && permResponse.granted) {
        proceedWithHomepageFallback();
        return;
      }

      showPermissionPrompt(domain, (granted) => {
        hidePermissionPrompt();
        if (!granted) {
          resetToStartWithError(`Permission to check ${domain} was declined.`);
          return;
        }
        proceedWithHomepageFallback();
      });
    });
  });

  confirmNoBtn.addEventListener("click", () => {
    console.log("Teardown declined");
    pendingConfirmation = null;
    confirmActions.hidden = true;
    startBtn.hidden = false;
    teardownTitle.textContent = "Teardown this product?";
    setStatus("Click Start Teardown to analyze this page.");
    fadeIn(teardownTitle, statusEl, startBtn);
  });

  // Whether onboarding needs to run at all. This content script never
  // touches chrome.storage.local for the key itself (background.js locks
  // storage.local down to TRUSTED_CONTEXTS on startup, which would refuse
  // a direct read from here anyway) — it only asks background.js for a
  // plain boolean, never the key value. Save/Remove both live entirely
  // inside the key-entry iframes now; this is purely the initial "which
  // screen do I open on" decision.
  chrome.runtime.sendMessage({ type: "HAS_CLAUDE_API_KEY" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Teardown: could not check for a saved API key.", chrome.runtime.lastError.message);
      return;
    }
    if (response && response.ok && !response.hasKey) {
      showOnboarding();
    }
  });

  // --- Namespace exports for overlay.js ---
  // overlay.js's message listener (handleTrustedFrameMessage) calls these
  // for the KEY_SAVED/KEY_REMOVED cases.
  window.__teardownOverlay.showOnboarding = showOnboarding;
  window.__teardownOverlay.endOnboarding = endOnboarding;
  window.__teardownOverlay.resetToInitialState = resetToInitialState;
})();
