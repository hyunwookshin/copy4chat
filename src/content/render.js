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

  // Anything an HTML→Markdown converter would preserve, we must preserve too:
  // losing a link or a heading means losing to the baseline on table stakes.
  function textOf(n) {
    const t = n.text.trim();
    return n.href ? `[${t}](${n.href})` : t;
  }

  // Emit a record on one marker line with its remaining content indented
  // beneath, so a card reads "1. [iodine](…)" rather than a bare marker with
  // an orphaned first line. Returns how many lines it produced.
  function emitRecord(prefix, n, depth, out) {
    const before = out.length;
    const pad = INDENT.repeat(depth);
    const [first, ...rest] = n.children;

    if (first && first.kind === "text") {
      out.push(pad + prefix + textOf(first));
      renderNodes(rest, depth + 1, out);
    } else {
      out.push(pad + prefix.trimEnd());
      renderNodes(n.children, depth + 1, out);
    }
    return out.length - before;
  }

  function renderNodes(nodes, depth, out) {
    const pad = INDENT.repeat(depth);
    let inlineRun = "";
    let itemNo = 0;

    // Glued runs are rendered as one word by the page, so they join with no
    // separator: <span>$</span><span>20</span> is "$20", not "$ 20".
    const addInline = (n, s) => {
      inlineRun += inlineRun && !n.glue ? " " + s : s;
    };

    const flushInline = () => {
      if (inlineRun) {
        out.push(pad + inlineRun.replace(/\s+/g, " ").trim());
        inlineRun = "";
      }
    };

    for (const n of nodes) {
      // Inline fragments join their neighbours; block-level content owns its
      // line, so sibling list items stay distinct instead of running together.
      if (n.kind === "text" && !n.block) {
        addInline(n, textOf(n));
        continue;
      }
      flushInline();

      // Repeated records get numbered so boundaries survive. Reset the
      // counter whenever the run of records is interrupted.
      if (!n.item) itemNo = 0;

      if (n.kind === "text") {
        out.push(pad + (n.bullet ? "- " : "") + textOf(n));
      } else if (n.kind === "field") {
        out.push(pad + renderField(n));
      } else if (n.kind === "table") {
        out.push(...renderTable(n, depth));
      } else if (n.kind === "group") {
        if (n.item) {
          itemNo++;
          const lines = emitRecord(`${itemNo}. `, n, depth, out);
          // Multi-line records get breathing room, so a long card doesn't
          // bleed into the next one.
          if (lines > 1) out.push("");
        } else if (n.name && n.level) {
          out.push(pad + "#".repeat(Math.min(n.level, 6)) + " " + n.name);
          renderNodes(n.children, depth + 1, out);
        } else if (n.name) {
          out.push(pad + (n.bullet ? "- " : "") + n.name);
          renderNodes(n.children, depth + 1, out);
        } else if (n.bullet) {
          // An unnamed list item is still a list item. Falling through to the
          // flat case here is what dissolved repo cards into a loose run.
          emitRecord("- ", n, depth, out);
        } else {
          renderNodes(n.children, depth, out);
        }
      }
    }
    flushInline();
    return out;
  }

  C4C.render = {
    // Shared with the boxed renderer: a real table is a real table in both.
    tableLines(t) {
      return renderTable(t, 0);
    },

    // Nested plain text / Markdown.
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
