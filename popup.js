// popup.js
// Owns the popup UI: the page-check trigger, the homepage-fallback prompt,
// the write-then-reveal 4-field teardown flow, and the settings panel.

const statusEl = document.getElementById("status");
const fallbackActions = document.getElementById("fallbackActions");
const fallbackYesBtn = document.getElementById("fallbackYesBtn");
const fallbackNoBtn = document.getElementById("fallbackNoBtn");
const startBtn = document.getElementById("startBtn");

const teardownFlow = document.getElementById("teardownFlow");
const teardownQuestion = document.getElementById("teardownQuestion");
const teardownInputArea = document.getElementById("teardownInputArea");
const teardownAnswerInput = document.getElementById("teardownAnswerInput");
const teardownSubmitBtn = document.getElementById("teardownSubmitBtn");
const teardownRevealArea = document.getElementById("teardownRevealArea");
const teardownUserAnswer = document.getElementById("teardownUserAnswer");
const teardownReadAnswer = document.getElementById("teardownReadAnswer");
const teardownNextBtn = document.getElementById("teardownNextBtn");

const teardownSummary = document.getElementById("teardownSummary");
const teardownSummaryContent = document.getElementById("teardownSummaryContent");
const startOverBtn = document.getElementById("startOverBtn");

// One field at a time, in this order — matches the keys generateTeardown
// returns in background.js. summaryLabel is the field name shown on the
// review screen at the end; question is the plain-language prompt shown
// during the one-at-a-time flow.
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
// No persistence, this resets whenever the popup closes or Start Over
// is clicked.
let teardownState = null;

// Once the soft check passes, there's no separate confirmation step, this
// goes straight from "looks like a product page" into calling
// generateTeardown and then the first field's question.
function startTeardownGeneration(pageText, hostname) {
  fallbackActions.hidden = true;
  startBtn.hidden = true;
  statusEl.textContent = "Analyzing this page…";

  const message = { type: "GENERATE_TEARDOWN", pageText, hostname };
  console.log("Sending GENERATE_TEARDOWN message", message);

  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
      startBtn.hidden = false;
      return;
    }

    if (!response || !response.ok) {
      const errMsg = response && response.error ? response.error : "Unknown error.";
      console.error("Teardown generation failed:", errMsg);
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

    statusEl.textContent = "Teardown in progress…";
    teardownFlow.hidden = false;
    renderCurrentTeardownField();
  });
}

function renderCurrentTeardownField() {
  const field = TEARDOWN_FIELDS[teardownState.currentIndex];
  teardownQuestion.textContent = field.question;
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
// Not a new interaction, just a summary of what already happened.
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
  statusEl.textContent = "Teardown complete.";
}

// Fully resets the popup's in-memory state back to the initial screen,
// ready to run the soft check again from scratch on a new page.
function resetToInitialState() {
  console.log("Start Over clicked, resetting state");

  teardownState = null;
  pendingFallbackDomain = null;

  fallbackActions.hidden = true;
  teardownFlow.hidden = true;
  teardownInputArea.hidden = false;
  teardownRevealArea.hidden = true;
  teardownQuestion.textContent = "";
  teardownAnswerInput.value = "";
  teardownUserAnswer.textContent = "";
  teardownReadAnswer.textContent = "";
  teardownNextBtn.hidden = true;
  teardownNextBtn.textContent = "Next";
  teardownSummary.hidden = true;
  teardownSummaryContent.textContent = "";

  startBtn.hidden = false;
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

function showFallbackPrompt(domain) {
  pendingFallbackDomain = domain;
  console.log("pendingFallbackDomain set to:", pendingFallbackDomain);
  statusEl.textContent = `This doesn't look like a product or company page. Want to teardown ${domain} instead?`;
  startBtn.hidden = true;
  fallbackActions.hidden = false;
}

startBtn.addEventListener("click", () => {
  console.log("Start Teardown clicked");
  fallbackActions.hidden = true;
  teardownFlow.hidden = true;
  teardownSummary.hidden = true;
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
      startBtn.hidden = false;
      return;
    }

    console.log("Homepage fallback content received", response);

    if (response.isProductPage) {
      startTeardownGeneration(response.pageText, response.hostname);
    } else {
      // No further fallback attempts — stop here.
      statusEl.textContent = "Couldn't find a clear product page here.";
      startBtn.hidden = false;
    }
  });
});

fallbackNoBtn.addEventListener("click", () => {
  console.log("Homepage fallback declined");
  fallbackActions.hidden = true;
  startBtn.hidden = false;
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
