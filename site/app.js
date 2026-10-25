/* Copy4Chat landing page.
 *
 * The comparison is live, not canned. The Copy4Chat column runs the
 * extension's own mask.js / extract.js / render-boxed.js — the same files the
 * published extension ships, copied in by tools/build-site.sh. The Regular
 * Copy column runs Turndown over the same selection's HTML, which is what a
 * chat client actually receives from an ordinary copy and paste.
 *
 * Neither side is hand-written, so neither can flatter the other.
 */
(function () {
  "use strict";

  var STORE_URL =
    "https://chromewebstore.google.com/detail/copy4chat/jfcmdbgodjiacadofiacehfmnnonfjec";
  var VERSION = "__VERSION__"; // replaced by tools/build-site.sh

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Guarded so the page behaves identically with the tag blocked.
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  // ------------------------------------------------------------- chrome UI

  // UTM tags ride on the outbound link so the Web Store can attribute installs
  // to this page and to which button.
  document.querySelectorAll("[data-store-link]").forEach(function (a) {
    var params = new URLSearchParams({
      utm_source: "copy4chat.com",
      utm_medium: "referral",
      utm_campaign: "landing",
      utm_content: a.dataset.storeLink || "unknown",
    });
    a.href = STORE_URL + "?" + params.toString();
    a.rel = "noopener";
    a.addEventListener("click", function () {
      track("store_click", { placement: a.dataset.storeLink });
    });
  });

  if (VERSION.indexOf("__") !== 0) {
    document.querySelectorAll("[data-version]").forEach(function (el) {
      el.textContent = "v" + VERSION;
    });
    var long = document.querySelector("[data-version-long]");
    if (long) long.textContent = "Copy4Chat v" + VERSION;
  }

  // ------------------------------------------------------------------ theme

  var MODES = ["auto", "light", "dark"];
  var LABELS = { auto: "System", light: "Light", dark: "Dark" };
  var GLYPHS = { auto: "◑", light: "☀", dark: "☾" };
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem("c4c-theme"); } catch (e) {}
  var theme = MODES.indexOf(stored) >= 0 ? stored : "light";

  function applyTheme() {
    root.setAttribute("data-theme", theme);
    var glyph = document.querySelector("[data-theme-glyph]");
    var label = document.querySelector("[data-theme-label]");
    if (glyph) glyph.textContent = GLYPHS[theme];
    if (label) label.textContent = LABELS[theme];
    var btn = document.querySelector("[data-theme-toggle]");
    if (btn) btn.setAttribute("aria-label", "Colour theme: " + LABELS[theme] + ". Click to change.");
  }
  applyTheme();

  var toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    toggle.addEventListener("click", function () {
      theme = MODES[(MODES.indexOf(theme) + 1) % MODES.length];
      try { localStorage.setItem("c4c-theme", theme); } catch (e) {}
      applyTheme();
      track("theme_change", { mode: theme });
    });
  }

  var tryBtn = document.querySelector("[data-try]");
  if (tryBtn) {
    tryBtn.addEventListener("click", function () { track("try_click", {}); });
  }

  // -------------------------------------------------------- sticky section nav

  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  var sections = links
    .map(function (a) { return document.querySelector(a.getAttribute("href")); })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    var visible = new Map();
    var navObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) { visible.set(e.target.id, e.intersectionRatio); });
        var best = null;
        var bestRatio = 0;
        visible.forEach(function (ratio, id) {
          if (ratio > bestRatio) { bestRatio = ratio; best = id; }
        });
        links.forEach(function (a) {
          if (best && a.getAttribute("href") === "#" + best) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-120px 0px -45% 0px", threshold: [0, 0.2, 0.5, 1] }
    );
    sections.forEach(function (s) { navObserver.observe(s); });
  }

  // ------------------------------------------------------------ widget tabs

  // The widgets are genuinely interactive: tabs must actually switch, because
  // the extractor reads the live aria-selected state.
  document.querySelectorAll('.widget [role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    list.addEventListener("click", function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (!tab) return;
      tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      var demo = list.closest("[data-demo]");
      if (demo) refresh(demo);
    });
    list.addEventListener("keydown", function (e) {
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
      if (next < 0 || next >= tabs.length) return;
      e.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    });
  });

  // ------------------------------------------------------------- converters

  var turndown = null;
  if (window.TurndownService) {
    turndown = new window.TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });
    if (window.turndownPluginGfm) turndown.use(window.turndownPluginGfm.gfm);
  }

  // If the visitor has highlighted something inside this widget, copy exactly
  // that — the same ragged, partial range the extension sees on a real page.
  function rangeOf(widget) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      var r = sel.getRangeAt(0);
      if (widget.contains(r.commonAncestorContainer) && r.toString().trim()) return r;
    }
    var full = document.createRange();
    full.selectNodeContents(widget);
    return full;
  }

  // Note this serialises the DOM, so a value the visitor typed is absent —
  // the attribute is what gets copied, not the live property. That is real
  // browser behaviour, not a thumb on the scale.
  function regularOutput(widget) {
    if (!turndown) return "(converter unavailable)";
    var holder = document.createElement("div");
    holder.appendChild(rangeOf(widget).cloneContents());
    return turndown.turndown(holder.innerHTML).trim() || "(nothing)";
  }

  function c4cOutput(widget) {
    try {
      var doc = window.C4C.extract(rangeOf(widget));
      if (!doc) return "(nothing to copy)";
      return window.C4C.render.boxed(doc);
    } catch (err) {
      return "Extraction failed: " + (err && err.message);
    }
  }

  var NOTES = {
    regular: "What a chat assistant receives from an ordinary copy and paste.",
    c4c: "Generated just now by Copy4Chat itself, running on this page.",
  };

  // --------------------------------------------------------------- learning

  // Once a visitor has produced output once they have understood the gesture;
  // nudging them for the rest of the visit is just noise.
  var LEARNED_KEY = "c4c-learned";
  var learned = false;
  try { learned = sessionStorage.getItem(LEARNED_KEY) === "1"; } catch (e) {}

  function markLearned() {
    if (learned) return;
    learned = true;
    try { sessionStorage.setItem(LEARNED_KEY, "1"); } catch (e) {}
    document.querySelectorAll(".panel-label").forEach(function (el) {
      el.classList.remove("nudge");
    });
  }

  // ------------------------------------------------------------------ demos

  function refresh(demo) {
    var widget = demo.querySelector("[data-widget]");
    var out = demo.querySelector("[data-out]");
    var note = demo.querySelector("[data-note]");
    var mode = demo.dataset.mode || "c4c";
    out.textContent = mode === "c4c" ? c4cOutput(widget) : regularOutput(widget);
    if (note) note.textContent = NOTES[mode];
    demo.querySelector(".out-panel").classList.add("has-output");
    markLearned();
  }

  document.querySelectorAll("[data-demo]").forEach(function (demo) {
    demo.dataset.mode = "c4c";

    demo.querySelectorAll(".seg [data-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        demo.dataset.mode = btn.dataset.mode;
        demo.querySelectorAll(".seg [data-mode]").forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        track("demo_toggle", { demo: demo.id, mode: btn.dataset.mode });
        // Only re-render if there is already something to re-render: the
        // panel stays empty until the visitor has actually selected something.
        if (demo.querySelector(".out-panel").classList.contains("has-output")) refresh(demo);
      });
    });

    var widget = demo.querySelector("[data-widget]");
    var pending = null;
    function schedule() {
      clearTimeout(pending);
      pending = setTimeout(function () { refresh(demo); }, 120);
    }

    // focusin/focusout included so the ‹focused› annotation tracks reality.
    ["input", "change", "focusin", "focusout"].forEach(function (evt) {
      widget.addEventListener(evt, schedule);
    });
    ["mouseup", "keyup", "touchend"].forEach(function (evt) {
      widget.addEventListener(evt, function () {
        var sel = window.getSelection();
        if (sel && !sel.isCollapsed && widget.contains(sel.anchorNode)) schedule();
      });
    });

    var copyBtn = demo.querySelector("[data-copy]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var text = demo.querySelector("[data-out]").textContent;
        if (!text) return;
        track("demo_copy", { demo: demo.id, mode: demo.dataset.mode });
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            var was = copyBtn.textContent;
            copyBtn.textContent = "Copied";
            setTimeout(function () { copyBtn.textContent = was; }, 1400);
          }, function () {});
        }
      });
    }
  });

  // ------------------------------------------------------------------ nudge

  // Pulse the highlight hint while a demo is on screen, until the visitor has
  // worked it out once.
  if ("IntersectionObserver" in window) {
    var nudger = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          var label = e.target.querySelector(".panel-label");
          if (!label) return;
          if (e.isIntersecting && !learned && !REDUCED) label.classList.add("nudge");
          else label.classList.remove("nudge");
        });
      },
      { threshold: 0, rootMargin: "-20% 0px -20% 0px" }
    );
    document.querySelectorAll("[data-demo]").forEach(function (d) { nudger.observe(d); });
  }
})();
