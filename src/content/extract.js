// Selection -> intermediate representation.
//
// The IR is deliberately renderer-agnostic: nested text, Markdown and (if we
// ever want it) Unicode columns are all just different walks of this tree.
//
// Two rules constrain everything here:
//   1. Only selected content is content. We never expand the selection
//      outward. Surrounding DOM may be read to *annotate* relationships, and
//      anything read that way is tagged as context so the renderer can mark it.
//   2. Prefer explicit semantics, then DOM hierarchy, then geometry. Geometry
//      never promotes a relationship; it only vetoes one, or corrects reading
//      order the DOM gets wrong.
//
// IR nodes:
//   { kind: 'doc',   context: [string], url, children }
//   { kind: 'group', name?, children, note? }
//   { kind: 'text',  text }
//   { kind: 'field', label?, value?, control, states: [string] }
//   { kind: 'table', headers: [string], rows: [[string]] }

(function () {
  const C4C = (globalThis.C4C = globalThis.C4C || {});
  const mask = C4C.mask;

  const SEMANTIC_TAGS = new Set([
    "ARTICLE", "SECTION", "NAV", "ASIDE", "MAIN", "HEADER", "FOOTER",
    "FIGURE", "FIGCAPTION", "BLOCKQUOTE", "UL", "OL", "LI", "DL", "DT", "DD",
    "FORM", "FIELDSET", "TABLE", "DETAILS", "SUMMARY",
  ]);

  const CONTROL_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

  const MAX_CONTEXT_ANCESTORS = 3;

  // ---------------------------------------------------------------- helpers

  // Inline-level content flows into a line with its neighbours; everything
  // else owns its line. Without this the renderer can't tell a <span> inside a
  // sentence from an <li> that happens to hold one text node.
  const INLINE_DISPLAY = /^(inline|contents|ruby)/;

  function isBlockLevel(el) {
    return !INLINE_DISPLAY.test(getComputedStyle(el).display);
  }

  function isBullet(el) {
    return el.tagName === "LI" || getComputedStyle(el).display === "list-item";
  }

  function visible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    // Zero-size containers can still hold laid-out children (e.g. absolutely
    // positioned), so only reject leaves.
    if (r.width === 0 && r.height === 0 && el.children.length === 0) return false;
    return true;
  }

  function collapseWs(text, el) {
    const pre = getComputedStyle(el).whiteSpace.startsWith("pre");
    return pre ? text : text.replace(/\s+/g, " ");
  }

  // What the user sees, not what the DOM says.
  function shownText(text, el) {
    const t = getComputedStyle(el).textTransform;
    if (t === "uppercase") return text.toUpperCase();
    if (t === "lowercase") return text.toLowerCase();
    if (t === "capitalize") return text.replace(/\b\w/g, (c) => c.toUpperCase());
    return text;
  }

  // Document-order cursors for glue detection, reset per extraction.
  let lastRunRect = null;
  let lastRunEndedWithSpace = true;

  function textRects(node) {
    const probe = node.ownerDocument.createRange();
    probe.selectNodeContents(node);
    const rects = probe.getClientRects();
    return rects.length ? rects : null;
  }

  // True when this run starts exactly where the previous one ended, i.e. the
  // page renders them as one word. <span>$</span><span>20</span> is "$20",
  // not "$ 20".
  function gluedToPrevious(node, raw) {
    const rects = textRects(node);
    if (!rects) return false;
    const first = rects[0];
    // A text node s rect spans its own trailing whitespace, so geometry alone
    // reports "contiguous" across a real space. The source settles it.
    const separated = lastRunEndedWithSpace || /^\s/.test(raw);
    const glued =
      !separated &&
      !!lastRunRect &&
      Math.abs(first.top - lastRunRect.top) <= 1 &&
      Math.abs(first.left - lastRunRect.right) <= 0.5;
    lastRunRect = rects[rects.length - 1];
    lastRunEndedWithSpace = /\s$/.test(raw);
    return glued;
  }

  function sliceText(node, range) {
    const whole = node.data;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : whole.length;
    const parent = node.parentElement;
    if (!parent) return "";
    return shownText(collapseWs(whole.slice(start, end), parent), parent);
  }

  // textContent concatenates across element boundaries with no separator, so
  // <span>Close</span><span>Add a customer ID</span> reads back as
  // "CloseAdd a customer ID". Real sites stack spans like this constantly —
  // a visible label, a screen-reader label, an avatar initial.
  //
  // innerText is not the fix: it also returns "CloseAdd a customer ID" for
  // inline-block siblings separated by a margin, which is exactly the case
  // that matters. Blindly joining with a space is not the fix either — it
  // turns <b>re</b>ally into "re ally".
  //
  // So measure. Separate two runs when the rendering separates them: a line
  // break between, or a horizontal gap. Same rule as everywhere else in this
  // file — emit what is visible.
  function renderedText(el) {
    if (!el) return "";

    if (!(el instanceof HTMLElement) || !el.isConnected) {
      // Detached clones and SVG nodes cannot be measured; join on boundaries.
      const parts = [];
      (function walk(n) {
        if (n.nodeType === Node.TEXT_NODE) parts.push(n.data);
        else n.childNodes.forEach(walk);
      })(el);
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }

    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const probe = el.ownerDocument.createRange();
    let out = "";
    let prev = null;
    let prevClipped = false;

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) {
        out += " ";
        continue;
      }
      probe.selectNodeContents(n);
      const rects = probe.getClientRects();
      if (!rects.length) continue; // not rendered at all

      const first = rects[0];
      // Measure the containing box, not the text: an sr-only span is 1px
      // but its text overflows, so the text rect looks perfectly normal.
      const host = n.parentElement && n.parentElement.getBoundingClientRect();
      const clipped = !!host && (host.width <= 1 || host.height <= 1);
      if (prev) {
        const brokeLine = Math.abs(first.top - prev.top) > 1;
        // Absolute value: an out-of-flow run can start to the LEFT of where
        // the previous one ended.
        const moved = Math.abs(first.left - prev.right) > 0.5;
        // A visually-hidden label renders at its static position, so it
        // measures as contiguous even though nothing is drawn there.
        if (brokeLine || moved || clipped || prevClipped) out += " ";
      }
      out += n.data;
      prev = rects[rects.length - 1];
      prevClipped = clipped;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function pseudoText(el, which) {
    const cs = getComputedStyle(el, which);
    const c = cs.content;
    if (!c || c === "none" || c === "normal") return "";
    const m = c.match(/^"(.*)"$/);
    return m ? m[1] : "";
  }

  // An icon is visible content whose rendering happens not to be text. A
  // sighted user reading "★ 8" gets "stars" from the glyph; dropping the glyph
  // and keeping the number destroys the meaning. So the accessible name is the
  // icon's transcription, not an exception to "emit what's visible".
  function iconText(el) {
    if (el.tagName === "IMG") return (el.getAttribute("alt") || "").trim();
    if (el.tagName.toLowerCase() === "svg") {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      const title = el.querySelector("title");
      return title ? renderedText(title) : "";
    }
    return "";
  }

  function hrefOf(el) {
    if (el.tagName !== "A") return null;
    const raw = el.getAttribute("href");
    if (!raw || raw.startsWith("javascript:") || raw === "#") return null;
    return mask.href(raw, location.href);
  }

  function accessibleName(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => renderedText(el.ownerDocument.getElementById(id)))
        .join(" ")
        .trim();
      if (text) return text;
    }

    if (el.tagName === "FIELDSET") {
      const legend = el.querySelector(":scope > legend");
      if (legend) return renderedText(legend);
    }
    if (el.tagName === "TABLE") {
      const caption = el.querySelector(":scope > caption");
      if (caption) return renderedText(caption);
    }
    return "";
  }

  function headingLevel(el) {
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) return Number(m[1]);
    if (el.getAttribute("role") === "heading") {
      return Number(el.getAttribute("aria-level")) || 2;
    }
    return 0;
  }

  function isTable(el) {
    const role = el.getAttribute("role");
    return el.tagName === "TABLE" || role === "table" || role === "grid";
  }

  function isControl(el) {
    return CONTROL_TAGS.has(el.tagName);
  }

  // --------------------------------------------------------------- controls

  function controlLabel(el) {
    const named = accessibleName(el);
    if (named) return named;

    const doc = el.ownerDocument;
    if (el.id) {
      const forLabel = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) return renderedText(forLabel);
    }
    const wrapping = el.closest("label");
    if (wrapping) {
      // Strip the control's own text so a wrapping label doesn't echo it.
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((n) => n.remove());
      const t = renderedText(clone);
      if (t) return t;
    }
    if (el.placeholder) return el.placeholder.trim();
    return "";
  }

  function controlStates(el) {
    const states = [];
    if (el.disabled) states.push("disabled");
    if (el.required) states.push("required");
    if (el.readOnly) states.push("readonly");
    if (el === el.ownerDocument.activeElement) states.push("focused");
    if (el.getAttribute("aria-invalid") === "true") states.push("invalid");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) states.push(expanded === "true" ? "expanded" : "collapsed");
    return states;
  }

  function fieldNode(el) {
    const label = controlLabel(el);
    const states = controlStates(el);
    let value = "";
    let control = "text";

    if (el.tagName === "BUTTON" || el.type === "submit" || el.type === "button") {
      control = "button";
      value = renderedText(el) || (el.value || "").trim();
    } else if (el.type === "checkbox" || el.type === "radio") {
      control = el.type;
      states.push(el.checked ? "checked" : "unchecked");
    } else if (el.tagName === "SELECT") {
      control = "select";
      value = el.selectedOptions?.[0]?.text?.trim() || "";
    } else {
      value = mask.value(el, el.value || "");
    }

    return { kind: "field", label, value, control, states };
  }

  // ----------------------------------------------------------------- tables

  function tableNode(el, range) {
    const rows = Array.from(el.rows || el.querySelectorAll('[role="row"]'));
    if (!rows.length) return null;

    const cellsOf = (row) =>
      Array.from(row.cells || row.querySelectorAll('[role="cell"], [role="columnheader"]'));

    let headers = [];
    const first = rows[0];
    if (first && cellsOf(first).every((c) => c.tagName === "TH" || c.getAttribute("role") === "columnheader")) {
      headers = cellsOf(first).map(renderedText);
    }

    const body = headers.length ? rows.slice(1) : rows;
    const out = [];
    for (const row of body) {
      if (!range.intersectsNode(row)) continue;
      // Cells outside the selection stay blank rather than being pulled in.
      out.push(cellsOf(row).map((c) => (range.intersectsNode(c) ? renderedText(c) : "")));
    }
    if (!out.length) return null;
    return { kind: "table", headers, rows: out, note: headers.length ? "header row shown as context" : "" };
  }

  // ------------------------------------------------------------------- walk

  function visitElement(el, range) {
    if (!visible(el)) return null;
    if (isTable(el)) return tableNode(el, range);
    if (isControl(el)) return fieldNode(el);

    const icon = iconText(el);
    if (icon) return { kind: "text", text: icon, block: false };

    const children = [];

    const before = pseudoText(el, "::before");
    if (before) children.push({ kind: "text", text: before });

    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!range.intersectsNode(child)) continue;
        const raw = sliceText(child, range);
        const t = raw.trim();
        const glue = gluedToPrevious(child, raw);
        if (t) children.push({ kind: "text", text: t, glue });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!range.intersectsNode(child)) continue;
        const n = visitElement(child, range);
        if (n) children.push(n);
      }
    }

    const after = pseudoText(el, "::after");
    if (after) children.push({ kind: "text", text: after });

    if (!children.length) return null;

    return {
      kind: "el",
      el,
      name: accessibleName(el),
      heading: headingLevel(el),
      block: isBlockLevel(el),
      bullet: isBullet(el),
      href: hrefOf(el),
      children,
    };
  }

  // -------------------------------------------------------------- transform

  // Repeated sibling shape is the strongest signal that a generic wrapper is
  // actually a record rather than a spacer.
  function markRepeats(children) {
    // Require a class: without one the signature is just the tag name, so
    // any two sibling paragraphs read as "repeated records" and get framed.
    // Component-built records essentially always carry a class.
    const sig = (n) => {
      if (n.kind !== "el" || !n.el.classList.length) return null;
      return `${n.el.tagName}.${Array.from(n.el.classList).sort().join(".")}`;
    };
    const counts = new Map();
    for (const c of children) {
      const s = sig(c);
      if (s) counts.set(s, (counts.get(s) || 0) + 1);
    }
    for (const c of children) {
      const s = sig(c);
      if (s && counts.get(s) >= 2) c.repeated = true;
    }
  }

  function contentBearing(n) {
    return n.kind !== "text" || n.text.trim().length > 0;
  }

  function meaningful(n) {
    if (n.kind !== "el") return true;
    if (n.href) return true; // never collapse a link and lose its target
    if (n.heading) return true;
    if (n.repeated) return true;
    if (n.name) return true;
    if (SEMANTIC_TAGS.has(n.el.tagName)) return true;
    if (n.el.getAttribute("role")) return true;
    if (n.children.filter(contentBearing).length >= 2) return true;
    return false;
  }

  // Whether a group's children are laid out across or down. Not a claim that
  // they are *comparable* — just a record of the arrangement, which a column
  // renderer needs and a nested renderer can ignore.
  function axisOf(children) {
    const rects = children
      .filter((c) => c.kind === "el")
      .map((c) => c.el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    if (rects.length < 2) return "column";

    let acrossPairs = 0;
    for (let i = 1; i < rects.length; i++) {
      const a = rects[i - 1];
      const b = rects[i];
      const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const sideBySide = yOverlap > Math.min(a.height, b.height) * 0.5 && b.left >= a.right - 4;
      if (sideBySide) acrossPairs++;
    }
    return acrossPairs >= rects.length - 1 ? "row" : "column";
  }

  // Geometry's only structural job: the DOM can be flatly wrong about reading
  // order (order:, row-reverse, absolute positioning), and reading order is
  // load-bearing for comprehension.
  function reorderIfVisuallyReordered(el, children) {
    const cs = getComputedStyle(el);
    const reversed = cs.flexDirection?.endsWith("reverse");
    const explicitOrder = children.some(
      (c) => c.kind === "el" && getComputedStyle(c.el).order !== "0"
    );
    if (!reversed && !explicitOrder) return children;

    const withRects = children.map((c, i) => ({
      c,
      i,
      r: c.kind === "el" ? c.el.getBoundingClientRect() : null,
    }));
    withRects.sort((a, b) => {
      if (!a.r || !b.r) return a.i - b.i;
      if (Math.abs(a.r.top - b.r.top) > 4) return a.r.top - b.r.top;
      return a.r.left - b.r.left;
    });
    return withRects.map((w) => w.c);
  }

  // Heading association is a heuristic, not an authoritative restructuring:
  // there is no browser-implemented outline algorithm to lean on. Geometry
  // vetoes it when the following siblings are not actually laid out beneath
  // the heading (scattered grid cells, multi-column boards). On veto we keep
  // the flat sequence rather than inventing nesting.
  function scopeHeadings(children) {
    const out = [];
    let i = 0;
    while (i < children.length) {
      const node = children[i];
      const level = node.kind === "el" ? node.heading : 0;
      if (!level) {
        out.push(node);
        i++;
        continue;
      }

      const headingRect = node.el.getBoundingClientRect();
      const gathered = [];
      let j = i + 1;
      while (j < children.length) {
        const next = children[j];
        if (next.kind === "el" && next.heading && next.heading <= level) break;
        if (next.kind === "el") {
          const r = next.el.getBoundingClientRect();
          const xOverlap =
            Math.min(r.right, headingRect.right) - Math.max(r.left, headingRect.left);
          const belowHeading = r.top >= headingRect.top - 4;
          const sameColumn = xOverlap > Math.min(r.width, headingRect.width) * 0.5;
          if (!belowHeading || !sameColumn) break; // veto
        }
        gathered.push(next);
        j++;
      }

      if (gathered.length) {
        out.push({
          kind: "group",
          name: textOf(node),
          level, // lets the renderer emit a real Markdown heading
          block: true,
          children: gathered.map((c) => carryItem(c, toIR(c))).filter(Boolean),
        });
        i = j;
      } else {
        out.push(node);
        i++;
      }
    }
    return out;
  }

  function textOf(node) {
    if (node.kind === "text") return node.text;
    if (node.kind === "el") return node.children.map(textOf).join(" ").trim();
    return "";
  }

  // A repeated sibling shape is a record boundary. Marking it lets the
  // renderer number them, which is the structure a flat dump loses — you can
  // no longer tell where one repository card ends and the next begins.
  // Only applied to multi-part records, so repeated words don't get numbered.
  //
  // This deliberately does NOT exclude list items. Real record lists are
  // usually built from <li>, so skipping bullets skipped the exact case the
  // rule exists for; a numbered multi-part record beats a bulleted one anyway,
  // because the number gives an agent something to refer back to.
  function carryItem(raw, ir) {
    if (!ir) return ir;
    if (raw.repeated && ir.kind === "group" && ir.children.length >= 2) {
      return { ...ir, item: true };
    }
    return ir;
  }

  function toIR(node) {
    if (node.kind !== "el") return node;

    let children = node.children;
    markRepeats(children);
    const axis = axisOf(children);
    children = reorderIfVisuallyReordered(node.el, children);
    children = scopeHeadings(children);

    // scopeHeadings already converted scoped subtrees; convert the rest.
    children = children
      .map((c) => (c.kind === "el" ? carryItem(c, toIR(c)) : c))
      .filter(Boolean);

    // Collapse non-meaningful wrappers into their parent. Dissolving a node
    // must not dissolve its line semantics with it — an <li> holding one text
    // node is still a list item, not a loose word.
    const flat = [];
    for (const c of children) {
      if (c.kind === "group" && !c.name && c.children.length === 1 && !c.item && !c.bullet) {
        const only = c.children[0];
        flat.push({
          ...only,
          block: only.block || c.block,
          bullet: only.bullet || c.bullet,
          href: only.href || c.href,
        });
      } else if (c.kind === "group" && !c.name && c.children.length === 0) {
        // nothing survived; drop it
      } else {
        flat.push(c);
      }
    }

    if (!meaningful(node) && flat.length <= 1) {
      const only = flat[0] || null;
      if (!only) return null;
      return {
        ...only,
        block: only.block || node.block,
        bullet: only.bullet || node.bullet,
        href: only.href || node.href,
      };
    }

    // A link wrapping only inline text is a link, not a container.
    if (node.href && flat.every((c) => c.kind === "text" && !c.block)) {
      const text = flat.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
      if (text) return { kind: "text", text, href: node.href, block: node.block };
    }

    return {
      kind: "group",
      name: mask.name(node.name) || "",
      level: node.heading || 0,
      block: node.block,
      bullet: node.bullet,
      href: node.href,
      axis,
      children: flat,
    };
  }

  // --------------------------------------------------------------- context

  // Read upward only for names. Never sibling values — that is precisely the
  // leak that expanding the selection would have caused.
  function contextChain(startEl) {
    const names = [];
    let el = startEl;
    while (el && names.length < MAX_CONTEXT_ANCESTORS) {
      const name =
        accessibleName(el) ||
        (SEMANTIC_TAGS.has(el.tagName) || el.getAttribute("role")
          ? renderedText(el.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4"))
          : "");
      if (name) names.push(mask.name(name.replace(/\s+/g, " ").slice(0, 80)));
      el = el.parentElement;
    }
    return names.reverse();
  }

  // ------------------------------------------------------------------ entry

  C4C.extract = function extract(range) {
    mask.reset();
    lastRunRect = null;
    lastRunEndedWithSpace = true;

    const root =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (!root) return null;

    const raw = visitElement(root, range);
    if (!raw) return null;

    const ir = toIR(raw);
    const children = !ir ? [] : ir.kind === "group" && !ir.name ? ir.children : [ir];

    return {
      kind: "doc",
      context: contextChain(root.parentElement),
      url: mask.url(location.href),
      masked: mask.count,
      children,
    };
  };
})();
