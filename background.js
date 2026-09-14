// background.js — service worker.
// Owns: mounting the overlay UI into the active tab on icon click (below),
// injecting the page-read script on demand once the overlay asks for it,
// the soft check via Claude (below), the homepage fallback fetch (below),
// and the Claude 4-field teardown call (below).

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_VERSION = "2023-06-01";
// Small/fast model — this is a one-word yes/no classification, not the
// deep 4-field analysis, so we don't need a heavyweight model here.
const CLAUDE_SOFT_CHECK_MODEL = "claude-haiku-4-5-20251001";
// This is the actual product of the extension — sharp, specific, grounded
// answers, not a quick classification — so it gets the more capable model.
const CLAUDE_TEARDOWN_MODEL = "claude-sonnet-5";
const CLAUDE_TIMEOUT_MS = 10000;

// Pulls the actual text answer out of a Claude API response's content
// array. Newer models can put a "thinking" block (or other non-text block
// types) before the "text" block, so this scans for the first block that
// actually has type "text" instead of assuming content[0] is it. Returns
// null if no text block is present at all.
function extractTextFromClaudeContent(content) {
  if (!Array.isArray(content)) {
    return null;
  }
  const textBlock = content.find((block) => block && block.type === "text" && typeof block.text === "string");
  return textBlock ? textBlock.text : null;
}

// Parses the soft check's response text into
// { isProductPage, isPortfolio, productName }. Expects a strict
// "YES: Name" / "NO" / "PORTFOLIO" first line, but falls back to a loose
// substring check (the old behavior) if Claude doesn't follow that format —
// in that fallback path there's no name to extract, just the verdict.
// Returns null if genuinely unparseable either way.
function parseSoftCheckResponse(text) {
  const trimmed = text.trim();
  const firstLine = trimmed.split("\n")[0].trim();
  const upperFirstLine = firstLine.toUpperCase();

  if (upperFirstLine.startsWith("YES")) {
    const colonIndex = firstLine.indexOf(":");
    const productName = colonIndex !== -1 ? firstLine.slice(colonIndex + 1).trim() : "";
    return { isProductPage: true, isPortfolio: false, productName: productName || null };
  }

  if (upperFirstLine.startsWith("PORTFOLIO")) {
    return { isProductPage: false, isPortfolio: true, productName: null };
  }

  if (upperFirstLine.startsWith("NO")) {
    return { isProductPage: false, isPortfolio: false, productName: null };
  }

  // Loose fallback: check PORTFOLIO before NO, since a stray sentence like
  // "this is not a product page, it's a portfolio site" would otherwise
  // match "NO" as a substring of "NOT" and miss the portfolio case.
  const upperWhole = trimmed.toUpperCase();
  if (upperWhole.includes("PORTFOLIO")) {
    return { isProductPage: false, isPortfolio: true, productName: null };
  }
  if (upperWhole.includes("YES")) {
    return { isProductPage: true, isPortfolio: false, productName: null };
  }
  if (upperWhole.includes("NO")) {
    return { isProductPage: false, isPortfolio: false, productName: null };
  }

  return null;
}

// Does this page's text describe a specific product or company, and if so,
// what's it actually called? Calls the Claude API — same key we'll use for
// the 4-field call later, so there's only one key for the user to manage.
// Defaults to { isProductPage: true, productName: null } on any failure so
// a flaky/missing key never blocks the user; errors are logged, not
// surfaced.
async function checkIsProductPage(pageText) {
  try {
    const { claudeApiKey } = await chrome.storage.local.get("claudeApiKey");
    if (!claudeApiKey) {
      console.warn("Teardown: no claudeApiKey set, skipping soft check.");
      return { isProductPage: true, isPortfolio: false, productName: null };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

    // This is the exact string going into the prompt below — logged in
    // full (not sliced for display) so we can see precisely what Claude
    // saw when a classification looks wrong.
    // Sliced to 800 (was 1500): title + meta description are already
    // prioritized first when pageText is built (grabPageContent), and
    // they're the reliable signal for this yes/no + name classification —
    // the raw innerText tail past that is mostly nav/boilerplate noise, so
    // paying to send an extra 700 characters of it bought nothing. Cost
    // optimization, not a quality change.
    const promptPageText = pageText.slice(0, 800);
    console.log("Final pageText being sent to Claude:", promptPageText);

    let response;
    try {
      console.log("Calling Claude API for soft check");
      response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": claudeApiKey,
          "anthropic-version": CLAUDE_API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: CLAUDE_SOFT_CHECK_MODEL,
          // 5 tokens was too tight for a bare word: if Claude led with any
          // preamble (seen in practice: echoing a page's own tagline like
          // "AI-powered answer engine"), the budget ran out before it ever
          // reached YES/NO. More headroom here since we're now also asking
          // for a name, plus a stricter instruction, so it reliably lands
          // on the required format even if it wants to hedge first.
          max_tokens: 20,
          messages: [
            {
              role: "user",
              content:
                "Does the following page content describe a specific product or " +
                "company (e.g. a product listing, a company homepage, a SaaS " +
                "product page)?\n\n" +
                "Respond on a single line in exactly this format, nothing else:\n" +
                "YES: <the actual product or company name>\n" +
                "or\n" +
                "NO\n" +
                "or\n" +
                "PORTFOLIO\n\n" +
                "Use the real product or company name as it appears on the page " +
                '(e.g. "Ninja Foodi Air Fryer" or "Notion"), not a generic ' +
                "description. If it's a product/company page but no clear name is " +
                "identifiable, respond \"YES:\" with nothing after the colon. " +
                "Respond PORTFOLIO instead of NO if the page is a personal " +
                "portfolio, resume, or personal site where someone is showcasing " +
                "their own work or skills, rather than a product or company. Do " +
                "not add any other text, punctuation, or explanation.\n\n" +
                promptPageText
            }
          ]
        }),
        signal: controller.signal
      });
      console.log("Claude API fetch resolved, status:", response.status);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Claude API returned ${response.status}`);
    }

    const result = await response.json();
    console.log("Claude API raw result:", result);
    const text = extractTextFromClaudeContent(result && result.content);
    if (typeof text !== "string") {
      throw new Error("Unexpected Claude API response shape.");
    }
    console.log("Claude raw text response:", text);

    const parsed = parseSoftCheckResponse(text);
    if (!parsed) {
      throw new Error(`Could not parse YES/NO from Claude response: "${text}"`);
    }
    console.log("Parsed soft check result:", parsed);
    return parsed;
  } catch (err) {
    console.error("Teardown: soft check failed, defaulting to proceed.", err);
    return { isProductPage: true, isPortfolio: false, productName: null };
  }
}

const TEARDOWN_TIMEOUT_MS = 30000;

// Strips a ```json ... ``` or ``` ... ``` fence if Claude wraps its answer
// in one despite being told not to. Returns the input unchanged otherwise.
function stripCodeFence(text) {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}

// The core value of the extension: given a product/company page's content,
// produce the five-field teardown (who / job / value / gap / metric). Only
// meant to be called once checkIsProductPage has already said true.
// Returns { ok: true, who, job, value, gap, metric } on success, or
// { ok: false, error } on any failure — unlike the soft check, there's no
// sensible default to fall back to here, so failures are surfaced rather
// than silently proceeding.
async function generateTeardown(pageText, hostname, productName) {
  try {
    const { claudeApiKey } = await chrome.storage.local.get("claudeApiKey");
    if (!claudeApiKey) {
      console.warn("Teardown: no claudeApiKey set, cannot generate teardown.");
      return { ok: false, error: "No Claude API key set." };
    }

    // Each field's instructions mirror the exact title + micro-prompt shown
    // to the user in the overlay, so what Claude is asked to produce lines
    // up with what the user was just asked to answer themselves.
    const prompt =
      "You are analyzing a product or company page to produce a sharp, specific teardown.\n\n" +
      "Given the page content below, return ONLY a JSON object. No preamble, no " +
      "markdown code fences, no explanation before or after it. Use exactly these " +
      "five fields:\n\n" +
      '{"who": "...", "job": "...", "value": "...", "gap": "...", "metric": "..."}\n\n' +
      '- who (primary user): "Who is this built for?" Be specific: role, ' +
      "context, situation, not just a segment.\n" +
      '- job (core job-to-be-done): "What job is this product hired to do?" ' +
      "What progress is the user trying to make? A single clear sentence, not " +
      "a list of features.\n" +
      '- value (differentiation): "Why does this beat the alternative?" Name ' +
      "the alternative and the real edge this has over it, grounded in " +
      "something specific from the page.\n" +
      '- gap: "What\'s the biggest weak point here?" Be specific, not just ' +
      '"pricing."\n' +
      '- metric: "What metric would this product move?" Think activation, ' +
      "retention, revenue, whatever actually fits.\n\n" +
      "Avoid vague, one-size-fits-all language in every field. Ground each answer " +
      "in specific details actually present in the page content, such as names, " +
      "numbers, claims, features, or wording, rather than generic industry " +
      "statements that could apply to any competitor.\n\n" +
      "Keep every answer to one sentence, no more than 30 words.\n\n" +
      "Never use em dashes in any of the five answers. Use periods, commas, or " +
      "separate sentences instead.\n\n" +
      "Every answer must use proper punctuation and capitalization: start with a " +
      "capital letter, capitalize proper nouns and the product's own name " +
      "correctly, and end with a period (or a question mark if it's phrased as a " +
      "question).\n\n" +
      (productName ? `Product name: ${productName}\n\n` : "") +
      `Hostname: ${hostname}\n\n` +
      "Page content:\n" +
      pageText;

    console.log("Final pageText being sent to Claude for teardown:", pageText);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEARDOWN_TIMEOUT_MS);

    let response;
    try {
      console.log("Calling Claude API for teardown generation");
      response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": claudeApiKey,
          "anthropic-version": CLAUDE_API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: CLAUDE_TEARDOWN_MODEL,
          // max_tokens is a combined cap across thinking + visible output.
          // effort:"low" still permits some thinking, so this needs enough
          // headroom to cover that plus the actual 5-field JSON, or a
          // truncated mid-thought response fails to parse below. Bumped
          // from 800 (sized for the old no-thinking-by-default reality).
          max_tokens: 1500,
          // Sonnet 5 runs adaptive thinking by default when this is left
          // unset — real, billed reasoning tokens never shown anywhere in
          // the UI. This is a well-specified, non-agentic 5-sentence
          // extraction task, not deep multi-step reasoning, so low effort
          // is the expected sweet spot here (cost optimization).
          output_config: { effort: "low" },
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });
      console.log("Claude API fetch resolved, status:", response.status);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Claude API returned ${response.status}`);
    }

    const result = await response.json();
    console.log("Claude API raw result:", result);
    const text = extractTextFromClaudeContent(result && result.content);
    if (typeof text !== "string") {
      throw new Error("Unexpected Claude API response shape.");
    }
    console.log("Claude raw text response:", text);

    let parsed;
    try {
      parsed = JSON.parse(stripCodeFence(text));
    } catch (parseErr) {
      console.error("Teardown: could not parse JSON from Claude response. Raw response:", text);
      return { ok: false, error: "Claude did not return valid JSON." };
    }

    const { who, job, value, gap, metric } = parsed || {};
    if (![who, job, value, gap, metric].every((field) => typeof field === "string" && field.trim())) {
      console.error("Teardown: parsed JSON is missing one or more fields. Raw response:", text);
      return { ok: false, error: "Claude's response was missing one or more fields." };
    }

    console.log("Parsed teardown:", { who, job, value, gap, metric });
    return { ok: true, who, job, value, gap, metric };
  } catch (err) {
    console.error("Teardown: generateTeardown failed.", err);
    return { ok: false, error: err.message || String(err) };
  }
}

const SCORE_TIMEOUT_MS = 20000;

// Fixed score -> label mapping. Derived here rather than trusted from
// Claude's own wording (even though the prompt below also asks it to
// state one, for context) so the tier shown next to the ring can never
// mismatch the numeric score — a deterministic lookup can't drift the way
// free-form model output occasionally could.
const SCORE_TIERS = { 1: "Vague", 2: "Broad", 3: "Developing", 4: "Solid", 5: "Sharp" };

// The one summary-level score for the whole session: how specific and
// grounded the user's own five answers were, not how closely they matched
// Claude's reference answers. Only meant to be called once all five
// fields have been answered. Returns { ok: true, score, tier, note } on
// success, or { ok: false, error } on failure — same "surface it, don't
// silently proceed" approach as generateTeardown, since there's no
// sensible default score to fall back to.
async function generateScore(answers, hostname, productName) {
  try {
    const { claudeApiKey } = await chrome.storage.local.get("claudeApiKey");
    if (!claudeApiKey) {
      console.warn("Teardown: no claudeApiKey set, cannot generate score.");
      return { ok: false, error: "No Claude API key set." };
    }

    const answersBlock = answers
      .map((answer, index) => {
        const userAnswer = answer.userAnswer && answer.userAnswer.trim() ? answer.userAnswer : "(no answer given)";
        return `${index + 1}. ${answer.question}\nUser's answer: ${userAnswer}\nReference answer: ${answer.aiAnswer}`;
      })
      .join("\n\n");

    const prompt =
      "You are scoring how specific and grounded a user's OWN answers were during a " +
      "product teardown exercise, not how closely they match the reference answers " +
      "below. A user's answer can be excellent even if worded very differently from " +
      "the reference.\n\n" +
      "Judge whether the user named a real, specific role or context instead of " +
      '"everyone," a real specific alternative instead of vague fluff, a concrete ' +
      "gap instead of a generic complaint, and so on, across all five answers as a " +
      "whole.\n\n" +
      "Here are the five question and answer pairs from this session:\n\n" +
      answersBlock +
      "\n\n" +
      "Return ONLY a JSON object. No preamble, no markdown code fences, no " +
      "explanation before or after it. Use exactly these two fields:\n\n" +
      '{"score": <integer from 1 to 5>, "note": "..."}\n\n' +
      "- score: an integer from 1 to 5 judging the specificity and groundedness of " +
      "the user's five answers overall.\n" +
      "- note: one sentence, no more than 25 words, explaining the score in plain " +
      "language, referencing what actually happened in this session (which " +
      "answers were specific, which could have gone further), not a generic " +
      "statement that could apply to any session.\n\n" +
      "Never use em dashes. Use periods, commas, or separate sentences instead. Use " +
      "proper punctuation and capitalization, and end with a period.\n\n" +
      (productName ? `Product name: ${productName}\n` : "") +
      `Hostname: ${hostname}\n`;

    console.log("Final prompt being sent to Claude for scoring:", prompt);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCORE_TIMEOUT_MS);

    let response;
    try {
      console.log("Calling Claude API for session score");
      response = await fetch(CLAUDE_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": claudeApiKey,
          "anthropic-version": CLAUDE_API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: CLAUDE_TEARDOWN_MODEL,
          // Same combined thinking+output cap issue as generateTeardown:
          // 200 was sized for the old no-thinking-by-default reality and
          // left no room for effort:"low"'s residual thinking, so the
          // score's tiny JSON was getting cut off mid-response.
          max_tokens: 1024,
          // Same reasoning as generateTeardown: a simple 1-5 rubric
          // judgment doesn't need Sonnet 5's default adaptive thinking,
          // which otherwise bills invisible reasoning tokens.
          output_config: { effort: "low" },
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });
      console.log("Claude API fetch resolved, status:", response.status);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Claude API returned ${response.status}`);
    }

    const result = await response.json();
    console.log("Claude API raw result:", result);
    const text = extractTextFromClaudeContent(result && result.content);
    if (typeof text !== "string") {
      throw new Error("Unexpected Claude API response shape.");
    }
    console.log("Claude raw text response:", text);

    let parsed;
    try {
      parsed = JSON.parse(stripCodeFence(text));
    } catch (parseErr) {
      console.error("Teardown: could not parse JSON from Claude score response. Raw response:", text);
      return { ok: false, error: "Claude did not return valid JSON." };
    }

    const score = Number.isInteger(parsed && parsed.score) ? parsed.score : null;
    if (!score || score < 1 || score > 5) {
      console.error("Teardown: invalid score in Claude response. Raw response:", text);
      return { ok: false, error: "Claude returned an invalid score." };
    }

    const note = parsed && typeof parsed.note === "string" ? parsed.note.trim() : "";
    if (!note) {
      console.error("Teardown: missing note in Claude score response. Raw response:", text);
      return { ok: false, error: "Claude's response was missing a note." };
    }

    const tier = SCORE_TIERS[score];

    console.log("Parsed score:", { score, tier, note });
    return { ok: true, score, tier, note };
  } catch (err) {
    console.error("Teardown: generateScore failed.", err);
    return { ok: false, error: err.message || String(err) };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Teardown extension installed.");
});

const OVERLAY_HOST_ID = "teardown-overlay-host";

// No default_popup, so this fires on every icon click as expected. Mounts
// the overlay directly into the page's DOM instead of opening a native
// popup, since only that lets us anchor the UI near the bottom third of
// the viewport rather than being stuck under the toolbar icon.
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Extension icon clicked, tab:", tab && tab.id);

  if (!tab || !tab.id) {
    console.error("Teardown: icon clicked but no valid tab to inject into.");
    return;
  }

  try {
    // Guard against a duplicate overlay if the icon is clicked again while
    // one is already open — bring the existing one into view instead of
    // injecting a second copy.
    const [{ result: alreadyOpen } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (hostId) => {
        const existing = document.getElementById(hostId);
        if (existing) {
          existing.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }
        return false;
      },
      args: [OVERLAY_HOST_ID]
    });

    if (alreadyOpen) {
      console.log("Teardown: overlay already open on this tab, focused it instead of re-injecting.");
      return;
    }

    // overlay.js builds its own Shadow DOM and injects its CSS inline into
    // that shadow root (see overlay.js for why) — no separate insertCSS
    // call needed, a shadow root couldn't be reached by insertCSS's
    // page-<head> injection anyway.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["overlay.js"]
    });

    console.log("Teardown: overlay injected into tab", tab.id);
  } catch (err) {
    // Restricted pages (chrome://, the Web Store, etc.) will land here —
    // there's nothing to inject into, so just log it rather than throw.
    console.error("Teardown: could not inject overlay into this tab.", err);
  }
});

// Root-domain heuristic for the homepage fallback (e.g. "www.medium.com" or
// "someuser.substack.com" -> the registrable domain, dropping subdomains).
// This is a v1 shortcut, not a real public-suffix-list lookup — it only
// special-cases the common two-part TLDs likely to show up (co.uk, com.au,
// etc.), so an unusual TLD could still come out wrong.
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk",
  "co.jp", "co.kr", "co.nz", "co.za", "co.in",
  "com.au", "com.br", "com.mx", "com.sg"
]);

function getRootDomain(hostname) {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return hostname;
  }
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

// Builds the same "Title / Meta description / Page text" format used by
// grabPageContent, for content we fetched as raw HTML instead of reading
// from a live tab (the homepage fallback below).
function formatPageText(title, metaDescription, rawTextExcerpt) {
  return [
    `Title: ${title}`,
    `Meta description: ${metaDescription}`,
    "Page text:",
    rawTextExcerpt
  ].join("\n\n");
}

// Lightweight entity decoding — not exhaustive, just the handful that show
// up constantly in real page HTML. There's no DOMParser available in a
// service worker, so we can't lean on the browser to do this for us.
function decodeHtmlEntities(str) {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
}

function extractTitleFromHtml(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : "";
}

function extractMetaDescriptionFromHtml(html) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    if (/name\s*=\s*["']description["']/i.test(tag)) {
      const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
      if (contentMatch) {
        return decodeHtmlEntities(contentMatch[1].trim());
      }
    }
  }
  return "";
}

// Approximates document.body.innerText from raw HTML by stripping
// script/style blocks and tags. It won't match real innerText for
// JS-rendered pages, but for a fallback homepage fetch it's a reasonable
// stand-in — we mainly need title + meta description anyway.
function extractApproxTextFromHtml(html) {
  const withoutScriptsAndStyles = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScriptsAndStyles.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
}

const HOMEPAGE_FETCH_TIMEOUT_MS = 10000;

// Fetches a domain's homepage and extracts the same three signals
// grabPageContent reads from a live tab, for the "want to teardown
// [domain] instead?" fallback.
async function fetchHomepageContent(domain) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HOMEPAGE_FETCH_TIMEOUT_MS);

  let response;
  try {
    console.log("Fetching homepage fallback for domain:", domain);
    response = await fetch(`https://${domain}`, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Homepage fetch returned ${response.status}`);
  }

  const html = await response.text();
  const title = extractTitleFromHtml(html);
  const metaDescription = extractMetaDescriptionFromHtml(html);
  const rawTextExcerpt = extractApproxTextFromHtml(html).slice(0, 1500);

  return formatPageText(title, metaDescription, rawTextExcerpt);
}

// Runs inside the target page. Keep this self-contained — it's serialized
// and injected, it can't reference anything from background.js's scope.
//
// Raw document.body.innerText often leads with nav links, cookie notices,
// or ad disclaimers rather than the actual product/company content (seen
// on Amazon listings, among others). document.title and the meta
// description tag are reliable and concise regardless of page layout, so
// they go first — the noisier raw text stays in, just demoted to a
// secondary signal after them.
function grabPageContent() {
  const title = document.title || "";

  const descriptionTag = document.querySelector('meta[name="description"]');
  const metaDescription = (descriptionTag && descriptionTag.content) || "";

  const bodyText = document.body ? document.body.innerText || "" : "";
  const rawTextExcerpt = bodyText.slice(0, 1500);

  const pageText = [
    `Title: ${title}`,
    `Meta description: ${metaDescription}`,
    "Page text:",
    rawTextExcerpt
  ].join("\n\n");

  return {
    pageText,
    pageTitle: title,
    hostname: window.location.hostname
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background.js", message);

  if (!message) {
    return false; // not for us
  }

  if (message.type === "GRAB_PAGE_CONTENT") {
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
        console.log("Starting product page check");
        const { isProductPage, isPortfolio, productName } = await checkIsProductPage(data.pageText);

        sendResponse({
          ok: true,
          isProductPage,
          isPortfolio,
          productName,
          pageText: data.pageText,
          pageTitle: data.pageTitle,
          hostname: data.hostname,
          rootDomain: getRootDomain(data.hostname)
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();

    return true; // keep the message channel open for the async sendResponse
  }

  if (message.type === "CHECK_HOMEPAGE_FALLBACK") {
    (async () => {
      try {
        console.log("CHECK_HOMEPAGE_FALLBACK received, message.domain:", message.domain);
        let domain = message.domain;

        // The domain overlay.js sends is state it cached from an earlier
        // GRAB_PAGE_CONTENT response — if the overlay was rebuilt, raced,
        // or that state got lost some other way, don't just fail. Re-derive
        // it fresh from the active tab's current URL, the same source
        // GRAB_PAGE_CONTENT used to compute it in the first place.
        if (!domain) {
          console.warn("Teardown: no domain in CHECK_HOMEPAGE_FALLBACK message, re-deriving from the active tab.");
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab && activeTab.url) {
            try {
              domain = getRootDomain(new URL(activeTab.url).hostname);
              console.log("Re-derived domain from active tab:", domain);
            } catch (urlErr) {
              console.error("Teardown: could not parse active tab URL for fallback domain.", urlErr);
            }
          }
        }

        if (!domain) {
          sendResponse({ ok: false, error: "No domain provided for homepage fallback." });
          return;
        }

        const pageText = await fetchHomepageContent(domain);

        console.log("Starting product page check (homepage fallback)");
        const { isProductPage, isPortfolio, productName } = await checkIsProductPage(pageText);

        sendResponse({
          ok: true,
          isProductPage,
          isPortfolio,
          productName,
          pageText,
          hostname: domain
        });
      } catch (err) {
        console.error("Teardown: homepage fallback fetch failed.", err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();

    return true; // keep the message channel open for the async sendResponse
  }

  if (message.type === "GENERATE_TEARDOWN") {
    (async () => {
      try {
        const { pageText, hostname, productName } = message;
        if (!pageText || !hostname) {
          sendResponse({ ok: false, error: "Missing pageText or hostname for teardown generation." });
          return;
        }

        console.log("Starting teardown generation for:", hostname);
        const teardown = await generateTeardown(pageText, hostname, productName);
        sendResponse(teardown);
      } catch (err) {
        console.error("Teardown: GENERATE_TEARDOWN handler failed.", err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();

    return true; // keep the message channel open for the async sendResponse
  }

  if (message.type === "GENERATE_SCORE") {
    (async () => {
      try {
        const { answers, hostname, productName } = message;
        if (!Array.isArray(answers) || answers.length === 0 || !hostname) {
          sendResponse({ ok: false, error: "Missing answers or hostname for scoring." });
          return;
        }

        console.log("Starting score generation for:", hostname);
        const scoreResult = await generateScore(answers, hostname, productName);
        sendResponse(scoreResult);
      } catch (err) {
        console.error("Teardown: GENERATE_SCORE handler failed.", err);
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();

    return true; // keep the message channel open for the async sendResponse
  }

  return false; // not a message type we handle
});
