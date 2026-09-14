# Security and privacy

## Your API key

Teardown is bring-your-own-key (BYOK). There is no backend server for this extension, nothing you enter is ever collected, stored, or visible to the developer.

### Real cross-origin isolation

The API key input lives in `key-entry.html`, a genuine `chrome-extension://` page loaded in an iframe, not part of the overlay injected into the webpage you're on. This is a real browser-enforced origin boundary, not a convention: the host webpage's own scripts cannot read, query, or reach into that iframe, even if the page itself is malicious. Only `key-entry.js`, running inside that isolated page, ever reads or writes the key.

The extension's content script (the overlay you see on the page) never touches `chrome.storage.local` for the key at all, confirmed by code audit: it only ever checks a boolean (`hasKey: true/false`) via a message to the background service worker, never the key value itself.

### Storage lockdown

`chrome.storage.local` is locked to trusted extension contexts only, via `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`, run at every startup. This is enforced by Chrome itself: even if something in the content script tried to read the key directly, the platform denies it. The key is never stored in `chrome.storage.sync` (which would sync across devices), `localStorage`, `sessionStorage`, cookies, or IndexedDB.

### Network requests

- The key is transmitted only in the `x-api-key` header of a direct request to `https://api.anthropic.com/v1/messages`, hardcoded, never built from variable input.
- Never in a URL, query string, or request body.
- Every request uses `credentials: "omit"` and `referrerPolicy: "no-referrer"`, no ambient cookies, no referrer leak.
- This was independently verified with a live network trace: a canary test key was saved through the real flow, a teardown was run, and DevTools' Network tab (on the service worker specifically, where the actual fetch happens) confirmed the key appeared only in that one header, on that one request, nowhere else.

### Permissions

Teardown requests minimal permissions by default: `activeTab`, `scripting`, `storage`, and host access scoped only to `api.anthropic.com`, nothing broader.

The homepage-fallback feature (offering to check a site's homepage when the current page isn't a clear product/company page) needs to read one additional domain's content. Rather than requesting broad access upfront, it uses `chrome.permissions.request()` to ask for access to that one specific domain, at the moment it's needed, through a real, visible permission prompt you approve or deny. No standing or persistent broad access is ever requested or held.

### Message validation

Every message passed between the page-level overlay and the background service worker is checked against an explicit allowlist of message types, with length and type validation on payloads (page text, answers, etc). There is no generic "fetch this URL" message type that a page could exploit to make the extension request something arbitrary.

Messages coming back from the key-entry and permission-prompt iframes are validated on three fronts before being trusted: the message's origin, the source window it came from, and a marker field unique to that flow. This logic is covered by automated tests (`test/origin-validation.test.js`), including deliberate spoofing attempts (wrong origin, wrong source, missing or wrong marker), all of which are confirmed to be rejected.

### What this doesn't protect against

No extension can protect a key from a genuinely compromised device, or from a user pasting their key somewhere unsafe outside the extension. That's true of every BYOK tool, not something specific to Teardown.

## What data this extension reads

When you click the extension on a page, it reads that page's visible text, title, and meta description to determine if it's a product or company page and to generate the teardown questions. This content is sent directly to Anthropic's API (using your key) for analysis and is not stored anywhere beyond that single request.

No browsing history, no analytics, no tracking, no data collection of any kind.

## Responsibility

You are responsible for keeping your own API key secure, same as with any BYOK tool. This extension is provided as-is, with no warranty. The developer is not liable for any loss, misuse, unauthorized access to, or charges resulting from your API key.

## Reporting a concern

If you find a security issue, open an issue on this repo or reach out directly.
