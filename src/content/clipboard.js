// Two write paths, on purpose.
//
// navigator.clipboard.writeText is the clean one but is sensitive to document
// focus, and the failures are intermittent — exactly the kind of bug that is
// miserable to diagnose after the fact. The execCommand path works precisely
// because we already have a live user selection to copy, which is our case by
// definition.

(function () {
  const C4C = (globalThis.C4C = globalThis.C4C || {});

  function legacyWrite(text, html) {
    let wrote = false;

    const handler = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation(); // keep page copy handlers out of it
      e.clipboardData.setData("text/plain", text);
      if (html) e.clipboardData.setData("text/html", html);
      wrote = true;
    };

    document.addEventListener("copy", handler, true);
    try {
      document.execCommand("copy");
    } finally {
      document.removeEventListener("copy", handler, true);
    }
    return wrote;
  }

  C4C.clipboard = {
    async write(text, html) {
      try {
        if (document.hasFocus() && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return "async";
        }
      } catch {
        // fall through
      }
      return legacyWrite(text, html) ? "execCommand" : null;
    },
  };
})();
