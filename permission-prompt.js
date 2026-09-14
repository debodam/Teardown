// permission-prompt.js — runs inside permission-prompt.html, a genuine
// chrome-extension:// page overlay.js embeds as an iframe, same as
// key-entry.html. This is the ONE call in the whole extension that
// genuinely has to happen here rather than anywhere else:
// chrome.permissions.request() only works "during a user gesture," and
// that gesture context does not survive either of the two other places
// it was tried — content scripts don't expose chrome.permissions at all
// (calling it from overlay.js throws "Cannot read properties of
// undefined"), and calling it from background.js in response to a
// content script's button click throws "This function must be called
// during a user gesture" even though it's still handling that same
// click, one message-passing hop later. A real click on a button inside
// a genuine extension-page document — this iframe — is the only context
// left where the browser actually credits it as a user gesture.
(function () {
  const params = new URLSearchParams(window.location.search);
  const domain = params.get("domain") || "";

  const promptText = document.getElementById("prompt-text");
  const allowBtn = document.getElementById("allow-btn");
  const statusEl = document.getElementById("prompt-status");

  // Built with plain DOM calls rather than promptText.innerHTML — domain
  // comes from the page's own hostname, effectively untrusted input, and
  // this keeps the "never innerHTML with dynamic content" rule the rest
  // of the extension follows rather than making an exception for it. The
  // one static accent span (the "one-time access" phrase) is written
  // straight into permission-prompt.html since it never changes; only
  // the trailing domain-specific text is swapped in here.
  if (domain) {
    promptText.appendChild(document.createTextNode(` to read ${domain}'s homepage.`));
    allowBtn.textContent = `Allow access to ${domain}`;
  } else {
    promptText.appendChild(document.createTextNode(" to read this site's homepage."));
  }

  function postToParent(message) {
    window.parent.postMessage(Object.assign({ source: "teardown-permission-prompt" }, message), "*");
  }

  function reportHeight() {
    // document.body, not document.documentElement — the root <html>
    // element's scrollHeight is defined to never report less than the
    // iframe's OWN current viewport height, only equal or more (it can
    // grow to fit overflowing content, but can never shrink back down
    // below whatever height the iframe already is). Since the iframe
    // starts at a CSS default of 190px, measuring documentElement means
    // every report is silently floored at "at least 190px" forever, no
    // matter how much smaller the real content is — confirmed directly,
    // this was the actual cause of the iframe staying too tall no matter
    // how many times a resize fired. body (with no explicit height of
    // its own) reflects the real content height instead.
    postToParent({ type: "PERMISSION_PROMPT_RESIZE", height: document.body.scrollHeight });
  }

  allowBtn.addEventListener("click", () => {
    if (!domain) {
      statusEl.textContent = "No domain to request access for.";
      reportHeight();
      return;
    }

    allowBtn.disabled = true;
    // *.domain (not just domain itself) since a bare root domain very
    // often redirects to a www./regional subdomain (linkedin.com ->
    // www.linkedin.com, seen directly in practice) — a permission grant
    // scoped to only the bare domain doesn't cover that redirect target,
    // and Chrome's *.example.com match pattern already covers both the
    // subdomain case and the bare domain itself.
    chrome.permissions.request({ origins: [`https://*.${domain}/*`] }, (granted) => {
      if (chrome.runtime.lastError) {
        allowBtn.disabled = false;
        statusEl.textContent = "Something went wrong requesting access.";
        reportHeight();
        return;
      }

      if (granted) {
        postToParent({ type: "PERMISSION_GRANTED" });
        return;
      }

      allowBtn.disabled = false;
      statusEl.textContent = "Permission declined.";
      reportHeight();
      postToParent({ type: "PERMISSION_DECLINED" });
    });
  });

  reportHeight();
  window.addEventListener("resize", reportHeight);
  // A single reportHeight() at load can measure before fonts/layout have
  // fully settled, leaving the parent iframe taller than the content
  // actually needs (visible as dead space below the button, pushing it
  // up toward the top of a box that's bigger than it needs to be).
  // ResizeObserver catches every subsequent real layout change — web
  // fonts finishing, the status line's text appearing — and keeps the
  // parent in sync automatically instead of relying on load timing.
  new ResizeObserver(reportHeight).observe(document.body);
})();
