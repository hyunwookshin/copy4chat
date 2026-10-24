/* Copy4Chat landing page.
 *
 * The comparison is live, not canned. The Copy4Chat column runs the
 * extension's own mask.js / extract.js / render-boxed.js against the widget
 * beside it — the same files the published extension ships, copied in by
 * tools/build-site.sh. The Regular Copy column runs Turndown over the same
 * selection's HTML, which is what a chat client receives from an ordinary
 * copy and paste.
 *
 * Neither side is hand-written, so neither can flatter the other.
 */
(function () {
  "use strict";

  var STORE_URL =
    "https://chromewebstore.google.com/detail/copy4chat/jfcmdbgodjiacadofiacehfmnnonfjec";
  var VERSION = "__VERSION__"; // replaced by tools/build-site.sh

  // Analytics events. Guarded so the page works identically with the tag
  // blocked, which many visitors will have.
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  // ------------------------------------------------------------- chrome UI

  // UTM tags so the Web Store dashboard can attribute installs to this page,
  // and to which button on it. Nothing is tracked here: the parameters ride
  // on the outbound link, so the page itself stays script-free and the
  // "nothing is sent anywhere" claim in the footer stays true.
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
  var LABELS = { auto: "Auto", light: "Light", dark: "Dark" };
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem("c4c-theme"); } catch (e) {}
  var theme = MODES.indexOf(stored) >= 0 ? stored : "auto";

  function applyTheme() {
    root.setAttribute("data-theme", theme);
    var label = document.querySelector("[data-theme-label]");
    if (label) label.textContent = LABELS[theme];
  }
  applyTheme();

  var toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    toggle.addEventListener("click", function () {
      theme = MODES[(MODES.indexOf(theme) + 1) % MODES.length];
      try { localStorage.setItem("c4c-theme", theme); } catch (e) {}
      applyTheme();
    });
  }

  // -------------------------------------------------------- sticky section nav

  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  var sections = links
    .map(function (a) { return document.querySelector(a.getAttribute("href")); })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    var visible = new Map();
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) { visible.set(e.target.id, e.intersectionRatio); });
        var best = null;
        var bestRatio = 0;
        visible.forEach(function (ratio, id) {
          if (ratio > bestRatio) { bestRatio = ratio; best = id; }
        });
        links.forEach(function (a) {
          var on = best && a.getAttribute("href") === "#" + best;
          if (on) a.setAttribute("aria-current", "true");
          else a.removeAttribute("aria-current");
        });
      },
      // Top margin clears the sticky header so a section counts as "current"
      // once it reaches the reading area rather than the viewport edge.
      { rootMargin: "-120px 0px -45% 0px", threshold: [0, 0.2, 0.5, 1] }
    );
    sections.forEach(function (s) { observer.observe(s); });
  }

  // ------------------------------------------------------------ widget tabs

  // Keep the mock widgets genuinely interactive: tabs must actually switch,
  // because the extractor reads the live aria-selected state.
  document.querySelectorAll('.widget [role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    list.addEventListener("click", function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (!tab) return;
      tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      refresh(list.closest("[data-demo]"));
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

  function rangeOf(widget) {
    var r = document.createRange();
    r.selectNodeContents(widget);
    return r;
  }

  // What a chat client actually receives: the clipboard's text/html flavour,
  // converted to Markdown. Note this serialises the DOM, so a value the user
  // typed is absent — the attribute is what gets copied, not the live
  // property. That is real browser behaviour, not a thumb on the scale.
  function regularOutput(widget) {
    if (!turndown) return "(converter unavailable)";
    var holder = document.createElement("div");
    holder.appendChild(rangeOf(widget).cloneContents());
    var md = turndown.turndown(holder.innerHTML).trim();
    return md || "(nothing)";
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
    regular:
      "The clipboard's HTML, converted to Markdown with Turndown — what ChatGPT " +
      "receives from an ordinary copy and paste.",
    c4c:
      "Produced live by the extension's own extract.js and render-boxed.js, " +
      "running on this page against the widget on the left.",
  };

  // ------------------------------------------------------------------ demos

  function refresh(demo, reveal) {
    if (!demo) return;
    var widget = demo.querySelector("[data-widget]");
    var out = demo.querySelector("[data-out]");
    var note = demo.querySelector("[data-note]");
    var mode = demo.dataset.mode || "c4c";
    var text = mode === "c4c" ? c4cOutput(widget) : regularOutput(widget);

    if (reveal) {
      // Wrapped so the fade applies to the text rather than the panel, which
      // would otherwise flash the whole box on every keystroke.
      out.textContent = "";
      var span = document.createElement("span");
      span.className = "out-reveal";
      span.textContent = text;
      out.appendChild(span);
    } else {
      out.textContent = text;
    }
    if (note) note.textContent = NOTES[mode];
  }

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Replays the real sequence once, the first time a demo scrolls into view:
  // the selection highlights, the menu action appears, then the output
  // generates. Any interaction cancels it and shows the result immediately,
  // so the theatre never gets in the way of the thing being demonstrated.
  function choreograph(demo) {
    if (demo.dataset.played === "1") return;
    demo.dataset.played = "1";

    var panel = demo.querySelector(".widget-panel");
    var outPanel = demo.querySelector(".out-panel");
    var seg = demo.querySelector(".seg");
    var copyBtn = demo.querySelector("[data-copy]");
    var toast = demo.querySelector(".stage-toast");
    var timers = [];

    function finish() {
      timers.forEach(clearTimeout);
      timers = [];
      panel.classList.remove("is-selecting");
      outPanel.classList.remove("is-busy");
      seg.classList.remove("is-busy");
      if (toast) toast.classList.remove("show");
      refresh(demo, !REDUCED);
    }
    demo.dataset.cancel = "";
    demo._cancelPlay = finish;

    if (REDUCED) { finish(); return; }

    var at = function (ms, fn) { timers.push(setTimeout(fn, ms)); };

    // Clear only now, so the output was already on screen for anyone whose
    // browser never fires the observer.
    demo.querySelector("[data-out]").textContent = "";
    panel.classList.add("is-selecting");
    if (toast) { toast.querySelector("[data-toast-text]").textContent = "Select the page"; toast.classList.add("show"); }

    at(900, function () {
      if (toast) toast.querySelector("[data-toast-text]").textContent = "Copy For Chat";
    });

    at(1700, function () {
      panel.classList.remove("is-selecting");
      if (toast) toast.classList.remove("show");
      outPanel.classList.add("is-busy");
      seg.classList.add("is-busy");
    });

    at(2500, function () {
      outPanel.classList.remove("is-busy");
      seg.classList.remove("is-busy");
      refresh(demo, true);
      if (copyBtn) {
        copyBtn.classList.add("pulse");
        setTimeout(function () { copyBtn.classList.remove("pulse"); }, 2400);
      }
    });
  }

  document.querySelectorAll("[data-demo]").forEach(function (demo) {
    demo.dataset.mode = "c4c";

    demo.querySelectorAll(".seg [data-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        // Switching mode mid-animation means the visitor is ahead of us.
        if (demo._cancelPlay) { var c = demo._cancelPlay; demo._cancelPlay = null; c(); }
        demo.dataset.mode = btn.dataset.mode;
        track("demo_toggle", { demo: demo.id, mode: btn.dataset.mode });
        demo.querySelectorAll(".seg [data-mode]").forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        refresh(demo);
      });
    });

    var widget = demo.querySelector("[data-widget]");
    var pending = null;
    function schedule() {
      if (demo._cancelPlay) { var c = demo._cancelPlay; demo._cancelPlay = null; c(); return; }
      clearTimeout(pending);
      pending = setTimeout(function () { refresh(demo); }, 120);
    }
    // focusin/focusout included so the ‹focused› annotation tracks reality.
    ["input", "change", "focusin", "focusout"].forEach(function (evt) {
      widget.addEventListener(evt, schedule);
    });

    var copyBtn = demo.querySelector("[data-copy]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var text = demo.querySelector("[data-out]").textContent;
        var done = function () {
          var was = copyBtn.textContent;
          copyBtn.textContent = "Copied";
          setTimeout(function () { copyBtn.textContent = was; }, 1400);
        };
        track("demo_copy", { demo: demo.id, mode: demo.dataset.mode });
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
        }
      });
    }

    refresh(demo);
  });

  // Play when a demo is meaningfully on screen, once each.
  if ("IntersectionObserver" in window) {
    // Trigger on entering the middle band of the viewport rather than on a
    // visibility ratio. Ratio is measured against the element, so a section
    // taller than the viewport can never reach a 25% threshold — which left
    // tall demos permanently blank, and would have hit almost every section
    // on mobile where the panels stack.
    var player = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            choreograph(e.target);
            player.unobserve(e.target);
          }
        });
      },
      { threshold: 0, rootMargin: "-25% 0px -25% 0px" }
    );
    document.querySelectorAll("[data-demo]").forEach(function (d) { player.observe(d); });
  } else {
    document.querySelectorAll("[data-demo]").forEach(function (d) { refresh(d); });
  }
})();
