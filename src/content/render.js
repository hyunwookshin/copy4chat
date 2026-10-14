// IR -> clipboard text.
//
// Renderers are swappable by design: the extractor decides what the
// relationships *are*, this file decides how they read. A Unicode-column
// renderer would be a sibling of `text` here and would not touch extraction.

(function () {
  const C4C = (globalThis.C4C = globalThis.C4C || {});

  const INDENT = "  ";

  function esc(s) {
    return String(s).replace(/\|/g, "\\|");
  }

  function renderField(f) {
    const label = f.label ? f.label.replace(/\s+/g, " ").trim() : "";

    // Checked-ness is carried by the glyph for toggles, so don't also list it.
    const suffixOf = (omit = []) => {
      const rest = f.states.filter((s) => !omit.includes(s));
      return rest.length ? `  ‹${rest.join(", ")}›` : "";
    };

    switch (f.control) {
      case "button":
        return `[ ${f.value || label} ]${suffixOf()}`;
      case "checkbox": {
        const box = f.states.includes("checked") ? "☑" : "☐";
        return `${box} ${label}${suffixOf(["checked", "unchecked"])}`;
      }
      case "radio": {
        const dot = f.states.includes("checked") ? "(•)" : "( )";
        return `${dot} ${label}${suffixOf(["checked", "unchecked"])}`;
      }
      case "select":
        return `${label}  (${f.value} ▾)${suffixOf()}`;
      default:
        return `${label}  [${f.value}]${suffixOf()}`;
    }
  }

  function renderTable(t, depth) {
    const pad = INDENT.repeat(depth);
    const width = Math.max(t.headers.length, ...t.rows.map((r) => r.length));
    const lines = [];

    if (t.headers.length) {
      lines.push(pad + "| " + t.headers.map(esc).join(" | ") + " |");
      lines.push(pad + "|" + " --- |".repeat(width));
    }
    for (const row of t.rows) {
      const cells = Array.from({ length: width }, (_, i) => esc(row[i] ?? ""));
      lines.push(pad + "| " + cells.join(" | ") + " |");
    }
    if (t.note) lines.push(pad + `‹${t.note}›`);
    return lines;
  }

  function renderNodes(nodes, depth, out) {
    const pad = INDENT.repeat(depth);
    let inlineRun = [];

    const flushInline = () => {
      if (inlineRun.length) {
        out.push(pad + inlineRun.join(" ").replace(/\s+/g, " ").trim());
        inlineRun = [];
      }
    };

    for (const n of nodes) {
      // Inline fragments join their neighbours; block-level content owns its
      // line, so sibling list items stay distinct instead of running together.
      if (n.kind === "text" && !n.block) {
        inlineRun.push(n.text);
        continue;
      }
      flushInline();

      if (n.kind === "text") {
        out.push(pad + (n.bullet ? "- " : "") + n.text.trim());
      } else if (n.kind === "field") {
        out.push(pad + renderField(n));
      } else if (n.kind === "table") {
        out.push(...renderTable(n, depth));
      } else if (n.kind === "group") {
        if (n.name) {
          out.push(pad + (n.bullet ? "- " : "") + n.name);
          renderNodes(n.children, depth + 1, out);
        } else {
          renderNodes(n.children, depth, out);
        }
      }
    }
    flushInline();
    return out;
  }

  C4C.render = {
    // Default renderer: nested plain text.
    text(doc) {
      const out = [];

      // Context is page content the user did *not* select. Marking it keeps
      // the agent from mistaking our annotation for the user's selection.
      if (doc.context.length) {
        out.push(`‹context: ${doc.context.join(" › ")}›`, "");
      }

      renderNodes(doc.children, 0, out);

      // No footer. Nothing goes on the clipboard that the user didn't copy —
      // masking is disclosed in the toast instead, where it belongs.
      return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    },
  };
})();
