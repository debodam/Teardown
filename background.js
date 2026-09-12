// background.js — service worker.
// Owns: injecting the page-read script on demand (triggered by popup.js,
// since a default_popup means chrome.action.onClicked never fires),
// the soft check via Claude (below), the homepage fallback fetch (below),
// and the Claude 4-field call (later).

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_VERSION = "2023-06-01";
// Small/fast model — this is a one-word yes/no classification, not the
// deep 4-field analysis, so we don't need a heavyweight model here.
const CLAUDE_SOFT_CHECK_MODEL = "claude-haiku-4-5-20251001";
const CLAUDE_TIMEOUT_MS = 10000;

// Does this page's text describe a specific product or company?
// Calls the Claude API — same key we'll use for the 4-field call later,
// so there's only one key for the user to manage.
// Defaults to true (proceed) on any failure so a flaky/missing key never
// blocks the user; errors are logged, not surfaced.
async function checkIsProductPage(pageText) {
  try {
    const { claudeApiKey } = await chrome.storage.local.get("claudeApiKey");
    if (!claudeApiKey) {
      console.warn("Teardown: no claudeApiKey set, skipping soft check.");
      return true;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

    // This is the exact string going into the prompt below — logged in
    // full (not sliced for display) so we can see precisely what Claude
    // saw when a classification looks wrong.
    const promptPageText = pageText.slice(0, 1500);
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
          max_tokens: 5,
          messages: [
            {
              role: "user",
              content:
                "Does the following page content describe a specific product or " +
                "company (e.g. a product listing, a company homepage, a SaaS " +
                "product page)? Answer with only the single word YES or NO.\n\n" +
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
    const text = result && result.content && result.content[0] && result.content[0].text;
    if (typeof text !== "string") {
      throw new Error("Unexpected Claude API response shape.");
    }
    console.log("Claude raw text response:", text);

    const normalized = text.trim().toUpperCase();
    let parsedResult;
    if (normalized.includes("YES")) {
      parsedResult = true;
    } else if (normalized.includes("NO")) {
      parsedResult = false;
    } else {
      throw new Error(`Could not parse YES/NO from Claude response: "${text}"`);
    }
    console.log("Parsed result (true/false):", parsedResult);
    return parsedResult;
  } catch (err) {
    console.error("Teardown: soft check failed, defaulting to proceed.", err);
    return true;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Teardown extension installed.");
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
        const isProductPage = await checkIsProductPage(data.pageText);

        sendResponse({
          ok: true,
          isProductPage,
          pageText: data.pageText,
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

        // The domain popup.js sends is state it cached from an earlier
        // GRAB_PAGE_CONTENT response — if the popup was reopened, raced,
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
        const isProductPage = await checkIsProductPage(pageText);

        sendResponse({
          ok: true,
          isProductPage,
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

  return false; // not a message type we handle
});
