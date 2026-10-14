// Visual-text renderer.
//
// Paste a form and it should still look like a form. That is the reason to
// install this; whether it also helps the agent is what the fixtures decide.
//
// THE INVARIANT, which the first version violated and which every bug in the
// United output traced back to:
//
//   Every render operation returns a Rect — { lines, w } where every line is
//   already padded to exactly w display columns — and NOTHING downstream ever
//   re-wraps it.
//
// Wrapping is a property of text, so it happens when text becomes a Rect and
// never again. The previous renderer returned bare string arrays of unknown
// width and wrapped them inside the panel builder, which meant a nested box's
// border could be word-wrapped. That is what produced torn frames.
//
// Budget flows downward: a frame at budget B renders its body at B-4, so a
// child can never come back wider than its parent allows.
//
// Output is fenced. Chat clients render proportional fonts, which destroys
// alignment on arrival.

(function () {
  const C4C = (globalThis.C4C = globalThis.C4C || {});

  const MAX = 80;
  const GAP = 2; // columns between side-by-side blocks
  const MAX_TITLE = 36;
  const FIELD_PAD = 12;
  const MIN_SOFT = 16; // narrowest column worth squeezing prose into
  const MAX_NEST = 3; // frames deeper than this must earn their border

  // Lines that must survive intact: buttons, inputs, checkboxes, radios.
  const ATOMIC = /^(\[|☑|☐|\(•\)|\( \)|\( )/;

  const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

  // String length is not display width: CJK and full-width glyphs take two
  // columns, and combining marks take none. Frames skew without this.
  function width(s) {
    let n = 0;
    for (const ch of s) {
      if (/\p{M}/u.test(ch)) continue;
      n += WIDE.test(ch) ? 2 : 1;
    }
    return n;
  }

  function padTo(s, w) {
    return s + " ".repeat(Math.max(0, w - width(s)));
  }

  function truncate(s, w) {
    if (width(s) <= w) return s;
    let out = "";
    for (const ch of s) {
      if (width(out) + width(ch) > w - 1) break;
      out += ch;
    }
    return out + "…";
  }

  // ------------------------------------------------------------------ Rect

  const EMPTY = { lines: [], w: 0 };

  function rectOf(lines, forceW) {
    const w = forceW ?? Math.max(0, ...lines.map(width));
    return { lines: lines.map((l) => padTo(l, w)), w };
  }

  function stack(rects) {
    const list = rects.filter((r) => r && r.lines.length);
    if (!list.length) return EMPTY;
    const w = Math.max(...list.map((r) => r.w));
    return { lines: list.flatMap((r) => r.lines.map((l) => padTo(l, w))), w };
  }

  // Side by side. Both operands are already final rectangles, so this is pure
  // concatenation — no measurement, no wrapping, nothing that can tear.
  function row(rects) {
    const list = rects.filter((r) => r && r.lines.length);
    if (!list.length) return EMPTY;
    const h = Math.max(...list.map((r) => r.lines.length));
    const gap = " ".repeat(GAP);
    const lines = [];
    for (let i = 0; i < h; i++) {
      lines.push(list.map((r) => r.lines[i] ?? " ".repeat(r.w)).join(gap));
    }
    return rectOf(lines);
  }

  function indent(r, k) {
    if (!r.lines.length) return EMPTY;
    const p = " ".repeat(k);
    return { lines: r.lines.map((l) => p + l), w: r.w + k };
  }

  function frame(title, body, budget) {
    // Widen for the title before resorting to truncating it; a box only
    // squeezes its label when the budget genuinely has no room.
    const want = Math.max(body.w, title ? width(title) + 2 : 0, 6);
    const inner = Math.min(want, budget - 4);
    const t = title ? truncate(title, Math.max(0, inner - 1)) : "";

    const top = t
      ? "┌─ " + t + " " + "─".repeat(Math.max(0, inner - width(t) - 1)) + "┐"
      : "┌" + "─".repeat(inner + 2) + "┐";

    return rectOf([
      top,
      ...body.lines.map((l) => "│ " + padTo(l, inner) + " │"),
      "└" + "─".repeat(inner + 2) + "┘",
    ]);
  }

  // ------------------------------------------------------------------ text

  function wrapText(s, budget) {
    const limit = Math.max(4, budget);
    const out = [];
    for (const word of s.split(/\s+/)) {
      const last = out[out.length - 1];
      if (last !== undefined && width(last) + 1 + width(word) <= limit) {
        out[out.length - 1] = last + " " + word;
      } else {
        out.push(word);
      }
    }
    // A single unbreakable token (a long URL) still has to be cut, and this is
    // the only place in the renderer allowed to do it.
    return out.flatMap((l) => {
      if (width(l) <= limit) return [l];
      const parts = [];
      let cur = "";
      for (const ch of l) {
        if (width(cur) + width(ch) > limit) {
          parts.push(cur);
          cur = "";
        }
        cur += ch;
      }
      if (cur) parts.push(cur);
      return parts;
    });
  }

  function textRect(s, budget) {
    const t = s.replace(/\s+/g, " ").trim();
    return t ? rectOf(wrapText(t, budget)) : EMPTY;
  }

  // Pack items onto lines without ever splitting one.
  function packRect(items, budget) {
    const lines = [];
    let cur = "";
    for (const item of items) {
      if (!cur) cur = item;
      else if (width(cur) + GAP + width(item) <= budget) cur += " ".repeat(GAP) + item;
      else {
        lines.push(cur);
        cur = item;
      }
    }
    if (cur) lines.push(cur);
    return rectOf(lines);
  }

  function linkText(n) {
    const t = n.text.trim();
    return n.href ? `${t} (${n.href})` : t;
  }

  // ---------------------------------------------------------------- fields

  function field(f, omitLabel) {
    const label = omitLabel ? "" : (f.label || "").replace(/\s+/g, " ").trim();
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
        const fill = Math.max(FIELD_PAD - width(f.value), 4);
        const box = `[ ${f.value}${"_".repeat(fill)} ]${note}`;
        return label ? [label, box] : [box];
      }
    }
  }

  // ------------------------------------------------------------- IR shape

  function holdsControls(n) {
    return (n.children || []).some((c) => c.kind === "field");
  }

  function titleOf(n) {
    return titleNodeOf(n).text;
  }

  // Accessible names are often whole instruction paragraphs ("a tabs widget:
  // Book, Flight status…; use arrow keys to navigate"). The leading clause is
  // the part that works as a label.
  function shortTitle(name) {
    const head = name.split(/[:;]|\s[–—-]\s/)[0].trim();
    return head ? truncate(head, MAX_TITLE) : "";
  }

  function titleNodeOf(n) {
    if (n.name) return { text: shortTitle(n.name), href: null };
    const first = (n.children || [])[0];
    return first && first.kind === "text"
      ? { text: shortTitle(first.text.trim()), href: first.href || null }
      : { text: "", href: null };
  }

  // A group earns a frame when the frame says something. An untitled group
  // whose children are all themselves framed earns nothing — the children's
  // own frames already show the grouping.
  function framed(n) {
    if (!n || n.kind !== "group") return false;
    if (!(n.item || holdsControls(n) || (n.children || []).some(framed))) return false;
    const kids = (n.children || []).filter((c) => c.kind !== "text" || c.text.trim());
    if (!titleOf(n) && kids.length > 1 && kids.every(framed)) return false;
    return true;
  }

  // A container with no label, no controls and no text of its own, which
  // exists only to hold another container. Its border draws a box around a
  // box and says nothing — tolerable near the surface, noise once nested.
  function isPureWrapper(n) {
    if (titleOf(n)) return false;
    if (holdsControls(n)) return false;
    if ((n.children || []).some((c) => c.kind === "text" && c.text.trim())) return false;
    return (n.children || []).some((c) => c.kind === "group");
  }

  // Set per render: true when the selection nests boxes deeper than
  // MAX_NEST anywhere. Deciding once, up front, matters — if each wrapper
  // re-measured as its ancestors were dropped, the subtree would shrink back
  // under the threshold and the remaining wrappers would survive.
  let trimWrappers = false;

  // How many frames deep this subtree goes.
  function frameDepth(n) {
    if (!n || n.kind !== "group") return 0;
    const inner = Math.max(0, ...(n.children || []).map(frameDepth));
    return (framed(n) ? 1 : 0) + inner;
  }

  // Soft content wraps gracefully, so it can be squeezed into a narrow column.
  // Controls and nested frames cannot.
  function isSoft(n) {
    if (!n) return true;
    if (n.kind === "field" || n.kind === "table") return false;
    if (framed(n)) return false;
    return (n.children || []).every(isSoft);
  }

  // Forms emit the same string two or three times — a <label>, the control's
  // accessible name, a visible span. Drop the echoes before rendering.
  function dropEchoes(children, title) {
    const out = [];
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.kind === "text") {
        const t = c.text.trim();
        if (!t) continue;
        if (t === title) continue;
        const prev = out[out.length - 1];
        if (prev && prev.kind === "text" && prev.text.trim() === t) continue;
        // A control's label may sit on either side of it in the DOM.
        const labelled = (x) => x && x.kind === "field" && (x.label || "").trim() === t;
        if (labelled(children[i + 1]) || labelled(prev)) continue;
        out.push(c);
        continue;
      }
      if (c.kind === "field" && (c.label || "").trim() === title) {
        out.push({ ...c, label: "" });
        continue;
      }
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- render

  function renderGroup(n, budget, depth) {
    const title = titleNodeOf(n);
    const kids = dropEchoes(n.children || [], title.text);

    if (framed(n)) {
      // Once a stack of boxes runs deeper than MAX_NEST, wrappers that
      // contribute nothing of their own are dropped rather than drawn. The
      // nesting they show is already visible from the frames inside them.
      if (trimWrappers && isPureWrapper(n)) {
        return renderList(kids, budget, n.axis, depth);
      }
      const inner = budget - 4;
      const body = renderList(kids, inner, n.axis, depth + 1);
      // A frame cannot hold a link, so a titled link keeps its target inside.
      const full = title.href ? stack([textRect(title.href, inner), body]) : body;
      // A frame around one untitled line says nothing the line doesn't.
      if (!title.text && full.lines.length <= 1) return full;
      return frame(title.text, full, budget);
    }

    const head = [];
    if (n.name && n.level) head.push(textRect("#".repeat(Math.min(n.level, 6)) + " " + n.name, budget));
    else if (n.name) head.push(textRect(n.name, budget));

    const sub = renderList(kids, head.length ? budget - 2 : budget, n.axis, depth);
    return stack([...head, head.length ? indent(sub, 2) : sub]);
  }

  // Natural first: render each child at the full budget and compose only if
  // the finished rectangles fit. Otherwise stack them *unchanged* — never
  // reflow a block that has already been composed.
  function widthOf(rects) {
    return rects.reduce((a, r) => a + r.w, 0) + GAP * (rects.length - 1);
  }

  // Greedy pack into as many full rows as fit. Each row is composed from
  // finished rectangles and the rows are then stacked, so the invariant holds
  // however the run divides.
  function packRows(rects, budget) {
    const rows = [];
    let cur = [];
    for (const r of rects) {
      if (cur.length && widthOf([...cur, r]) > budget) {
        rows.push(row(cur));
        cur = [];
      }
      cur.push(r);
    }
    if (cur.length) rows.push(row(cur));
    return rows.length === 1 ? rows[0] : stack(rows);
  }

  function composeRow(run, budget, depth) {
    const natural = run.map((g) => renderGroup(g, budget, depth));
    if (widthOf(natural) <= budget) return row(natural);

    // Prose tolerates a narrower column; controls and nested frames do not.
    if (run.every(isSoft)) {
      const share = Math.floor((budget - GAP * (run.length - 1)) / run.length);
      if (share >= MIN_SOFT) {
        const squeezed = run.map((g) => renderGroup(g, share, depth));
        if (widthOf(squeezed) <= budget) return row(squeezed);
      }
    }

    // Three boxes that don't fit on one line usually still fit two-and-one,
    // which beats stacking all three.
    return packRows(natural, budget);
  }

  function renderList(nodes, budget, parentAxis, depth) {
    const blocks = [];
    let inlineRun = [];

    const flushInline = () => {
      if (!inlineRun.length) return;
      const s = inlineRun.join(" ");
      inlineRun = [];
      const r = textRect(s, budget);
      if (r.lines.length) blocks.push(r);
    };

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];

      if (n.kind === "text" && !n.block) {
        inlineRun.push(linkText(n));
        continue;
      }
      flushInline();

      if (n.kind === "text") {
        blocks.push(textRect((n.bullet ? "- " : "") + linkText(n), budget));
        continue;
      }

      if (n.kind === "field") {
        // A row of controls (tabs, a button bar) packs onto shared lines.
        if (parentAxis === "row") {
          const items = [];
          let j = i;
          while (j < nodes.length && nodes[j].kind === "field") {
            const r = field(nodes[j]);
            if (r.length !== 1) break;
            items.push(r[0]);
            j++;
          }
          if (items.length > 1) {
            blocks.push(packRect(items, budget));
            i = j - 1;
            continue;
          }
        }
        blocks.push(rectOf(field(n).flatMap((l) => wrapText(l, budget))));
        continue;
      }

      if (n.kind === "table") {
        blocks.push(rectOf(C4C.render.tableLines(n).flatMap((l) => wrapText(l, budget))));
        continue;
      }

      if (parentAxis === "row" && framed(n)) {
        const run = [];
        let j = i;
        while (j < nodes.length && framed(nodes[j])) run.push(nodes[j++]);
        if (run.length > 1) {
          blocks.push(composeRow(run, budget, depth));
          i = j - 1;
          continue;
        }
      }

      blocks.push(renderGroup(n, budget, depth));
    }

    flushInline();
    return stack(blocks);
  }

  C4C.render.boxed = function boxed(doc) {
    const parts = [];
    if (doc.context.length) {
      parts.push(textRect(`‹context: ${doc.context.join(" › ")}›`, MAX));
    }
    trimWrappers = Math.max(0, ...doc.children.map(frameDepth)) > MAX_NEST;
    parts.push(renderList(doc.children, MAX, "column", 0));
    const r = stack(parts);
    const body = r.lines.map((l) => l.replace(/\s+$/, "")).join("\n").trim();
    return "```\n" + body + "\n```";
  };

  // Exposed for the invariant tests.
  C4C.render._boxed = { width, stack, row, frame, textRect, MAX };
})();
