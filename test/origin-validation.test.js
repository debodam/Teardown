// Extracts the postMessage origin/source/marker validation functions
// straight out of the shipped overlay.js (not re-typed copies) and
// exercises them directly, since both are pure functions with no
// DOM/chrome dependency: resolveTrustedKeyEntrySource (the two key-entry
// iframes) and resolveTrustedPermissionPromptSource (the homepage
// fallback's permission-prompt iframe).
const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", "overlay.js");
const source = fs.readFileSync(SRC_PATH, "utf8");

function extractFunction(signature) {
  const startIdx = source.indexOf(signature);
  if (startIdx === -1) {
    console.error(`FAIL: could not find "${signature}" in overlay.js — extraction marker missing.`);
    process.exit(1);
  }

  // Brace-match from the opening '{' to find the function's real end,
  // rather than guessing a line count.
  let depth = 0;
  let i = startIdx + signature.length - 1; // at the opening brace
  let endIdx = -1;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  if (endIdx === -1) {
    console.error(`FAIL: could not brace-match the end of "${signature}".`);
    process.exit(1);
  }

  const fnSource = source.slice(startIdx, endIdx);
  return new Function(`"use strict"; return (${fnSource});`)();
}

const resolveTrustedKeyEntrySource = extractFunction(
  "function resolveTrustedKeyEntrySource(event, extensionOrigin, onboardingWindow, settingsWindow) {"
);
const resolveTrustedPermissionPromptSource = extractFunction(
  "function resolveTrustedPermissionPromptSource(event, extensionOrigin, promptWindow) {"
);

const REAL_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef";
const onboardingWindow = { name: "onboarding-window" };
const settingsWindow = { name: "settings-window" };
const promptWindow = { name: "permission-prompt-window" };
const someOtherWindow = { name: "attacker-controlled-window" };

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} — ${label} (got: ${JSON.stringify(actual)}, expected: ${JSON.stringify(expected)})`);
  if (ok) pass++; else fail++;
}

// ============================================================
// resolveTrustedKeyEntrySource — the onboarding/Settings key iframes
// ============================================================

check(
  "key-entry: legit onboarding message accepted",
  resolveTrustedKeyEntrySource(
    { origin: REAL_ORIGIN, source: onboardingWindow, data: { source: "teardown-key-entry", type: "KEY_SAVED" } },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  "onboarding"
);

check(
  "key-entry: legit settings message accepted",
  resolveTrustedKeyEntrySource(
    { origin: REAL_ORIGIN, source: settingsWindow, data: { source: "teardown-key-entry", type: "KEY_REMOVED" } },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  "settings"
);

// --- Spoofing attempts: a malicious host page's own script sharing the
// same top-level `window` could try to fake any of these fields. Each
// must be independently rejected. ---
check(
  "key-entry: wrong origin rejected (page's own script posting from its own origin)",
  resolveTrustedKeyEntrySource(
    { origin: "https://evil.example.com", source: onboardingWindow, data: { source: "teardown-key-entry", type: "KEY_SAVED" } },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  null
);

check(
  "key-entry: right origin string but wrong source window rejected",
  resolveTrustedKeyEntrySource(
    { origin: REAL_ORIGIN, source: someOtherWindow, data: { source: "teardown-key-entry", type: "KEY_SAVED" } },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  null
);

check(
  "key-entry: right origin + right source but missing marker field rejected",
  resolveTrustedKeyEntrySource(
    { origin: REAL_ORIGIN, source: onboardingWindow, data: { type: "KEY_SAVED" } },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  null
);

check(
  "key-entry: right origin + right source but wrong marker value rejected",
  resolveTrustedKeyEntrySource(
    { origin: REAL_ORIGIN, source: onboardingWindow, data: { source: "not-the-real-marker", type: "KEY_SAVED" } },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  null
);

check(
  "key-entry: null data rejected outright",
  resolveTrustedKeyEntrySource(
    { origin: REAL_ORIGIN, source: onboardingWindow, data: null },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  null
);

check(
  "key-entry: top-level page's own window object (not either iframe) rejected even with a correct-looking origin string",
  resolveTrustedKeyEntrySource(
    { origin: REAL_ORIGIN, source: {}, data: { source: "teardown-key-entry", type: "KEY_SAVED" } },
    REAL_ORIGIN, onboardingWindow, settingsWindow
  ),
  null
);

// ============================================================
// resolveTrustedPermissionPromptSource — the homepage-fallback
// permission-prompt iframe
// ============================================================

check(
  "permission-prompt: legit message accepted",
  resolveTrustedPermissionPromptSource(
    { origin: REAL_ORIGIN, source: promptWindow, data: { source: "teardown-permission-prompt", type: "PERMISSION_GRANTED" } },
    REAL_ORIGIN, promptWindow
  ),
  true
);

check(
  "permission-prompt: wrong origin rejected",
  resolveTrustedPermissionPromptSource(
    { origin: "https://evil.example.com", source: promptWindow, data: { source: "teardown-permission-prompt", type: "PERMISSION_GRANTED" } },
    REAL_ORIGIN, promptWindow
  ),
  false
);

check(
  "permission-prompt: right origin but wrong source window rejected",
  resolveTrustedPermissionPromptSource(
    { origin: REAL_ORIGIN, source: someOtherWindow, data: { source: "teardown-permission-prompt", type: "PERMISSION_GRANTED" } },
    REAL_ORIGIN, promptWindow
  ),
  false
);

check(
  "permission-prompt: right origin + source but missing marker field rejected",
  resolveTrustedPermissionPromptSource(
    { origin: REAL_ORIGIN, source: promptWindow, data: { type: "PERMISSION_GRANTED" } },
    REAL_ORIGIN, promptWindow
  ),
  false
);

check(
  "permission-prompt: right origin + source but wrong marker value rejected",
  resolveTrustedPermissionPromptSource(
    { origin: REAL_ORIGIN, source: promptWindow, data: { source: "not-the-real-marker", type: "PERMISSION_GRANTED" } },
    REAL_ORIGIN, promptWindow
  ),
  false
);

check(
  "permission-prompt: null data rejected outright",
  resolveTrustedPermissionPromptSource(
    { origin: REAL_ORIGIN, source: promptWindow, data: null },
    REAL_ORIGIN, promptWindow
  ),
  false
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
