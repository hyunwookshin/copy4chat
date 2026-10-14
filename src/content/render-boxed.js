// Visual-text renderer.
//
// The pitch for this extension is that you paste something recognisable — a
// form still looks like a form. That is worth real tokens, but not everywhere,
// so this is a hybrid: frame the things whose frame carries meaning (forms,
// repeated records, side-by-side arrangements), and leave prose alone. Same
// "which relation is load-bearing" rule as extraction, one layer later.
//
// Output is fenced. Chat clients render proportional fonts, which destroys
// column alignment on arrival; the fence is what makes any of this survive
// the paste.

(function () {
  const C4C = (globalThis.C4C = globalThis.C4C || {});

  const MAX_WIDTH = 76; // fits most chat composers without wrapping
  const MIN_FIELD = 22;
  const MIN_COLUMN = 18; // narrower than this and columns read worse than a stack
  const MIN_COLUMN_TEXT = 12; // prose wraps, so text-only records tolerate more

  // Lines that must survive intact: buttons, inputs, checkboxes, radios.
  const ATOMIC = /^(\[|☑|☐|\(•\)|\( \)|\( )/;

  const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

  // CJK and full-width glyphs occupy two cells; without this the frames skew.
  function width(s) {
    let n = 0;
    for (const ch of s) n += WIDE.test(ch) ? 2 : 1;
    return n;
  }

  function pad(s, w) {
    return s + " ".repeat(Math.max(0, w - width(s)));
  }

  function wrap(s, w) {
    if (width(s) <= w) return [s];
    const words = s.split(/\s+/);
    const lines = [];
    let cur = "";
    for (const word of words) {
      if (!cur) cur = word;
      else if (width(cur) + 1 + width(word) <= w) cur += " " + word;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    // A single unbreakable token (a long URL) still has to be cut.
    return lines.flatMap((l) => {
      if (width(l) <= w) return [l];
      const parts = [];
      for (let i = 0; i < l.length; i += w) parts.push(l.slice(i, i + w));
      return parts;
    });
  }

  function linkText(n) {
    const t = n.text.trim();
    return n.href ? `${t} (${n.href})` : t;
  }

  // ------------------------------------------------------------- primitives

  function panel(title, body, forceInner) {
    const inner = forceInner ?? Math.min(
      MAX_WIDTH - 4,
      Math.max(width(title) + 4, ...body.map(width), 10)
    );
    const lines = body.flatMap((l) => wrap(l, inner));

    // Body lines measure inner+4 ("| " + inner + " |"); the head has to match.
    const head = title
      ? `┌─ ${title} ` + "─".repeat(Math.max(0, inner - width(title) - 1)) + "┐"
      : "┌" + "─".repeat(inner + 2) + "┐";

    return [
      head,
      ...lines.map((l) => `│ ${pad(l, inner)} │`),
      "└" + "─".repeat(inner + 2) + "┘",
    ];
  }

  // Side-by-side only pays when the content actually fits. Squeezing three
  // cards into slivers makes the grouping harder to read than stacking them,
  // so this returns null to mean "stack instead".
  function columnWidths(cells) {
    const natural = cells.map((c) =>
      Math.max(width(c.title) + 2, ...c.lines.map(width), 8)
    );
    if (natural.reduce((a, b) => a + b + 3, 0) + 1 <= MAX_WIDTH) return natural;

    const share = Math.floor((MAX_WIDTH - cells.length * 3 - 1) / cells.length);
    const hasControls = cells.some((c) => c.lines.some((l) => ATOMIC.test(l)));

    // Text-only records lean horizontal: prose wraps gracefully, so narrow
    // columns stay readable and the arrangement is worth keeping. Controls
    // are what force a stack.
    if (share < (hasControls ? MIN_COLUMN : MIN_COLUMN_TEXT)) return null;

    // A button sliced into "[ Contact our sales" / "team ]" reads as broken,
    // which is worse than simply stacking the cards.
    if (hasControls && cells.some((c) => c.lines.some((l) => ATOMIC.test(l) && width(l) > share))) {
      return null;
    }

    return natural.map((n) => Math.min(n, share));
  }

  function columns(cells, widths) {
    const wrapped = cells.map((c, i) => c.lines.flatMap((l) => wrap(l, widths[i])));
    const height = Math.max(...wrapped.map((w) => w.length));

    const seg = (i, left, fill, right) =>
      (i === 0 ? left : "") + fill.repeat(widths[i] + 2) + right;

    let top = "";
    cells.forEach((c, i) => {
      const label = c.title ? `─ ${c.title} ` : "──";
      const rest = Math.max(0, widths[i] + 2 - width(label));
      top += (i === 0 ? "┌" : "┬") + label + "─".repeat(rest);
    });
    top += "┐";

    const rows = [];
    for (let r = 0; r < height; r++) {
      let line = "";
      wrapped.forEach((w, i) => {
        line += "│ " + pad(w[r] ?? "", widths[i]) + " ";
      });
      rows.push(line + "│");
    }

    let bottom = "";
    cells.forEach((c, i) => {
      bottom += (i === 0 ? "└" : "┴") + "─".repeat(widths[i] + 2);
    });
    bottom += "┘";

    return [top, ...rows, bottom];
  }

  // ----------------------------------------------------------------- fields

  function field(f) {
    const label = (f.label || "").replace(/\s+/g, " ").trim();
    const extra = f.states.filter((s) => !["checked", "unchecked"].includes(s));
    const note = extra.length ? `  ‹${extra.join(", ")}›` : "";

    switch (f.control) {
      case "button":
        return [`[ ${f.value || label} ]${note}`];
      case "checkbox":
        return [`${f.states.includes("checked") ? "☑" : "☐"} ${label}${note}`];
      case "radio":
        return [`${f.states.includes("checked") ? "(•)" : "( )"} ${label}${note}`];
      case "select":
        return [label, `( ${f.value} ▾ )${note}`].filter(Boolean);
      default: {
        // An input reads as an input: a filled slot with room left in it.
        const fill = Math.max(MIN_FIELD - width(f.value), 4);
        const box = `[ ${f.value}${"_".repeat(fill)} ]`;
        return label ? [label, box + note] : [box + note];
      }
    }
  }

  // ------------------------------------------------------------------ walk

  // Direct children only. Checking descendants recursively frames every
  // ancestor of a single button, so a whole page ends up inside one box.
  function holdsControls(n) {
    return (n.children || []).some((c) => c.kind === "field");
  }

  function titleNodeOf(n) {
    if (n.name) return { text: n.name, href: null };
    const first = (n.children || [])[0];
    return first && first.kind === "text"
      ? { text: first.text.trim(), href: first.href || null }
      : { text: "", href: null };
  }

  function titleOf(n) {
    return titleNodeOf(n).text;
  }

  // A group earns a frame when the frame says something: it holds controls, or
  // it is one of a set of repeated records. Prose stays unframed.
  function framed(n) {
    return n.kind === "group" && (n.item || holdsControls(n));
  }

  // parentAxis comes from the container's measured layout: whether these
  // siblings sit across the page or down it.
  function block(nodes, parentAxis) {
    const out = [];
    let inlineRun = [];
    const flush = () => {
      if (inlineRun.length) {
        out.push(inlineRun.join(" ").replace(/\s+/g, " ").trim());
        inlineRun = [];
      }
    };

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];

      if (n.kind === "text" && !n.block) {
        inlineRun.push(linkText(n));
        continue;
      }
      flush();

      if (n.kind === "text") {
        out.push((n.bullet ? "- " : "") + linkText(n));
        continue;
      }
      if (n.kind === "field") {
        out.push(...field(n));
        continue;
      }
      if (n.kind === "table") {
        out.push(...C4C.render.tableLines(n));
        continue;
      }

      const bodyOf = (g) => {
        const title = titleNodeOf(g);
        // Don't repeat the title inside its own frame — but a frame can't hold
        // a link, so a titled link keeps its target as the first body line.
        const body = block(
          g.children.filter((c) => c.kind !== "text" || c.text.trim() !== title.text),
          g.axis
        );
        return title.href ? [title.href, ...body] : body;
      };

      // A run of framed records sitting across the page becomes columns —
      // the one case where 2D genuinely carries the meaning.
      if (framed(n) && n.item && parentAxis === "row") {
        const run = [];
        let j = i;
        while (j < nodes.length && nodes[j].item && framed(nodes[j])) run.push(nodes[j++]);
        if (run.length > 1) {
          const cells = run.map((r) => ({ title: titleOf(r), lines: bodyOf(r) }));
          const widths = columnWidths(cells);
          if (widths) {
            out.push(...columns(cells, widths));
          } else {
            // Too wide to sit across: stack the records instead. Nesting
            // alternates orientation naturally, since each container's axis
            // is measured independently. Share one width so the stack still
            // reads as a set.
            const inner = Math.min(
              MAX_WIDTH - 4,
              Math.max(...cells.map((c) => Math.max(width(c.title) + 4, ...c.lines.map(width), 10)))
            );
            cells.forEach((c) => out.push(...panel(c.title, c.lines, inner)));
          }
          i = j - 1;
          continue;
        }
      }

      if (framed(n)) {
        out.push(...panel(titleOf(n), bodyOf(n)));
        continue;
      }

      // Unframed group: keep the heading, keep the nesting, no box.
      if (n.name && n.level) out.push("#".repeat(Math.min(n.level, 6)) + " " + n.name);
      else if (n.name) out.push(n.name);
      const inner = block(n.children, n.axis);
      out.push(...(n.name ? inner.map((l) => "  " + l) : inner));
    }
    flush();
    return out;
  }

  C4C.render.boxed = function boxed(doc) {
    const out = [];
    if (doc.context.length) {
      out.push(`‹context: ${doc.context.join(" › ")}›`, "");
    }
    out.push(...block(doc.children, "column"));
    const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    // Fenced, or the chat client's proportional font eats the alignment.
    return "```\n" + body + "\n```";
  };
})();
