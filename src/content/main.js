(function () {
  const C4C = globalThis.C4C;

  const RENDERER = "boxed"; // "boxed" | "text"

  function toast(message) {
    const el = document.createElement("div");
    el.textContent = message;
    Object.assign(el.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: "2147483647",
      padding: "10px 14px",
      borderRadius: "8px",
      background: "rgba(20,20,20,.92)",
      color: "#fff",
      font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
      boxShadow: "0 4px 16px rgba(0,0,0,.3)",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // window.getSelection() does not report selections inside <input> or
  // <textarea>; it comes back collapsed. The real range lives on the element.
  //
  // This is not just a form-field edge case. GitHub's code view overlays a
  // transparent read-only <textarea> on top of the highlighted source, so
  // selecting code selects inside that textarea and the page selection is
  // empty. Both reported "copies nothing" cases are this one bug.
  function controlSelection() {
    const el = document.activeElement;
    if (!el) return null;

    const isTextarea = el.tagName === "TEXTAREA";
    const isTextInput = el.tagName === "INPUT" && typeof el.selectionStart === "number";
    if (!isTextarea && !isTextInput) return null;

    const { selectionStart: start, selectionEnd: end } = el;
    if (start == null || end == null || start === end) return null;

    const raw = String(el.value).slice(start, end);
    if (!raw.trim()) return null;

    // A selection inside a password field is still a password.
    return { el, text: C4C.mask.value(el, raw) };
  }

  function labelFor(el) {
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      "";
    return name.replace(/\s+/g, " ").trim().slice(0, 80);
  }

  async function copy(text, note) {
    const path = await C4C.clipboard.write(text);
    if (!path) {
      toast("Copy4Chat: clipboard write failed");
      return false;
    }
    toast([`Copied ${text.length} chars`, note].filter(Boolean).join(" · "));
    return true;
  }

  async function run() {
    C4C.mask.reset();

    // Control selections first: when one exists the page selection is empty,
    // so checking it afterwards would be checking a selection that lost.
    const control = controlSelection();
    if (control) {
      const label = labelFor(control.el);
      const body = label ? `‹${label}›\n${control.text}` : control.text;
      await copy("```\n" + body + "\n```", C4C.mask.count ? "1 masked" : "verbatim text");
      return;
    }

    const sel = getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      // Never return silently. A clipboard tool that quietly does nothing
      // leaves stale content behind, and the user pastes it believing it is
      // fresh — worse than having no extension at all.
      toast("Copy4Chat: nothing selected");
      return;
    }

    const range = sel.getRangeAt(0);
    const doc = C4C.extract(range);

    // When output looks wrong, the question is always "what did the extractor
    // actually see?" — guessing at a site's DOM from the rendered text is how
    // you end up fixing the wrong layer. console.debug sits at Verbose level,
    // so this is invisible unless you go looking.
    console.debug("[copy4chat] IR", doc);

    const text = doc ? C4C.render[RENDERER](doc) : "";
    const structured = text.replace(/```/g, "").trim();

    if (!structured) {
      // Extraction found no structure it could render. Plain text is a worse
      // answer than structure, but it is a far better answer than nothing,
      // and the toast says which one you got.
      const plain = sel.toString().trim();
      if (!plain) {
        toast("Copy4Chat: nothing to copy from this selection");
        return;
      }
      await copy(plain, "plain text, no structure found");
      return;
    }

    await copy(text, doc.masked ? `${doc.masked} masked` : "");
  }

  run();
})();
