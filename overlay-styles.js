// overlay-styles.js — the CSS for the overlay's Shadow DOM, split out of
// overlay.js purely for file-size/readability reasons (pure reorg, no
// behavior change). Injected as a content script alongside overlay.js
// and teardown-flow.js (see background.js's executeScript files array,
// which lists this file first so the string below exists before
// overlay.js builds the Shadow DOM that consumes it).
//
// Attaches to window.__teardownOverlay rather than using a module
// export — content scripts injected via chrome.scripting.executeScript
// don't support import/export without a bundler, but files listed in one
// executeScript call DO share one global scope (Chrome's per-extension
// "isolated world" for that page), so a plain namespace object on that
// shared window is the working, dependency-free equivalent here. Each
// file that touches this namespace initializes it defensively
// (`|| {}`) so file load order never causes a "property of undefined"
// crash even if that changes later.
window.__teardownOverlay = window.__teardownOverlay || {};

window.__teardownOverlay.styles = `
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
`;
