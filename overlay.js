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
// The CSS lives inline here (a template string appended to the shadow
// root) rather than as a separate file, since insertCSS injects into the
// page's own <head>, which can't reach into a shadow tree at all.

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
    <style>
      * {
        box-sizing: border-box;
      }

      :host {
        --accent-gradient: linear-gradient(135deg, #8B5CF6 0%, #6366F1 52%, #22D3EE 100%);
      }

      /* The card itself never scrolls — it's a fixed frame so the close
         button (top-right) and gear/home button (bottom-left) can be
         pinned via position:absolute / normal flow against ITS box and
         stay put regardless of how much the content inside scrolls. Only
         .teardown-scroll (below), a separate inner element, actually
         scrolls. */
      .teardown-card {
        pointer-events: auto;
        position: relative;
        display: flex;
        flex-direction: column;
        width: 560px;
        max-width: 92vw;
        max-height: 70vh;
        overflow: hidden; /* clip content to the rounded corners */
        color: #F5F7FB;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.5;

        /* Flat and solid, not translucent+blurred, and deliberately the
           SAME exact value as .teardown-key-frame / key-entry.css's own
           html,body background below. Glassmorphism (a translucent card
           blurring whatever page is behind it) looks great on its own,
           but it made the card's own rendered color shift depending on
           the page underneath it — and the key-entry/permission-prompt
           iframes elsewhere in this card can only ever render a flat
           solid fill (backdrop-filter doesn't correctly composite through
           a nested iframe's browsing context — confirmed directly, no
           value of transparency fixed it), so a translucent card could
           never reliably match them. Making the card solid too is what
           actually guarantees they always match, on every page, instead
           of matching by coincidence on whichever page a color happened
           to be eyeballed against. */
        background: #23252F;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 18px;
        box-shadow:
          0 24px 72px rgba(0, 0, 0, 0.52),
          inset 0 1px 0 rgba(255, 255, 255, 0.10);
      }

      /* The summary page has meaningfully more to read than any
         single-field step, so it gets a larger card. */
      .teardown-card.teardown-card--summary {
        width: 720px;
        max-width: 94vw;
        max-height: 85vh;
      }

      /* The one part of the card that actually scrolls, as a flex child
         so it fills whatever space the fixed-frame card gives it.
         min-height:0 is load-bearing — without it a flex child won't
         shrink below its content size, so overflow-y:auto would never
         actually kick in. */
      .teardown-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 24px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
      }

      .teardown-scroll::-webkit-scrollbar {
        width: 8px;
      }

      .teardown-scroll::-webkit-scrollbar-track {
        background: transparent;
      }

      .teardown-scroll::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.25);
        border-radius: 8px;
      }

      .teardown-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.4);
      }

      .teardown-title {
        font-size: 22px;
        font-weight: 700;
        line-height: 1.25;
        margin: 0 44px 14px 0;
        color: #F5F7FB;
      }

      .teardown-status {
        font-size: 13px;
        color: #A7ADBC;
        margin-bottom: 4px;
      }

      .teardown-status--error {
        color: #FB7185;
      }

      .teardown-microprompt {
        font-size: 12px;
        color: #A7ADBC;
        margin-bottom: 12px;
      }

      button,
      input {
        font-family: inherit;
      }

      /* Base button geometry, shared by primary/secondary. */
      .teardown-btn-block {
        display: block;
        width: 100%;
        margin-top: 12px;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }

      .teardown-btn-block[hidden] {
        display: none;
      }

      .primary-button {
        color: #ffffff;
        background: linear-gradient(135deg, #8B5CF6, #6366F1);
        border: 1px solid rgba(196, 181, 253, 0.52);
        box-shadow: 0 8px 24px rgba(99, 102, 241, 0.28), 0 0 0 1px rgba(167, 139, 250, 0.10);
      }

      .primary-button:hover {
        filter: brightness(1.08);
      }

      .secondary-button {
        color: #D5D9E3;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.14);
      }

      .secondary-button:hover {
        background: rgba(167, 139, 250, 0.11);
        border-color: rgba(167, 139, 250, 0.35);
      }

      /* The key entry/Save/Remove UI, and the homepage-fallback permission
         prompt, live inside their own extension pages loaded here as
         iframes — see the security notes at the top of key-entry.js for
         why (real cross-origin isolation for the one input that actually
         matters, not just Shadow DOM). Sized by postMessage from that
         document (KEY_ENTRY_RESIZE / PERMISSION_PROMPT_RESIZE) rather
         than a fixed height, since content varies by mode/state.
         Deliberately a SOLID color, not transparent: .teardown-card's own
         backdrop-filter blur doesn't correctly composite through a nested
         iframe's browsing context (a real cross-browser rendering
         limit, not a bug in the transparency CSS itself — the iframe's
         embedded document can be as transparent as it likes and still
         falls back to opaque white), so true see-through blending isn't
         reliable here. #23252F is a deliberately lighter approximation
         than .teardown-card's own flat rgba(20,22,30,0.78) — the card
         itself never actually renders that dark in practice since it's
         only 78% opaque over whatever page is behind it, so matching its
         raw CSS value looks visibly darker than the real thing (this is a
         color chosen to eyeball-match rendered screenshots, not a
         computed value — nudge it if a specific page makes the seam
         obvious again). Kept identical to key-entry.css's own html/body
         background so the iframe box and its embedded document agree
         regardless of which layer ends up visible. */
      .teardown-key-frame {
        display: block;
        width: 100%;
        border: none;
        background: #23252F;
        overflow: hidden;
        /* A reasonable guess for its resting height, so there's no visible
           collapse/snap before the first resize message arrives
           (effectively instant, but not zero time). */
        height: 190px;
      }

      .teardown-confirm-actions {
        display: flex;
        gap: 8px;
      }

      .teardown-confirm-actions[hidden] {
        display: none;
      }

      .teardown-confirm-actions .teardown-btn-block {
        flex: 1;
      }

      /* Icon buttons: close (top-right, always present) and gear/home
         (settings toggle — only one visible at a time). Gear/home are
         deliberately NOT position:absolute: floating one over the
         scrollable content meant it always sat on top of whatever text
         happened to be scrolled to the bottom at that moment. Living in
         normal flow, as the very last thing after #teardown-main's or
         #teardown-settings-view's own content, means it only ever appears
         after the real content ends. */
      .icon-button {
        width: 32px;
        height: 32px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9CA3AF;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
      }

      .icon-button:hover {
        color: #E9D5FF;
        background: rgba(167, 139, 250, 0.14);
        border-color: rgba(167, 139, 250, 0.36);
      }

      .icon-button[hidden] {
        display: none;
      }

      .teardown-close-btn {
        position: absolute;
        top: 12px;
        right: 12px;
      }

      .teardown-corner-btn {
        margin-top: 20px;
      }

      /* Progress indicator: "Question X of 5" + a five-segment row, shown
         only during the one-at-a-time question flow. */
      .teardown-progress {
        margin-bottom: 16px;
      }

      .teardown-progress-label {
        font-size: 12px;
        color: #A7ADBC;
        margin-bottom: 6px;
      }

      .teardown-progress-row {
        display: flex;
        gap: 6px;
      }

      .progress-track {
        flex: 1;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.09);
      }

      .progress-track.progress-fill {
        background: var(--accent-gradient);
      }

      /* Analyzing screen: orb loader + rotating status lines beneath it. */
      .teardown-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 28px 0;
      }

      .teardown-loading[hidden] {
        display: none;
      }

      /* Soft ambient glow behind the spinning disc, static — the actual
         "is something happening" signal is the conic-gradient disc inside
         it, continuously rotating like a spinning globe/wheel. */
      .analysis-orb {
        position: relative;
        width: 112px;
        height: 112px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(139, 92, 246, 0.18) 0%, rgba(34, 211, 238, 0.06) 50%, transparent 75%);
        filter: blur(6px);
      }

      .analysis-orb-spin {
        position: absolute;
        inset: 14px;
        border-radius: 50%;
        background: conic-gradient(from 0deg, #8B5CF6, #22D3EE, #8B5CF6);
        box-shadow: 0 0 30px rgba(139, 92, 246, 0.4);
        animation: teardown-orb-spin 1.6s linear infinite;
      }

      @keyframes teardown-orb-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .teardown-loading-text {
        font-size: 13px;
        color: #A7ADBC;
      }

      .teardown-input {
        width: 100%;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(41, 44, 56, 0.72);
        color: #F5F7FB;
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
        border-color: rgba(167, 139, 250, 0.5);
        box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
      }

      .teardown-input::placeholder {
        color: rgba(167, 173, 188, 0.6);
      }

      .teardown-answer-label {
        font-size: 11px;
        color: #A7ADBC;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        margin-bottom: 2px;
      }

      .teardown-answer-text {
        font-size: 13px;
        color: #F5F7FB;
      }

      /* Reveal cards (per-field) and summary cards share these — the
         user's own answer in blue-tinted glass, Claude's in violet/cyan. */
      .teardown-answer-card {
        padding: 10px 12px;
        border-radius: 12px;
        margin-bottom: 10px;
      }

      .user-card {
        background: rgba(59, 130, 246, 0.09);
        border: 1px solid rgba(96, 165, 250, 0.28);
      }

      .ai-card {
        background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(34, 211, 238, 0.06));
        border: 1px solid rgba(167, 139, 250, 0.36);
      }

      /* The one summary-level score: a progress ring (SVG stroke-dasharray/
         -dashoffset, the standard technique) filling proportionally to
         score/5, with the number centered inside. This is the only score
         anywhere in the flow — no per-question grading. */
      .teardown-score-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 4px;
        margin-bottom: 20px;
        padding-bottom: 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.10);
      }

      .teardown-score-section[hidden] {
        display: none;
      }

      .teardown-score-ring {
        margin-bottom: 6px;
      }

      .teardown-score-ring-track {
        fill: none;
        stroke: rgba(255, 255, 255, 0.09);
        stroke-width: 8;
      }

      .teardown-score-ring-fill {
        fill: none;
        stroke: url(#teardown-score-gradient);
        stroke-width: 8;
        stroke-linecap: round;
        transform: rotate(-90deg);
        transform-origin: 50% 50%;
        transition: stroke-dashoffset 0.6s ease;
      }

      .teardown-score-value {
        fill: #F5F7FB;
        font-size: 24px;
        font-weight: 700;
      }

      .teardown-score-tier {
        font-size: 16px;
        font-weight: 700;
        color: #F5F7FB;
      }

      .teardown-score-note {
        font-size: 12px;
        color: #A7ADBC;
        max-width: 380px;
      }

      .teardown-summary-checks {
        display: flex;
        gap: 6px;
        margin-bottom: 18px;
      }

      .teardown-summary-check {
        width: 22px;
        height: 22px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        color: #ffffff;
        background: var(--accent-gradient);
      }

      .teardown-summary-block {
        margin-bottom: 18px;
        padding-bottom: 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.10);
      }

      .teardown-summary-block:last-of-type {
        border-bottom: none;
      }

      .teardown-summary-question {
        font-size: 17px;
        font-weight: 700;
        line-height: 1.3;
        color: #F5F7FB;
        margin-bottom: 10px;
      }

      /* Applied whenever one full screen/state replaces another (initial
         prompt, confirmation, a question card, the analyzing state, the
         summary). Deliberately opacity-only — no slide/scale — and short
         enough to read as polish rather than a slideshow. Never applied
         while the user is typing or interacting within a card; see the
         fadeIn() call sites for exactly which transitions trigger it. */
      @keyframes teardown-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .teardown-fade-in {
        animation: teardown-fade-in 180ms ease-out;
      }

      /* Onboarding: a short first-run carousel gating the rest of the UI
         until a Claude API key is saved. Deliberately does NOT reuse the
         shared #teardown-title/#teardown-status header — both are hidden
         while this shows instead — after the last bug where that shared
         header leaked main-flow text into the Settings view; each slide
         carries its own heading. */
      .teardown-onboarding-heading {
        font-size: 22px;
        font-weight: 700;
        line-height: 1.25;
        margin: 0 44px 10px 0;
        color: #F5F7FB;
      }

      .teardown-onboarding-subheading {
        font-size: 14px;
        color: #D5D9E3;
        line-height: 1.5;
        /* Same 12px rhythm .teardown-microprompt already uses elsewhere —
           each line is its own div with zero default margin, so without
           this they stack with no gap at all and read as one dense block
           instead of separate beats. */
        margin-bottom: 12px;
      }

      /* Inline highlight for key words/phrases within onboarding copy —
         the cyan half of the accent gradient reads cleanly at small sizes
         against the dark glass background, where the full gradient would
         mostly just look flat over a few words. */
      .teardown-accent {
        color: #67E8F9;
      }

      .teardown-onboarding-heading-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 44px 10px 0;
      }

      .teardown-onboarding-heading-row .teardown-onboarding-heading {
        margin: 0;
      }

      /* Same muted-to-accent circular treatment as .icon-button (gear/home),
         just non-interactive — it's reassurance, not a control, so it
         doesn't need its own hover state. */
      .teardown-onboarding-icon {
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        color: #C4B5FD;
        background: rgba(167, 139, 250, 0.14);
        border: 1px solid rgba(167, 139, 250, 0.36);
      }

      .teardown-link {
        color: #C4B5FD;
        text-decoration: underline;
      }

      .teardown-link:hover {
        color: #E9D5FF;
      }

      .teardown-onboarding-nav {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        margin-top: 22px;
      }

      .teardown-onboarding-dots {
        display: flex;
        align-items: center;
        gap: 7px;
      }

      .teardown-onboarding-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        transition: background 0.15s ease, transform 0.15s ease;
      }

      .teardown-onboarding-dot--active {
        background: var(--accent-gradient);
        transform: scale(1.4);
      }
    </style>

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

  const card = shadow.getElementById("teardown-card");
  const teardownTitle = shadow.getElementById("teardown-title");
  const statusEl = shadow.getElementById("teardown-status");
  const confirmActions = shadow.getElementById("teardown-confirm-actions");
  const confirmYesBtn = shadow.getElementById("teardown-confirm-yes");
  const confirmNoBtn = shadow.getElementById("teardown-confirm-no");
  const permissionStep = shadow.getElementById("teardown-permission-step");
  const permissionFrame = shadow.getElementById("teardown-permission-frame");
  const startBtn = shadow.getElementById("teardown-start-btn");
  const closeBtn = shadow.getElementById("teardown-close-btn");

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
  const settingsKeyFrame = shadow.getElementById("teardown-settings-key-frame");

  const onboardingView = shadow.getElementById("teardown-onboarding");
  const onboardingSlideEls = [
    shadow.getElementById("teardown-onboarding-slide-0"),
    shadow.getElementById("teardown-onboarding-slide-1"),
    shadow.getElementById("teardown-onboarding-slide-2")
  ];
  const onboardingDotEls = Array.from(shadow.querySelectorAll(".teardown-onboarding-dot"));
  const onboardingPrevBtn = shadow.getElementById("teardown-onboarding-prev");
  const onboardingNextBtn = shadow.getElementById("teardown-onboarding-next");
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
      endOnboarding();
      return;
    }

    if (data.type === "KEY_REMOVED" && fromSettings) {
      // Fully reset the main flow's own state too (not just Settings) —
      // removing the key means whatever mid-teardown state was sitting
      // underneath Settings shouldn't still be there once a new key is
      // entered and the user lands back on the idle screen.
      resetToInitialState();
      showOnboarding();
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

  // Reloading the extension in chrome://extensions invalidates any content
  // script already injected into an open tab from before that reload —
  // chrome.runtime goes undefined in that stale instance, and calling
  // sendMessage on it throws a raw, confusing TypeError. Check for that
  // up front on every entry point that talks to the extension, and show
  // something the user can actually act on instead.
  function isExtensionContextValid() {
    return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  }

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
})();
