(function () {
  const C4C = globalThis.C4C;

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

  async function run() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const doc = C4C.extract(range);
    if (!doc) return;

    // When output looks wrong, the question is always "what did the extractor
    // actually see?" — guessing at a site's DOM from the rendered text is how
    // you end up fixing the wrong layer. console.debug sits at Verbose level,
    // so this is invisible unless you go looking.
    console.debug("[copy4chat] IR", doc);

    const text = C4C.render.text(doc);
    const path = await C4C.clipboard.write(text);

    if (!path) {
      toast("Copy4Chat: clipboard write failed");
      return;
    }

    // Tell the user what left the page. An extension that silently reads form
    // values should say so.
    const bits = [`Copied ${text.length} chars`];
    if (doc.masked) bits.push(`${doc.masked} masked`);
    toast(bits.join(" · "));
  }

  run();
})();
